/**
 * Consumer Projection V2 — the semantic vocabulary.
 *
 * The architectural rule this file exists to enforce: a government source
 * label never dictates a UI section. Every extracted fact is routed into one
 * of OUR consumer concepts, and the UI renders concepts. Source labels that
 * carry no consumer meaning ("Intended use", "Condition") route to
 * deliberately-not-displayed concepts, and pure page-layout artifacts
 * ("See Image Below") route to `layout_artifact`, which must never survive
 * into consumer UI.
 *
 * Routing is a fixed lookup over normalized label text — deterministic, and
 * unmatched labels become `unknown` (shown only as a last resort with the
 * source's own wording) rather than being guessed into a concept.
 */

export type ConsumerConcept =
  // ── Package identification (the "is this my package?" task) ──
  | 'variant' // affected version/flavor: "Potato Market Loaf 20oz"
  | 'package_size' // net weight / size: "12 oz"
  | 'packaging' // "Paper bag", "Glass jar"
  | 'package_color' // "Blue, yellow, and green"
  | 'best_by'
  | 'use_by'
  | 'sell_by'
  | 'expiration'
  | 'freeze_by'
  | 'production_date'
  | 'production_code' // opaque code the source maps to a calendar date
  | 'upc'
  | 'product_code' // source-labeled code that is not a scannable barcode
  | 'lot'
  | 'case_code'
  | 'item_number'
  | 'establishment_number'
  | 'identifier_location' // "bottom of package"
  // ── Routed OUT of package identification ──
  | 'distribution' // "Sold At" belongs to Where it was sold
  | 'retail_location' // a store's street address, from a Retailer/Address table
  | 'brand'
  | 'company'
  | 'quantity'
  // ── Present in the source, deliberately not displayed ──
  | 'intended_use'
  | 'condition'
  | 'shelf_life'
  | 'layout_artifact' // "See Image Below" — never reaches the UI
  | 'unknown';

/** Concepts that belong to the package checker, in consumer-priority order. */
export const PACKAGE_CONCEPT_PRIORITY: ConsumerConcept[] = [
  'variant',
  'best_by',
  'use_by',
  'sell_by',
  'expiration',
  'freeze_by',
  'production_date',
  'package_size',
  'packaging',
  'package_color',
  'upc',
  'product_code',
  'production_code',
  'lot',
  'case_code',
  'item_number',
  'establishment_number',
  'identifier_location',
];

/** Concepts intentionally never rendered (low-value or layout metadata). */
export const SUPPRESSED_CONCEPTS = new Set<ConsumerConcept>([
  'intended_use',
  'condition',
  'shelf_life',
  'layout_artifact',
]);

/** Consumer-facing label for a concept. Deliberately plain language. */
export const CONCEPT_LABEL: Record<ConsumerConcept, string> = {
  variant: 'Affected version',
  package_size: 'Size',
  packaging: 'Packaging',
  package_color: 'Package color',
  best_by: 'Best by',
  use_by: 'Use by',
  sell_by: 'Sell by',
  expiration: 'Expiration',
  freeze_by: 'Freeze by',
  production_date: 'Production date',
  production_code: 'Production code',
  // Most consumers do not know the term "UPC" — lead with the familiar word.
  upc: 'Barcode (UPC)',
  // A code the notice called a UPC but which is not a valid barcode length.
  // Shown honestly rather than as something a scanner would recognize.
  product_code: 'Product code',
  lot: 'Lot code',
  case_code: 'Case code',
  item_number: 'Item number',
  establishment_number: 'Establishment number',
  identifier_location: 'Where to find it',
  distribution: 'Where it was sold',
  retail_location: 'Store location',
  brand: 'Brand',
  company: 'Company',
  quantity: 'Amount recalled',
  intended_use: 'Intended use',
  condition: 'Condition',
  shelf_life: 'Shelf life',
  layout_artifact: 'Layout artifact',
  unknown: 'Details',
};

