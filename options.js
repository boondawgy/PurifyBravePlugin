import {defaultRequestBody, defaults, baseUrl} from './core.js';
import {renderRequestBody} from './templates.js';
const form = document.getElementById('settings');
const status = document.getElementById('status');
const saved = {...defaults, ...await chrome.storage.local.get(Object.keys(defaults))};
for (const key of Object.keys(defaults)) {
  const input = document.getElementById(key);
  if (input.type === 'checkbox') input.checked = saved[key];
  else input.value = saved[key];
}
const templateInput = document.getElementById('requestBodyTemplate');
function updateTemplatePreview() {
  try {
    const rendered = renderRequestBody(templateInput.value);
    document.getElementById('templatePreview').textContent = JSON.stringify(rendered, null, 2);
    document.getElementById('templateStatus').textContent = 'Valid template. Save settings to use it.';
  } catch (error) {
    document.getElementById('templatePreview').textContent = '';
    document.getElementById('templateStatus').textContent = error.message;
  }
}
templateInput.addEventListener('input', updateTemplatePreview);
document.getElementById('resetBodyTemplate').addEventListener('click', () => {
  templateInput.value = defaultRequestBody;
  updateTemplatePreview();
});
updateTemplatePreview();
async function showLastRefresh() {
  const info = await chrome.runtime.sendMessage({type: 'purify-sync-info'});
  document.getElementById('lastRefresh').textContent = (info?.fetchedAt
    ? `Last successful refresh: ${new Date(info.fetchedAt).toLocaleString()}.`
    : 'Status has not been refreshed yet.') + (info?.error ? ` ${info.error}` : '');
}
showLastRefresh().catch(() => {});
const refreshButton = document.getElementById('refreshStatus');
refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  const result = document.getElementById('refreshResult');
  try {
    const response = await chrome.runtime.sendMessage({type: 'purify-refresh-now'});
    result.textContent = response?.message || 'Could not refresh status.';
    await showLastRefresh();
  } catch { result.textContent = 'Reload the extension and try again.'; }
  finally { refreshButton.disabled = false; }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(Object.keys(defaults).map(key => [key, document.getElementById(key).type === 'checkbox' ? document.getElementById(key).checked : document.getElementById(key).value.trim()]));
    renderRequestBody(values.requestBodyTemplate);
    values.statusRefreshHours = Number(values.statusRefreshHours);
    if (!Number.isInteger(values.statusRefreshHours) || values.statusRefreshHours < 1 || values.statusRefreshHours > 8760) throw new Error('Choose a refresh interval from 1 to 8760 whole hours.');
    values.purifierUrl = baseUrl(values.purifierUrl);
    if (values.plexUrl) values.plexUrl = baseUrl(values.plexUrl);
    if (!values.sourcePrefix.startsWith('/') || !values.targetPrefix.startsWith('/')) throw new Error('Both path prefixes must start with /.');
    if (!!values.statusSourcePrefix !== !!values.statusTargetPrefix ||
        (values.statusSourcePrefix && (!values.statusSourcePrefix.startsWith('/') || !values.statusTargetPrefix.startsWith('/')))) {
      throw new Error('Enter both status path prefixes as absolute paths, or leave both blank.');
    }
    const origins = [...new Set([`${values.purifierUrl}/*`, ...(values.plexUrl ? [`${values.plexUrl}/*`] : []), 'https://*.plex.direct/*'])];
    // Request permissions within the Save button's user gesture.
    if (!await chrome.permissions.request({origins})) throw new Error('Site access is needed to contact Plex and Purifier. Settings were not saved.');
    await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
    await chrome.storage.local.set(values);
    const response = await chrome.runtime.sendMessage({type: 'purify-refresh-settings'});
    status.textContent = response?.ok === false ? `Settings saved. ${response.message}` : 'Settings saved.';
    await showLastRefresh();
  } catch (error) { status.textContent = error.message; }
});
