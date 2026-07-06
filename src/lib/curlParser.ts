/**
 * Minimal cURL command parser tailored to the "import this doc" use case.
 * Supports the flags people actually paste from browser devtools and
 * Postman "Save as cURL", including basic multipart uploads.
 *
 *   curl 'https://example.com/api' \
 *     -X POST \
 *     -H 'accept: application/json' \
 *     -H 'authorization: Bearer …' \
 *     --data-raw '{"q":"hi"}' \
 *     -u user:password
 *
 * Multipart form (`--form`, `-F`) is parsed into `formParts`. File
 * references like `-F 'file=@/path/to/x.pdf'` record the basename only —
 * the browser can't read arbitrary filesystem paths, so the runtime
 * layer either wires bytes from the collection's `input/` folder or
 * prompts the user via a file picker.
 *
 * Missing on purpose: cookie jars, batch-shell flags, and other niche
 * cURL options — nothing that can't be honoured from a browser context.
 */

/**
 * One part of a multipart form body. `kind: 'text'` carries the value
 * inline; `kind: 'file'` carries just enough metadata to look up (or
 * request) the actual bytes at run time.
 */
export interface FormPart {
  /** Field name — the `name` in `--form 'name=value'`. */
  name: string;
  /** `text` = literal string value, `file` = attachment reference. */
  kind: 'text' | 'file';
  /** Present when `kind === 'text'` — the field's string value. */
  value?: string;
  /** Optional per-part MIME override; cURL's `;type=…` suffix. */
  contentType?: string;
  /** File basename (never the full path — we strip it during parsing so
   *  the reference is portable across machines). Present when
   *  `kind === 'file'`. Used to look up matching bytes in the saved
   *  collection's `input/` folder at run time. */
  filename?: string;
}

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Set when the command included `-k` / `--insecure`. The dev proxy
   *  honours this by using an undici Agent that skips TLS verification —
   *  needed for corp APIs behind self-signed / mis-configured certs. */
  insecure?: boolean;
  /** Multipart form parts from `-F` / `--form`. When present, the request
   *  is sent as `multipart/form-data` and `body` is ignored (cURL treats
   *  the two flags as mutually exclusive; last one wins there, but we
   *  keep both fields intact so the reviewer UI can show what was
   *  parsed). */
  formParts?: FormPart[];
}

/**
 * Shell-style token splitter that respects single and double quotes,
 * backslash escapes, and line continuations. Not a full shell parser —
 * good enough for the flags cURL emits, which is all we care about.
 *
 * Handles the classic bash single-quote-escape idiom `'it'\''s'` (three
 * quoted fragments concatenated: `'it'`, `\'`, `'s'` → `it's`). Missing
 * that made bodies containing apostrophes get truncated at the first `'`.
 */
function tokenize(input: string): string[] {
  const src = input.replace(/\\\r?\n/g, ' ').trim();
  const out: string[] = [];
  let i = 0;

  /** Consume the run of unquoted characters (up to next whitespace),
   *  honouring `\x` escapes and joining adjacent quoted fragments. Both
   *  the top-level bareword branch and the "join after closing quote"
   *  loop go through this same helper so the escape / quote-merge rules
   *  stay consistent. Returns the string produced and the new index. */
  const readBarewordSegment = (start: number): [string, number] => {
    let j = start;
    let buf = '';
    while (j < src.length && src[j] !== ' ' && src[j] !== '\t' && src[j] !== '\n') {
      const ch = src[j];
      if (ch === "'" || ch === '"') {
        // Adjacent quoted fragment — inline it into the current token.
        const quote = src[j++];
        while (j < src.length && src[j] !== quote) {
          if (quote === '"' && src[j] === '\\' && j + 1 < src.length) {
            buf += src[j + 1];
            j += 2;
          } else {
            buf += src[j++];
          }
        }
        j++; // consume closing quote (or EOF)
      } else if (ch === '\\' && j + 1 < src.length) {
        // Unquoted `\x` → literal x. Critical for bash's `\'` idiom.
        buf += src[j + 1];
        j += 2;
      } else {
        buf += src[j++];
      }
    }
    return [buf, j];
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let buf = '';
      while (i < src.length && src[i] !== quote) {
        if (quote === '"' && src[i] === '\\' && i + 1 < src.length) {
          buf += src[i + 1];
          i += 2;
        } else {
          buf += src[i++];
        }
      }
      i++; // consume closing quote (or EOF, harmless)
      // Adjacent quoted/unquoted fragments join into one token — shells
      // do this and cURL exports rely on it: `-H 'x: '"$TOKEN"`.
      const [suffix, next] = readBarewordSegment(i);
      buf += suffix;
      i = next;
      out.push(buf);
      continue;
    }
    // Bareword — read until whitespace, honouring `\x` escapes and any
    // embedded quote runs (Windows cmd cURL exports often produce these
    // via caret-escaped double quotes: `-H ^"foo: bar^"`).
    const [word, next] = readBarewordSegment(i);
    i = next;
    out.push(word);
  }
  return out;
}

/**
 * Parse a `curl …` command string into a fetch-ready shape.
 * Throws on malformed input; the caller should surface a toast.
 */
