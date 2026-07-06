import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Button } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, wide }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while the modal is open so the page behind it doesn't
  // scroll under the backdrop.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  // Portal to <body> so the modal escapes any ancestor stacking context or
  // containing block (e.g. our header uses `backdrop-filter`, which per the
  // CSS spec becomes the containing block for `position: fixed` descendants
  // — that would trap the modal inside a 56px-tall header). Rendering into
  // <body> guarantees `fixed inset-0` fills the viewport.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] overflow-y-auto overscroll-contain"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Scrollable centering container. `min-h-full` + `items-center`
              gives vertical centering when the panel fits, and natural
              scrolling when it doesn't — the whole overlay scrolls, so
              nothing is ever clipped. */}
          <div className="relative min-h-full flex items-center justify-center p-4 sm:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className={clsx(
                'relative w-full my-auto rounded-2xl bg-white dark:bg-night-soft shadow-pop',
                'border border-slate-200 dark:border-slate-700',
                wide ? 'max-w-2xl' : 'max-w-md',
              )}
            >
              <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-base font-semibold">{title}</h2>
                <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
                  <X size={16} />
                </Button>
              </header>
              <div className="p-5">{children}</div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
