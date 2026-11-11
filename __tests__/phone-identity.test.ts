import { validatePhoneIdentity } from '../lib/direct-auth/identity';
const encode=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const claims={iss:'https://auth.openai.com',aud:'issued-phone',sub:'verified-subject',exp:2000,iat:900,nonce:'fresh-nonce'};
const token=(patch={},header={alg:'RS256',kid:'key'})=>`${encode(header)}.${encode({...claims,...patch})}.c2lnbmF0dXJl`;
const jwks={keys:[{kid:'key',kty:'RSA',n:'modulus',e:'AQAB',alg:'RS256',use:'sig'}]};
const native={decodeBase64Url:(value:string)=>atob(value.replace(/-/g,'+').replace(/_/g,'/')),verifyRs256:jest.fn(()=>true)};
const expected={clientId:'issued-phone',nonce:'fresh-nonce',now:1000};
it('requires RSA verification and exact identity/nonce/client/expiry claims',()=>{
  expect(validatePhoneIdentity(token(),jwks,expected,native).sub).toBe('verified-subject');
  for(const patch of [{iss:'other'},{aud:'other'},{nonce:'other'},{sub:''},{exp:900},{iat:1100},{nbf:1100},{aud:['issued-phone','other'],azp:'other'}])expect(()=>validatePhoneIdentity(token(patch),jwks,expected,native)).toThrow();
  expect(()=>validatePhoneIdentity(token({}, {alg:'none',kid:'key'}),jwks,expected,native)).toThrow();
  native.verifyRs256.mockReturnValueOnce(false);expect(()=>validatePhoneIdentity(token(),jwks,expected,native)).toThrow();
});
it('a refresh can omit nonce but cannot change the account or supplied nonce',()=>{
  expect(validatePhoneIdentity(token({nonce:undefined}),jwks,{...expected,refresh:true,subject:'verified-subject'},native).sub).toBe('verified-subject');
  expect(()=>validatePhoneIdentity(token({sub:'other'}),jwks,{...expected,refresh:true,subject:'verified-subject'},native)).toThrow();
  expect(()=>validatePhoneIdentity(token({nonce:'other'}),jwks,{...expected,refresh:true},native)).toThrow();
});
