import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import Index from '../app/index';

const mockPush = jest.fn();
let mockExtra: Record<string, unknown> | undefined;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: mockExtra }; } },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => options.headerRight?.() ?? null },
}));
jest.mock('@/hooks/use-saved-shops', () => ({ useSavedShops: () => ({}) }));
jest.mock('@/component/shop/shop-chooser', () => ({
  ShopChooser: () => null, ShopLoadFeedback: () => null, ShopSyncFeedback: () => null,
}));
jest.mock('@/component/shop/shop-home', () => ({ ShopHome: () => null }));

const origin = 'https://cheapo.example';

beforeEach(() => mockPush.mockClear());

test('opens Cheapo access from opted-in iPhone Home', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'ios');
  mockExtra = { iosSharedShopping: true, cheapoApiOrigin: origin };
  try {
    await render(<Index />);
    expect(screen.queryByRole('button', { name: /^ChatGPT$/i })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Cheapo access$/i }));
    expect(mockPush).toHaveBeenCalledWith('/cheapo-access');
  } finally { platform.restore(); }
});

test.each([undefined, origin])('keeps the existing Android ChatGPT option (Cheapo origin: %s)', async cheapoApiOrigin => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  mockExtra = { fieldTest: true, cheapoApiOrigin };
  try {
    await render(<Index />);
    await fireEvent.press(screen.getByRole('button', { name: /^ChatGPT$/i }));
    expect(mockPush).toHaveBeenCalledWith('/direct-auth');
    if (cheapoApiOrigin) {
      await fireEvent.press(screen.getByRole('button', { name: /^Cheapo access$/i }));
      expect(mockPush).toHaveBeenCalledWith('/cheapo-access');
    } else expect(screen.queryByRole('button', { name: /^Cheapo access$/i })).not.toBeOnTheScreen();
  } finally { platform.restore(); }
});

test.each([
  ['ios', { cheapoApiOrigin: origin }],
  ['ios', { fieldTest: true, cheapoApiOrigin: origin }],
  ['ios', { iosSharedShopping: true, cheapoApiOrigin: 'http://cheapo.example' }],
  ['android', { iosSharedShopping: true, cheapoApiOrigin: origin }],
  ['web', { fieldTest: true, iosSharedShopping: true, cheapoApiOrigin: origin }],
] as const)('keeps default and mismatched platform modes off (%s, %j)', async (os, extra) => {
  const platform = jest.replaceProperty(Platform, 'OS', os);
  mockExtra = extra;
  try {
    await render(<Index />);
    expect(screen.queryByRole('button', { name: /^Cheapo access$/i })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^ChatGPT$/i })).not.toBeOnTheScreen();
  } finally { platform.restore(); }
});
