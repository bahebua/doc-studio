import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

/**
 * Applies the currently selected theme (light / dark / system) to the <html>
 * element and keeps it in sync with the user's OS preference when "system"
 * is chosen.
 */
export function useTheme() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', isDark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', isDark ? '#0b1220' : '#ffffff');
    };

    apply();
    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [theme]);
}
