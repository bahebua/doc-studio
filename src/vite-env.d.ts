/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}

declare module 'remark-emoji';

// Mammoth ships its browser bundle at `mammoth/mammoth.browser` (UMD) with no
// accompanying types. Point it at the same declarations as the main entry.
declare module 'mammoth/mammoth.browser' {
  const mammoth: typeof import('mammoth');
  export = mammoth;
}
