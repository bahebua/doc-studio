/*
 * Rasterize the source SVG icons to the PNG sizes that browser home-screen
 * / app-launcher UIs expect. Wired into `npm run prebuild:icons` so the
 * files land in `public/icons/` before Vite copies them into `dist/`.
 *
 * Why PNGs when we have SVGs already?
 *   - Android launchers and iOS Safari's "Add to Home Screen" flow both
 *     use raster icons. Chrome accepts SVG in the manifest but many
 *     Android OEM launchers still pull the largest PNG they can find.
 *   - iOS Safari's `<link rel="apple-touch-icon">` REQUIRES PNG (180x180
 *     is the current default; smaller sizes are only used when the
 *     preferred size is missing).
 *
 * Sizes generated:
 *   - icon-192.png / icon-512.png       (PWA manifest)
 *   - icon-192-maskable.png / -512-maskable (Android adaptive icon)
 *   - apple-touch-icon.png (180x180)    (iOS home-screen)
 *   - favicon-32.png / favicon-16.png   (browser tabs)
 *
 * Run:  npx tsx scripts/gen-icons.ts
 */
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, '..', 'public', 'icons');

interface Target {
  source: string;
  outName: string;
  size: number;
}

const TARGETS: Target[] = [
  // Standard PWA manifest icons.
  { source: 'icon.svg', outName: 'icon-192.png', size: 192 },
  { source: 'icon.svg', outName: 'icon-512.png', size: 512 },

  // Maskable variants for Android adaptive icons — content sits inside
  // the safe zone in `icon-maskable.svg`.
  { source: 'icon-maskable.svg', outName: 'icon-192-maskable.png', size: 192 },
  { source: 'icon-maskable.svg', outName: 'icon-512-maskable.png', size: 512 },

  // iOS home-screen. 180×180 is the current preferred size.
  { source: 'icon.svg', outName: 'apple-touch-icon.png', size: 180 },

  // Browser tab favicons — small sizes rasterize best from a dedicated
  // low-res SVG, but the main icon is close enough for our purposes.
  { source: 'icon.svg', outName: 'favicon-32.png', size: 32 },
  { source: 'icon.svg', outName: 'favicon-16.png', size: 16 },
];

let generated = 0;
for (const t of TARGETS) {
  const srcPath = path.join(iconsDir, t.source);
  if (!fs.existsSync(srcPath)) {
    console.warn(`[gen-icons] skip ${t.outName}: source ${t.source} missing`);
    continue;
  }
  const svg = fs.readFileSync(srcPath);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: t.size },
    // Anti-aliased edges look better on high-DPI displays.
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
  });
  const png = resvg.render().asPng();
  const outPath = path.join(iconsDir, t.outName);
  fs.writeFileSync(outPath, png);
  generated++;
  console.log(`[gen-icons] wrote ${t.outName} (${t.size}×${t.size}, ${png.byteLength} bytes)`);
}
console.log(`[gen-icons] done — ${generated}/${TARGETS.length} generated`);
