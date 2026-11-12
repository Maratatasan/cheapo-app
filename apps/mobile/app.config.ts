import type { ConfigContext, ExpoConfig } from 'expo/config';

// Keep standalone Android build identities separate from the default app.
export default function configure({ config }: ConfigContext): ExpoConfig {
  const authTest = process.env.CHEAPO_AUTH_TEST === '1';
  const fieldTest = process.env.CHEAPO_FIELD_TEST === '1';
  if (authTest && fieldTest) throw new Error('Choose one Cheapo test app per build.');
  if (fieldTest) return {
    ...config,
    name: 'Cheapo Field',
    slug: config.slug ?? 'cheapo-app',
    version: '0.1.7',
    scheme: 'cheapofield',
    android: { ...config.android, package: 'com.maratatasan.cheapo.field', versionCode: 9 },
    plugins: [...(config.plugins ?? []), 'expo-secure-store'],
    extra: { ...config.extra, fieldTest: true },
  };
  if (!authTest) return config as ExpoConfig;
  return {
    ...config,
    name: 'Cheapo Auth Test',
    version: '1.0.2',
    slug: config.slug ?? 'cheapo-app',
    scheme: 'cheapo-auth-test',
    android: { ...config.android, package: 'com.maratatasan.cheapo.dev', versionCode: 3 },
    plugins: [...(config.plugins ?? []), 'expo-secure-store'],
    extra: { ...config.extra, directAuthTest: true },
  };
}
