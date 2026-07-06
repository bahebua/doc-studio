import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';

interface Props {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

/**
 * Very lightweight tooltip — no portal dependency, opens on hover/focus.
 */
export function Tooltip({ label, children, side = 'bottom' }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 250);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1 text-xs',
          'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-pop',
          'transition-opacity duration-150 left-1/2 -translate-x-1/2',
          side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
          open ? 'opacity-100' : 'opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
