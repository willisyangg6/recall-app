/**
 * "Check your package" model: deterministic extraction of package-identifying
 * information (UPCs, lots, date codes, package descriptions, where-to-look
 * hints) from a case's preserved source text plus its structured product
 * lines.
 *
 * This runs at display time over `projection.summaryText`, so improvements
 * reach already-persisted cases without re-ingestion. Every extraction is
 * label-driven — a value is called a lot/UPC/date only because the source's
 * own wording labels it that way; ambiguous strings stay under their source
 * label, and nothing is ever invented. The product philosophy: the user
 * identifies their product inside the app; the official notice is provenance,
 * not required reading.
 */

import type { AffectedProduct } from '@/domain/recall-types';
import { splitSentences } from '@/domain/text';
import { parseProductLine, type ProductIdentifier } from './consumer-summary';

export type PackageCoverage = 'structured' | 'partial' | 'source_silent' | 'parser_missed';

export interface PackageCheckModel {
  /** Package description as the source states it ("8-ounce blue package"). */
  packageText: string | null;
  /** Prose-stated identifiers not already covered by the product rows. */
  identifiers: ProductIdentifier[];
  /** Where to look on the package, in the source's words. */
  locationHints: string[];
  /** Product-with-code lines stated outside tables ("… 10-ounce, UPC 41415-06453"). */
  proseProductLines: string[];
  /** True when structured affected-product rows exist for the expanded view. */
  hasProductRows: boolean;
  /** Benchmark/fallback classification: distinguishes "the source provides no
   * identifiers" (honest, common for fresh produce and all-lots recalls) from
   * "the source provides them and extraction missed" (a parser bug). */
  coverage: PackageCoverage;
}

/** Does the source text talk about package identifiers at all? */
const IDENTIFIER_KEYWORDS =
  /\bUPC\b|\blot\b|\bbatch\b|best[-\s]?(if\s+used\s+)?by|use[-\s]?by|sell[-\s]?by|expiration date|date code|case code|item number/i;

/** Nouns that make a placement phrase a real on-package location. */
const PACKAGE_NOUNS =
  /package|packaging|pouch|bag|label|lid|cap|box|carton|container|jar|bottle|panel|corner|side|bottom|top|back|front|reverse|tub|wrapper|sleeve|can\b/i;

const LOCATION_PATTERNS = [
  /\b(?:can|may)\s+be\s+found\s+(?:on|in|at|directly\s+beneath|below|beneath|under|next\s+to)\b[^.;\n]{3,90}/gi,
  /\b(?:printed|stamped|marked|located|displayed|embossed)\s+(?:on|in|at|below|beneath|under)\b[^.;\n]{3,90}/gi,
  /\b(?:is|are)\s+(?:on|in)\s+the\b[^.;\n]{3,80}/gi,
];

