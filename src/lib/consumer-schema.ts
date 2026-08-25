/**
 * The closed consumer schema.
 *
 * The parser may extract anything the source states, and everything it extracts
 * is preserved. But the CONSUMER UI renders a fixed vocabulary that this app
 * defines, and nothing else. No source heading, table column, parser heuristic,
 * or projection helper can introduce a new consumer-visible field — the only
 * way a value reaches the screen is by mapping onto one of the keys below.
 *
 * This exists because the alternative was tried. An open projection with a
 * generic `label: value` renderer produced, across 160 real announcements,
 * nineteen different package field labels including `Details`, `Item number`,
 * `Case code`, and — in one case — two hundred store addresses rendered as a
 * single `Details` row. Every one of those was a source fact faithfully
 * extracted and then rendered somewhere it did not belong. A closed schema
 * makes that class of defect impossible rather than fixable.
 *
 * A fact that does not map cleanly is not lost: it is classified, counted, and
 * kept for provenance. It is simply not shown. A clean omission is better than
 * a confident-looking field a consumer cannot use.
 */

import type { ConsumerConcept } from './consumer-concepts';

// ── Package fields ──────────────────────────────────────────────────────────

/**
 * The complete vocabulary a package card may render. Closed by design: adding
 * a member is a product decision, not something a parser can do at runtime.
 */
export type PackageFieldKey =
  | 'bestBy'
  | 'useBy'
  | 'sellBy'
  | 'expiration'
  | 'size'
  | 'packaging'
  | 'upc'
  | 'lotCodes'
  | 'batchCodes';

/** Consumer label for each approved field. The UI never composes its own. */
export const PACKAGE_FIELD_LABEL: Record<PackageFieldKey, string> = {
  bestBy: 'Best by',
  useBy: 'Use by',
  sellBy: 'Sell by',
  expiration: 'Expiration',
  size: 'Size',
  packaging: 'Packaging',
  upc: 'Barcode (UPC)',
  lotCodes: 'Lot code',
  batchCodes: 'Batch code',
};

/**
 * Display order, by how quickly a person can check the field against a package
 * in hand: a printed date first, then the physical package, then the numbers.
 * Every card uses this order, so two recalls never read differently.
 */
export const PACKAGE_FIELD_ORDER: PackageFieldKey[] = [
  'bestBy',
  'useBy',
  'sellBy',
  'expiration',
  'size',
  'packaging',
  'upc',
  'lotCodes',
  'batchCodes',
];

/** One approved field, ready to render. */
export interface PackageField {
  key: PackageFieldKey;
  /** Always from `PACKAGE_FIELD_LABEL` — never a source heading. */
  label: string;
  /** Joined, consumer-formatted text. */
  value: string;
  /** Individual values, for QA and provenance. */
  values: string[];
  /** The source's own text for each value. */
  raw: string[];
  /** Identity of each value, independent of source spelling. */
  canonicalKeys: string[];
}

/**
 * The approved field a concept may fill, or null when the concept has no place
 * on a package card. Null is the answer for most concepts, deliberately.
 *
 * `production_date` and `production_code` are null here because they are not
 * card fields: they render through the separate production-code disclosure,
 * where a readable calendar date leads and the opaque printed code follows.
 */
export function packageFieldFor(concept: ConsumerConcept, isBatch = false): PackageFieldKey | null {
  switch (concept) {
    case 'best_by':
      return 'bestBy';
    case 'use_by':
      return 'useBy';
    case 'sell_by':
      return 'sellBy';
    case 'expiration':
      return 'expiration';
    case 'package_size':
      return 'size';
    case 'packaging':
      return 'packaging';
    case 'upc':
      return 'upc';
    case 'lot':
      return isBatch ? 'batchCodes' : 'lotCodes';
    default:
      return null;
  }
}

// ── Destinations ────────────────────────────────────────────────────────────

/**
 * The one consumer section a kind of fact is allowed to appear in.
 *
 * Every cross-destination bug this pass removed was the same shape: a fact that
 * is perfectly true, rendered in a section that answers a different question. A
 * recall total inside a package card does not help anyone check a package; a
 * lot code inside "Where it was sold" does not help anyone tell whether the
 * recall reached their store.
 */
