import { useEffect,useState } from 'react';
import { Button,Linking,ScrollView,Text } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ui } from '@/component/results/theme';
import { createPhoneAuth,type PhoneNative } from '@/lib/direct-auth/client';

type Check={callbackVerified:boolean;signatureVerified:boolean;boundAddress:string};
const enabled=Constants.expoConfig?.extra?.directAuthTest===true;
const native=enabled?requireOptionalNativeModule<PhoneNative & {selfTest(state:string):Promise<Check>}>('CheapoLoopback'):null;
const randomHex=()=>Array.from(Crypto.getRandomBytes(32),byte=>byte.toString(16).padStart(2,'0')).join('');
const auth=native?createPhoneAuth({native,getItem:SecureStore.getItemAsync,setItem:SecureStore.setItemAsync,deleteItem:SecureStore.deleteItemAsync,randomUUID:Crypto.randomUUID,randomHex,challenge:async verifier=>(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,verifier,{encoding:Crypto.CryptoEncoding.BASE64})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'),openBrowser:url=>Linking.openURL(url)}):null;
export default function DirectAuthTest() {
  const [busy,setBusy]=useState(false);
  const [authState,setAuthState]=useState(auth?.getState());
  useEffect(()=>{if(!auth)return;const unsubscribe=auth.subscribe(setAuthState);void auth.restore();return unsubscribe;},[]);
  const [status,setStatus]=useState('First check the callback listener and protected storage on this phone.');
  async function check() {
    setBusy(true);setStatus('Checking on-phone loopback and protected storage…');
    try {
      if(!native)throw Error('Install the separate Cheapo Auth Test APK. Expo Go cannot host this native listener.');
      let host=await SecureStore.getItemAsync('direct-auth.host-id');
      if(!host){host=`urn:uuid:${Crypto.randomUUID()}`;await SecureStore.setItemAsync('direct-auth.host-id',host);}
      const state=Array.from(Crypto.getRandomBytes(32),byte=>byte.toString(16).padStart(2,'0')).join('');
      const result=await native.selfTest(state);
      const storageVerified=await SecureStore.getItemAsync('direct-auth.host-id')===host;
      if(!result.callbackVerified||!result.signatureVerified||!storageVerified||result.boundAddress!=='127.0.0.1')throw Error('The phone self-check did not pass.');
      setStatus('Phone loopback callback passed. RSA signature check passed. Protected storage passed. No account was signed in and no provider request was sent.');
    }catch(error){setStatus(error instanceof Error?error.message:'Phone self-check failed.');}
    finally{setBusy(false);}
  }
  return <ScrollView style={ui.page} contentContainerStyle={ui.content}>
    <Text style={ui.title}>Direct phone sign-in test</Text>
    <Text style={ui.body}>This separate local test app checks the native prerequisites. It does not use the Mac companion or its credentials.</Text>
    <Text style={ui.body}>{status}</Text>
    <Button title={busy?'Checking…':'Check this phone'} disabled={busy||authState?.busy} onPress={check} />
    <Text style={ui.body}>{authState?.message || 'Install the native Android test app to sign in.'}</Text>
    <Text style={ui.small}>Identity: {authState?.signedIn?'verified':'not verified'} · Plan permission: {authState?.planAllowed?'granted':'not granted'} · Saved login: {authState?.savedLogin?'yes':'no'}</Text>
    <Button title={authState?.busy?'Completing phone sign-in…':'Sign in with ChatGPT on this phone'} disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.signIn()} />
    {authState?.busy?<Button title="Cancel phone sign-in" onPress={()=>void auth?.cancel()} />:null}
    <Button title="Check OpenAI connection" disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.checkConnection()} />
    <Button title="Check saved phone sign-in" disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.restore()} />
    <Button title="Clear phone login / sign out" disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.signOut()} />
    <Text style={ui.small}>Sign-in uses the system browser and a callback listener on this phone. It does not send a photo or request inference. If the browser waits at 127.0.0.1, return to this app to let the callback finish.</Text>
  </ScrollView>;
}
