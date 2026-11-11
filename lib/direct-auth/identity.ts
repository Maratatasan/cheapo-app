export type Claims={sub:string;exp:number;[key:string]:unknown};
export type IdentityBridge={decodeBase64Url(value:string):string;verifyRs256(input:string,signature:string,n:string,e:string):boolean};
export function validatePhoneIdentity(token:string,jwks:unknown,expected:{clientId:string;nonce:string;subject?:string;refresh?:boolean;now?:number},native:IdentityBridge):Claims {
  const fail=()=>{throw Error('The phone could not validate the ChatGPT identity.');};
  if(typeof token!=='string'||token.length>65536)return fail();
  const parts=token.split('.');
  if(parts.length!==3||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))return fail();
  let header,claims;
  try{header=JSON.parse(native.decodeBase64Url(parts[0]));claims=JSON.parse(native.decodeBase64Url(parts[1]));}catch{return fail();}
  if(header?.alg!=='RS256'||typeof header.kid!=='string')return fail();
  const keys=(jwks as {keys?:{kid?:string;kty?:string;use?:string;alg?:string;n?:string;e?:string}[]})?.keys;
  const selected=Array.isArray(keys)?keys.filter(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.use||key.use==='sig')&&(!key.alg||key.alg==='RS256')):[];
  const key=selected[0];
  if(selected.length!==1||typeof key.n!=='string'||typeof key.e!=='string'||!native.verifyRs256(`${parts[0]}.${parts[1]}`,parts[2],key.n,key.e))return fail();
  const now=expected.now??Date.now()/1000;
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!=='https://auth.openai.com'||!audiences.includes(expected.clientId)||(audiences.length>1&&claims.azp!==expected.clientId)||typeof claims.sub!=='string'||!claims.sub||typeof claims.exp!=='number'||claims.exp<=now-5||typeof claims.iat!=='number'||claims.iat>now+5||claims.iat>claims.exp||(claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>now+5))||(!(expected.refresh&&claims.nonce===undefined)&&claims.nonce!==expected.nonce)||(expected.subject&&claims.sub!==expected.subject))return fail();
  return claims;
}
