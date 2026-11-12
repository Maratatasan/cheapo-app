import { authorizeUrl,validateCallback } from './protocol';
import { validatePhoneIdentity,type IdentityBridge } from './identity';
const AUTH_ORIGIN='https://auth.openai.com';
const TOKEN=`${AUTH_ORIGIN}/api/accounts/oauth/token`;
const RESOURCE='https://api.openai.com/v1';
const SESSION='direct-auth.session',REGISTRATION='direct-auth.registration',HOST='direct-auth.host-id';
const TERMINAL=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
type Session={clientId:string;subject:string;accessToken:string;refreshToken:string;nonce:string;scopes:string[];expires:number};
export type PhoneAuthState={busy:boolean;signedIn:boolean;planAllowed:boolean;savedLogin:boolean;awaitingContinue:boolean;message:string};
export type PhoneNative=IdentityBridge & {
  startReceiver(state:string):Promise<{port:number}>;
  waitForCallback():Promise<string>;
  stopReceiver():Promise<void>;
  requestJson(url:string,form:string|null):Promise<{status:number;bodyText:string}>;
};
type Dependencies={native:PhoneNative;getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;deleteItem(key:string):Promise<void>;randomUUID():string;randomHex():string;challenge(verifier:string):Promise<string>;openBrowser(url:string):Promise<unknown>;isAppActive():boolean;now?():number;appName?:string};
class AuthFailure extends Error {constructor(message:string,readonly code='invalid'){super(message);}}
export function createPhoneAuth(deps:Dependencies) {
  const now=deps.now??Date.now;
  let view:PhoneAuthState={busy:false,signedIn:false,planAllowed:false,savedLogin:false,awaitingContinue:false,message:'Not signed in on this phone.'};
  let pendingSession:Session|undefined;
  let flow=0;
  let continuation:((error?:AuthFailure)=>void)|undefined;
  const listeners=new Set<(state:PhoneAuthState)=>void>();
  function update(patch:Partial<PhoneAuthState>){view={...view,...patch};listeners.forEach(listener=>listener(view));}
  function waitForContinue() {
    return new Promise<void>((resolve,reject)=>{
      const deadline=now()+60000;
      const finish=(error?:AuthFailure)=>{
        if(continuation!==finish)return;
        continuation=undefined;clearTimeout(timer);update({awaitingContinue:false});
        if(!error&&now()>=deadline)error=new AuthFailure('Pending phone sign-in expired. Start sign-in again.');
        if(error)reject(error);else resolve();
      };
      const timer=setTimeout(()=>finish(new AuthFailure('Pending phone sign-in expired. Start sign-in again.')),60000);
      continuation=finish;
      update({awaitingContinue:true,message:'Browser sign-in received. Return to Cheapo and tap Continue to finish sign-in.'});
    });
  }
  async function inPhase<T>(phase:string,action:()=>Promise<T>):Promise<T> {
    try{return await action();}catch(error){
      if(error instanceof AuthFailure)throw new AuthFailure(`${phase}: ${error.message}`,error.code);
      throw error;
    }
  }
  async function read<T>(key:string):Promise<T|null>{const value=await deps.getItem(key);if(!value)return null;try{return JSON.parse(value);}catch{throw new AuthFailure('Saved phone credentials need review.');}}
  async function readRegistration() {
    const registration=await read<{clientId:string;subject?:string}>(REGISTRATION);
    if(registration!==null&&(typeof registration!=='object'||typeof registration.clientId!=='string'||!registration.clientId||registration.clientId==='dynamic_agent_client'||registration.clientId.length>512||(registration.subject!==undefined&&(typeof registration.subject!=='string'||!registration.subject))))throw new AuthFailure('Saved phone registration needs review. Clear the phone login before retrying.');
    return registration;
  }
  async function request(url:string,form?:URLSearchParams,probe=false) {
    let response;
    try{response=await deps.native.requestJson(url,form?.toString()??null);}catch(error){
      const message=error instanceof Error?error.message:'';
      const category=['UnknownHostException','SSLHandshakeException','SSLPeerUnverifiedException','SocketTimeoutException','NetworkOnMainThreadException','ArgumentCastException','NullArgumentException','ConnectException','SecurityException'].find(name=>message.includes(name))??'native transport';
      const code=typeof error==='object'&&error!==null&&'code' in error ? error.code : undefined;
      const safeCode=typeof code==='string'&&['ERR_UNEXPECTED','ERR_INVALID_ARGS','ERR_INVALID_ARG','ERR_MODULE_NOT_FOUND'].includes(code)?`; ${code}`:'';
      throw new AuthFailure(probe?`Connection probe: native bridge rejected (${category}${safeCode}).`:`Phone HTTPS connection failed (${category}).`,'temporary');
    }
    let value;
    try{value=JSON.parse(response.bodyText);}catch{throw new AuthFailure('Authentication returned an invalid response.','temporary');}
    if(response.status===0 && value?.error==='native_transport'){
      const diagnostic=probe&&url===`${AUTH_ORIGIN}/.well-known/jwks.json` && ['connect','read','validate'].includes(value.stage) && ['resolved','failed','empty'].includes(value.dns) && typeof value.foreground==='boolean' ? `; ${value.stage}; DNS ${value.dns}; app ${value.foreground?'foreground':'background'}` : '';
      throw new AuthFailure(`${probe?'Connection probe: native request failed':'Phone HTTPS connection failed'} (${String(value.category).replace(/[^A-Za-z0-9_]/g,'').slice(0,80)}${diagnostic}).`,'temporary');
    }
    if(response.status<200||response.status>=300){
      const code=typeof value?.error==='string'?value.error:value?.error?.code;
      const safeCode=typeof code==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(code)?code:'unknown';
      throw new AuthFailure(`ChatGPT authentication request failed (HTTP ${response.status}; ${safeCode}).`,safeCode);
    }
    return value;
  }
  async function identity(token:string,clientId:string,nonce:string,subject?:string,refresh=false,preloadedKeys?:unknown) {
    const keys=preloadedKeys??await request(`${AUTH_ORIGIN}/.well-known/jwks.json`);
    try{return validatePhoneIdentity(token,keys,{clientId,nonce,subject,refresh,now:now()/1000},deps.native);}
    catch{throw new AuthFailure('The phone could not validate the ChatGPT identity.','identity_invalid');}
  }
  function sessionFrom(tokens:Record<string,unknown>,clientId:string,subject:string,nonce:string,previous?:Session):Session {
    if(typeof tokens.access_token!=='string'||!tokens.access_token||typeof tokens.refresh_token!=='string'||!tokens.refresh_token||typeof tokens.expires_in!=='number'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0||(tokens.token_type!==undefined&&(typeof tokens.token_type!=='string'||tokens.token_type.toLowerCase()!=='bearer')))throw new AuthFailure('A renewable phone session was not returned. Sign in again.');
    return {clientId,subject,nonce,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expires:now()+tokens.expires_in*1000,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/).filter(Boolean):previous?.scopes??[]};
  }
  async function persist(session:Session) {
    pendingSession=session;
    try{
      await deps.setItem(REGISTRATION,JSON.stringify({clientId:session.clientId,subject:session.subject}));
      await deps.setItem(SESSION,JSON.stringify(session));
      pendingSession=undefined;
    }catch{throw new AuthFailure('The renewed phone login could not be saved. Unlock the phone and check saved sign-in again.','storage');}
  }
  async function persistSignIn(session:Session,currentFlow:number) {
    const previousSession=await deps.getItem(SESSION);
    const previousRegistration=await deps.getItem(REGISTRATION);
    if(currentFlow!==flow)throw new AuthFailure('Phone sign-in cancelled.');
    let failure:unknown;
    try{await persist(session);}catch(error){failure=error;}
    if(currentFlow!==flow){
      pendingSession=undefined;
      const results=await Promise.allSettled([
        previousSession===null?deps.deleteItem(SESSION):deps.setItem(SESSION,previousSession),
        previousRegistration===null?deps.deleteItem(REGISTRATION):deps.setItem(REGISTRATION,previousRegistration),
      ]);
      if(results.some(result=>result.status==='rejected'))throw new AuthFailure('Sign-in cancelled, but protected storage could not be restored. Clear the phone login before retrying.','storage');
      throw new AuthFailure('Phone sign-in cancelled.');
    }
    if(failure)throw failure;
  }
  function publish(session:Session,message='Phone identity verified. Sign-in saved in Android protected storage.') {
    const planAllowed=session.scopes.includes('resource.invoke')&&session.scopes.includes('chatgpt.tokens.use.direct');
    update({signedIn:true,savedLogin:true,planAllowed,message:`${message} ${planAllowed?'ChatGPT plan permission granted.':'ChatGPT plan permission was not granted.'} No inference request sent.`});
  }
  async function savedSession() {
    const session=await read<Session>(SESSION);if(!session)return null;
    const registration=await readRegistration();
    if(!registration||registration.clientId!==session.clientId||registration.subject!==session.subject||session.clientId==='dynamic_agent_client'||typeof session.subject!=='string'||!session.subject||!['accessToken','refreshToken','nonce'].every(key=>typeof session[key as keyof Session]==='string'&&session[key as keyof Session])||!Number.isFinite(session.expires)||!Array.isArray(session.scopes))throw new AuthFailure('Saved phone registration does not match. Sign in again.');
    return session;
  }
  async function operation(action:()=>Promise<void>) {
    if(view.busy)return;
    update({busy:true});
    try{await action();}
    catch(error){update({message:error instanceof AuthFailure?error.message:'Phone authentication could not complete. Retry from this screen.',planAllowed:false});}
    finally{update({busy:false});}
  }
  async function readySession() {
    const session=pendingSession??await savedSession();
    if(pendingSession)await persist(pendingSession);
    if(!session||session.expires-now()>60000)return session;

    update({message:'Renewing the saved phone sign-in…'});
    let tokens;
    try{tokens=await request(TOKEN,new URLSearchParams({grant_type:'refresh_token',client_id:session.clientId,refresh_token:session.refreshToken,resource:RESOURCE}));}
    catch(error){if(error instanceof AuthFailure&&TERMINAL.has(error.code)){await deps.deleteItem(SESSION);update({signedIn:false,savedLogin:false,planAllowed:false});throw new AuthFailure('The renewable phone session ended. Sign in again.');}throw error;}
    const renewed=sessionFrom(tokens,session.clientId,session.subject,session.nonce,session);
    if(tokens.id_token){
      try{await identity(tokens.id_token,session.clientId,session.nonce,session.subject,true);}
      catch(error){
        if(error instanceof AuthFailure&&error.code==='temporary')await persist({...session,refreshToken:renewed.refreshToken});
        else{await deps.deleteItem(SESSION);update({signedIn:false,savedLogin:false,planAllowed:false});}
        throw error;
      }
    }
    await persist(renewed);
    return renewed;
  }
  return {
    getState:()=>view,
    subscribe(listener:(state:PhoneAuthState)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    checkConnection:()=>operation(async()=>{update({message:'Connection probe v2: checking the public OpenAI endpoint…'});const keys=await request(`${AUTH_ORIGIN}/.well-known/jwks.json`,undefined,true);if(!Array.isArray(keys?.keys)||!keys.keys.length)throw new AuthFailure('Trusted identity keys were unavailable.','temporary');update({message:'Connection probe v2 passed. OpenAI identity keys received; no login or inference request sent.'});}),
    signIn:()=>operation(async()=>{
      const currentFlow=++flow;
      if(pendingSession){const session=pendingSession;await persistSignIn(session,currentFlow);publish(session);return;}
      const ensureActive=()=>{if(currentFlow!==flow)throw new AuthFailure('Phone sign-in cancelled.');};
      let host=await deps.getItem(HOST);if(!host){host=`urn:uuid:${deps.randomUUID()}`;await deps.setItem(HOST,host);}
      const registration=await readRegistration();
      update({message:'Checking the trusted OpenAI identity endpoint from this phone…'});
      const keys=await inPhase('OpenAI public keys',()=>request(`${AUTH_ORIGIN}/.well-known/jwks.json`));
      if(!Array.isArray(keys?.keys)||!keys.keys.length)throw new AuthFailure('Identity verification is unavailable. Try later.','temporary');
      ensureActive();
      const state=deps.randomHex(),nonce=deps.randomHex(),verifier=deps.randomHex();
      const {port}=await deps.native.startReceiver(state);
      try{
        ensureActive();
        const url=authorizeUrl({port,hostId:host,clientId:registration?.clientId,state,nonce,challenge:await deps.challenge(verifier),appName:deps.appName});
        update({message:'Complete sign-in in the phone browser, then return to Cheapo.'});
        const callback=deps.native.waitForCallback();
        // Observe an early native timeout without an unhandled rejection while the browser opens.
        void callback.catch(()=>{});
        await deps.openBrowser(url);
        let target;try{target=await callback;}catch{ensureActive();throw new AuthFailure('No valid phone callback arrived. Return to the app and retry.');}
        ensureActive();
        const returned=validateCallback(target,{port,state,clientId:registration?.clientId});
        if(!registration)await deps.setItem(REGISTRATION,JSON.stringify({clientId:returned.clientId}));
        ensureActive();
        await waitForContinue();
        ensureActive();
        if(!deps.isAppActive())throw new AuthFailure('Return to Cheapo and start sign-in again; no token request was sent.');
        update({message:'Finishing ChatGPT token exchange on this phone…'});
        const tokens=await inPhase('ChatGPT token exchange',()=>request(TOKEN,new URLSearchParams({grant_type:'authorization_code',client_id:returned.clientId,code:returned.code,redirect_uri:`http://127.0.0.1:${port}/auth/callback`,code_verifier:verifier,resource:RESOURCE})));
        ensureActive();
        const claims=await identity(tokens.id_token,returned.clientId,nonce,registration?.subject,false,keys);
        ensureActive();
        const session=sessionFrom(tokens,returned.clientId,claims.sub,nonce);
        await persistSignIn(session,currentFlow);
        publish(session);
      }finally{await deps.native.stopReceiver().catch(()=>{});}
    }),
    continueSignIn(){
      if(!continuation)return;
      if(!deps.isAppActive()){update({message:'Return to Cheapo before tapping Continue. No token request has been sent.'});return;}
      continuation();
    },
    async cancel(){flow++;continuation?.(new AuthFailure('Phone sign-in cancelled.'));await deps.native.stopReceiver().catch(()=>{});update({message:'Phone sign-in cancelled.'});},
    restore:()=>operation(async()=>{
      const session=await readySession();
      if(!session){update({signedIn:false,savedLogin:false,planAllowed:false,message:'Not signed in on this phone.'});return;}
      publish(session,'Saved phone sign-in restored from Android protected storage.');
    }),
    async withPlanAccess<T>(requestWithToken:(accessToken:string)=>Promise<T>):Promise<T>{
      if(view.busy)throw new AuthFailure('Wait for the current ChatGPT action to finish.');
      update({busy:true});
      try{
        const session=await readySession();
        if(!session){
          update({signedIn:false,savedLogin:false,planAllowed:false});
          throw new AuthFailure('Connect ChatGPT on this phone first.');
        }
        const planAllowed=session.scopes.includes('resource.invoke')&&session.scopes.includes('chatgpt.tokens.use.direct');
        update({signedIn:true,savedLogin:true,planAllowed,message:planAllowed?'Saved ChatGPT sign-in is ready.':'ChatGPT plan permission was not granted.'});
        if(!planAllowed)throw new AuthFailure('Allow ChatGPT plan usage before analysing a photo.');
        if(!deps.isAppActive())throw new AuthFailure('Return to Cheapo before analysing a photo.');
        return await requestWithToken(session.accessToken);
      }finally{update({busy:false});}
    },
    signOut:()=>operation(async()=>{
      let session:Session|null|undefined;let invalidSavedState=false;
      try{await readRegistration();session=pendingSession??await savedSession();}catch{invalidSavedState=true;}
      let revoked=!session&&!invalidSavedState;
      if(session)try{
        const discovery=await request(`${AUTH_ORIGIN}/.well-known/openid-configuration`);
        const endpoint=new URL(discovery.revocation_endpoint);
        if(endpoint.origin!==AUTH_ORIGIN||endpoint.username||endpoint.password)throw new AuthFailure('Invalid revocation endpoint.');
        const response=await deps.native.requestJson(endpoint.toString(),new URLSearchParams({token:session.refreshToken,token_type_hint:'refresh_token',client_id:session.clientId}).toString());
        revoked=response.status===200;
      }catch{ /* Local sign-out remains available when remote revocation fails. */ }
      await deps.deleteItem(SESSION);pendingSession=undefined;
      if(invalidSavedState)await deps.deleteItem(REGISTRATION);
      update({signedIn:false,savedLogin:false,planAllowed:false,message:revoked?'Signed out on this phone.':'Local phone credentials cleared. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings if needed.'});
    }),
  };
}
