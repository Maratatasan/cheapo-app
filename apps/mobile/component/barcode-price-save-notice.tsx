import { Text } from 'react-native';

export function BarcodePriceSaveNotice({ text = 'Saved on this phone · Waiting to sync' }: { text?: string }) {
  return <Text accessibilityLiveRegion="polite" style={{ color: '#fff', textAlign: 'center' }}>
    {text}
  </Text>;
}
