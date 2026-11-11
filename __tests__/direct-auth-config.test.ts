import configure from '../app.config';
import type { ConfigContext } from 'expo/config';
const config={name:'Cheapo',slug:'cheapo-app',scheme:'myapp',plugins:['expo-router'],extra:{existing:true},android:{package:'com.example.cheapo'}};
const context:ConfigContext={config,projectRoot:'/test',staticConfigPath:null,packageJsonPath:'/test/package.json'};
afterEach(()=>{delete process.env.CHEAPO_AUTH_TEST;});
it('preserves the normal app configuration unless explicitly opted in',()=>{
  expect(configure(context)).toEqual(config);
});
it('isolates the Android auth experiment and preserves existing configuration',()=>{
  process.env.CHEAPO_AUTH_TEST='1';
  expect(configure(context)).toMatchObject({name:'Cheapo Auth Test',scheme:'cheapo-auth-test',android:{package:'com.maratatasan.cheapo.dev'},extra:{existing:true,directAuthTest:true},plugins:['expo-router','expo-secure-store']});
});
