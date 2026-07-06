// latex.js ships no TypeScript declarations. We use `any` for the
// engine surface deliberately — the real API is small (`HtmlGenerator`
// + `parse`) and lives in a lazy chunk, so pulling in a full typing
// package would defeat the code-splitting.
declare module 'latex.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const HtmlGenerator: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const parse: any;
}

declare module 'latex.js/dist/css/base.css';
declare module 'latex.js/dist/css/article.css';
