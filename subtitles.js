import {jsonRequest} from './requests.js';

export const subtitleWebhookUrl = 'http://192.168.0.228:5678/webhook/plex-export-downloaded-subtitles';

export async function requestSubtitleExport(request = jsonRequest) {
  await request(subtitleWebhookUrl, {method: 'POST'}, 'Subtitle export webhook', undefined, true);
  return {message: 'Subtitle export requested.'};
}
