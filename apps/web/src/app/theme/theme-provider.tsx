import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { SYSTEM_DARK_QUERY, THEME_PREFERENCES } from '@/platform/theme/theme-preferences';
import type { ResolvedTheme, ThemePreference } from '@/platform/theme/theme-preferences';
import { themePreferenceStorage } from '@/platform/theme/theme-preference-storage';

export { THEME_PREFERENCES } from '@/platform/theme/theme-preferences';
export type { ResolvedTheme, ThemePreference } from '@/platform/theme/theme-preferences';

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolvedTheme: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
  readonly cyclePreference: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== THEME_PREFERENCES.SYSTEM) return preference;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches
    ? THEME_PREFERENCES.DARK
    : THEME_PREFERENCES.LIGHT;
}

function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.classList.toggle('dark', resolved === THEME_PREFERENCES.DARK);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function initializeTheme(): void {
  applyTheme(themePreferenceStorage.read());
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(themePreferenceStorage.read);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyTheme(preference));

  useEffect(() => {
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const synchronize = (): void => setResolvedTheme(applyTheme(preference));
    synchronize();
    if (preference === THEME_PREFERENCES.SYSTEM) media.addEventListener('change', synchronize);
    return () => media.removeEventListener('change', synchronize);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => {
    const setPreference = (nextPreference: ThemePreference): void => {
      themePreferenceStorage.write(nextPreference);
      setResolvedTheme(applyTheme(nextPreference));
      setPreferenceState(nextPreference);
    };
    const cyclePreference = (): void => {
      const next =
        preference === THEME_PREFERENCES.LIGHT
          ? THEME_PREFERENCES.DARK
          : preference === THEME_PREFERENCES.DARK
            ? THEME_PREFERENCES.SYSTEM
            : THEME_PREFERENCES.LIGHT;
      setPreference(next);
    };
    return { preference, resolvedTheme, setPreference, cyclePreference };
  }, [preference, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside ThemeProvider.');
  return value;
}
