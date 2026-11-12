import { authorizeUrl,validateCallback } from '../lib/direct-auth/protocol';
const state='s'.repeat(43),nonce='n'.repeat(43),challenge='c'.repeat(43);
it('uses phone loopback, S256, fresh state/nonce and the direct plan scopes',()=>{
  const url=new URL(authorizeUrl({port:45678,hostId:'urn:uuid:821e1a44-0f2d-4d0a-9354-52cbd8e1f937',state,nonce,challenge}));
  expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:45678/auth/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
  expect(url.searchParams.get('resource')).toBe('https://api.openai.com/v1');
  expect(url.searchParams.get('nonce')).toBe(nonce);
});
it('accepts only the matching callback and an issued registration',()=>{
  const callback=`/auth/callback?state=${state}&code=mock&client_id=issued-phone`;
  expect(validateCallback(callback,{port:45678,state})).toEqual({code:'mock',clientId:'issued-phone'});
  for(const target of [callback.replace(state,'wrong'),callback.replace('issued-phone','dynamic_agent_client'),`http://localhost:45678${callback}`,`https://evil.test${callback}`,callback+'&state=second'])expect(()=>validateCallback(target,{port:45678,state})).toThrow();
});
it('identifies the field app when registering its own saved ChatGPT connection',()=>{
  const options={port:45678,hostId:'urn:uuid:821e1a44-0f2d-4d0a-9354-52cbd8e1f937',state,nonce,challenge,appName:'Cheapo Field'};
  expect(new URL(authorizeUrl(options)).searchParams.get('agent_name_hint')).toBe('Cheapo Field');
  expect(new URL(authorizeUrl({...options,clientId:'issued-phone'})).searchParams.has('agent_name_hint')).toBe(false);
});
