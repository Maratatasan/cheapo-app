import { Text } from 'react-native';

export function BarcodePriceSaveNotice() {
  return <Text accessibilityLiveRegion="polite" style={{ color: '#fff', textAlign: 'center' }}>
    Saved on this phone · Waiting to sync
  </Text>;
}
