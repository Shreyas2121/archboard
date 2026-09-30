import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_DARK_QUERY } from '@/platform/theme/theme-preferences';

describe('theme initialization before React mounts', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { stored: 'light', systemDark: true, resolved: 'light' },
    { stored: 'dark', systemDark: false, resolved: 'dark' },
    { stored: 'system', systemDark: true, resolved: 'dark' },
    { stored: null, systemDark: false, resolved: 'light' },
  ])(
    'resolves $stored with systemDark=$systemDark to $resolved',
    async ({ stored, systemDark, resolved }) => {
      const root = {
        classList: { toggle: vi.fn() },
        dataset: { theme: '' },
        style: { colorScheme: '' },
      };
      const matchMedia = vi.fn(() => ({ matches: systemDark }));
      vi.stubGlobal('window', { localStorage: { getItem: () => stored }, matchMedia });
      vi.stubGlobal('document', { documentElement: root });
      const { initializeTheme } = await import('./theme-provider');

      initializeTheme();

      expect(root.classList.toggle).toHaveBeenCalledWith('dark', resolved === 'dark');
      expect(root.dataset.theme).toBe(resolved);
      expect(root.style.colorScheme).toBe(resolved);
      if (stored === 'light' || stored === 'dark') {
        expect(matchMedia).not.toHaveBeenCalled();
      } else {
        expect(matchMedia).toHaveBeenCalledWith(SYSTEM_DARK_QUERY);
      }
    },
  );

  it('initializes with blocked localStorage and reapplies an in-memory choice', async () => {
    const root = {
      classList: { toggle: vi.fn() },
      dataset: { theme: '' },
      style: { colorScheme: '' },
    };
    const blockedWindow = {
      get localStorage(): Storage {
        throw new Error('Storage access denied');
      },
      matchMedia: () => ({ matches: true }),
    };
    vi.stubGlobal('window', blockedWindow);
    vi.stubGlobal('document', { documentElement: root });
    const { initializeTheme } = await import('./theme-provider');
    const { themePreferenceStorage } = await import('@/platform/theme/theme-preference-storage');

    expect(() => initializeTheme()).not.toThrow();
    expect(root.style.colorScheme).toBe('dark');
    themePreferenceStorage.write('light');
    initializeTheme();
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(root.classList.toggle).toHaveBeenLastCalledWith('dark', false);
  });
});
