import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

// Match static HTML during hydration before using the device theme.
export function useColorScheme(): 'light' | 'dark' {
  const hasHydrated = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const colorScheme = useRNColorScheme();
  return hasHydrated && colorScheme === 'dark' ? 'dark' : 'light';
}
