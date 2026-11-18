import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, moviePayload} from '../core.js';
import {exampleVariables, renderRequestBody, requestVariables} from '../templates.js';

test('default body preserves the existing POST contract', () => {
  assert.deepEqual(renderRequestBody(defaults.requestBodyTemplate), {file_path:exampleVariables.file_path,profile:'Movie',title:'Example Movie'});
});
test('renders nested processing JSON, string interpolation, and typed whole-value variables', () => {
  const body = renderRequestBody(JSON.stringify({file_path:'{{file_path}}', title:'{{title}} ({{year}})', year:'{{ year }}', processing:{remove_language:{enabled:true}}, tags:['{{media_type}}', 'literal'], extra:null}));
  assert.equal(body.year, 2003);
  assert.equal(body.title, 'Example Movie (2003)');
  assert.equal(body.processing.remove_language.enabled, true);
  assert.deepEqual(body.tags, ['video','literal']);
  assert.equal(body.extra, null);
});
test('movie strings cannot break JSON or inject fields, and inserted braces are not evaluated', () => {
  const variables = {...exampleVariables, title:'A "quote" \\ newline\n{{unknown}}', file_path:'/media/Movies/"},"injected":true,"a":".mp4'};
  const rendered = renderRequestBody(defaults.requestBodyTemplate, variables);
  const body = JSON.parse(JSON.stringify(rendered));
  assert.equal(body.title, variables.title);
  assert.equal(body.file_path, variables.file_path);
  assert.equal(body.injected, undefined);
});
test('validates JSON, documented placeholders, object body, field names, and file path', () => {
  for (const template of ['{', '[]', 'null', '42', '{"title":"{{title}}"}', '{"file_path":"relative.mp4"}', '{"file_path":"{{plex_token}}"}', '{"file_path":"{{file_path}}","title":"{{bad"}', '{"{{title}}":"x","file_path":"{{file_path}}"}', '{"file_path":{{file_path}}}']) {
    assert.throws(() => renderRequestBody(template));
  }
});
test('variables come only from selected movie metadata/context; missing optional values are null', () => {
  const metadata = {type:'movie',title:'Film',Media:[{Part:[{file:'/Volumes/Media/Media/Movies/Film.mp4'}]}]};
  const payload = moviePayload(metadata, defaults);
  const variables = requestVariables(metadata, {server:'nas',ratingKey:'123'}, payload);
  assert.equal(variables.file_path, '/media/Movies/Film.mp4');
  assert.equal(variables.plex_file_path, '/Volumes/Media/Media/Movies/Film.mp4');
  assert.equal(variables.rating_key, '123');
  assert.equal(variables.server_id, 'nas');
  assert.equal(variables.year, null);
  assert.equal(variables.duration_ms, null);
  assert.equal(variables.plex_guid, null);
  assert.equal(variables.plex_token, undefined);
  assert.equal(renderRequestBody('{"file_path":"{{file_path}}","year":"{{year}}"}', variables).year, null);
});
