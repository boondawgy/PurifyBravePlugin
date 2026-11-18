import {defaults, baseUrl, moviePayload} from './core.js';
import {plexHeaders, jsonRequest} from './requests.js';
import {createMovieLookup} from './plex.js';
import {createStatusSync, matchStatus, refreshInterval, refreshAlarm} from './status.js';
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
// Keep the token in extension contexts, inaccessible to content scripts.
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
const pending = new Set();

// Persist one client identity per installed extension, as required by Plex's API.
let clientIdentifierPromise;
function getClientIdentifier() {
  return clientIdentifierPromise ||= (async () => {
    const {plexClientIdentifier} = await chrome.storage.local.get('plexClientIdentifier');
    if (plexClientIdentifier) return plexClientIdentifier;
    const identifier = crypto.randomUUID();
    await chrome.storage.local.set({plexClientIdentifier: identifier});
    return identifier;
  })();
}

const lookupMovie = createMovieLookup(jsonRequest, {
  async get(key) { return (await chrome.storage.session.get(key))[key]; },
  async set(key, value) { await chrome.storage.session.set({[key]: value}); },
  async delete(key) { await chrome.storage.session.remove(key); }
});

async function connectionCacheKey(settings, server) {
  // Isolate cache entries by server and credentials without storing tokens in keys.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify([settings.plexUrl, settings.plexToken, server])
  ));
  return 'plexConnection:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const getSettings = async () => ({...defaults, ...await chrome.storage.local.get(Object.keys(defaults))});
async function broadcast(type) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id != null).map(tab =>
    chrome.tabs.sendMessage(tab.id, {type}).catch(() => {})
  ));
}
const statusSync = createStatusSync({
  request: jsonRequest, storage: chrome.storage.local,
  changed: () => broadcast('purify-status-updated')
});
async function scheduleStatus(settings, snapshot) {
  await chrome.alarms.clear(refreshAlarm);
  if (!settings.statusAutoRefresh) return;
  const due = snapshot?.error ? snapshot.retryAt : snapshot?.fetchedAt ? snapshot.fetchedAt + refreshInterval(settings) : Date.now();
  await chrome.alarms.create(refreshAlarm, {when: Math.max(Date.now() + 60000, due)});
}
async function syncStatus(force = false) {
  const settings = await getSettings();
  const snapshot = await statusSync.ensure(settings, force);
  await scheduleStatus(settings, snapshot);
  return snapshot;
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === refreshAlarm) syncStatus().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => syncStatus().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => syncStatus().catch(() => {}));

async function movieAction(context, action) {
  if (!context || !/^[a-zA-Z0-9_-]+$/.test(context.server) || !/^\d+$/.test(context.ratingKey)) throw new Error('Cannot identify this Plex movie.');
  const key = `${context.server}:${context.ratingKey}`;
  // Status reads may overlap a submission. Only POST operations hold this lock.
  if (action === 'purify' && pending.has(key)) throw new Error('This movie is already being submitted.');
  if (action === 'purify') pending.add(key);
  try {
    const settings = await getSettings();
    if (!settings.plexToken) throw new Error('Open the Purify extension settings and add your Plex token first.');
    const statusKey = 'sent:' + JSON.stringify([baseUrl(settings.purifierUrl), settings.sourcePrefix, settings.targetPrefix, context.server, context.ratingKey]);
    const local = (await chrome.storage.local.get(statusKey))[statusKey];
    const headers = plexHeaders(settings.plexToken, await getClientIdentifier());
    const metadata = await lookupMovie(settings, context, headers, await connectionCacheKey(settings, context.server));
    if (metadata.type !== 'movie' || metadata.purifyMovieLibrary !== true) {
      if (action === 'purify-status') return {eligible: false, sent: false};
      throw new Error('Purify supports movie libraries only; home videos and other library types are excluded.');
    }
    const payload = moviePayload(metadata, settings);
    const snapshot = await statusSync.ensure(settings);
    await scheduleStatus(settings, snapshot);
    // Read again after the sync: another tab might have submitted while we waited.
    const latestLocal = (await chrome.storage.local.get(statusKey))[statusKey] || local;
    const state = matchStatus(snapshot, payload.file_path, latestLocal?.filePath === payload.file_path ? latestLocal : null, settings);
    const response = {eligible: true, ...state, stale: !!snapshot?.error, syncError: snapshot?.error || null};
    if (action === 'purify-status') return response;
    if (state.sent) return {...response, message: state.status === 'completed' ? 'Purifier processing completed.' : 'Already sent to Purifier.'};
    const result = await jsonRequest(`${baseUrl(settings.purifierUrl)}/media`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    }, 'Purifier submission');
    if (result.queued !== true) throw new Error(`Purifier did not queue the movie: ${result.reason || result.message || 'check its status page'}`);
    await chrome.storage.local.set({[statusKey]: {
      sentAt: Date.now(), filePath: payload.file_path,
      jobId: Number.isSafeInteger(result.job_id) ? result.job_id : null
    }});
    await broadcast('purify-status-updated');
    return {eligible: true, status: 'sent', sent: true, message: `Queued “${payload.title}” in Purifier.`};
  } finally { if (action === 'purify') pending.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const optionsSender = !sender.tab && sender.url === chrome.runtime.getURL('options.html');
  // Options may also be opened as a normal extension tab.
  const isOptions = optionsSender || sender.tab?.url === chrome.runtime.getURL('options.html');
  if (isOptions && ['purify-refresh-now', 'purify-refresh-settings'].includes(message?.type)) {
    (async () => {
      if (message.type === 'purify-refresh-now') {
        const snapshot = await syncStatus(true);
        if (snapshot?.error) return {ok: false, message: snapshot.error + ' Last known status was kept.'};
        return {ok: true, message: 'Purifier status refreshed. Open Plex tabs are updating.'};
      }
      const snapshot = await syncStatus();
      await broadcast('purify-refresh-settings');
      return {ok: !snapshot?.error, message: snapshot?.error || 'Refresh settings saved.'};
    })().then(respond).catch(error => respond({ok: false, message: error.message}));
    return true;
  }
  if (isOptions && message?.type === 'purify-sync-info') {
    getSettings().then(settings => statusSync.read(settings)).then(snapshot => respond({
      fetchedAt: snapshot?.fetchedAt || null, error: snapshot?.error || null
    })).catch(error => respond({error: error.message}));
    return true;
  }
  const url = sender.tab?.url && new URL(sender.tab.url);
  const allowed = url && (url.origin === 'https://app.plex.tv' || ['http://localhost:32400', 'http://127.0.0.1:32400'].includes(url.origin));
  if (!allowed) return;
  if (message?.type === 'purify-refresh-policy') {
    chrome.storage.local.get(['statusAutoRefresh', 'statusRefreshHours']).then(values => respond({
      enabled: values.statusAutoRefresh ?? defaults.statusAutoRefresh,
      hours: values.statusRefreshHours ?? defaults.statusRefreshHours
    }));
    return true;
  }
  if (!['purify', 'purify-status'].includes(message?.type)) return;
  movieAction(message.context, message.type).then(result => respond({ok: true, ...result})).catch(error => respond({ok: false, message: error.message}));
  return true;
});
