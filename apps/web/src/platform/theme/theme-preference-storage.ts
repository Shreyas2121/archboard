import { isThemePreference, THEME_PREFERENCES, THEME_STORAGE_KEY } from './theme-preferences';
import type { ThemePreference } from './theme-preferences';

export function createThemePreferenceStorage(
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'> = () => window.localStorage,
) {
  let sessionPreference: ThemePreference | undefined;

  return {
    read(): ThemePreference {
      if (sessionPreference !== undefined) return sessionPreference;
      try {
        const stored = getStorage().getItem(THEME_STORAGE_KEY);
        sessionPreference = isThemePreference(stored) ? stored : THEME_PREFERENCES.SYSTEM;
      } catch {
        // Storage access can be blocked; keep theme selection available for this session.
        sessionPreference = THEME_PREFERENCES.SYSTEM;
      }
      return sessionPreference;
    },
    write(preference: ThemePreference): void {
      sessionPreference = preference;
      try {
        getStorage().setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // The in-memory choice remains authoritative even when persistence fails.
      }
    },
  };
}

export const themePreferenceStorage = createThemePreferenceStorage();
