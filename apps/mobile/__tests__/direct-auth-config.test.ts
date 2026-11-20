import configure from '../app.config';
import type { ConfigContext } from 'expo/config';
const config={name:'Cheapo',slug:'cheapo-app',scheme:'myapp',plugins:['expo-router'],extra:{existing:true},
  android:{package:'com.example.cheapo'},ios:{bundleIdentifier:'com.example.cheapo',buildNumber:'5'}};
const context:ConfigContext={config,projectRoot:'/test',staticConfigPath:null,packageJsonPath:'/test/package.json'};
afterEach(()=>{delete process.env.CHEAPO_AUTH_TEST;delete process.env.CHEAPO_FIELD_TEST;delete process.env.CHEAPO_IOS_SHARED;delete process.env.CHEAPO_IOS_CHATGPT;delete process.env.CHEAPO_API_ORIGIN;});
it('preserves the normal app configuration unless explicitly opted in',()=>{
  expect(configure(context)).toEqual(config);
});
it('isolates the Android auth experiment and preserves existing configuration',()=>{
  process.env.CHEAPO_AUTH_TEST='1';
  expect(configure(context)).toMatchObject({name:'Cheapo Auth Test',version:'1.0.2',scheme:'cheapo-auth-test',android:{package:'com.maratatasan.cheapo.dev',versionCode:3},extra:{existing:true,directAuthTest:true},plugins:['expo-router','expo-secure-store']});
});

it('uses the existing field-test package without enabling auth-test UI',()=>{
  process.env.CHEAPO_FIELD_TEST='1';
  const field=configure(context);
  expect(field).toMatchObject({name:'Cheapo Field',scheme:'cheapofield',version:'0.1.11',android:{package:'com.maratatasan.cheapo.field',versionCode:13},extra:{fieldTest:true},plugins:['expo-router','expo-secure-store']});
  expect(field.extra?.directAuthTest).toBeUndefined();
});
it('rejects conflicting test-app choices',()=>{
  process.env.CHEAPO_FIELD_TEST='1';process.env.CHEAPO_AUTH_TEST='1';
  expect(()=>configure(context)).toThrow('Choose one');
});

it('sets only a plain HTTPS origin for field enrollment', () => {
  process.env.CHEAPO_FIELD_TEST = '1';
  process.env.CHEAPO_API_ORIGIN = 'https://cheapo.example/';
  expect(configure(context).extra?.cheapoApiOrigin).toBe('https://cheapo.example');
  process.env.CHEAPO_API_ORIGIN = 'https://cheapo.example/?credential=synthetic';
  expect(() => configure(context)).toThrow('CHEAPO_API_ORIGIN must be a plain HTTPS origin.');
});

it('opts the existing iPhone app into shared shopping while retaining its app identity', () => {
  process.env.CHEAPO_IOS_SHARED = '1';
  process.env.CHEAPO_API_ORIGIN = 'https://cheapo.example/';
  expect(configure(context)).toEqual({
    ...config,
    plugins: ['expo-router', 'expo-secure-store'],
    extra: { ...config.extra, iosSharedShopping: true, cheapoApiOrigin: 'https://cheapo.example' },
  });
});

it('keeps optional iPhone ChatGPT separate from enrollment and retains the iPhone identity', () => {
  process.env.CHEAPO_IOS_CHATGPT = '1';
  expect(() => configure(context)).toThrow('Enable iPhone shared shopping');
  process.env.CHEAPO_IOS_SHARED = '1';
  process.env.CHEAPO_API_ORIGIN = 'https://cheapo.example/';
  expect(configure(context)).toEqual({ ...config, plugins: ['expo-router', 'expo-secure-store'],
    extra: { ...config.extra, iosSharedShopping: true, iosPhotoAnalysis: true, cheapoApiOrigin: 'https://cheapo.example' },
  });
});

it.each([undefined, 'http://cheapo.example', 'https://cheapo.example/private', 'https://user@cheapo.example'])(
  'rejects an absent or unsafe iPhone origin (%s)', origin => {
    process.env.CHEAPO_IOS_SHARED = '1';
    if (origin) process.env.CHEAPO_API_ORIGIN = origin;
    expect(() => configure(context)).toThrow('CHEAPO_API_ORIGIN must be a plain HTTPS origin for iPhone shared shopping.');
  },
);

it.each(['CHEAPO_FIELD_TEST', 'CHEAPO_AUTH_TEST'])('keeps %s separate from iPhone shared access', flag => {
  process.env.CHEAPO_IOS_SHARED = '1';
  process.env[flag] = '1';
  expect(() => configure(context)).toThrow('Choose one');
});
