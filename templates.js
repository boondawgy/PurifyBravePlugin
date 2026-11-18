import {defaultRequestBody} from './core.js';

export const exampleVariables = Object.freeze({
  file_path: '/media/Movies/Example Movie.mp4', plex_file_path: '/Volumes/Media/Media/Movies/Example Movie.mp4',
  title: 'Example Movie', profile: 'Movie', year: 2003, media_type: 'video',
  rating_key: '12345', server_id: 'example-server', duration_ms: 5400000, plex_guid: 'plex://movie/example'
});

export function requestVariables(metadata, context, payload) {
  return {
    file_path: payload.file_path, plex_file_path: metadata.Media[0].Part[0].file,
    title: metadata.title, profile: 'Movie', year: metadata.year ?? null, media_type: 'video',
    rating_key: context.ratingKey, server_id: context.server,
    duration_ms: metadata.duration ?? null, plex_guid: metadata.guid ?? null
  };
}

export function renderRequestBody(template = defaultRequestBody, variables = exampleVariables) {
  let parsed;
  try { parsed = JSON.parse(template); }
  catch { throw new Error('POST body must be valid JSON. Put placeholders inside double-quoted JSON strings, for example "{{file_path}}".'); }
  const variable = name => {
    if (!Object.hasOwn(exampleVariables, name) || !Object.hasOwn(variables, name)) throw new Error(`Unknown POST body variable: {{${name}}}.`);
    return variables[name];
  };
  function render(value) {
    if (typeof value === 'string') {
      const whole = value.match(/^{{\s*([a-z_]+)\s*}}$/);
      if (whole) return variable(whole[1]);
      // Check the template, never rescan inserted data (filenames can contain braces).
      const remainder = value.replace(/{{\s*([a-z_]+)\s*}}/g, '');
      if (remainder.includes('{{') || remainder.includes('}}')) throw new Error('Invalid POST body placeholder. Use a documented {{variable}}.');
      return value.replace(/{{\s*([a-z_]+)\s*}}/g, (_, name) => String(variable(name) ?? ''));
    }
    if (Array.isArray(value)) return value.map(render);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key.includes('{{') || key.includes('}}')) throw new Error('POST body placeholders are supported in values, not field names.');
      return [key, render(child)];
    }));
    return value;
  }
  const result = render(parsed);
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error('POST body must be a JSON object.');
  if (typeof result.file_path !== 'string' || !result.file_path.startsWith('/') || result.file_path.includes('\0')) {
    throw new Error('POST body needs an absolute file_path, normally "{{file_path}}".');
  }
  return result;
}
