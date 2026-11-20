import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function phonePhotoAnalysisRequested() {
  const extra = Constants.expoConfig?.extra;
  return Platform.OS === 'android' ? extra?.fieldTest === true
    : Platform.OS === 'ios' && extra?.iosSharedShopping === true && extra?.iosPhotoAnalysis === true;
}
