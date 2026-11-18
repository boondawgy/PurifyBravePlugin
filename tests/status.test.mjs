import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatusSync, fetchSnapshot, matchStatus, snapshotKey} from '../status.js';
import {defaults} from '../core.js';
const settings = {...defaults};
const job = (id = 1, status = 'completed', extras = {}) => ({
  job_id:id, file_path:'/media/Movies/Film.mp4', submitted_file_path:'/plex/Movies/Film.mp4',
  media_type:'video', status, authoritative:true, authoritative_job_id:id, error:null, ...extras
});
const page = (items, next_cursor = null) => ({api_version:1, items, next_cursor, missing_file_paths:[]});
function storage() {
  const values = {};
  return {values, async get(key) {return {[key]:values[key]};}, async set(items) {Object.assign(values, items);}};
}

test('traverses every opaque cursor with fixed video filter and no Plex credentials', async () => {
  const calls = [];
  const jobs = await fetchSnapshot(settings, async (url, init) => {
    calls.push(url);
    assert.equal(init.method, 'GET');
    assert.deepEqual(init.headers, {Accept:'application/json'});
    assert.equal(init.body, undefined);
    const params = new URL(url).searchParams;
    assert.equal(params.get('media_type'), 'video');
    assert.equal(params.get('limit'), '100');
    return params.has('cursor') ? page([job(1, 'completed', {authoritative:false, authoritative_job_id:2})]) : page([job(2, 'failed')], 'opaque+/=');
  });
  assert.equal(new URL(calls[1]).searchParams.get('cursor'), 'opaque+/=');
  assert.equal(jobs.length, 2);
  assert.equal(matchStatus({jobs}, '/plex/Movies/Film.mp4').status, 'failed');
});
test('exact aliases resolve to canonical authoritative job even if its submitted path differs', async () => {
  const jobs = await fetchSnapshot(settings, async () => page([
    job(2, 'processing', {submitted_file_path:'/another/path'}),
    job(1, 'completed', {authoritative:false, authoritative_job_id:2})
  ]));
  assert.equal(matchStatus({jobs}, '/plex/Movies/Film.mp4').status, 'processing');
  assert.equal(matchStatus({jobs}, '/media/Movies/Film.mp4').status, 'processing');
  assert.equal(matchStatus({jobs}, '/MEDIA/Movies/Film.mp4').status, 'unknown');
  assert.equal(matchStatus({jobs}, '/media/Movies/Other.mp4').status, 'unknown');
});
test('ambiguous aliases stay unknown; a local POST remains pending when absent or newer', async () => {
  const jobs = await fetchSnapshot(settings, async () => page([job(), job(2, 'failed', {file_path:'/changed/map/Film.mp4'})]));
  assert.equal(matchStatus({jobs}, '/plex/Movies/Film.mp4').status, 'unknown');
  const local = {jobId:3, sentAt:100};
  assert.equal(matchStatus({jobs, fetchedAt:200}, '/media/Movies/Film.mp4', local).status, 'sent');
  assert.equal(matchStatus({jobs:[], fetchedAt:200}, '/missing', local).status, 'sent');
});
test('coalesces tabs, survives worker recreation, and refreshes only when daily cache is due', async () => {
  let now = 1000, calls = 0;
  const saved = storage();
  const request = async () => {calls++; return page([job()]);};
  let sync = createStatusSync({storage:saved, request, now:() => now});
  await Promise.all([sync.ensure(settings), sync.ensure(settings), sync.ensure(settings)]);
  assert.equal(calls, 1);
  sync = createStatusSync({storage:saved, request, now:() => now});
  await sync.ensure(settings);
  assert.equal(calls, 1);
  now += 24 * 3600000;
  await sync.ensure(settings);
  assert.equal(calls, 2);
});
test('off prevents automatic network calls but manual refresh bypasses off and interval', async () => {
  const saved = storage();
  let calls = 0;
  const sync = createStatusSync({storage:saved, request: async () => {calls++; return page([]);}});
  const off = {...settings, statusAutoRefresh:false};
  await sync.ensure(off);
  assert.equal(calls, 0);
  await sync.ensure(off, true);
  await sync.ensure(off, true);
  assert.equal(calls, 2);
});
test('failed later page preserves complete previous snapshot and backs off, manual retry works', async () => {
  const saved = storage();
  let now = 1000, fail = false, calls = 0;
  const sync = createStatusSync({storage:saved, now:() => now, request:async url => {
    calls++;
    if (fail && new URL(url).searchParams.has('cursor')) throw new Error('unavailable');
    return page([job()], fail ? 'next' : null);
  }});
  const before = await sync.ensure(settings);
  now += 24 * 3600000;
  fail = true;
  const failed = await sync.ensure(settings);
  assert.deepEqual(failed.jobs, before.jobs);
  assert.equal(failed.fetchedAt, before.fetchedAt);
  assert.equal(failed.error, 'unavailable');
  assert.equal(calls, 3);
  await sync.ensure(settings);
  assert.equal(calls, 3);
  fail = false;
  const recovered = await sync.ensure(settings, true);
  assert.equal(recovered.error, null);
  assert.equal(calls, 4);
});
test('rejects incompatible schemas, unknown states, and repeated cursors instead of inventing success', async () => {
  for (const response of [{api_version:2, items:[], next_cursor:null}, page([job(1, 'future')]), page([job(1, 'completed', {authoritative_job_id:2})])]) {
    await assert.rejects(fetchSnapshot(settings, async () => response));
  }
  await assert.rejects(fetchSnapshot(settings, async () => page([], 'same')), /pagination loop/);
});
test('cache is isolated by Purifier origin', async () => {
  assert.notEqual(snapshotKey(settings), snapshotKey({...settings, purifierUrl:'http://another:8787'}));
});

