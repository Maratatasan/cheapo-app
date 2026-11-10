import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRemote } from './session-remote.mjs';
const session={clientId:'issued',refreshToken:'private-refresh',subject:'same'};
test('refresh uses issued client/resource without changing scope and validates renewed identity',async()=>{
  let identityValidated=false;
  const api=sessionRemote({remote:async(url,options)=>{assert.equal(url,'https://auth.openai.com/api/accounts/oauth/token');assert.deepEqual(Object.fromEntries(options.body),{grant_type:'refresh_token',client_id:'issued',refresh_token:'private-refresh',resource:'https://api.openai.com/v1'});return Response.json({access_token:'new',refresh_token:'rotated',expires_in:3600,id_token:'signed'});},validateIdentity:async(token,record)=>{assert.equal(token,'signed');assert.equal(record.subject,'same');identityValidated=true;}});
  assert.equal((await api.refresh(session)).refresh_token,'rotated');assert.equal(identityValidated,true);
});
test('logout discovers the revocation endpoint and sends only the selected renewable session',async()=>{
  const calls=[];const api=sessionRemote({remote:async(url,options)=>{calls.push(String(url));if(!options)return Response.json({revocation_endpoint:'https://auth.openai.com/revoke'});assert.deepEqual(Object.fromEntries(options.body),{token:'private-refresh',token_type_hint:'refresh_token',client_id:'issued'});return new Response(null,{status:200});}});
  assert.equal(await api.revoke(session),true);assert.deepEqual(calls,['https://auth.openai.com/.well-known/openid-configuration','https://auth.openai.com/revoke']);
});
test('discovery cannot redirect refresh credentials to another origin',async()=>{
  let calls=0;const api=sessionRemote({remote:async()=>{calls++;return Response.json({revocation_endpoint:'https://evil.test/revoke'});}});
  await assert.rejects(api.revoke(session),/Invalid revocation/);assert.equal(calls,1);
});
