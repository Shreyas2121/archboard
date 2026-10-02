import { describe, expect, it, vi } from 'vitest';

import { createThemePreferenceStorage } from '@/platform/theme/theme-preference-storage';
import { THEME_OPTIONS, THEME_STORAGE_KEY } from '@/platform/theme/theme-preferences';

describe('theme preference storage', () => {
  it.each(THEME_OPTIONS)(
    'reads the persisted $value preference using the existing key',
    ({ value }) => {
      const storage = { getItem: vi.fn(() => value), setItem: vi.fn() };
      const preferences = createThemePreferenceStorage(() => storage);

      expect(preferences.read()).toBe(value);
      expect(storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    },
  );

  it.each([null, '', 'invalid', 'Dark'])('defaults %s to system', (stored) => {
    const preferences = createThemePreferenceStorage(() => ({
      getItem: () => stored,
      setItem: vi.fn(),
    }));

    expect(preferences.read()).toBe('system');
  });

  it('persists changes under the existing key', () => {
    const storage = { getItem: () => 'light', setItem: vi.fn() };
    const preferences = createThemePreferenceStorage(() => storage);

    preferences.write('dark');

    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    expect(preferences.read()).toBe('dark');
  });

  it('keeps the session choice when the storage accessor is blocked', () => {
    const preferences = createThemePreferenceStorage(() => {
      throw new Error('Storage is unavailable');
    });

    expect(preferences.read()).toBe('system');
    expect(() => preferences.write('dark')).not.toThrow();
    expect(preferences.read()).toBe('dark');
    preferences.write('light');
    expect(preferences.read()).toBe('light');
  });

  it('recovers from a read failure and retains a subsequent choice', () => {
    const preferences = createThemePreferenceStorage(() => ({
      getItem: () => {
        throw new Error('Read denied');
      },
      setItem: vi.fn(),
    }));

    expect(preferences.read()).toBe('system');
    preferences.write('dark');
    expect(preferences.read()).toBe('dark');
  });

  it('keeps a choice when writes fail rather than rereading an older persisted value', () => {
    const preferences = createThemePreferenceStorage(() => ({
      getItem: () => 'light',
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    }));

    expect(preferences.read()).toBe('light');
    expect(() => preferences.write('dark')).not.toThrow();
    expect(preferences.read()).toBe('dark');
    preferences.write('system');
    expect(preferences.read()).toBe('system');
  });
});
