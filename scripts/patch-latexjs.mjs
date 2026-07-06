/**
 * latex.js@0.12.6 ships two placeholder `.keep` files in its dist
 * folder (`dist/documentclasses/.keep`, `dist/packages/.keep`) so npm
 * preserves the otherwise-empty directories that its runtime dynamic
 * `require()` scans. Vite's esbuild dep pre-bundler expands those
 * dynamic requires as glob imports and blows up on the `.keep` files
 * because no loader is registered for that extension.
 *
 * Every attempt to teach esbuild about `.keep` (esbuildOptions.loader,
 * a custom esbuild plugin, a Rollup-side Vite plugin) has failed
 * because the glob-scan pass runs at a layer none of those hooks
 * reach. The cleanest workaround is to just delete the two marker
 * files — they're placeholders with no purpose in a browser build,
 * and the empty directories that remain contribute nothing to the
 * dynamic require lookups (which will simply return undefined and
 * hit latex.js's own try/catch fallback).
 *
 * This script runs on `postinstall` so the fix is idempotent and
 * survives `npm ci` / `npm install`.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const targets = [
  resolve(root, 'node_modules/latex.js/dist/documentclasses/.keep'),
  resolve(root, 'node_modules/latex.js/dist/packages/.keep'),
];

for (const p of targets) {
  if (existsSync(p)) {
    try {
      unlinkSync(p);
      console.log(`[patch-latexjs] removed ${p.replace(root, '.')}`);
    } catch (err) {
      console.warn(`[patch-latexjs] could not remove ${p}:`, err);
    }
  }
}