export type Destination =
  | 'what_happened'
  | 'where_sold'
  | 'check_package'
  /** Behind an explicit disclosure inside the package checker. */
  | 'check_package_advanced'
  | 'what_you_should_do'
  | 'product_photos'
  | 'header'
  /** Preserved for provenance; never rendered. */
  | 'not_rendered';

export const CONCEPT_DESTINATION: Record<ConsumerConcept, Destination> = {
  variant: 'check_package',
  package_size: 'check_package',
  packaging: 'check_package',
  best_by: 'check_package',
  use_by: 'check_package',
  sell_by: 'check_package',
  expiration: 'check_package',
  upc: 'check_package',
  lot: 'check_package',
  identifier_location: 'check_package',
  production_date: 'check_package_advanced',
  production_code: 'check_package_advanced',
  distribution: 'where_sold',
  retail_location: 'where_sold',
  quantity: 'what_happened',
  brand: 'header',
  company: 'header',
  // Preserved, never shown. Each was a real consumer-visible field before this
  // pass; see the field inventory in the architecture notes.
  package_color: 'not_rendered',
  freeze_by: 'not_rendered',
  product_code: 'not_rendered',
  case_code: 'not_rendered',
  item_number: 'not_rendered',
  establishment_number: 'not_rendered',
  intended_use: 'not_rendered',
  condition: 'not_rendered',
  shelf_life: 'not_rendered',
  layout_artifact: 'not_rendered',
  unknown: 'not_rendered',
};

// ── Rejection accounting ────────────────────────────────────────────────────

/**
 * Why a source fact did not reach the consumer UI. Broad extraction stays
 * broad; this is what keeps the hidden material measurable instead of silent.
 */
export type RejectionReason =
  /** The concept has no approved consumer field (`Item number`, `Case code`). */
  | 'unsupported-consumer-field'
  /** The value is not the kind of thing its concept promises (`Use by: 58 oz`). */
  | 'invalid-type'
  /** True, but belongs to a different section than the one asking for it. */
  | 'wrong-destination'
  /** Already shown under the specific version that owns it. */
  | 'duplicate'
  /**
   * Versions own this kind of field and this value could not be assigned to
   * one. Rendering it as a loose row below the cards would invent a
   * recall-wide relationship the source never asserted, so it is suppressed —
   * ambiguity resolves by omission, never by guessing an owner.
   */
  | 'ambiguous-scope'
  /** Page layout or low-value source metadata. */
  | 'intentionally-suppressed';

/** A fact the projection extracted and deliberately did not render. */
export interface RejectedFact {
  concept: ConsumerConcept;
  /** The source's own label, for provenance only. */
  sourceLabel: string;
  values: string[];
  reason: RejectionReason;
}

/** The reason a concept is not renderable on a package card, when it is not. */
export function packageRejectionReason(concept: ConsumerConcept): RejectionReason {
  const destination = CONCEPT_DESTINATION[concept];
  if (destination === 'where_sold' || destination === 'what_happened' || destination === 'header') {
    return 'wrong-destination';
  }
  if (
    concept === 'layout_artifact' ||
    concept === 'intended_use' ||
    concept === 'condition' ||
    concept === 'shelf_life'
  ) {
    return 'intentionally-suppressed';
  }
  return 'unsupported-consumer-field';
}

// ── Distribution ────────────────────────────────────────────────────────────

/**
 * Broad sales routes worth telling a consumer about.
 *
 * Deliberately excludes "retail stores", "grocery stores", "supermarkets", and
 * "club stores": a consumer packaged food was sold in shops, which the reader
 * already assumes. Rendering it reads as information while adding none, and —
 * worse — it is what a specific retailer list gets compressed into when
 * extraction fails, turning six named Zion Market locations into "Sold through
 * retail stores."
 */
export const APPROVED_CHANNELS = new Set([
  'food service',
  'wholesalers',
  'distributors',
  'restaurants',
  'cafés',
  'farmers markets',
  'bodegas',
  'convenience stores',
  'independent retailers',
]);
