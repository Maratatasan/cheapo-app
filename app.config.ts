import type { ConfigContext, ExpoConfig } from 'expo/config';

// Opt in only when building the standalone Android authentication experiment.
export default function configure({ config }: ConfigContext): ExpoConfig {
  if (process.env.CHEAPO_AUTH_TEST !== '1') return config as ExpoConfig;
  return {
    ...config,
    name: 'Cheapo Auth Test',
    slug: config.slug ?? 'cheapo-app',
    scheme: 'cheapo-auth-test',
    android: { ...config.android, package: 'com.maratatasan.cheapo.dev' },
    plugins: [...(config.plugins ?? []), 'expo-secure-store'],
    extra: { ...config.extra, directAuthTest: true },
  };
}
