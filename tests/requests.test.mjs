import test from 'node:test';
import assert from 'node:assert/strict';
import {plexHeaders, jsonRequest} from '../requests.js';

test('Plex discovery includes required client identity and product headers', () => {
  const headers = plexHeaders('private-token', 'installation-id');
  assert.equal(headers['X-Plex-Client-Identifier'], 'installation-id');
  assert.equal(headers['X-Plex-Product'], 'Purify for Plex');
  assert.equal(headers['X-Plex-Token'], 'private-token');
});
test('distinguishes a discovery rejection from a Purifier rejection', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({errors:[{message:'Missing client identifier'}]}), {status:400});
  await assert.rejects(jsonRequest('https://plex.tv/api/v2/resources', {}, 'Plex server discovery', fakeFetch), /Plex server discovery \(HTTP 400\): Missing client identifier/);
});
test('shows Purifier profile validation errors', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({message:'Unknown profile: Movie'}), {status:400});
  await assert.rejects(jsonRequest('http://localhost:8787/media', {}, 'Purifier submission', fakeFetch), /Purifier submission \(HTTP 400\): Unknown profile: Movie/);
});
test('redacts credentials and extracts non-JSON error titles', async () => {
  const fakeFetch = async () => new Response('<title>Rejected private-token</title>', {status:400});
  await assert.rejects(jsonRequest('https://plex.tv/api/v2/resources', {headers:plexHeaders('private-token','id')}, 'Plex', fakeFetch), /Rejected \[redacted\]/);
});
test('returns successful queue responses without changing submission', async () => {
  const fakeFetch = async (url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    return new Response('{"queued":true}', {status:202});
  };
  assert.deepEqual(await jsonRequest('http://localhost:8787/media', {method:'POST'}, 'Purifier', fakeFetch), {queued:true});
});
