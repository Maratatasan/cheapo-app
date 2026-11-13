import { useEffect,useState } from 'react';
import { Button,ScrollView,Text } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ui } from '@/component/results/theme';
import { fieldPhotoAnalysisEnabled,iosPhoneAuthTestEnabled,phoneAuth as auth,phoneAuthNative as native,randomHex } from '@/lib/direct-auth/phone-session';

const experiment=iosPhoneAuthTestEnabled || Constants.expoConfig?.extra?.directAuthTest===true;
export default function DirectAuthTest() {
  const [busy,setBusy]=useState(false);
  const [authState,setAuthState]=useState(auth?.getState());
  useEffect(()=>{if(!auth)return;const unsubscribe=auth.subscribe(setAuthState);void auth.restore();return unsubscribe;},[]);
  const [status,setStatus]=useState('First check the callback listener and protected storage on this phone.');
  async function check() {
    setBusy(true);setStatus('Checking on-phone loopback and protected storage…');
    try {
      if(!native)throw Error('Install the separate Cheapo Auth Test app. Expo Go cannot host this native listener.');
      let host=await SecureStore.getItemAsync('direct-auth.host-id');
      if(!host){host=`urn:uuid:${Crypto.randomUUID()}`;await SecureStore.setItemAsync('direct-auth.host-id',host);}
      const state=randomHex();
      const result=await native.selfTest(state);
      const storageVerified=await SecureStore.getItemAsync('direct-auth.host-id')===host;
      if(!result.callbackVerified||!result.signatureVerified||!storageVerified||result.boundAddress!=='127.0.0.1')throw Error('The phone self-check did not pass.');
      setStatus('Phone loopback callback passed. RSA signature check passed. Protected storage passed. No account was signed in and no provider request was sent.');
    }catch(error){setStatus(error instanceof Error?error.message:'Phone self-check failed.');}
    finally{setBusy(false);}
  }
  return <ScrollView style={ui.page} contentContainerStyle={ui.content}>
    <Stack.Screen options={{title:fieldPhotoAnalysisEnabled?'ChatGPT sign-in':'Direct phone sign-in test'}} />
    <Text style={ui.title}>{fieldPhotoAnalysisEnabled?'Connect ChatGPT':'Direct phone sign-in test'}</Text>
    {experiment ? <>
      <Text style={ui.small}>{iosPhoneAuthTestEnabled ? 'iPhone auth test 1.0.0 (1)' : 'Auth test 1.0.2 (3)'} · explicit Continue</Text>
      <Text style={ui.body}>{status}</Text>
      <Button title={busy?'Checking…':'Check this phone'} disabled={busy||authState?.busy} onPress={check} />
    </> : <Text style={ui.body}>Connect your ChatGPT plan to suggest details from a photo you choose. You can still save photos and enter details manually.</Text>}
    <Text style={ui.body}>{authState?.message || 'Install a Cheapo build with phone sign-in enabled.'}</Text>
    <Text style={ui.small}>Identity: {authState?.signedIn?'verified':'not verified'} · Plan permission: {authState?.planAllowed?'granted':'not granted'} · Saved login: {authState?.savedLogin?'yes':'no'}</Text>
    <Button title={authState?.busy?'Completing phone sign-in…':'Sign in with ChatGPT on this phone'} disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.signIn()} />
    {authState?.awaitingContinue?<Button title="Continue sign-in" onPress={()=>auth?.continueSignIn()} />:null}
    {authState?.busy?<Button title="Cancel phone sign-in" onPress={()=>void auth?.cancel()} />:null}
    {experiment?<Button title="Check OpenAI connection" disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.checkConnection()} />:null}
    <Button title="Check saved phone sign-in" disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.restore()} />
    {experiment?<Button title="Clear phone login / sign out" disabled={!auth||busy||authState?.busy} onPress={()=>void auth?.signOut()} />:null}
    <Text style={ui.small}>After browser sign-in, return to Cheapo and tap Continue sign-in.</Text>
  </ScrollView>;
}
