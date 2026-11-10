const TERMINAL = new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
export function createSavedSession({registration,store,refresh,revoke,now=Date.now}) {
  let session, loaded, renewing, pendingSave=false, stopping=false;
  function validate(value) {
    if (!value || value.clientId !== registration.clientId || value.subject !== registration.subject || value.clientId === 'dynamic_agent_client') throw Error('Saved session does not match this registration');
    if (!['accessToken','refreshToken'].every(k=>typeof value[k]==='string' && value[k]) || !Number.isFinite(value.expires) || !Array.isArray(value.scopes) || !value.scopes.every(scope=>typeof scope==='string')) throw Error('Saved credentials are invalid. Sign in again.');
    return value;
  }
  async function load() { if(!loaded) loaded=(async()=>{const value=await store.load();session=value?validate(value):undefined;})().catch(error=>{loaded=undefined;throw error;}); await loaded; }
  async function persist() {
    try { await store.save(session);pendingSave=false; }
    catch { pendingSave=true;throw Error('Renewed credentials could not be saved to Keychain. Unlock it and retry.'); }
  }
  async function renew() {
    let tokens;
    try { tokens=await refresh(session); }
    catch(error) {
      if(typeof error.replacementRefreshToken==='string' && error.replacementRefreshToken) {
        session={...session,refreshToken:error.replacementRefreshToken};
        await persist(); // Keep the replacement even if JWKS was temporarily unavailable.
      }
      if(TERMINAL.has(error.code)) {session=undefined;await store.clear();throw Error('Sign in again to continue');}
      if(error.code==='invalid_client') throw Error('Saved client registration was rejected. Check the companion configuration.');
      throw Error('Saved sign-in is temporarily unavailable. Retry later.');
    }
    if(!tokens || !['access_token','refresh_token'].every(k=>typeof tokens[k]==='string' && tokens[k]) || !Number.isFinite(tokens.expires_in) || tokens.expires_in<=0) {
      session=undefined;await store.clear();throw Error('Renewal returned invalid credentials. Sign in again.');
    }
    session={...session,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expires:now()+tokens.expires_in*1000,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/).filter(Boolean):session.scopes};
    await persist();
  }
  return {
    async current() {
      await load();
      if(stopping || !session) throw Error('Sign in again to continue');
      if(pendingSave) await persist();
      if(session.expires-now()<=60_000) {
        if(!renewing) renewing=renew().finally(()=>{renewing=undefined;});
        await renewing;
      }
      if(stopping || !session) throw Error('Sign in again to continue');
      return session;
    },
    async save(value) { await load();if(stopping)throw Error('Sign-out is still finishing.');session=validate(value);await persist(); },
    async status() { await load();return {signedIn:!!session, saved:!!session&&!pendingSave, expires:session?.expires}; },
    async logout() {
      stopping=true;await load();if(renewing)await renewing.catch(()=>{});
      let revocationConfirmed=true;
      try {if(session)revocationConfirmed=await revoke(session);} catch {revocationConfirmed=false;}
      session=undefined;pendingSave=false;await store.clear();stopping=false;
      return {revocationConfirmed};
    },
  };
}
