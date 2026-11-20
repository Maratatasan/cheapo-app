import { AppState, Linking, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { createPhoneAuth, type PhoneNative } from './client';
import { phonePhotoAnalysisRequested } from './config';

type Check = { callbackVerified: boolean; signatureVerified: boolean; boundAddress: string };
const extra = Constants.expoConfig?.extra;
export const fieldPhotoAnalysisEnabled = phonePhotoAnalysisRequested();
const iphone = Platform.OS === 'ios' && fieldPhotoAnalysisEnabled;
export const phoneAuthNative = fieldPhotoAnalysisEnabled || (Platform.OS === 'android' && extra?.directAuthTest === true)
  ? requireOptionalNativeModule<PhoneNative & { selfTest(state: string): Promise<Check> }>('CheapoLoopback')
  : null;

export const randomHex = () => Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const phoneAuth = phoneAuthNative ? createPhoneAuth({
  native: phoneAuthNative,
  appName: iphone ? 'Cheapo' : fieldPhotoAnalysisEnabled ? 'Cheapo Field' : undefined,
  storageName: iphone ? 'the iPhone Keychain' : undefined,
  getItem: SecureStore.getItemAsync,
  setItem: iphone ? (key, value) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }) : SecureStore.setItemAsync,
  deleteItem: SecureStore.deleteItemAsync,
  randomUUID: Crypto.randomUUID,
  randomHex,
  challenge: async (verifier) => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'),
  openBrowser: (url) => Linking.openURL(url),
  isAppActive: () => AppState.currentState === 'active',
}) : null;