export function parseCurl(command: string): ParsedCurl {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Empty command.');

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error('Empty command.');
  if (tokens[0].toLowerCase() === 'curl') tokens.shift();
  if (tokens.length === 0) throw new Error('Missing URL.');

  const headers: Record<string, string> = {};
  let method: string | undefined;
  let body: string | undefined;
  let url: string | undefined;
  let user: string | undefined;
  let insecure = false;
  const formParts: FormPart[] = [];

  const takeValue = (i: number, flag: string): [string, number] => {
    if (i + 1 >= tokens.length) throw new Error(`Flag ${flag} needs a value.`);
    return [tokens[i + 1], i + 2];
  };

  for (let i = 0; i < tokens.length; ) {
    const tok = tokens[i];
    // Combined form: --data=foo, --header=x:y
    let flag = tok;
    let inlineValue: string | undefined;
    const eq = tok.indexOf('=');
    if (tok.startsWith('--') && eq > 0) {
      flag = tok.slice(0, eq);
      inlineValue = tok.slice(eq + 1);
    }

    switch (flag) {
      case '-X':
      case '--request': {
        if (inlineValue) {
          method = inlineValue.toUpperCase();
          i++;
        } else {
          const [v, next] = takeValue(i, flag);
          method = v.toUpperCase();
          i = next;
        }
        break;
      }
      case '-H':
      case '--header': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        const idx = val.indexOf(':');
        if (idx > 0) {
          const name = val.slice(0, idx).trim();
          const value = val.slice(idx + 1).trim();
          if (name) headers[name] = value;
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--data-urlencode': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        body = body == null ? val : `${body}&${val}`;
        if (!method) method = 'POST';
        break;
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        // Everything before the first `=` is the field name; the rest is
        // the value spec. Skip malformed parts silently instead of
        // aborting the whole parse — real cURL is lenient here too.
        const eqIdx = val.indexOf('=');
        if (eqIdx <= 0) break;
        const name = val.slice(0, eqIdx);
        let raw = val.slice(eqIdx + 1);

        // Per-part MIME override (`;type=text/json`) — cURL treats it
        // as trailing metadata on the value spec, not part of the
        // literal string. Applies to text AND file parts.
        let contentType: string | undefined;
        const typeMatch = raw.match(/;type=([^;]+)$/);
        if (typeMatch) {
          contentType = typeMatch[1].trim();
          raw = raw.slice(0, typeMatch.index);
        }

        if (flag !== '--form-string' && raw.startsWith('@')) {
          // File reference — `@/absolute/path` or `@relative/path`. Also
          // supports Windows-style `@"C:/…"` where the quotes are already
          // stripped by the tokenizer. We keep only the basename because
          // the full path is meaningless on any other machine, and use it
          // as the lookup key inside the collection's `input/` folder.
          const path = raw.slice(1).replace(/^["']|["']$/g, '');
          const basename = path.split(/[\\/]/).pop() || path || 'attachment';
          formParts.push({ name, kind: 'file', filename: basename, contentType });
        } else if (flag !== '--form-string' && raw.startsWith('<')) {
          // `<file` reads file contents as text — we don't have real
          // filesystem access, so treat it the same as an @file
          // reference: a placeholder the user will resolve at run time.
          const path = raw.slice(1).replace(/^["']|["']$/g, '');
          const basename = path.split(/[\\/]/).pop() || path || 'attachment';
          formParts.push({ name, kind: 'file', filename: basename, contentType });
        } else {
          // Literal text value. Strip a single pair of wrapping quotes
          // if present (Postman's `-F 'payload="{…}"'` idiom) so the
          // stored value is just the JSON, not `"…"`.
          let value = raw;
          if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))
          ) {
            value = value.slice(1, -1);
          }
          formParts.push({ name, kind: 'text', value, contentType });
        }
        if (!method) method = 'POST';
        break;
      }
      case '-u':
      case '--user': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        user = val;
        break;
      }
      case '-A':
      case '--user-agent': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        headers['user-agent'] = val;
        break;
      }
      case '-e':
      case '--referer': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        headers['referer'] = val;
        break;
      }
      case '-b':
      case '--cookie': {
        const val = inlineValue ?? (takeValue(i, flag)[0]);
        i = inlineValue ? i + 1 : i + 2;
        headers['cookie'] = val;
        break;
      }
      // Silent no-ops for flags that don't translate to fetch — we accept
      // the value (if any) so the parser keeps its bearings on the rest
      // of the command.
      case '--compressed':
      case '-L':
      case '--location':
      case '-s':
      case '--silent':
      case '-i':
      case '--include':
      case '-v':
      case '--verbose':
      case '-#':
      case '--progress-bar': {
        i++;
        break;
      }
      case '-k':
      case '--insecure': {
        insecure = true;
        i++;
        break;
      }
      case '-o':
      case '--output':
      case '-O':
      case '--remote-name':
      case '--connect-timeout':
      case '--max-time':
      case '--retry':
      case '--retry-delay':
      case '--resolve': {
        // Take + drop their value.
        if (!inlineValue) i += 2;
        else i += 1;
        break;
      }
      default: {
        if (tok.startsWith('-')) {
          // Unknown flag with likely value — skip conservatively.
          i += 1;
          break;
        }
        // Positional: the URL. First bareword wins; extras are ignored.
        if (!url) url = tok;
        i++;
      }
    }
  }

  if (!url) throw new Error('No URL found in cURL command.');

  // Basic auth: cURL sends `Authorization: Basic base64(user:pass)`.
  if (user) {
    // btoa is available in browsers; the parser is browser-only.
    headers['authorization'] = `Basic ${btoa(user)}`;
  }

  return {
    url,
    method: method ?? 'GET',
    headers,
    body,
    insecure: insecure || undefined,
    formParts: formParts.length > 0 ? formParts : undefined,
  };
}
