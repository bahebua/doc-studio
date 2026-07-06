import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

/**
 * Global keyboard shortcuts.
 *
 * - Ctrl/Cmd+S       → prevent browser save (autosave already runs)
 * - Ctrl/Cmd+Z       → undo
 * - Ctrl/Cmd+Shift+Z → redo
 * - Ctrl/Cmd+B       → toggle preview / editor
 * - Ctrl/Cmd+/       → toggle split view
 * - F11              → zen mode
 */
export function useKeyboardShortcuts() {
  const store = useAppStore.getState;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (isMod && key === 's') {
        e.preventDefault();
        return;
      }
      if (isMod && !e.shiftKey && key === 'z') {
        e.preventDefault();
        store().undo();
        return;
      }
      if (isMod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        store().redo();
        return;
      }
      if (isMod && key === 'b') {
        e.preventDefault();
        const { viewMode, setViewMode } = store();
        setViewMode(viewMode === 'editor' ? 'preview' : 'editor');
        return;
      }
      if (isMod && key === '/') {
        e.preventDefault();
        store().setViewMode('split');
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        store().toggleZen();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);
}
