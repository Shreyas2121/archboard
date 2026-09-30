export const THEME_PREFERENCES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[keyof typeof THEME_PREFERENCES];
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const THEME_OPTIONS = [
  { value: THEME_PREFERENCES.LIGHT, label: 'Light' },
  { value: THEME_PREFERENCES.DARK, label: 'Dark' },
  { value: THEME_PREFERENCES.SYSTEM, label: 'System' },
] as const;

export const THEME_STORAGE_KEY = 'archboard.theme';
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: string | null): value is ThemePreference {
  return Object.values(THEME_PREFERENCES).some((theme) => theme === value);
}
