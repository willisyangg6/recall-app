/**
 * Canonical resolution of official agency document URLs (C9).
 *
 * One resolver serves every seam that turns an href from preserved agency
 * HTML into a fetchable URL — FSIS label PDFs (server) and FDA product
 * photos (display layer). Before C9 each extractor had its own ad-hoc
 * string handling, and the FSIS one mistook protocol-relative hrefs
 * (`//www.fsis.usda.gov/…`) for root-relative paths, producing the
 * duplicated-host form `https://www.fsis.usda.gov//www.fsis.usda.gov/…`
 * recorded in the product_visual_failures ledger.
 *
 * Contract:
 *  - Standards-based: forms are classified per WHATWG URL semantics
 *    (absolute, protocol-relative, root-relative, ordinary relative) and
 *    resolved with `new URL(input, base)` — never by string guessing.
 *  - Approved hosts only: a URL that does not resolve to an approved
 *    official host returns null. An unrelated external URL is never
 *    rewritten into an official one — rejection happens before repair.
 *  - Byte-stable for well-formed input: a URL that is already correct
 *    resolves to itself. The FSIS label sync matches stored
 *    `product_visuals.source_url` values by equality, so normalization
 *    that changed an already-working URL would silently re-fetch the whole
 *    rendered corpus. (Verified over the live corpus in C9's audit.)
 *  - Bounded repair: the duplicated-host form is repaired only when the
 *    embedded host equals the URL's own (approved) host. Redundant
 *    slashes in the path collapse only on these approved hosts, where `//`
 *    in a path is always an error, never meaning.
 *  - Lossless where it matters: query strings and percent-encoded path
 *    segments survive untouched; fragments are preserved as given.
 */

/** Hosts an official FSIS document may live on. */
export const FSIS_HOSTS: readonly string[] = ['www.fsis.usda.gov', 'fsis.usda.gov'];

/**
 * Hosts an official FDA asset may live on. FDA serves site assets from
 * www.fda.gov and historically from bare fda.gov; product photos observed
 * in the corpus are exclusively `www.fda.gov/files/…`. The wildcard keeps
 * parity with the pre-C9 extractor, which accepted any `*.fda.gov` asset
 * host.
 */
export const FDA_HOSTS: readonly string[] = ['www.fda.gov', 'fda.gov', '*.fda.gov'];

export interface ResolveOfficialUrlOptions {
  /**
   * Hostnames the resolved URL may carry. An exact name matches itself; a
   * `*.example.gov` entry matches any single-or-deeper subdomain of
   * example.gov (never example.gov itself, and never a host that merely
   * ENDS in the text, so `evilexample.gov` cannot slip through).
   */
  approvedHosts: readonly string[];
  /**
   * The page the href appeared on, for resolving ordinary relative URLs.
   * When absent, ordinary relative hrefs resolve against the first
   * approved host's root — root-relative and absolute forms are
   * unaffected either way.
   */
  baseUrl?: string;
}

export interface ResolvedOfficialUrl {
  /** The https URL to fetch. */
  url: string;
  /** True when the duplicated-host defect was repaired. */
  repaired: boolean;
}

function isApprovedHost(host: string, approvedHosts: readonly string[]): boolean {
  const lowered = host.toLowerCase();
  return approvedHosts.some((approved) => {
    const pattern = approved.toLowerCase();
    if (pattern.startsWith('*.')) return lowered.endsWith(pattern.slice(1));
    return lowered === pattern;
  });
}

/**
 * Collapse runs of slashes in a path — safe only on approved official
 * hosts, whose servers treat `//` in a path as a broken link, never as
 * routing. Percent-encoded characters are untouched (the collapse sees
 * `%2F` as ordinary text, not a slash).
 */
function collapsePathSlashes(pathname: string): string {
  return pathname.replace(/\/{2,}/g, '/');
}

/**
 * Resolve one href from official agency HTML into a fetchable https URL.
 *
 * Returns null for anything that is not an approved official document
 * reference: other hosts, non-http(s) schemes (`data:`, `file:`,
 * `javascript:`, `mailto:`…), credentials smuggled into the authority,
 * or text that does not parse as a URL at all.
 */
export function resolveOfficialUrl(
  raw: string,
  options: ResolveOfficialUrlOptions,
): ResolvedOfficialUrl | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Explicit non-web schemes are rejected before any resolution: a base
  // URL must never turn `javascript:` or `data:` text into a fetch.
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;

  const base = options.baseUrl ?? `https://${options.approvedHosts[0]}/`;
  let parsed: URL;
  try {
    // WHATWG resolution handles every form in one place: absolute URLs
    // stand alone, `//host/path` takes the base's scheme, `/path` takes
    // the base's origin, and ordinary relative paths resolve against the
    // base's directory.
    parsed = new URL(trimmed, base);
  } catch {
    return null;
  }

  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!isApprovedHost(parsed.hostname, options.approvedHosts)) return null;
  if (parsed.port !== '') return null;

  // Both agencies serve https and redirect http to it; fetching https
  // directly removes a redirect that would otherwise need revalidation.
  parsed.protocol = 'https:';

  // The duplicated-host repair, bounded to the observed defect: a path
  // that begins by restating the URL's own host (the fingerprint of a
  // protocol-relative href joined as if it were root-relative). Only the
  // URL's own host qualifies — an approved URL whose path embeds some
  // OTHER host is left alone rather than guessed at.
  let repaired = false;
  const ownHost = parsed.hostname.toLowerCase();
  const embedded = parsed.pathname.match(/^\/\/?([^/]+)(\/.*)$/);
  if (embedded && embedded[1].toLowerCase() === ownHost) {
    parsed.pathname = embedded[2];
    repaired = true;
  }

  const collapsed = collapsePathSlashes(parsed.pathname);
  if (collapsed !== parsed.pathname) {
    parsed.pathname = collapsed;
    repaired = true;
  }

  return { url: parsed.href, repaired };
}
