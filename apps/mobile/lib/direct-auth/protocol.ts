const AUTH='https://auth.openai.com/api/accounts/authorize';
export const PLAN_SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export function authorizeUrl({port,hostId,clientId,state,nonce,challenge,appName='Cheapo Android direct-auth test'}:{port:number;hostId:string;clientId?:string;state:string;nonce:string;challenge:string;appName?:string}) {
  if(!Number.isInteger(port)||port<1||port>65535||![state,nonce,challenge].every(value=>value.length>=32)||!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hostId))throw Error('Invalid phone authorization parameters');
  const url=new URL(AUTH);
  const params={response_type:'code',client_id:clientId||'dynamic_agent_client',ext_agent_host_id:hostId,redirect_uri:`http://127.0.0.1:${port}/auth/callback`,scope:PLAN_SCOPES,resource:'https://api.openai.com/v1',state,nonce,code_challenge_method:'S256',code_challenge:challenge};
  for(const [name,value]of Object.entries(params))url.searchParams.set(name,value);
  if(!clientId)url.searchParams.set('agent_name_hint',appName);
  return url.toString();
}
export function validateCallback(target:string,{port,state,clientId}:{port:number;state:string;clientId?:string}) {
  const expected=`http://127.0.0.1:${port}/auth/callback`;
  const url=new URL(target,expected);
  if(url.origin+url.pathname!==expected || url.hash || url.searchParams.getAll('state').length!==1 || url.searchParams.get('state')!==state || url.searchParams.has('error') || url.searchParams.getAll('code').length!==1 || !url.searchParams.get('code'))throw Error('Invalid or cancelled phone callback');
  const returned=url.searchParams.get('client_id');
  if(clientId ? returned && returned!==clientId : !returned || returned==='dynamic_agent_client' || returned.length>512)throw Error('Invalid issued client registration');
  return {code:url.searchParams.get('code')!,clientId:clientId||returned!};
}
