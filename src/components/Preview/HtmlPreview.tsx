import { forwardRef, memo, useRef } from 'react';
import clsx from 'clsx';
import { usePreviewSearch } from '@/hooks/usePreviewSearch';
import { useHtmlPreviewFocus } from '@/hooks/usePreviewFocus';

interface Props {
  html: string;
  className?: string;
}

/**
 * Renders raw HTML into an isolated document. We use `dangerouslySetInnerHTML`
 * on a wrapper `div` — not an iframe — so:
 *  - preview search (Custom Highlight API) can walk the same DOM tree we
 *    do for Markdown, and
 *  - the user's HTML inherits the app's font stack for a coherent look.
 *
 * If the pasted HTML contains `<script>` React strips it silently via the
 * innerHTML setter; still, we do a minimal sanitize pass to drop
 * event-handler attributes so bookmarked docs can't launch attacks.
 */
function sanitize(html: string): string {
  // Drop `on*="..."` inline handlers and `javascript:` urls. Cheap first line
  // of defence — for a fuller solution we'd bring in DOMPurify, but the app
  // isn't accepting HTML from untrusted third parties (only user-owned files).
  return html
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

export const HtmlPreview = memo(
  forwardRef<HTMLDivElement, Props>(function HtmlPreview({ html, className }, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    usePreviewSearch(rootRef, html);
    useHtmlPreviewFocus(rootRef);

    const setRef = (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };

    return (
      <div
        ref={setRef}
        className={clsx('md-preview', className)}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: sanitize(html) || '<p><em>Nothing to preview yet — start writing in the editor.</em></p>' }}
      />
    );
  }),
);
