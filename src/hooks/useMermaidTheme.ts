/**
 * Resolve the concrete Mermaid theme from the app shell.
 *
 * The diagram theme is intentionally bound 1:1 to the shell (light / dark)
 * so there is a single, obvious control for "how does the app look right
 * now" — no separate widget cluttering the header. Dark shell → `dark`
 * diagrams, otherwise → `default`.
 *
 * Exposes both a non-hook resolver (for one-shot use in export helpers)
 * and a React hook that re-renders when the shell class flips.
 */
import { useEffect, useState } from 'react';
import type { MermaidTheme } from '@/types';

const isShellDark = (): boolean =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark');

/** Non-hook resolver — safe to call from anywhere. */
export function resolveMermaidTheme(dark: boolean = isShellDark()): MermaidTheme {
  return dark ? 'dark' : 'default';
}

/**
 * React hook: returns the concrete Mermaid theme to render with. Watches
 * the shell `.dark` class so the diagram surface flips in lockstep with
 * the rest of the UI.
 */
export function useMermaidTheme(): MermaidTheme {
  const [dark, setDark] = useState<boolean>(isShellDark);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      const next = el.classList.contains('dark');
      setDark((prev) => (prev === next ? prev : next));
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    // Sync once in case the class changed between the initial `useState`
    // read and the effect firing.
    setDark(el.classList.contains('dark'));
    return () => obs.disconnect();
  }, []);

  return resolveMermaidTheme(dark);
}

