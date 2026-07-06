import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'ghost' | 'outline' | 'subtle' | 'danger';
type Size = 'sm' | 'md' | 'icon';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium rounded-lg select-none transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 shadow-soft',
  ghost:
    'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800',
  outline:
    'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 ' +
    'bg-white/60 dark:bg-night-soft/70 hover:bg-white hover:shadow-soft dark:hover:bg-night-muted',
  subtle:
    'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100',
  danger:
    'bg-red-600 text-white hover:bg-red-500 shadow-soft',
};

const sizes: Record<Size, string> = {
  sm: 'text-xs px-2.5 h-8',
  md: 'text-sm px-3.5 h-9',
  icon: 'h-9 w-9 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'ghost', size = 'md', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
});
