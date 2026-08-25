/**
 * The closed consumer variant-identity contract.
 *
 * A variant name is the identity of a distinct affected product — a flavor, a
 * size-specific product, a format, a package/count version. It is NEVER a
 * date, a place, a code, a field label, or a serialized source row. The
 * previous pass closed the FIELD vocabulary; this closes the IDENTITY
 * vocabulary, because real regressions produced variant cards named
 * "Best by 12/14/2026" (a date list read as products), "California" (a
 * distribution list read as products), and "Case item code : 8 1000156076 5"
 * (a property row read as a product).
 *
 * Source parsers may extract broadly; this validator gates narrowly at the
 * consumer projection boundary. A row whose facts are valid but whose name is
 * not does not become a variant — its facts attach to the parent product
 * scope instead, so nothing the source stated is lost. Ambiguity resolves by
 * widening scope, never by inventing an identity.
 */

import { isUsCityName, normalizeStateToken } from '@/domain/us-geography';
import { conceptForLabel } from './consumer-concepts';

/** Why a candidate name cannot be a consumer-facing variant identity. */
export type VariantIdentityRejection =
  'date' | 'geography' | 'code' | 'field-label' | 'raw-source-row';

/** A calendar-date token in any of the shapes announcements print. */
const DATE_TOKEN =
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{2,4}\b|\b(?:19|20)\d{2}\b/gi;

/**
 * Field labels that appear at the head of a serialized row or a label+value
 * string. Matches the approved package vocabulary AND the known unapproved
 * source labels — either way, a label is not a product.
 */
const FIELD_LABEL_HEAD =
  /^["“]?(?:best[- ](?:if[- ]used[- ])?b(?:y|efore)|use[- ]by|sell[- ]by|freeze[- ]by|expir\w*|lot(?:\s*(?:code|number|#))?|batch(?:\s*(?:code|number|#))?|upc(?:\s+item)?(?:\s*code)?|bar\s*code|item\s+(?:name|number|code)|case(?:\s+item)?\s*code|product\s+code|date\s+code|sku|est\.?\s*(?:no|number)|establishment)\b/i;

/**
 * Directional-region geography ("Southern California", "Northern Nevada",
 * "Upstate New York"). The remainder must itself be a known place for the
 * whole phrase to read as geography — "Southern Comfort" is not a region.
 */
const DIRECTIONAL_PREFIX =
  /^(?:southern|northern|eastern|western|central|northeastern|northwestern|southeastern|southwestern|upstate|downstate|greater|metro)\s+(.+)$/i;

/** True when a phrase names a US region, state, or city — geography, not a product. */
export function isGeographicName(name: string): boolean {
  const trimmed = name.trim();
  if (normalizeStateToken(trimmed) !== null) return true;
  if (isUsCityName(trimmed)) return true;
  const directional = trimmed.match(DIRECTIONAL_PREFIX);
  if (directional && isGeographicName(directional[1])) return true;
  // A conjunction of places is still geography ("Ann Arbor and Brighton",
  // "California Nevada" from a mis-split table cell).
  const parts = trimmed.split(/\s+and\s+|\s*,\s*/);
  if (parts.length > 1 && parts.every((part) => part === '' || isGeographicName(part))) return true;
  const spaced = trimmed.split(/\s+/);
  if (spaced.length > 1 && spaced.every((part) => normalizeStateToken(part) !== null)) return true;
  return false;
}

/**
 * The reason a candidate variant name is invalid, or null when it is a
 * legitimate product identity. Deliberately asymmetric: it rejects names that
 * are demonstrably the wrong KIND of thing rather than demanding proof of the
 * right one, so unusual-but-genuine product names still render.
 */
export function variantIdentityRejection(name: string): VariantIdentityRejection | null {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 2) return 'raw-source-row';

  // A serialized source row: a list bullet inside the name, several
  // label:value pairs, or unbounded length.
  if (/[•·]/.test(trimmed)) return 'raw-source-row';
  if (trimmed.length > 90) return 'raw-source-row';

  // A field label heading the string — with or without a value after it —
  // is a source column, not a product ("Item name : Birch Benders",
  // "Lot code : 5 265", "Best by 12/14/2026").
  if (FIELD_LABEL_HEAD.test(trimmed)) return 'field-label';
  // "Label: value" text whose label routes to a known concept is a serialized
  // row even when the label is not in the head list.
  const labelled = trimmed.match(/^([A-Za-z][A-Za-z /()#-]{1,30}?)\s*:\s*\S/);
  if (labelled) {
    const concept = conceptForLabel(labelled[1]);
    if (concept !== 'unknown' && concept !== 'variant') return 'field-label';
  }

  // Geography can never be a product identity.
  if (isGeographicName(trimmed)) return 'geography';

  // A name dominated by dates: strip every date token, and if no product
  // wording survives, the "name" was a date. "December Fudge Cake" keeps
  // "Fudge Cake" and stays a product. Only names actually CARRYING a date
  // token qualify — a bare code is classified below, not here.
  const hasDateToken = new RegExp(DATE_TOKEN.source, 'i').test(trimmed);
  const withoutDates = trimmed
    .replace(DATE_TOKEN, ' ')
    .replace(/[\s\d/.,:–—-]+/g, ' ')
    .trim();
  if (
    hasDateToken &&
    (withoutDates === '' || /^(?:and|or|to|through|between|from)$/i.test(withoutDates))
  ) {
    return 'date';
  }

  // A barcode or numeric code: digits dominate and no product words exist.
  const compact = trimmed.replace(/[\s-]/g, '');
  const digits = compact.replace(/\D/g, '');
  if (digits.length >= 6 && digits.length / compact.length >= 0.7) return 'code';
  if (/^\d[\d\s-]{5,}$/.test(trimmed)) return 'code';

  return null;
}
