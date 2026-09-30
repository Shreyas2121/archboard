import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/app/theme/theme-provider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  isThemePreference,
  THEME_OPTIONS,
  THEME_PREFERENCES,
} from '@/platform/theme/theme-preferences';

export function ThemeControl({ compact = false }: { readonly compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  const ThemeIcon =
    preference === THEME_PREFERENCES.LIGHT
      ? Sun
      : preference === THEME_PREFERENCES.DARK
        ? Moon
        : Monitor;
  const label = THEME_OPTIONS.find((option) => option.value === preference)?.label;

  return (
    <Select
      value={preference}
      onValueChange={(value) => {
        if (isThemePreference(value)) setPreference(value);
      }}
    >
      <SelectTrigger
        aria-label={`Color theme: ${label}`}
        title={compact ? `Color theme: ${label}` : undefined}
        onKeyDown={(event) => event.stopPropagation()}
        size={compact ? 'sm' : 'default'}
        className={cn('shrink-0', compact && 'size-8 justify-center px-0 [&>svg]:hidden')}
      >
        <SelectValue>
          <ThemeIcon aria-hidden="true" />
          <span className={cn(compact && 'sr-only')}>{label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end" onKeyDown={(event) => event.stopPropagation()}>
        {THEME_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
