/**
 * Bounded, allowlisted binary fetch for official source documents (C9).
 *
 * Every server-side image/PDF download flows through here. This is
 * deliberately NOT a general-purpose fetcher: the URL must already carry
 * an approved official host (see lib/official-urls), and everything about
 * the exchange is bounded — redirects are re-validated hop by hop, the
 * response is size-capped while streaming, the content type must match
 * what the caller expects, and the first bytes must actually be the
 * declared format so an HTML error page can never masquerade as a PDF or
 * image.
 *
 * SSRF posture: the approved-host allowlist is exact public hostnames, so
 * localhost, literal IPs, private/link-local ranges, and every non-http(s)
 * scheme are unreachable by construction — and each redirect target is
 * held to the same rule, so an approved host cannot bounce the fetch
 * somewhere else. Error messages carry origin + path only, never query
 * strings (which can carry signed tokens on storage hosts).
 */

export type SafeFetchKind = 'pdf' | 'image';

export interface SafeFetchOptions {
  /** Exact hostnames this fetch may touch (initial URL and every redirect). */
  approvedHosts: readonly string[];
  /** What the response must be — drives Content-Type and magic-byte checks. */
  kind: SafeFetchKind;
  /** Hard cap on response bytes; enforced while streaming, not after. */
  maxBytes: number;
  /** Whole-exchange deadline (connect + headers + body). */
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  /** The URL that actually served the bytes, after any redirects. */
  finalUrl: string;
  contentType: string | null;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_REDIRECTS = 3;

/** A URL safe to put in an error or log: origin and path, never the query. */
export function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<unparseable url>';
  }
}

function assertApproved(url: URL, approvedHosts: readonly string[], stage: string): void {
  if (url.protocol !== 'https:') {
    throw new Error(`${stage} is not https: ${sanitizeUrlForLog(url.href)}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${stage} carries credentials: ${sanitizeUrlForLog(url.href)}`);
  }
  const host = url.hostname.toLowerCase();
  if (!approvedHosts.some((approved) => approved.toLowerCase() === host)) {
    throw new Error(`${stage} host not approved: ${sanitizeUrlForLog(url.href)}`);
  }
}

/** Leading bytes that prove the payload is what it claims to be. */
function matchesMagic(kind: SafeFetchKind, bytes: Uint8Array): boolean {
  const startsWith = (prefix: number[]) =>
    bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);
  if (kind === 'pdf') return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return (
    startsWith([0xff, 0xd8, 0xff]) || // JPEG
    startsWith([0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith([0x47, 0x49, 0x46, 0x38]) || // GIF
    (startsWith([0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50) // RIFF….WEBP
  );
}

function contentTypeAcceptable(kind: SafeFetchKind, contentType: string | null): boolean {
  if (contentType === null) return true; // magic bytes still decide
  const media = contentType.split(';')[0].trim().toLowerCase();
  // An HTML or JSON body is an error page whatever the caller expected.
  if (media === 'text/html' || media === 'application/json' || media === 'text/plain') {
    return false;
  }
  if (kind === 'pdf') return media === 'application/pdf' || media === 'application/octet-stream';
  return media.startsWith('image/') || media === 'application/octet-stream';
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw new Error(`over size cap (${declared} bytes): ${sanitizeUrlForLog(url)}`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`over size cap (${bytes.byteLength} bytes): ${sanitizeUrlForLog(url)}`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`over size cap (>${maxBytes} bytes): ${sanitizeUrlForLog(url)}`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetch one official document within every bound described above.
 * Throws with a sanitized message on any violation; the caller records
 * the failure and moves on — a bad document must never break a run.
 */
export async function safeFetchBinary(
  url: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timeout after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    let current = new URL(url);
    assertApproved(current, options.approvedHosts, 'fetch target');

    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(current.href, {
        headers: options.headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        // Drain nothing: redirect bodies are irrelevant. Re-validate the
        // target exactly as the original URL was validated.
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`redirect without location: ${sanitizeUrlForLog(current.href)}`);
        }
        if (hop >= maxRedirects) {
          throw new Error(`too many redirects: ${sanitizeUrlForLog(url)}`);
        }
        const next = new URL(location, current);
        assertApproved(next, options.approvedHosts, 'redirect target');
        current = next;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentTypeAcceptable(options.kind, contentType)) {
        throw new Error(
          `unexpected content-type ${contentType?.split(';')[0] ?? 'none'} for ${options.kind}: ` +
            sanitizeUrlForLog(current.href),
        );
      }

      const bytes = await readCapped(response, options.maxBytes, current.href);
      if (!matchesMagic(options.kind, bytes)) {
        throw new Error(
          `payload is not a ${options.kind} (magic bytes mismatch): ` +
            sanitizeUrlForLog(current.href),
        );
      }
      return { bytes, finalUrl: current.href, contentType };
    }
  } finally {
    clearTimeout(timer);
  }
}
