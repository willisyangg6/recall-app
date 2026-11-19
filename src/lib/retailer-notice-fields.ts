/**
 * The shopper-facing fields of an approved retailer notice (version 1): the
 * ONE shape a reviewer approves (src/server/retailer/approval.ts) and the new
 * client reads (lib/retailer-notices.ts). A client-safe leaf: no imports.
 *
 * Every value is a reviewer-approved string taken from the retailer's own
 * letter. The package identifiers are kept in separate lists on purpose: a
 * retailer item number is the store's own SKU, a supplier code is the
 * manufacturer's, a lot is a production code, a best-by date is a date, a can
 * timestamp is a time range, and a UPC is a barcode. None of them is ever
 * merged with another, inferred, or derived from a package size.
 *
 * No consumer pack size: the letters seen so far print a case pack (for
 * example "case pack 8CT/3PK") without saying what a shopper bought, so the
 * field does not exist rather than risk a wrong count.
 */

export const RETAILER_NOTICE_FIELDS_VERSION = 1;

/** The retailers a notice can be attributed to, as each writes its own name. */
export const RETAILER_NOTICE_PUBLISHER_NAMES = ['Costco', 'ALDI'] as const;
export type RetailerNoticePublisherName = (typeof RETAILER_NOTICE_PUBLISHER_NAMES)[number];

/** The agency hazard categories (domain/recall-types.ts `HazardCategory`), mirrored for this leaf. */
export const RETAILER_HAZARD_CATEGORIES = [
  'allergen',
  'microbial_contamination',
  'foreign_material',
  'chemical_contamination',
  'product_integrity',
  'other_regulatory',
  'unknown',
] as const;
export type RetailerHazardCategory = (typeof RETAILER_HAZARD_CATEGORIES)[number];

export interface RetailerNoticeFields {
  /** The retailer that published the letter, as the card names it. */
  retailer: RetailerNoticePublisherName;
  /** The product as the letter names it. */
  productName: string;
  /** The product size as printed, or null. Never a pack or case count. */
  size: string | null;
  /**
   * The product photo, or null: one JPEG embedded in the approved letter,
   * served unaltered from the product-visuals bucket. `path` is
   * `retailer-notices/<letter sha256>/<image sha256>.jpg`, so it names the
   * exact letter version it was approved from (approval.ts verifies both).
   */
  image: RetailerNoticeImage | null;
  /** The recalling firm as the letter names it. */
  firmName: string;
  whatHappened: string;
  whyRecalled: string;
  /**
   * The reviewer's structured reading of the reason, in the SAME terms an
   * agency case carries (`hazardCategory`, and the agent agency projections
   * store as `pathogenOrAllergen`), so the Feed card's concise reason comes
   * from the shared `conciseReasonLine` exactly as an agency card's does. The
   * agent, when named, must be printed in its cited excerpt.
   */
  reason: {
    hazardCategory: RetailerHazardCategory;
    agent: string | null;
  };
  whereSold: {
    /**
     * Full state names the letter lists, in the letter's order. Empty when
     * the letter states none: the notice then renders the shared
     * "Distribution not specified" treatment, and no state is ever inferred
     * from a region name, a warehouse or the index title.
     */
    states: string[];
    /** The purchase window as the letter states it, or null. */
    purchaseWindow: string | null;
  };
  packageChecks: {
    retailerItemNumbers: string[];
    supplierCodes: string[];
    lotCodes: string[];
    bestByDates: string[];
    canTimestamps: string[];
    upcs: string[];
  };
  /** What the letter explicitly tells shoppers to do. */
  instructions: string[];
  /** A contact line exactly as printed, or null. */
  contact: string | null;
}

export interface RetailerNoticeImage {
  path: string;
  width: number;
  height: number;
  /** The PDF object the JPEG is stored in, for provenance. */
  pdfObject: number;
}

/** `retailer-notices/<64-hex letter hash>/<64-hex image hash>.jpg`. */
export const RETAILER_IMAGE_PATH = /^retailer-notices\/([0-9a-f]{64})\/([0-9a-f]{64})\.jpg$/;

function readImage(value: unknown): RetailerNoticeImage | null | undefined {
  if (value === null) return null;
  const image = record(value);
  if (!image || !exactKeys(image, ['path', 'width', 'height', 'pdfObject'])) return undefined;
  const { path, width, height, pdfObject } = image;
  const positive = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 20000;
  if (typeof path !== 'string' || !RETAILER_IMAGE_PATH.test(path)) return undefined;
  if (!positive(width) || !positive(height) || !positive(pdfObject)) return undefined;
  return { path, width: width as number, height: height as number, pdfObject: pdfObject as number };
}

