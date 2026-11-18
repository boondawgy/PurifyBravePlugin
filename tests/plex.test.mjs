import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovieLookup, isMovieLibrary} from '../plex.js';

function memoryCache() {
  const values = new Map();
  return {get:async key=>values.get(key),set:async(key,value)=>values.set(key,value),delete:async key=>values.delete(key)};
}
const context = {server:'nas',ratingKey:'123'};
const item = {type:'movie',title:'Film',librarySectionID:2};
const verifiedItem = {...item, purifyMovieLibrary:true};
const sections = {MediaContainer:{Directory:[{key:'2',type:'movie',agent:'tv.plex.agents.movie'}]}};
const resources = [{clientIdentifier:'nas',provides:'server',connections:[{uri:'https://fast.plex.direct:32400'}]}];

test('discovery succeeds without waiting for a stalled local identity request', async () => {
  const request = async url => {
    if (url.endsWith('/library/sections')) return sections;
    if (url.endsWith('/identity')) return new Promise(()=>{});
    if (url.includes('/resources?')) return resources;
    return {MediaContainer:{Metadata:[item]}};
  };
  const lookup = createMovieLookup(request,memoryCache());
  assert.deepEqual(await lookup({plexUrl:'http://localhost:32400'},context,{},'key'),verifiedItem);
});
test('cached connection skips identity and discovery on the next movie', async () => {
  const calls=[];
  const request = async url => {calls.push(url);return url.endsWith('/library/sections')?sections:url.includes('/resources?')?resources:{MediaContainer:{Metadata:[item]}};};
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
    return url.endsWith('/library/sections')?sections:url.includes('/resources?')?resources:{MediaContainer:{Metadata:[item]}};
  };
  await createMovieLookup(request,cache)({},context,{},'key');
  assert.equal((await cache.get('key')).origin,'https://fast.plex.direct:32400');
});
test('races discovered connections so a slow first connection cannot block a fast one', async () => {
  const request=async url=>{
    if(url.endsWith('/library/sections'))return sections;
    if(url.includes('/resources?'))return [{...resources[0],connections:[{uri:'https://slow.plex.direct'},{uri:'https://fast.plex.direct'}]}];
    if(url.includes('slow.plex.direct'))return new Promise(()=>{});
    return {MediaContainer:{Metadata:[item]}};
  };
  assert.deepEqual(await createMovieLookup(request,memoryCache())({},context,{},'key'),verifiedItem);
});

test('recognizes movie agents and excludes personal-media, missing, and non-movie libraries', () => {
  for (const agent of ['tv.plex.agents.movie','com.plexapp.agents.plexmovie','com.plexapp.agents.imdb','com.plexapp.agents.themoviedb']) {
    assert.equal(isMovieLibrary({type:'movie', agent}), true);
  }
  for (const section of [undefined, {type:'movie'}, {type:'movie',agent:'com.plexapp.agents.none'}, {type:'movie',agent:'tv.plex.agents.none'}, {type:'show',agent:'tv.plex.agents.series'}]) {
    assert.equal(isMovieLibrary(section), false);
  }
});
test('checks the actual library for home-video items instead of treating type movie as sufficient', async () => {
  let sectionReads = 0;
  const request = async url => {
    if (url.includes('/resources?')) return resources;
    if (url.endsWith('/library/sections')) {
      sectionReads++;
      return {MediaContainer:{Directory:[{key:'17', type:'movie', agent:'com.plexapp.agents.none'}]}};
    }
    return {MediaContainer:{librarySectionID:17,Metadata:[{type:'movie',title:'Home video'}]}};
  };
  const lookup = createMovieLookup(request,memoryCache());
  assert.equal((await lookup({},context,{},'key')).purifyMovieLibrary, false);
  assert.equal((await lookup({}, {...context,ratingKey:'456'}, {}, 'key')).purifyMovieLibrary, false);
  assert.equal(sectionReads, 1);
});
