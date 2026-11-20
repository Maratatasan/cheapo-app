import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import DirectAuth from '../app/direct-auth';

const mockSignIn = jest.fn();
let mockEnabled = true;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/direct-auth/phone-session', () => ({
  get fieldPhotoAnalysisEnabled() { return mockEnabled; },
  phoneAuth: {
    getState: () => ({ message: 'Not signed in on this phone.' }),
    subscribe: () => () => {},
    restore: async () => {},
    signIn: (...args: unknown[]) => mockSignIn(...args),
  },
}));

beforeEach(() => mockSignIn.mockClear());

test.each([
  ['ios', true, true], ['ios', false, false], ['android', true, false], ['web', true, false],
] as const)('offers explicit Chrome only on opted-in iPhone (%s, %s)', async (os, enabled, showChrome) => {
  const platform = jest.replaceProperty(Platform, 'OS', os);
  mockEnabled = enabled;
  try {
    await render(<DirectAuth />);
    const chrome = screen.queryByRole('button', { name: /^Sign in using Chrome$/i });
    if (showChrome && chrome) {
      await fireEvent.press(chrome);
      expect(mockSignIn).toHaveBeenLastCalledWith('chrome');
    } else {
      expect(chrome).toBeNull();
    }
    expect(Boolean(chrome)).toBe(showChrome);
    await fireEvent.press(screen.getByRole('button', { name: /^Sign in with ChatGPT on this phone$/i }));
    expect(mockSignIn).toHaveBeenLastCalledWith('default');
  } finally { platform.restore(); }
});