export const PACKAGE_CHECK_KEYS = [
  'retailerItemNumbers',
  'supplierCodes',
  'lotCodes',
  'bestByDates',
  'canTimestamps',
  'upcs',
] as const satisfies readonly (keyof RetailerNoticeFields['packageChecks'])[];

const MAX_TEXT = 1200;
const MAX_LIST = 60;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT && trimmed === value ? trimmed : null;
}

function optionalText(value: unknown): string | null | undefined {
  return value === null ? null : (text(value) ?? undefined);
}

function list(value: unknown, { nonEmpty }: { nonEmpty: boolean }): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST) return null;
  const out: string[] = [];
  for (const entry of value) {
    const item = text(entry);
    if (item === null || out.includes(item)) return null;
    out.push(item);
  }
  return nonEmpty && out.length === 0 ? null : out;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && [...keys].sort().every((key, index) => key === own[index]);
}

const TOP_KEYS = [
  'retailer',
  'productName',
  'size',
  'image',
  'firmName',
  'whatHappened',
  'whyRecalled',
  'reason',
  'whereSold',
  'packageChecks',
  'instructions',
  'contact',
] as const;

/**
 * The strict reader: the exact version-1 shape or null. Unknown keys, empty
 * strings, padded strings, duplicate list entries and missing keys are all
 * rejected, so a malformed or tampered row is dropped whole rather than shown
 * in part. A notice with no package identifier at all (no item number,
 * supplier code, lot, best-by date, can timestamp or UPC) has no package to
 * check, so it is rejected too. Costco identifies packages by its own item
 * number; ALDI's notices print lots and dates instead.
 */
export function readRetailerNoticeFields(value: unknown): RetailerNoticeFields | null {
  const top = record(value);
  if (!top || !exactKeys(top, TOP_KEYS)) return null;
  const retailer = top.retailer;
  if (!(RETAILER_NOTICE_PUBLISHER_NAMES as readonly unknown[]).includes(retailer)) return null;
  const reasonRecord = record(top.reason);
  if (!reasonRecord || !exactKeys(reasonRecord, ['hazardCategory', 'agent'])) return null;
  const hazardCategory = reasonRecord.hazardCategory;
  if (!(RETAILER_HAZARD_CATEGORIES as readonly unknown[]).includes(hazardCategory)) return null;
  const agent = optionalText(reasonRecord.agent);
  if (agent === undefined) return null;
  const where = record(top.whereSold);
  const checks = record(top.packageChecks);
  if (!where || !exactKeys(where, ['states', 'purchaseWindow'])) return null;
  if (!checks || !exactKeys(checks, PACKAGE_CHECK_KEYS)) return null;

  const productName = text(top.productName);
  const size = optionalText(top.size);
  const image = readImage(top.image);
  if (image === undefined) return null;
  const firmName = text(top.firmName);
  const whatHappened = text(top.whatHappened);
  const whyRecalled = text(top.whyRecalled);
  const states = list(where.states, { nonEmpty: false });
  const purchaseWindow = optionalText(where.purchaseWindow);
  const instructions = list(top.instructions, { nonEmpty: true });
  const contact = optionalText(top.contact);
  const retailerItemNumbers = list(checks.retailerItemNumbers, { nonEmpty: false });
  const rest = PACKAGE_CHECK_KEYS.slice(1).map((key) => list(checks[key], { nonEmpty: false }));
  if (
    productName === null ||
    size === undefined ||
    firmName === null ||
    whatHappened === null ||
    whyRecalled === null ||
    states === null ||
    purchaseWindow === undefined ||
    instructions === null ||
    contact === undefined ||
    retailerItemNumbers === null ||
    rest.some((entry) => entry === null)
  ) {
    return null;
  }
  const [supplierCodes, lotCodes, bestByDates, canTimestamps, upcs] = rest as string[][];
  if (
    [retailerItemNumbers, supplierCodes, lotCodes, bestByDates, canTimestamps, upcs].every(
      (values) => values.length === 0,
    )
  ) {
    return null;
  }
  return {
    retailer: retailer as RetailerNoticePublisherName,
    productName,
    size,
    image,
    firmName,
    whatHappened,
    whyRecalled,
    reason: { hazardCategory: hazardCategory as RetailerHazardCategory, agent },
    whereSold: { states, purchaseWindow },
    packageChecks: {
      retailerItemNumbers,
      supplierCodes,
      lotCodes,
      bestByDates,
      canTimestamps,
      upcs,
    },
    instructions,
    contact,
  };
}
