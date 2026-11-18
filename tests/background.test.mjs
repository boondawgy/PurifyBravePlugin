import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createStatusSync, matchStatus, refreshInterval, refreshAlarm} from '../status.js';
import {defaults, baseUrl, moviePayload} from '../core.js';

function extension({movieLibrary = true, jobs = [], type = 'movie', queued = true} = {}) {
  const values = {plexToken: 'secret'};
  let listener;
  let posts = 0;
  const broadcasts = [];
  const storage = {
    setAccessLevel() {},
    async get(keys) {
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]).filter(([,value]) => value !== undefined));
    },
    async set(items) { Object.assign(values, items); },
    async remove(key) { delete values[key]; }
  };
  const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, {
    defaults, baseUrl, moviePayload, TextEncoder, URL, crypto: webcrypto,
    createStatusSync, matchStatus, refreshInterval, refreshAlarm,
    plexHeaders: () => ({}),
    createMovieLookup: () => async () => ({type, purifyMovieLibrary: movieLibrary, title: 'Film', Media: [{Part: [{file: '/Volumes/Media/Media/Movies/Film.mp4'}]}]}),
    jsonRequest: async (url, init) => {
      if (init.method === 'GET') return {api_version: 1, items: jobs, next_cursor: null};
      assert.equal(init.method, 'POST'); posts++; return {queued, job_id: 100};
    },
    chrome: {
      alarms: {clear: async () => {}, create: async () => {}, onAlarm: {addListener() {}}},
      tabs: {query: async () => [{id: 1}, {id: 2}], sendMessage: async (id, message) => { broadcasts.push({id, ...message}); }},
      action: {onClicked: {addListener() {}}},
      storage: {local: storage, session: storage},
      runtime: {onStartup: {addListener() {}}, onInstalled: {addListener() {}}, getURL: path => `chrome-extension://test/${path}`, onMessage: {addListener(fn) { listener = fn; }}}
    }
  });
  return {
    values,
    broadcasts,
    optionsMessage: type => new Promise(resolve => listener({type}, {url: 'chrome-extension://test/options.html'}, resolve)),
    posts: () => posts,
    message: (type, context = {server: 'nas', ratingKey: '123'}) => new Promise(resolve => {
      listener({type, context}, {tab: {url: 'https://app.plex.tv/desktop/'}}, resolve);
    })
  };
}

test('eligibility is read-only; accepted submission persists and prevents another POST', async () => {
  const app = extension();
  assert.equal((await app.message('purify-status')).eligible, true);
  assert.equal(app.posts(), 0);
  assert.equal((await app.message('purify')).sent, true);
  assert.equal((await app.message('purify-status')).sent, true);
  assert.equal((await app.message('purify')).sent, true);
  assert.equal(app.posts(), 1);
  assert.equal(Object.keys(app.values).filter(key => key.startsWith('sent:')).length, 1);
});
test('rejected queue response does not persist sent status and allows retry', async () => {
  const app = extension({queued: false});
  assert.equal((await app.message('purify')).ok, false);
  assert.equal((await app.message('purify-status')).sent, false);
  assert.equal((await app.message('purify')).ok, false);
  assert.equal(app.posts(), 2);
});
test('TV items have no poster action and cannot be submitted', async () => {
  const app = extension({type: 'episode'});
  assert.equal((await app.message('purify-status')).eligible, false);
  assert.equal((await app.message('purify')).ok, false);
  assert.equal(app.posts(), 0);
});
test('invalid context is rejected before requests', async () => {
  const app = extension();
  assert.equal((await app.message('purify', {server:'nas', ratingKey:'../other'})).ok, false);
  assert.equal(app.posts(), 0);
});

test('refresh defaults to daily and respects saved off/custom interval settings', async () => {
  const app = extension();
  let policy = await app.message('purify-refresh-policy');
  assert.equal(policy.enabled, true);
  assert.equal(policy.hours, 24);
  app.values.statusAutoRefresh = false;
  app.values.statusRefreshHours = 72;
  policy = await app.message('purify-refresh-policy');
  assert.equal(policy.enabled, false);
  assert.equal(policy.hours, 72);
  assert.equal(app.posts(), 0);
});
test('manual refresh broadcasts even when automatic refresh is off, without submitting jobs', async () => {
  const app = extension();
  app.values.statusAutoRefresh = false;
  const result = await app.optionsMessage('purify-refresh-now');
  assert.equal(result.ok, true);
  assert.equal(app.broadcasts.length, 2);
  assert.equal(app.broadcasts[0].type, 'purify-status-updated');
  assert.equal(app.posts(), 0);
});

const job = {job_id: 20, file_path:'/media/Movies/Film.mp4', submitted_file_path:'/media/Movies/Film.mp4', media_type:'video', status:'completed', authoritative:true, authoritative_job_id:20};
test('discovers completed jobs submitted by another client and prevents another POST', async () => {
  const app = extension({jobs:[job]});
  const status = await app.message('purify-status');
  assert.equal(status.status, 'completed');
  assert.equal(status.sent, true);
  assert.equal((await app.message('purify')).status, 'completed');
  assert.equal(app.posts(), 0);
});
test('a failed authoritative job permits a retry and immediately becomes locally sent', async () => {
  const app = extension({jobs:[{...job, status:'failed', error:{message:'Processing failed.'}}]});
  assert.equal((await app.message('purify-status')).status, 'failed');
  assert.equal((await app.message('purify')).status, 'sent');
  assert.equal((await app.message('purify-status')).status, 'sent');
  assert.equal(app.posts(), 1);
});

test('home videos with movie item type get neither a poster button nor submission, even with a known Purifier job', async () => {
  const app = extension({movieLibrary:false, jobs:[job]});
  assert.equal((await app.message('purify-status')).eligible, false);
  assert.equal((await app.message('purify')).ok, false);
  assert.equal(app.posts(), 0);
});

test('status-only mapping finds exported processing jobs while leaving submissions at the library path', async () => {
  const app = extension({jobs:[{...job,file_path:'/processing/Movies/Film.mp4',submitted_file_path:'/processing/Movies/Film.mp4'}]});
  app.values.statusSourcePrefix = '/processing';
  app.values.statusTargetPrefix = '/media';
  assert.equal((await app.message('purify-status')).status, 'completed');
  assert.equal((await app.message('purify')).sent, true);
  assert.equal(app.posts(), 0);
});
