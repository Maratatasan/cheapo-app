import type { ConfigContext, ExpoConfig } from 'expo/config';
import { parseCheapoApiOrigin } from './lib/cheapo-access/origin.js';

// Keep standalone Android build identities separate from the default app.
export default function configure({ config }: ConfigContext): ExpoConfig {
  const authTest = process.env.CHEAPO_AUTH_TEST === '1';
  const fieldTest = process.env.CHEAPO_FIELD_TEST === '1';
  if (authTest && fieldTest) throw new Error('Choose one Cheapo test app per build.');
  if (fieldTest) {
    const configuredOrigin = process.env.CHEAPO_API_ORIGIN;
    const cheapoApiOrigin = parseCheapoApiOrigin(configuredOrigin);
    if (configuredOrigin && !cheapoApiOrigin) throw new Error('CHEAPO_API_ORIGIN must be a plain HTTPS origin.');
    return {
      ...config,
      name: 'Cheapo Field',
      slug: config.slug ?? 'cheapo-app',
      version: '0.1.9',
      scheme: 'cheapofield',
      android: { ...config.android, package: 'com.maratatasan.cheapo.field', versionCode: 11 },
      plugins: [...(config.plugins ?? []), 'expo-secure-store'],
      extra: { ...config.extra, fieldTest: true, cheapoApiOrigin: cheapoApiOrigin ?? undefined },
    };
  }
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