function cleanValue(value: string): string {
  return value.replace(/^[\s,:#(“”"]+|[\s,;:.)“”"]+$/g, '').trim();
}

/** Collect `label: value` pairs stated in prose, per identifier family. */
function proseIdentifiers(text: string): ProductIdentifier[] {
  const found: ProductIdentifier[] = [];
  const push = (label: string, raw: string) => {
    const value = cleanValue(raw);
    if (value.length < 2 || !/[0-9]/.test(value)) return;
    if (found.some((f) => f.value.includes(value) || value.includes(f.value))) return;
    found.push({ label, value });
  };

  // UPCs: any ≥8-digit run inside a sentence that mentions UPC.
  for (const sentence of splitSentences(text)) {
    if (!/\bUPC\b/i.test(sentence)) continue;
    for (const run of sentence.matchAll(/\b(\d[\d\s-]{6,18}\d)\b/g)) {
      if (run[1].replace(/\D/g, '').length >= 8) push('UPC', run[1]);
    }
  }

  // Lots/batches: label-driven; the value runs until prose resumes. The
  // whole pattern is case-insensitive, so code values are cut at the first
  // lowercase word afterward ("E-054, EX 0225 and D-181" keeps its code part).
  const LOT_VALUE = String.raw`([A-Z0-9][A-Z0-9 ,/-]{0,80}?)(?=\s*$|\s*(?:[.;\n]|,?\s+(?:which|that|and\s+(?:the|expiration|best|is)|is|are|can|of|was|were)\b))`;
  const cutAtProse = (value: string) => value.split(/\s+(?=[a-z])/)[0];
  for (const pattern of [
    new RegExp(
      String.raw`\b(?:lot|batch)(?:[ \t]+(?:code|number|date))?s?(?:[ \t]+being[ \t]+recalled)?[ \t]*(?:are|is)?[ \t]*[:#]?[ \t]+${LOT_VALUE}`,
      'gi',
    ),
    new RegExp(
      String.raw`\brecall(?:ing|ed)?[ \t]+(?:a[ \t]+single[ \t]+)?lot[ \t]+(?:number[ \t]+)?#?${LOT_VALUE}`,
      'gi',
    ),
  ]) {
    for (const match of text.matchAll(pattern)) push('Lot', cutAtProse(match[1]));
  }

  // Date codes: keep the source's own qualifier ("through …") in the value.
  // Post-label whitespace never crosses a newline — a bare "Expiration Dates"
  // table header must not swallow the following line as its value.
  // Values may be quoted ("sell-by date “AUG 15”") — the quote bounds the
  // value and never bleeds into it.
  const DATE_VALUE = String.raw`([“”"]?(?:through\s+)?[A-Za-z0-9][^;\n“”"]{1,60}?)(?=[“”"]|\s*$|\s*[.;\n]|\s+(?:and|which|that|marked|printed|located|can)\b)`;
  // `[”“"]?` after the label tolerates FSIS's quoted-label style
  // (“Best By Date” of 11/06/26) without the quote bleeding into the value.
  const LABEL_TAIL = String.raw`(?:[ \t]+dates?)?[”“"]?[ \t]*:?[ \t]*(?:of[ \t]+|is[ \t]+|are[ \t]+)?`;
  const DATE_PATTERNS: [RegExp, string][] = [
    [
      new RegExp(String.raw`\bbest[-\s]?(?:if[ \t]+used[ \t]+)?by${LABEL_TAIL}${DATE_VALUE}`, 'gi'),
      'Best by',
    ],
    [new RegExp(String.raw`\buse[-\s]?by${LABEL_TAIL}${DATE_VALUE}`, 'gi'), 'Use by'],
    [new RegExp(String.raw`\bsell[-\s]?by${LABEL_TAIL}${DATE_VALUE}`, 'gi'), 'Sell by'],
    [
      new RegExp(
        String.raw`\bexpiration[ \t]+dates?[”“"]?[ \t]*:?[ \t]*(?:of[ \t]+|is[ \t]+|are[ \t]+)?${DATE_VALUE}`,
        'gi',
      ),
      'Expiration',
    ],
  ];
  for (const [pattern, label] of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) push(label, match[1]);
  }
  return found;
}

function proseLocationHints(text: string): string[] {
  const hints: string[] = [];
  for (const pattern of LOCATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const hint = match[0].replace(/\s+/g, ' ').trim();
      if (!PACKAGE_NOUNS.test(hint)) continue;
      if (!hints.some((h) => h.includes(hint) || hint.includes(h))) hints.push(hint);
    }
  }
  return hints.slice(0, 3);
}

function prosePackageText(text: string): string | null {
  const match =
    text.match(
      /\b(?:packaged|comes)\s+in\s+(?:an?\s+)?([^.;\n]{3,70}?)(?=\s+(?:with|and\s+is|and\s+has|because|that)\b|[.;\n])/i,
    ) ??
    text.match(
      /\bsold\s+in\s+an?\s+([^.;\n]{3,60}?(?:bag|pouch|package|jar|bottle|box|container|tub|carton)s?)\b/i,
    );
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

/** Standalone lines that identify a product with a code ("…, UPC 41415-06453"). */
function extractProseProductLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length >= 8 && line.length <= 140 && /,\s*(?:UPC|Lot|Best[-\s]?by)/i.test(line),
    )
    .slice(0, 30);
}

export function buildPackageCheck(
  summaryText: string | null,
  affectedProducts: AffectedProduct[],
): PackageCheckModel {
  const text = summaryText ?? '';

  // Identifiers already carried by structured product rows.
  const rowIdentifiers: ProductIdentifier[] = [];
  let parsableRows = 0;
  for (const product of affectedProducts) {
    const parsed = parseProductLine(product.rawText);
    if (!parsed) continue;
    parsableRows += 1;
    rowIdentifiers.push(...parsed.identifiers);
  }

  const proseProductLines = affectedProducts.length > 0 ? [] : extractProseProductLines(text);
  const identifiers = proseIdentifiers(text).filter(
    (id) => !rowIdentifiers.some((r) => r.value.includes(id.value) || id.value.includes(r.value)),
  );

  const locationHints = proseLocationHints(text);
  const packageText = prosePackageText(text);

  const anyIdentifiers =
    identifiers.length > 0 || rowIdentifiers.length > 0 || proseProductLines.length > 0;
  const anyPackageInfo = affectedProducts.length > 0 || packageText !== null || parsableRows > 0;
  const coverage: PackageCoverage = anyIdentifiers
    ? 'structured'
    : anyPackageInfo
      ? 'partial'
      : IDENTIFIER_KEYWORDS.test(text)
        ? 'parser_missed'
        : 'source_silent';

  return {
    packageText,
    identifiers,
    locationHints,
    proseProductLines,
    hasProductRows: affectedProducts.length > 0,
    coverage,
  };
}
