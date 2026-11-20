import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const fixture = new URL('./expo-fixtures.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (['expo-file-system', 'expo-crypto', 'expo/fetch'].includes(specifier)) {
      return { url: fixture, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !specifier.endsWith('.ts')) {
      for (const extension of ['.ts', '.js']) {
        const file = new URL(specifier + extension, context.parentURL);
        if (existsSync(fileURLToPath(file))) return next(file.href, context);
      }
    }
    return next(specifier, context);
  },
});
