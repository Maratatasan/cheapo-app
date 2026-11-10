import { TOKEN, RESOURCE } from './core.mjs';
export function sessionRemote({remote,validateIdentity}) {
  return {
    async refresh(session) {
      const response=await remote(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:session.clientId,refresh_token:session.refreshToken,resource:RESOURCE})});
      let value;try{value=await response.json();}catch{throw Error('Token renewal unavailable');}
      if(!response.ok)throw Object.assign(Error('Token renewal failed'),{code:typeof value?.error==='string'?value.error:value?.error?.code});
      if(value.id_token) {
        try{await validateIdentity(value.id_token,session);}catch(error){throw Object.assign(Error('Renewed identity was rejected'),error.temporary ? {code:'verification_unavailable',replacementRefreshToken:value.refresh_token} : {code:'invalid_grant'});}
      }
      return value;
    },
    async revoke(session) {
      const discovery=await remote('https://auth.openai.com/.well-known/openid-configuration');
      if(!discovery.ok)throw Error('Revocation discovery unavailable');
      const metadata=await discovery.json();
      const endpoint=new URL(metadata.revocation_endpoint);
      if(endpoint.origin!=='https://auth.openai.com')throw Error('Invalid revocation endpoint');
      for(let attempt=0;attempt<2;attempt++) {
        try {
          const response=await remote(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:session.refreshToken,token_type_hint:'refresh_token',client_id:session.clientId})});
          if(response.status===200)return true;
          if(response.status<500)return false;
        }catch{ /* Bounded retry; never forward response bodies or tokens. */ }
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
      }
      return false;
    },
  };
}