test('a manual failure on a fresh cache retries after backoff and preserves cached success in the meantime', async () => {
  let now = 1000, calls = 0, fail = false;
  const saved = storage();
  const sync = createStatusSync({storage:saved, now:() => now, request:async () => {
    calls++;
    if (fail) throw new Error('offline');
    return page([job()]);
  }});
  await sync.ensure(settings);
  fail = true;
  const failed = await sync.ensure(settings, true);
  assert.equal(matchStatus(failed, '/media/Movies/Film.mp4').status, 'completed');
  await sync.ensure(settings);
  assert.equal(calls, 2);
  now += 60000;
  fail = false;
  const recovered = await sync.ensure(settings);
  assert.equal(calls, 3);
  assert.equal(recovered.error, null);
});

test('explicit processing-to-library mapping matches exported files with the full relative path', async () => {
  const path = "/media/Movies/Disney's A Christmas Carol.mp4";
  const jobs = await fetchSnapshot(settings, async () => page([job(1415, 'completed', {
    file_path:"/processing/Movies/Disney's A Christmas Carol.mp4",
    submitted_file_path:"/processing/Movies/Disney's A Christmas Carol.mp4"
  })]));
  const mapped = {...settings, statusSourcePrefix:'/processing/', statusTargetPrefix:'/media/'};
  assert.equal(matchStatus({jobs}, path).status, 'unknown');
  assert.equal(matchStatus({jobs}, path, null, mapped).status, 'completed');
  for (const different of ["/media/Other/Disney's A Christmas Carol.mp4", "/media/Movies/A Christmas Carol.mp4", "/media/Movies/Disney's A Christmas Carol.mkv", "/MEDIA/Movies/Disney's A Christmas Carol.mp4"]) {
    assert.equal(matchStatus({jobs}, different, null, mapped).status, 'unknown');
  }
});
test('status prefix mapping respects boundaries and newer authoritative failures', async () => {
  const mapped = {...settings, statusSourcePrefix:'/processing', statusTargetPrefix:'/media'};
  const jobs = await fetchSnapshot(settings, async () => page([
    job(3, 'failed', {file_path:'/media/Movies/Film.mp4', submitted_file_path:'/media/Movies/Film.mp4'}),
    job(2, 'completed', {file_path:'/processing/Movies/Film.mp4', submitted_file_path:'/processing/Movies/Film.mp4'}),
    job(1, 'completed', {file_path:'/processing2/Movies/Other.mp4', submitted_file_path:'/processing2/Movies/Other.mp4'})
  ]));
  assert.equal(matchStatus({jobs}, '/media/Movies/Film.mp4', null, mapped).status, 'failed');
  assert.equal(matchStatus({jobs}, '/media/Movies/Other.mp4', null, mapped).status, 'unknown');
});
