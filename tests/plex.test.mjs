import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovieLookup} from '../plex.js';

function memoryCache() {
  const values = new Map();
  return {get:async key=>values.get(key),set:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key)};
}
const context = {server:'nas',ratingKey:'123'};
const item = {type:'movie',title:'Film'};
const resources = [{clientIdentifier:'nas',provides:'server',connections:[{uri:'https://fast.plex.direct:32400'}]}];

test('discovery succeeds without waiting for a stalled local identity request', async () => {
  const request = async url => {
    if (url.endsWith('/identity')) return new Promise(()=>{});
    if (url.includes('/resources?')) return resources;
    return {MediaContainer:{Metadata:[item]}};
  };
  const lookup = createMovieLookup(request,memoryCache());
  assert.deepEqual(await lookup({plexUrl:'http://localhost:32400'},context,{},'key'),item);
});
test('cached connection skips identity and discovery on the next movie', async () => {
  const calls=[];
  const request = async url => {calls.push(url);return url.includes('/resources?')?resources:{MediaContainer:{Metadata:[item]}};};
  const lookup=createMovieLookup(request,memoryCache());
  await lookup({},context,{},'key');
  calls.length=0;
  await lookup({},context,{},'key');
  assert.equal(calls.length,1);
  assert.equal(calls[0],'https://fast.plex.direct:32400/library/metadata/123');
});
test('failed cached connection falls back to discovery', async () => {
  const cache=memoryCache();
  await cache.set('key',{origin:'https://old.plex.direct',expires:Date.now()+10000});
  const request=async url=>{
    if(url.includes('old.plex.direct'))throw new Error('offline');
    return url.includes('/resources?')?resources:{MediaContainer:{Metadata:[item]}};
  };
  await createMovieLookup(request,cache)({},context,{},'key');
  assert.equal((await cache.get('key')).origin,'https://fast.plex.direct:32400');
});
test('races discovered connections so a slow first connection cannot block a fast one', async () => {
  const request=async url=>{
    if(url.includes('/resources?'))return [{...resources[0],connections:[{uri:'https://slow.plex.direct'},{uri:'https://fast.plex.direct'}]}];
    if(url.includes('slow.plex.direct'))return new Promise(()=>{});
    return {MediaContainer:{Metadata:[item]}};
  };
  assert.deepEqual(await createMovieLookup(request,memoryCache())({},context,{},'key'),item);
});
