import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedSession } from './saved-session.mjs';
const record = {clientId:'issued-client',subject:'account-a',accessToken:'access-old',refreshToken:'refresh-old',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expires:200000};
function setup({initial=record,refresh=async()=>({access_token:'access-new',refresh_token:'refresh-new',expires_in:3600}),save=async()=>{},revoke=async()=>true}={}) {
  let disk=initial;let refreshes=0;
  const manager=createSavedSession({registration:{clientId:'issued-client',subject:'account-a'},store:{load:async()=>disk,save:async value=>{await save(value);disk=structuredClone(value);},clear:async()=>{disk=null;}},refresh:async value=>{refreshes++;return refresh(value);},revoke,now:()=>190000});
  return {manager,disk:()=>disk,refreshes:()=>refreshes};
}
test('restores saved registration and serializes rotating refresh for concurrent callers',async()=>{
  const s=setup();const [a,b]=await Promise.all([s.manager.current(),s.manager.current()]);
  assert.equal(a.accessToken,'access-new');assert.equal(b.refreshToken,'refresh-new');assert.equal(s.refreshes(),1);assert.equal(s.disk().refreshToken,'refresh-new');
});
test('never releases a rotated token until saved and retries storage without refreshing again',async()=>{
  let fail=true;const s=setup({save:async()=>{if(fail)throw Error('disk failure');}});
  await assert.rejects(s.manager.current(),/could not be saved/);assert.equal(s.disk().refreshToken,'refresh-old');
  fail=false;assert.equal((await s.manager.current()).refreshToken,'refresh-new');assert.equal(s.refreshes(),1);
});
test('transient refresh failures preserve credentials, terminal failures clear them',async()=>{
  const temporary=setup({refresh:async()=>{throw Object.assign(Error('private response'),{code:'temporary'});}});
  await assert.rejects(temporary.manager.current(),/temporarily unavailable/);assert.equal(temporary.disk().refreshToken,'refresh-old');
  const terminal=setup({refresh:async()=>{throw Object.assign(Error('private response'),{code:'refresh_token_reused'});}});
  await assert.rejects(terminal.manager.current(),/Sign in again/);assert.equal(terminal.disk(),null);
});
test('saved credential sets cannot cross account/client registrations',async()=>{
  const s=setup({initial:{...record,subject:'account-b'}});await assert.rejects(s.manager.current(),/registration/);assert.equal(s.refreshes(),0);
});
test('logout revokes the latest session, clears local tokens and reports unconfirmed revocation',async()=>{
  let revoked;const s=setup({revoke:async value=>{revoked=value.refreshToken;throw Error('network');}});
  await s.manager.current();assert.deepEqual(await s.manager.logout(),{revocationConfirmed:false});assert.equal(revoked,'refresh-new');assert.equal(s.disk(),null);await assert.rejects(s.manager.current(),/Sign in again/);
});
test('logout during refresh prevents a waiting request from using the renewed session',async()=>{
  let complete;const s=setup({refresh:()=>new Promise(resolve=>{complete=resolve;})});
  const pending=s.manager.current();await new Promise(resolve=>setImmediate(resolve));
  const logout=s.manager.logout();complete({access_token:'new',refresh_token:'rotated',expires_in:3600});
  await assert.rejects(pending,/Sign in again/);assert.deepEqual(await logout,{revocationConfirmed:true});assert.equal(s.disk(),null);
});
test('temporary identity verification preserves the rotated refresh token without using new access',async()=>{
  const s=setup({refresh:async()=>{throw Object.assign(Error('verification'),{code:'verification_unavailable',replacementRefreshToken:'rotated-but-not-yet-verified'});}});
  await assert.rejects(s.manager.current(),/temporarily unavailable/);assert.equal(s.disk().refreshToken,'rotated-but-not-yet-verified');assert.equal(s.disk().accessToken,'access-old');
});

test('a temporarily locked credential store can be unlocked and retried',async()=>{
  let locked=true;
  const manager=createSavedSession({registration:{clientId:record.clientId,subject:record.subject},store:{load:async()=>{if(locked)throw Error('locked');return {...record,expires:999999};},save:async()=>{},clear:async()=>{}},refresh:async()=>{},revoke:async()=>true,now:()=>190000});
  await assert.rejects(manager.current());locked=false;assert.equal((await manager.current()).accessToken,'access-old');
});
