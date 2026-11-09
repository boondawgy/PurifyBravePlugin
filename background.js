import {defaults, baseUrl, moviePayload} from './core.js';
import {plexHeaders, jsonRequest} from './requests.js';
import {createMovieLookup} from './plex.js';
import {requestSubtitleExport} from './subtitles.js';
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

async function submitMovie(context, action) {
  if (!context || !/^[a-zA-Z0-9_-]+$/.test(context.server) || !/^\d+$/.test(context.ratingKey)) throw new Error('Cannot identify this Plex movie.');
  const key = `${action}:${context.server}:${context.ratingKey}`;
  if (pending.has(key)) throw new Error('This movie is already being submitted.');
  pending.add(key);
  try {
    if (action === 'save-subtitle') return await requestSubtitleExport();
    const settings = {...defaults, ...await chrome.storage.local.get(Object.keys(defaults))};
    if (!settings.plexToken) throw new Error('Open the Purify extension settings and add your Plex token first.');
    const headers = plexHeaders(settings.plexToken, await getClientIdentifier());
    const metadata = await lookupMovie(settings, context, headers, await connectionCacheKey(settings, context.server));
    const payload = moviePayload(metadata, settings);
    const result = await jsonRequest(`${baseUrl(settings.purifierUrl)}/media`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    }, 'Purifier submission');
    if (result.queued !== true) throw new Error(`Purifier did not queue the movie: ${result.reason || result.message || 'check its status page'}`);
    return {message: `Queued “${payload.title}” in Purifier.`};
  } finally { pending.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const url = sender.tab?.url && new URL(sender.tab.url);
  const allowed = url && (url.origin === 'https://app.plex.tv' || ['http://localhost:32400', 'http://127.0.0.1:32400'].includes(url.origin));
  if (!allowed || !['purify', 'save-subtitle'].includes(message?.type)) return;
  submitMovie(message.context, message.type).then(result => respond({ok: true, ...result})).catch(error => respond({ok: false, message: error.message}));
  return true;
});
