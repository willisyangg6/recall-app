/**
 * Canonical GTIN normalization (C9) — the matching-grade identifier layer.
 *
 * `normalizeUpc` (identifiers.ts) answers a DISPLAY question: "is this a
 * barcode-shaped value a shopper can compare against a package?" It keeps
 * digits verbatim and never validates. Exact-identifier matching — catalog
 * image enrichment, cross-recall identity — needs a stricter answer: a
 * value is a GTIN only when it is structurally valid, and two spellings of
 * one GTIN must share one canonical key.
 *
 * Rules, from the GS1 General Specifications:
 *  - Supported lengths: 8 (GTIN-8), 12 (GTIN-12/UPC-A), 13 (GTIN-13/EAN-13),
 *    14 (GTIN-14). Nothing else is ever padded or truncated to fit.
 *  - The final digit is a mod-10 check digit (weights 3/1 alternating from
 *    the right); an invalid check digit rejects the value.
 *  - GTIN-12 and GTIN-13 are the same identifier as their zero-padded
 *    GTIN-14 form, so the canonical key is the digits left-padded to 14 —
 *    the one equivalence the standard defines. A GTIN-8 is its own
 *    namespace; its padded key never collides with a padded GTIN-12/13
 *    because a GTIN-12 with five leading zeros is not a valid article
 *    number in practice and the length class is carried alongside.
 *  - Leading zeros are significant and preserved in `digits` exactly as
 *    printed.
 *  - An 8-digit code is AMBIGUOUS in prose: it may be a GTIN-8 (EAN-8,
 *    check digit over its own digits) or a zero-suppressed UPC-E (check
 *    digit computed over the expanded UPC-A). The two validate
 *    differently, and recall notices never say which. It is reported as
 *    ambiguous and must not drive exact-match enrichment.
 *
 * What this module deliberately does NOT do: fuzzy repair. A 10-digit
 * "UPC" missing its system digit and check digit, a lot code, a Julian
 * date code, a USDA establishment number — all reject. Absence of a match
 * is honest; a guessed identifier is not.
 */

export type GtinLength = 8 | 12 | 13 | 14;

export interface ValidGtin {
  ok: true;
  /** The digits exactly as printed, separators removed, zeros preserved. */
  digits: string;
  length: GtinLength;
  /** Canonical 14-digit key: `digits` left-padded with zeros. */
  key: string;
  /** True for 8-digit codes (GTIN-8 vs zero-suppressed UPC-E is undecidable). */
  ambiguous: boolean;
  /** Exactly what the source printed. */
  raw: string;
}

export interface InvalidGtin {
  ok: false;
  reason: 'not-a-digit-run' | 'unsupported-length' | 'check-digit';
  raw: string;
}

export type GtinResult = ValidGtin | InvalidGtin;

const GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];

/**
 * GS1 mod-10 check: number positions from the RIGHT starting at 1 (the
 * check digit); even positions weigh 3, odd positions weigh 1. The total,
 * check digit included, must be divisible by 10. Zero-padding on the left
 * adds only zero terms, which is why the GTIN-12→14 equivalence holds.
 */
export function hasValidCheckDigit(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const positionFromRight = digits.length - i;
    const weight = positionFromRight % 2 === 0 ? 3 : 1;
    sum += (digits.charCodeAt(i) - 48) * weight;
  }
  return sum % 10 === 0;
}

/**
 * Normalize one printed identifier into a GTIN, or say exactly why not.
 *
 * Accepted input is digits with the separators packages actually print —
 * spaces and hyphens ("6 28634 44216 6", "0-41548-61004-7"). Any other
 * character (letters, slashes, dots) means the value is a lot code, date
 * code, establishment number, or prose — never a GTIN.
 */
export function normalizeGtin(raw: string): GtinResult {
  const trimmed = raw.trim();
  if (!/^[\d\s-]+$/.test(trimmed) || !/\d/.test(trimmed)) {
    return { ok: false, reason: 'not-a-digit-run', raw: trimmed };
  }
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!GTIN_LENGTHS.includes(digits.length)) {
    return { ok: false, reason: 'unsupported-length', raw: trimmed };
  }
  if (!hasValidCheckDigit(digits)) {
    return { ok: false, reason: 'check-digit', raw: trimmed };
  }
  return {
    ok: true,
    digits,
    length: digits.length as GtinLength,
    key: digits.padStart(14, '0'),
    ambiguous: digits.length === 8,
    raw: trimmed,
  };
}

/**
 * The GTINs usable for exact-match lookup, from a set of candidate
 * strings: valid, unambiguous, deduplicated on the canonical key, source
 * order preserved. Conflicting spellings that reduce to one key collapse;
 * genuinely different GTINs stay distinct (a multi-product recall
 * legitimately carries many).
 */
export function exactMatchGtins(candidates: readonly string[]): ValidGtin[] {
  const out: ValidGtin[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const result = normalizeGtin(candidate);
    if (!result.ok || result.ambiguous || seen.has(result.key)) continue;
    seen.add(result.key);
    out.push(result);
  }
  return out;
}