/** Exact-match routing for the source labels observed in real FDA/FSIS notices. */
const EXACT_LABEL_ROUTES: Record<string, ConsumerConcept> = {
  'product packaging': 'packaging',
  packaging: 'packaging',
  'package color': 'package_color',
  'package colour': 'package_color',
  color: 'package_color',
  'net weight': 'package_size',
  'net wt': 'package_size',
  // FDA's own phrase for a package's stated contents — a size, not a recall
  // total, despite the word "quantity".
  'net quantity': 'package_size',
  'net quantity of contents': 'package_size',
  weight: 'package_size',
  size: 'package_size',
  'package size': 'package_size',
  'sold at': 'distribution',
  store: 'distribution',
  stores: 'distribution',
  retailer: 'distribution',
  retailers: 'distribution',
  'sold in': 'distribution',
  'where sold': 'distribution',
  distribution: 'distribution',
  'distributed to': 'distribution',
  // A Retailer/Address table states two facts about one store. The address is
  // its own concept so it can join the retailer under "Where it was sold"
  // instead of arriving in the package checker as unexplained text.
  address: 'retail_location',
  addresses: 'retail_location',
  'store address': 'retail_location',
  'retail location': 'retail_location',
  'retail locations': 'retail_location',
  'store location': 'retail_location',
  'store locations': 'retail_location',
  location: 'retail_location',
  locations: 'retail_location',
  'intended use': 'intended_use',
  condition: 'condition',
  'shelf life': 'shelf_life',
  brand: 'brand',
  'brand name': 'brand',
  'brand names': 'brand',
  company: 'company',
  'company name': 'company',
  upc: 'upc',
  'upc code': 'upc',
  'upc codes': 'upc',
  'upc #': 'upc',
  barcode: 'upc',
  'product description': 'variant',
  'product descriptions': 'variant',
  description: 'variant',
  product: 'variant',
  products: 'variant',
  'product name': 'variant',
  'generic name': 'variant',
  'item description': 'variant',
  // A property list's own name row ("Item name : Birch Benders 12 oz …").
  'item name': 'variant',
  flavor: 'variant',
  flavors: 'variant',
  variety: 'variant',
  varieties: 'variant',
  'retail product': 'variant',
  'affected product': 'variant',
  'affected products': 'variant',
  lot: 'lot',
  'lot code': 'lot',
  'lot codes': 'lot',
  'lot number': 'lot',
  'lot numbers': 'lot',
  'lot #': 'lot',
  batch: 'lot',
  'batch code': 'lot',
  'batch codes': 'lot',
  'batch number': 'lot',
  'case code': 'case_code',
  'case codes': 'case_code',
  'item number': 'item_number',
  'item #': 'item_number',
  'item code': 'item_number',
  // FDA sometimes supplies a "Product code" that is genuinely not a barcode.
  // It keeps its own name rather than being relabelled as an item number or,
  // worse, promoted to a UPC it was never claimed to be.
  'product code': 'product_code',
  'product codes': 'product_code',
  sku: 'item_number',
  'establishment number': 'establishment_number',
  'best by': 'best_by',
  'best-by': 'best_by',
  'best before': 'best_by',
  'best if used by': 'best_by',
  'best used by': 'best_by',
  'best by date': 'best_by',
  'best before date': 'best_by',
  'best buy date': 'best_by',
  'use by': 'use_by',
  'use-by': 'use_by',
  'use by date': 'use_by',
  'sell by': 'sell_by',
  'sell-by': 'sell_by',
  'sell by date': 'sell_by',
  'freeze by': 'freeze_by',
  expiration: 'expiration',
  'expiration date': 'expiration',
  'expiration dates': 'expiration',
  'exp date': 'expiration',
  expiry: 'expiration',
  'expiry date': 'expiration',
  'production date': 'production_date',
  'production dates': 'production_date',
  'date of production': 'production_date',
  'pack date': 'production_date',
  'production code': 'production_code',
  'production codes': 'production_code',
  quantity: 'quantity',
  'amount recalled': 'quantity',
  'quantity recalled': 'quantity',
  'total quantity': 'quantity',
  'units recalled': 'quantity',
  'amount of product recalled': 'quantity',
};

