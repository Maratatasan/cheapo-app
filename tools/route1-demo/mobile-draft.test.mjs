import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardMobile, completeMobileResponse } from './mobile-draft.mjs';
const key = 'a'.repeat(43);
test('paired native draft boundary rejects missing, expired keys and browser/foreign hosts', () => {
  const req = { method:'POST', headers: { host:'10.0.2.2:8768', 'content-type':'application/json', 'x-cheapo-pairing':key } };
  assert.doesNotThrow(() => guardMobile(req,8768,{key,expires:Date.now()+10000}));
  for (const headers of [{...req.headers,'x-cheapo-pairing':'wrong'}, {...req.headers,host:'evil.test:8768'}, {...req.headers,origin:'http://evil.test'}]) assert.throws(()=>guardMobile({...req,headers},8768,{key,expires:Date.now()+10000}));
  assert.throws(()=>guardMobile(req,8768,{key,expires:0}));
});
test('accepts completed SSE without Content-Type and returns only reviewed draft metadata', async t => {
  const dir=await mkdtemp(join(tmpdir(),'cheapo-mobile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const draft={product:'Potatoes 2kg',price:2.5,currency:'GBP',unit_price:{amount:1.25,unit:'kg'},uncertainty:''};
  const body=`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(draft)}]}]}})}\n\n`;
  const result=await completeMobileResponse(new Response(Buffer.from(body),{headers:{'x-request-id':'req_mobile123'}}),join(dir,'response.jsonl'));
  assert.deepEqual(result.draft,draft);assert.equal(result.requestId,'req_mobile123');assert.equal('bodyText' in result,false);
});
test('failed and unfinished responses never become a successful price draft',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cheapo-mobile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const response of [new Response('{"error":{"code":"quota_exceeded","message":"private detail"}}',{status:429}),new Response(Buffer.from('data: {"type":"response.incomplete"}\n\n')),new Response(Buffer.from('data: {"type":"response.refusal.done"}\n\n')),new Response(Buffer.from('data: {"type":"response.created"}\n\n'))]) await assert.rejects(completeMobileResponse(response,join(dir,'response.jsonl')));
});
