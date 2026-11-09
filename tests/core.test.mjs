import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, mapPath, movieContext, moviePayload, baseUrl} from '../core.js';

test('maps the exact user path with lowercase media', () => {
  assert.equal(mapPath('/Volumes/Media/Media/Movies/13 Going on 30 (2004).mp4', defaults.sourcePrefix, defaults.targetPrefix), '/media/Movies/13 Going on 30 (2004).mp4');
});
test('mapping respects boundaries and case', () => {
  for (const path of ['/Volumes/Media/Media2/film.mp4', '/volumes/Media/Media/film.mp4']) assert.throws(() => mapPath(path, defaults.sourcePrefix, defaults.targetPrefix));
});
test('parses hosted and local detail routes without confusing library IDs for movies', () => {
  for (const origin of ['https://app.plex.tv/desktop/', 'http://localhost:32400/web/index.html']) {
    assert.deepEqual(movieContext(`${origin}#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F123`), {server: 'abc', ratingKey: '123'});
    assert.equal(movieContext(`${origin}#!/media/abc/com.plexapp.plugins.library?source=8`), null);
  }
});
test('uses existing Purifier API names', () => {
  assert.deepEqual(moviePayload({type: 'movie', title: 'Film', Media: [{Part: [{file: '/Volumes/Media/Media/Movies/Film.mp4'}]}]}, defaults), {file_path: '/media/Movies/Film.mp4', profile: 'Movie', title: 'Film'});
});
test('rejects TV, missing files, multiple versions, and multiple parts', () => {
  for (const item of [{type:'episode'}, {type:'movie'}, {type:'movie', Media:[{},{}]}, {type:'movie',Media:[{Part:[{file:'a'},{file:'b'}]}]}]) assert.throws(() => moviePayload(item, defaults));
});
test('only accepts server origins', () => {
  assert.equal(baseUrl('http://localhost:8787/'), 'http://localhost:8787');
  for (const url of ['file:///tmp', 'https://host/path', 'https://user:pass@host', 'https://host/?token=secret']) assert.throws(() => baseUrl(url));
});
