import {defaults, baseUrl} from './core.js';
const form = document.getElementById('settings');
const status = document.getElementById('status');
const saved = {...defaults, ...await chrome.storage.local.get(Object.keys(defaults))};
for (const key of Object.keys(defaults)) document.getElementById(key).value = saved[key];
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(Object.keys(defaults).map(key => [key, document.getElementById(key).value.trim()]));
    values.purifierUrl = baseUrl(values.purifierUrl);
    if (values.plexUrl) values.plexUrl = baseUrl(values.plexUrl);
    if (!values.sourcePrefix.startsWith('/') || !values.targetPrefix.startsWith('/')) throw new Error('Both path prefixes must start with /.');
    const origins = [...new Set([`${values.purifierUrl}/*`, ...(values.plexUrl ? [`${values.plexUrl}/*`] : []), 'https://*.plex.direct/*'])];
    // Request permissions within the Save button's user gesture.
    if (!await chrome.permissions.request({origins})) throw new Error('Site access is needed to contact Plex and Purifier. Settings were not saved.');
    await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
    await chrome.storage.local.set(values);
    status.textContent = 'Saved. Refresh Plex, open a movie’s three-dot menu, and choose Purify.';
  } catch (error) { status.textContent = error.message; }
});
