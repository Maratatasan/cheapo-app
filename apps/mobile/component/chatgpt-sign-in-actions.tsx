import { Button, Text } from 'react-native';

import { ui } from './results/theme';
import type { PhoneAuthState } from '../lib/direct-auth/client';
import type { PhoneAuthBrowser } from '../lib/direct-auth/protocol';

type Props = {
  state?: PhoneAuthState;
  checking?: boolean;
  showChromeOption?: boolean;
  onSignIn?: (browser: PhoneAuthBrowser) => void;
  onContinue: () => void;
  onCancel: () => void;
};

export function ChatGPTSignInActions({ state, checking, showChromeOption, onSignIn, onContinue, onCancel }: Props) {
  const disabled = !onSignIn || checking || state?.busy;
  return <>
    <Text style={ui.body}>{state?.message || 'Install the Android field app to sign in.'}</Text>
    <Text style={ui.small}>Identity: {state?.signedIn ? 'verified' : 'not verified'} · Plan permission: {state?.planAllowed ? 'granted' : 'not granted'} · Saved login: {state?.savedLogin ? 'yes' : 'no'}</Text>
    <Button
      title={state?.busy ? 'Completing phone sign-in…' : 'Sign in with ChatGPT on this phone'}
      disabled={disabled} onPress={() => onSignIn?.('default')}
    />
    {showChromeOption ? <Button
      title="Sign in using Chrome" disabled={disabled} onPress={() => onSignIn?.('chrome')}
    /> : null}
    {state?.awaitingContinue ? <Button title="Continue sign-in" onPress={onContinue} /> : null}
    {state?.busy ? <Button title="Cancel phone sign-in" onPress={onCancel} /> : null}
  </>;
}
