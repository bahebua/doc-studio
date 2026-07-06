import { useCallback, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  DEFAULT_STYLE,
  PRESETS,
  parseCssBlock,
  toCssBlock,
  type LatexStyleConfig,
} from '../../lib/latex/latexStyleConfig';

interface Props {
  value: LatexStyleConfig;
  onChange: (next: LatexStyleConfig) => void;
  className?: string;
}

interface KnobDef {
  key: keyof LatexStyleConfig;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
}

/**
 * All tunables surfaced by the panel. `step` doubles as the numeric
 * input resolution; `min`/`max` guard against typos that would break
 * the layout catastrophically.
 */
const KNOBS: readonly KnobDef[] = [
  { key: 'fontSizePx', label: 'Font size', unit: 'px', step: 0.5, min: 8, max: 24 },
  { key: 'lineHeight', label: 'Line height', unit: '', step: 0.02, min: 0.9, max: 2 },
  { key: 'pagePaddingIn', label: 'Page padding', unit: 'in', step: 0.05, min: 0.1, max: 1.5 },
  { key: 'h2MarginTopEx', label: 'Section top', unit: 'ex', step: 0.1, min: 0, max: 6 },
  { key: 'h2MarginBottomEx', label: 'Section bottom', unit: 'ex', step: 0.1, min: 0, max: 6 },
  { key: 'h2FontSizeEm', label: 'Section size', unit: 'em', step: 0.02, min: 0.8, max: 2 },
  { key: 'hugeFontSizeEm', label: 'Title size', unit: 'em', step: 0.05, min: 1, max: 4 },
  { key: 'listIndentEm', label: 'List indent', unit: 'em', step: 0.1, min: 0, max: 4 },
  { key: 'listItemSpacingRem', label: 'Item spacing', unit: 'rem', step: 0.02, min: 0, max: 1 },
  { key: 'paragraphSpacingEm', label: 'Para spacing', unit: 'em', step: 0.05, min: 0, max: 2 },
] as const;

/**
 * Inline, collapsible strip that lets the user tune every visible
 * spacing / sizing knob for the LaTeX preview. Values flow up through
 * `onChange`; the parent is expected to persist them (this component
 * intentionally stays stateless w.r.t. storage so it works in tests
 * and Storybook without side effects).
 */
export function LatexStylePanel({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Import-CSS sub-panel state. Kept separate from `open` so the user
  // can leave the numeric knobs collapsed while pasting a stylesheet.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const setKnob = useCallback(
    (key: keyof LatexStyleConfig, raw: string) => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      onChange({ ...value, [key]: parsed });
    },
    [onChange, value],
  );

  const applyPreset = useCallback(
    (name: string) => {
      const preset = PRESETS[name];
      if (preset) onChange({ ...preset });
    },
    [onChange],
  );

  const reset = useCallback(() => onChange({ ...DEFAULT_STYLE }), [onChange]);

  const copyCss = useCallback(async () => {
    const css = toCssBlock(value);
    try {
      await navigator.clipboard.writeText(css);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions, insecure context) — fall back
      // to a temporary textarea + execCommand which works in more
      // browsers but is deprecated.
      const ta = document.createElement('textarea');
      ta.value = css;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, [value]);

  /** Merge parsed `--doc-*` overrides into the current config. */
  const applyImportedCss = useCallback(
    (cssText: string, sourceLabel: string) => {
      const { patch, matched, unknown } = parseCssBlock(cssText);
      if (matched === 0) {
        setImportFeedback(
          `No \`--doc-*\` variables found in ${sourceLabel}. Paste a block ` +
            'like `.md-preview.latex-mode { --doc-font-size: 14px; }`.',
        );
        return;
      }
      onChange({ ...value, ...patch });
      const skipped = unknown.length
        ? ` (${unknown.length} unknown var${unknown.length === 1 ? '' : 's'} ignored)`
        : '';
      setImportFeedback(
        `Applied ${matched} value${matched === 1 ? '' : 's'} from ${sourceLabel}${skipped}.`,
      );
    },
    [onChange, value],
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        applyImportedCss(text, file.name);
      } catch (err) {
        setImportFeedback(
          `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [applyImportedCss],
  );

  // Detect whether the current config exactly matches a preset — used
  // to highlight the active preset button so the user can see which
  // profile they're editing against.
  const activePreset = useMemo(() => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const same = (Object.keys(preset) as (keyof LatexStyleConfig)[]).every(
        (k) => Math.abs(preset[k] - value[k]) < 1e-6,
      );
      if (same) return name;
    }
    return null;
  }, [value]);

  return (
    <div
      className={clsx(
        'mb-2 rounded border border-slate-200 bg-slate-50 text-xs text-slate-700 shadow-sm',
        'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-slate-200 dark:hover:bg-slate-700"
          aria-expanded={open}
        >
          <span
            className={clsx(
              'inline-block transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden="true"
          >
            ▶
          </span>
          LaTeX style
        </button>
        <div className="ml-auto flex items-center gap-1">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(name)}
              className={clsx(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                activePreset === name
                  ? 'bg-sky-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
              )}
              aria-pressed={activePreset === name}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            onClick={copyCss}
            className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
          >
            {copied ? 'Copied!' : 'Copy CSS'}
          </button>
          <button
            type="button"
            onClick={() => {
              setImportOpen((v) => !v);
              setImportFeedback(null);
            }}
            className={clsx(
              'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
              importOpen
                ? 'bg-sky-600 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
            )}
            aria-expanded={importOpen}
          >
            Import CSS
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
          >
            Reset
          </button>
        </div>
      </div>
      {importOpen && (
        <div className="flex flex-col gap-2 border-t border-slate-200 px-2 py-2 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <span>
              Paste a CSS block containing <code className="font-mono">--doc-*</code>{' '}
              variables, or upload a <code className="font-mono">.css</code> file.
            </span>
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className="ml-auto rounded bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              Choose file…
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".css,text/css"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
                // Reset so choosing the same file twice re-fires change.
                e.target.value = '';
              }}
            />
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={`.md-preview.latex-mode {\n  --doc-font-size: 14px;\n  --doc-line-height: 1.3;\n}`}
            spellCheck={false}
            className="h-24 w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] leading-4 text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyImportedCss(importText, 'pasted CSS')}
              disabled={!importText.trim()}
              className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply pasted CSS
            </button>
            <button
              type="button"
              onClick={() => {
                setImportText('');
                setImportFeedback(null);
              }}
              className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              Clear
            </button>
            {importFeedback && (
              <span className="text-[11px] text-slate-600 dark:text-slate-300">
                {importFeedback}
              </span>
            )}
          </div>
        </div>
      )}
      {open && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-200 px-2 py-2 dark:border-slate-700 sm:grid-cols-3 md:grid-cols-5">
          {KNOBS.map((knob) => (
            <label key={knob.key} className="flex items-center gap-1.5">
              <span className="flex-1 truncate" title={knob.label}>
                {knob.label}
              </span>
              <input
                type="number"
                value={value[knob.key]}
                step={knob.step}
                min={knob.min}
                max={knob.max}
                onChange={(e) => setKnob(knob.key, e.target.value)}
                className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
              {knob.unit && (
                <span className="w-6 text-[10px] text-slate-500 dark:text-slate-400">
                  {knob.unit}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default LatexStylePanel;
