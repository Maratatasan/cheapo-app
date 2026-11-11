import { createPhoneAuth,type PhoneNative } from '../lib/direct-auth/client';
const nonce='n'.repeat(64);
const encode=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const idToken=`${encode({alg:'RS256',kid:'key'})}.${encode({iss:'https://auth.openai.com',aud:'issued-phone',sub:'test-subject',iat:900,exp:5000,nonce})}.c2ln`;
function setup(){
  const storage=new Map<string,string>();let clock=1000000;let refreshError=0;let failSave=false;
  const native:PhoneNative={startReceiver:jest.fn(async()=>({port:45678})),waitForCallback:jest.fn(async()=>`/auth/callback?state=${nonce}&code=mock-code&client_id=issued-phone`),stopReceiver:jest.fn(async()=>{}),decodeBase64Url:value=>atob(value.replace(/-/g,'+').replace(/_/g,'/')),verifyRs256:jest.fn(()=>true),requestJson:jest.fn(async(url,form)=>{
    if(url.endsWith('/jwks.json'))return {status:200,bodyText:JSON.stringify({keys:[{kid:'key',kty:'RSA',n:'public-modulus',e:'AQAB'}]})};
    const refresh=form&&new URLSearchParams(form).get('grant_type')==='refresh_token';
    if(refresh&&refreshError)return {status:refreshError,bodyText:JSON.stringify({error:refreshError===400?'invalid_grant':'temporary'})};
    return {status:200,bodyText:JSON.stringify({access_token:refresh?'new-access':'initial-access',refresh_token:refresh?'rotated-refresh':'initial-refresh',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct offline_access',...(refresh?{}:{id_token:idToken})})};
  })};
  const openBrowser=jest.fn(async(url:string)=>{void url;});
  const dependencies={native,getItem:async(key:string)=>storage.get(key)??null,setItem:async(key:string,value:string)=>{if(failSave&&key==='direct-auth.session')throw Error('locked');storage.set(key,value);},deleteItem:async(key:string)=>{storage.delete(key);},randomUUID:()=> '821e1a44-0f2d-4d0a-9354-52cbd8e1f937',randomHex:()=>nonce,challenge:async()=> 'c'.repeat(43),openBrowser,now:()=>clock};
  return {dependencies,client:createPhoneAuth(dependencies),newClient:()=>createPhoneAuth(dependencies),storage,native,openBrowser,expire:()=>{clock+=3600000;},setRefreshError:(value:number)=>{refreshError=value;},setSaveFailure:(value:boolean)=>{failSave=value;}};
}
it('signs in only explicitly and persists a verified phone session without exposing credentials',async()=>{
  const s=setup();expect(s.native.requestJson).not.toHaveBeenCalled();
  await s.client.signIn();expect(s.client.getState()).toMatchObject({signedIn:true,planAllowed:true,savedLogin:true,busy:false});
  const url=new URL(s.openBrowser.mock.calls[0][0] as string);expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:45678/auth/callback');
  expect(JSON.stringify(s.client.getState())).not.toContain('initial-access');
  const restored=s.newClient();await restored.restore();expect(restored.getState().signedIn).toBe(true);
  expect(s.native.requestJson).toHaveBeenCalledTimes(2);
});
it('serializes renewal, retains rotating refresh tokens and clears only terminal failures',async()=>{
  const s=setup();await s.client.signIn();s.expire();await Promise.all([s.client.restore(),s.client.restore()]);
  expect(JSON.parse(s.storage.get('direct-auth.session')!).refreshToken).toBe('rotated-refresh');
  const calls=(s.native.requestJson as jest.Mock).mock.calls.filter(([,form])=>form&&new URLSearchParams(form).get('grant_type')==='refresh_token');expect(calls).toHaveLength(1);
  expect(Object.fromEntries(new URLSearchParams(calls[0][1]))).toEqual({grant_type:'refresh_token',client_id:'issued-phone',refresh_token:'initial-refresh',resource:'https://api.openai.com/v1'});
  s.expire();s.setRefreshError(503);await s.client.restore();expect(s.storage.has('direct-auth.session')).toBe(true);
  s.setRefreshError(400);await s.client.restore();expect(s.storage.has('direct-auth.session')).toBe(false);expect(s.client.getState().signedIn).toBe(false);
});
it('retries saving a rotated token without another refresh request',async()=>{
  const s=setup();await s.client.signIn();s.expire();s.setSaveFailure(true);await s.client.restore();expect(s.client.getState().message).toContain('could not be saved');
  s.setSaveFailure(false);await s.client.restore();expect(JSON.parse(s.storage.get('direct-auth.session')!).refreshToken).toBe('rotated-refresh');
  const calls=(s.native.requestJson as jest.Mock).mock.calls.filter(([,form])=>form&&new URLSearchParams(form).get('grant_type')==='refresh_token');expect(calls).toHaveLength(1);
});

it('allows local sign-out when saved credentials are malformed',async()=>{
  const s=setup();s.storage.set('direct-auth.session','{broken');s.storage.set('direct-auth.registration','{broken');
  await s.client.restore();await s.client.signOut();
  expect(s.storage.has('direct-auth.session')).toBe(false);
  expect(s.storage.has('direct-auth.registration')).toBe(false);
  expect(s.client.getState()).toMatchObject({signedIn:false,savedLogin:false,planAllowed:false});
  await s.client.signIn();expect(s.client.getState().signedIn).toBe(true);
});
it('cancellation during persistence restores the prior connection without publishing the new login',async()=>{
  const s=setup();await s.client.signIn();const previous=s.storage.get('direct-auth.session');
  let release!:()=>void;let writing!:()=>void;
  const started=new Promise<void>(resolve=>{writing=resolve;});
  const blocked=new Promise<void>(resolve=>{release=resolve;});let once=true;
  const client=createPhoneAuth({...s.dependencies,setItem:async(key,value)=>{
    if(key==='direct-auth.session'&&once){once=false;writing();await blocked;}
    await s.dependencies.setItem(key,value);
  }});
  await client.restore();const signin=client.signIn();await started;await client.cancel();release();await signin;
  expect(s.storage.get('direct-auth.session')).toBe(previous);
  expect(client.getState().message).toContain('cancelled');
});
it('cancellation during first-login persistence leaves no usable session',async()=>{
  const s=setup();let release!:()=>void;let writing!:()=>void;
  const started=new Promise<void>(resolve=>{writing=resolve;});
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const client=createPhoneAuth({...s.dependencies,setItem:async(key,value)=>{
    if(key==='direct-auth.session'){writing();await blocked;}
    await s.dependencies.setItem(key,value);
  }});
  const signin=client.signIn();await started;await client.cancel();release();await signin;
  expect(s.storage.has('direct-auth.session')).toBe(false);
  expect(JSON.parse(s.storage.get('direct-auth.registration')!)).toEqual({clientId:'issued-phone'});
  expect(client.getState()).toMatchObject({signedIn:false,savedLogin:false,planAllowed:false});
});

it('retains an issued client registration when the initial code exchange fails',async()=>{
  const s=setup();const original=s.native.requestJson;
  let fail=true;s.native.requestJson=jest.fn(async(url,form)=>{
    if(fail&&form&&new URLSearchParams(form).get('grant_type')==='authorization_code'){
      fail=false;return {status:400,bodyText:JSON.stringify({error:'invalid_grant'})};
    }
    return original(url,form);
  });
  await s.client.signIn();expect(s.storage.has('direct-auth.session')).toBe(false);
  await s.client.signIn();
  expect(new URL(s.openBrowser.mock.calls[1][0]).searchParams.get('client_id')).toBe('issued-phone');
  expect(s.client.getState().signedIn).toBe(true);
});

it('clears a malformed registration even when no session exists',async()=>{
  const s=setup();s.storage.set('direct-auth.registration','{broken');
  await s.client.signOut();expect(s.storage.has('direct-auth.registration')).toBe(false);
  await s.client.signIn();expect(s.client.getState().signedIn).toBe(true);
});

it('shows only bounded public connection diagnostics without request secrets',async()=>{
  const s=setup();s.native.requestJson=jest.fn(async()=>({status:0,bodyText:JSON.stringify({error:'native_transport',category:'UnknownHostException',stage:'connect',dns:'failed',foreground:true,message:'secret-body'})}));
  await s.client.checkConnection();expect(s.client.getState().message).toContain('native request failed');expect(s.client.getState().message).toContain('DNS failed; app foreground');
  expect(s.client.getState().message).not.toContain('secret-body');
});

it('distinguishes a rejected native bridge without showing arbitrary codes or messages',async()=>{
 const s=setup();s.native.requestJson=jest.fn(async()=>{throw Object.assign(new Error('UnknownHostException secret-request'),{code:'secret-code'});});
 await s.client.checkConnection();expect(s.client.getState().message).toBe('Connection probe: native bridge rejected (UnknownHostException).');
});
it('shows a fresh loading message before the public probe settles',async()=>{
 const s=setup();let release!:(value:{status:number;bodyText:string})=>void;
 s.native.requestJson=jest.fn(()=>new Promise(resolve=>{release=resolve;}));
 const pending=s.client.checkConnection();expect(s.client.getState()).toMatchObject({busy:true,message:'Connection probe v2: checking the public OpenAI endpoint…'});
 release({status:200,bodyText:JSON.stringify({keys:[{}]})});await pending;
 expect(s.client.getState().message).toContain('Connection probe v2 passed');
});
