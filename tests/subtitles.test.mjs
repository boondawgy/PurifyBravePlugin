import test from 'node:test';
import assert from 'node:assert/strict';
import {subtitleWebhookUrl, requestSubtitleExport} from '../subtitles.js';
import {jsonRequest} from '../requests.js';

test('subtitle action sends exactly one POST with no body or credentials to the requested URL', async () => {
  const calls=[];
  const request=async (...args)=>calls.push(args);
  assert.deepEqual(await requestSubtitleExport(request),{message:'Subtitle export requested.'});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'http://192.168.0.228:5678/webhook/plex-export-downloaded-subtitles');
  assert.deepEqual(calls[0][1],{method:'POST'});
  assert.equal(calls[0][4],true);
});
test('subtitle action propagates webhook failures', async () => {
  await assert.rejects(requestSubtitleExport(async()=>{throw new Error('offline');}),/offline/);
});
test('webhook accepts text and empty HTTP success responses', async () => {
  for (const response of [new Response('Workflow was started'),new Response(null,{status:204})]) {
    assert.deepEqual(await jsonRequest(subtitleWebhookUrl,{method:'POST'},'Subtitle export webhook',async()=>response,true),{accepted:true});
  }
});
test('webhook still reports HTTP errors for non-JSON responses', async () => {
  await assert.rejects(jsonRequest(subtitleWebhookUrl,{},'Subtitle export webhook',async()=>new Response('Not found',{status:404}),true), /Subtitle export webhook \(HTTP 404\)/);
});