/** Substring routing, applied after exact matching (order matters). */
const PATTERN_ROUTES: [RegExp, ConsumerConcept][] = [
  // Layout artifacts first: "See Image Below" is never consumer content.
  [
    /^see (image|photo|picture)s?\b|^image below|^see below|^photo below|^n\/?a$|^none$/i,
    'layout_artifact',
  ],
  // How much was recalled, which belongs to "What happened" and nowhere else.
  // Bounded so FDA's "Net quantity of contents" — a package size — cannot
  // match it.
  [
    /\bquantit(?:y|ies)\s+(?:recalled|distributed|affected|involved)\b|\b(?:amount|units?|cases|pounds)\s+recalled\b|^quantity$/i,
    'quantity',
  ],
  // A street address, before the distribution rule below can claim it for the
  // word "store".
  [/\baddress(?:es)?\b|\bstore\s+locations?\b/i, 'retail_location'],
  [/\bbest[-\s]?(?:if[-\s]?)?(?:used[-\s]?)?by\b|\bbest before\b/i, 'best_by'],
  [/\buse[-\s]?by\b/i, 'use_by'],
  [/\bsell[-\s]?by\b/i, 'sell_by'],
  [/\bfreeze[-\s]?by\b/i, 'freeze_by'],
  [/\bexpir/i, 'expiration'],
  [/\bproduction codes?\b/i, 'production_code'],
  [/\bproduction dates?\b|\bpacked on\b/i, 'production_date'],
  [/\bupc\b|\bbarcode\b|\bbar code\b/i, 'upc'],
  [/\b(lot|batch)\b/i, 'lot'],
  [/\bcase code\b/i, 'case_code'],
  [/\bestablishment\b/i, 'establishment_number'],
  [/\b(item|product) (number|code)\b|\bsku\b/i, 'item_number'],
  [/\bsold\b|\bdistribut|\bstores?\b|\bretailers?\b/i, 'distribution'],
  [/\bnet w(?:eigh)?t\b|\bsize\b|\bweight\b/i, 'package_size'],
  [/\bcolou?r\b/i, 'package_color'],
  [/\bpackag/i, 'packaging'],
  [/\bshelf life\b/i, 'shelf_life'],
  [/\bintended use\b/i, 'intended_use'],
  [/\bcondition\b/i, 'condition'],
  [/\bbrand\b/i, 'brand'],
  [/\b(description|product|generic name|flavou?r|variety|varieties)\b/i, 'variant'],
];

/**
 * True when one source label names BOTH a code and a date
 * ("Batch Code/Best Before Date"), meaning the cell packs two different
 * concepts and must be split rather than routed to either one.
 */
export function isCodeAndDateLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  return (
    /\b(lot|batch|code)\b/.test(normalized) &&
    /\b(best before|best by|use by|sell by|expir|date)\b/.test(normalized)
  );
}

/** Normalize a source label for routing: lowercase, unpunctuated, trimmed. */
export function normalizeLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/\(s\)/g, 's')
      // A slash joins two labels into one heading ("Best By / Sell By Date");
      // as a word of its own it only inflates the label's length past the
      // routing bound, so it reads as a plain separator.
      .replace(/\//g, ' ')
      .replace(/[^a-z0-9# -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\s:]+$/, '')
  );
}

/**
 * Route a source field label into a consumer concept. Unrecognized labels
 * return `unknown` — the UI shows them only as a last resort, never as an
 * invented concept.
 */
/**
 * The longest a field label plausibly is. Real ones are terse ("Batch
 * Code/Best Before Date" is four words); a table heading like "King Arthur
 * Flour Unbleached All-Purpose Flour 25 lb. UPC: 071012012503 Costco only" is
 * a product line that merely CONTAINS the word UPC. Matching a keyword inside
 * it would label that column's dates as barcodes.
 */
const MAX_LABEL_WORDS = 6;

export function conceptForLabel(label: string): ConsumerConcept {
  const normalized = normalizeLabel(label);
  if (normalized === '') return 'unknown';
  const exact = EXACT_LABEL_ROUTES[normalized];
  if (exact) return exact;
  // Keyword routing applies only to something label-shaped; a whole sentence
  // is content, and guessing a concept from a word inside it misassigns the
  // values underneath.
  if (normalized.split(' ').length > MAX_LABEL_WORDS) return 'unknown';
  for (const [pattern, concept] of PATTERN_ROUTES) {
    if (pattern.test(normalized)) return concept;
  }
  return 'unknown';
}

/**
 * True when a *value* is pure page-layout metadata rather than consumer
 * information ("See Image Below", "None", "N/A"). These are dropped wherever
 * they appear, regardless of which concept the label routed to.
 */
export function isLayoutArtifactValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return /^(see (image|photo|picture)s?( below)?|image below|see below|photo below|n\/?a|none|not applicable|no packaging|-|—|–)\.?$/i.test(
    trimmed,
  );
}
