/**
 * Consumer Projection V2 — deterministic interpretation of the product tables
 * inside an official announcement's own HTML.
 *
 * Runs at display time over `projection.summaryHtml` (preserved for every
 * persisted case), so parser improvements reach already-stored records without
 * re-ingestion.
 *
 * Two real table orientations occur in FDA announcements and both are handled:
 *
 *   standard   — first row is the header; each later row is one product
 *                variant and each column is a field. (Prince Bakery, Outshine)
 *   transposed — the first COLUMN holds the field labels and each later column
 *                is one product variant. (Grand Central Bakery Potato
 *                Sourdough, whose first column reads Brand Name / Generic name
 *                / Sold At / Packaging / Net weight / UPC.)
 *
 * Misreading a transposed table is what produced the "product name repeated
 * before every value" defect, because the row labels were mistaken for
 * product names. Orientation is therefore detected explicitly, never assumed.
 */

import { decodeEntities, stripHtml } from '@/domain/text';
import { conceptForLabel, isLayoutArtifactValue, type ConsumerConcept } from './consumer-concepts';

/**
 * What kind of source context supported a semantic assignment. Every fact
 * carries it, because "the source's table column said UPC" and "a number
 * appeared in a sentence" are very different grounds for labeling a value, and
 * only the projection knows which one it is looking at.
 */
export type FactEvidence = 'table' | 'prose' | 'caption' | 'legacy';

export interface SemanticFact {
  concept: ConsumerConcept;
  /** The source's own label, preserved for provenance/debugging. */
  sourceLabel: string;
  /** The source's own value text, cleaned of markup only. */
  value: string;
  /** The authoritative source text, preserved through every transformation. */
  raw?: string;
  /** How this assignment is supported. */
  evidence?: FactEvidence;
  /**
   * Identity of the product/variant this fact belongs to, when the source
   * establishes one (a table row, a labeled product line). Facts sharing a
   * scope belong together; a fact with no scope belongs to the recall as a
   * whole and must never be presented as if it belonged to one version.
   */
  scope?: string;
  /** For a lot code the source printed alongside a date, that date — so the
   * code→date relationship survives into the package checker. */
  pairedDate?: string;
  /** For a calendar date the source printed alongside its printed code. */
  pairedCode?: string;
}

export interface TableVariant {
  facts: SemanticFact[];
  /** Stable identity of this row within the announcement. */
  scope: string;
  /** Position of this row/column in the source table, from 0. */
  index: number;
}

export interface InterpretedTable {
  orientation: 'standard' | 'transposed';
  variants: TableVariant[];
  /**
   * True when every product/packaging cell in this table defers to the
   * announcement's photos ("See Image Below"). Such a table states its product
   * identities visually, not textually — the photos ARE the missing column.
   */
  defersToImages: boolean;
}

interface Cell {
  text: string;
  isHeader: boolean;
  colspan: number;
  rowspan: number;
}

function cellsOf(rowHtml: string): Cell[] {
  const cells: Cell[] = [];
  for (const match of rowHtml.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
    const span = (name: string) => {
      const value = match[2].match(new RegExp(`${name}\\s*=\\s*"?(\\d+)"?`, 'i'));
      return value ? Math.max(1, Number(value[1])) : 1;
    };
    cells.push({
      text: stripHtml(match[3])
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      isHeader: match[1].toLowerCase() === 'h',
      colspan: span('colspan'),
      rowspan: span('rowspan'),
    });
  }
  return cells;
}

/**
 * Rows with vertically-spanned cells expanded into their real grid positions.
 *
 * A cell with `rowspan="5"` — real example: one barcode covering five lot rows
 * — appears in the HTML only once, so every later row is short by a column and
 * its remaining cells slide left. Read naively, row 2's LOT number lands under
 * the "Item UPC" heading and gets presented to a consumer as a barcode. This
 * is the same class of defect as misreading a transposed table: the grid must
 * be reconstructed before any cell is given a meaning.
 */
function rowsOf(tableHtml: string): Cell[][] {
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((row) => cellsOf(row[0]));
  // Cells still spanning down from an earlier row, by grid column.
  const carried = new Map<number, { cell: Cell; remaining: number }>();
  return rows.map((row) => {
    const expanded: Cell[] = [];
    let column = 0;
    const placeCarried = () => {
      let carry = carried.get(column);
      while (carry) {
        expanded.push({ ...carry.cell, rowspan: 1 });
        carry.remaining -= 1;
        if (carry.remaining <= 0) carried.delete(column);
        column += carry.cell.colspan;
        carry = carried.get(column);
      }
    };
    placeCarried();
    for (const cell of row) {
      expanded.push(cell);
      if (cell.rowspan > 1) carried.set(column, { cell, remaining: cell.rowspan - 1 });
      column += cell.colspan;
      placeCarried();
    }
    return expanded;
  });
}

/**
 * A label is "recognized" when it routes to a real concept. "See Image Below"
 * routes to `layout_artifact`, which means the cell is a pointer at a photo,
 * not a field name — counting it as a label would make an ordinary product
 * table look transposed.
 */
function isRecognizedLabel(text: string): boolean {
  if (text === '') return false;
  const concept = conceptForLabel(text);
  return concept !== 'unknown' && concept !== 'layout_artifact';
}

/**
 * Transposed when the first column reads like a list of field labels. Requires
 * a clear majority of first-column cells to route to real concepts AND more
 * than one such row, so a normal two-column table is never mistaken for one.
 */
function detectOrientation(rows: Cell[][]): 'standard' | 'transposed' {
  if (rows.length < 2) return 'standard';
  const firstColumnLabels = rows.filter((row) => row.length > 1 && isRecognizedLabel(row[0].text));
  const headerRowRecognized = rows[0].filter((c) => isRecognizedLabel(c.text)).length;

  const transposedScore = firstColumnLabels.length / rows.length;
  const standardScore = rows[0].length > 0 ? headerRowRecognized / rows[0].length : 0;

  // A header row of <th> cells argues for standard orientation, but not when
  // the first column is even more clearly a list of field names: FDA also
  // publishes transposed tables whose corner cell is marked up as a header
  // ("Store: | Walmart", then a column of labelled attribute rows).
  if (
    rows[0].every((c) => c.isHeader) &&
    standardScore >= 0.5 &&
    standardScore >= transposedScore
  ) {
    return 'standard';
  }
  if (transposedScore >= 0.6 && firstColumnLabels.length >= 3 && transposedScore > standardScore) {
    return 'transposed';
  }
  return 'standard';
}

function fact(sourceLabel: string, value: string, scope: string): SemanticFact | null {
  const cleaned = decodeEntities(value).trim();
  if (cleaned === '' || isLayoutArtifactValue(cleaned)) return null;
  let label = sourceLabel.trim();
  let concept = conceptForLabel(label);
  // A layout-artifact label ("See Image Below") never yields a fact.
  if (concept === 'layout_artifact') return null;
  if (concept === 'unknown') {
    // The column heading told us nothing, but the cell may label itself:
    // "Best Used By: 12/04/19, 12/10/19". The cell's own words are better
    // evidence than a heading that routed nowhere.
    const inline = cleaned.match(/^([A-Za-z][A-Za-z /()#-]{1,40}?)\s*:\s*\S/);
    const inlineConcept = inline ? conceptForLabel(inline[1]) : 'unknown';
    if (inline && inlineConcept !== 'unknown' && inlineConcept !== 'layout_artifact') {
      label = inline[1].trim();
      concept = inlineConcept;
    }
  }
  return {
    concept,
    sourceLabel: label,
    value: cleaned,
    raw: cleaned,
    evidence: 'table',
    scope,
  };
}

/**
 * True when a table's product/packaging cells only point at the photos. FDA
 * does this often: the row's identity lives in the image, not in text, so the
 * projection must look to the announcement's photos to name the row rather
 * than concluding the row has no product.
 */
function tableDefersToImages(rows: Cell[][], orientation: 'standard' | 'transposed'): boolean {
  const identityCells: string[] = [];
  if (orientation === 'standard') {
    const header = rows[0].map((c) => c.text);
    const identityColumns = header
      .map((label, index) => ({ label, index }))
      .filter(({ label }) => {
        const concept = conceptForLabel(label);
        return concept === 'variant' || concept === 'packaging' || concept === 'upc';
      });
    for (const row of rows.slice(1)) {
      for (const { index } of identityColumns) {
        if (row[index]) identityCells.push(row[index].text);
      }
    }
  } else {
    for (const row of rows) {
      const concept = conceptForLabel(row[0]?.text ?? '');
      if (concept !== 'variant' && concept !== 'packaging' && concept !== 'upc') continue;
      for (const cell of row.slice(1)) identityCells.push(cell.text);
    }
  }
  const deferring = identityCells.filter((text) => /^see (image|photo|picture)/i.test(text.trim()));
  return (
    deferring.length >= 2 &&
    deferring.length === identityCells.filter((t) => t.trim() !== '').length
  );
}

/** Interpret one HTML table into product variants carrying semantic facts. */
export function interpretTable(tableHtml: string, tableIndex = 0): InterpretedTable | null {
  const rows = rowsOf(tableHtml).filter((row) => row.length > 0);
  if (rows.length < 2) return null;
  const orientation = detectOrientation(rows);
  const defersToImages = tableDefersToImages(rows, orientation);

  if (orientation === 'transposed') {
    // Column 1..n are variants; each row contributes one fact per variant.
    // A colspan cell states one value shared by every variant.
    const variantCount = Math.max(
      ...rows.map((row) => row.slice(1).reduce((total, cell) => total + cell.colspan, 0)),
    );
    if (variantCount < 1) return null;
    const variants: TableVariant[] = Array.from({ length: variantCount }, (_, index) => ({
      facts: [],
      scope: `t${tableIndex}c${index}`,
      index,
    }));

    // A transposed table can name its columns in the header row, with the
    // product in the corner: "Sura Tanmen | Unit | Case" over rows of Item
    // Number, UPC, and so on. Those column names ARE the affected versions —
    // without them the two packs' identifiers merge into one ambiguous list.
    // Only when the corner cell is not itself a field label, so an ordinary
    // labelled first row is never mistaken for product names.
    const headerRow = rows[0];
    if (
      headerRow.every((cell) => cell.isHeader) &&
      headerRow.length === variantCount + 1 &&
      !isRecognizedLabel(headerRow[0].text) &&
      headerRow.slice(1).every((cell) => cell.text !== '' && cell.text.length <= 40)
    ) {
      const product = headerRow[0].text;
      headerRow.slice(1).forEach((cell, index) => {
        variants[index].facts.push({
          concept: 'variant',
          sourceLabel: 'column header',
          value: product === '' ? cell.text : `${product} (${cell.text})`,
          raw: cell.text,
          evidence: 'table',
          scope: variants[index].scope,
        });
      });
    }

    for (const row of rows) {
      const label = row[0].text;
      if (label === '') continue;
      let column = 0;
      for (const cell of row.slice(1)) {
        for (let offset = 0; offset < cell.colspan && column + offset < variantCount; offset++) {
          const target = variants[column + offset];
          // A spanning cell applies to every variant it covers, but each copy
          // is scoped to its own variant so ownership stays unambiguous.
          const entry = fact(label, cell.text, target.scope);
          if (entry) target.facts.push(entry);
        }
        column += cell.colspan;
      }
    }
    return {
      orientation,
      variants: variants.filter((v) => v.facts.length > 0),
      defersToImages,
    };
  }

  // Standard: row 0 is the header, each later row is one variant.
  const header = rows[0].map((cell) => splitHeaderValue(cell.text));
  const variants: TableVariant[] = [];
  // A sub-heading row ("Affected Lot Codes:" repeated across every column)
  // labels the block beneath it, per column.
  const subHeading: string[] = [];
  for (const row of rows.slice(1)) {
    // A row that is entirely headers is a repeated header band, not data.
    if (row.every((c) => c.isHeader)) continue;
    if (isSubHeadingRow(row)) {
      row.forEach((cell, column) => {
        subHeading[column] = cell.text.replace(/[:\s]+$/, '');
      });
      continue;
    }
    const index = variants.length;
    const scope = `t${tableIndex}r${index}`;
    const facts: SemanticFact[] = [];
    row.forEach((cell, column) => {
      const label = subHeading[column] ?? header[column]?.label ?? '';
      // Unlabeled first column of a product table is the variant itself.
      const entry = fact(label === '' && column === 0 ? 'product' : label, cell.text, scope);
      if (entry) facts.push(entry);
      // A header that carried its own value ("BEST IF USED BY 09/23/2023")
      // states a fact about this whole column; every row under it shares it.
      // Here the relationship runs down the column rather than across the row,
      // so the code in this cell is paired with this column's date directly.
      const carried = header[column]?.value;
      if (carried && entry) {
        const columnFact = fact(header[column].label, carried, scope);
        if (columnFact) {
          facts.push(columnFact);
          if (ROW_DATE_CONCEPTS.has(columnFact.concept) && DATED_CODE_CONCEPTS.has(entry.concept)) {
            entry.pairedDate = columnFact.value;
          }
        }
      }
    });
    if (facts.length > 0) variants.push({ facts: pairRowDatesAndCodes(facts), scope, index });
  }
  return { orientation, variants, defersToImages };
}

/**
 * A header cell that states its own value: "BEST IF USED BY 09/23/2023" over a
 * column of the lot codes carrying that date. Read as a plain label, the codes
 * beneath it become "Best by: 20082D04" — a lot number presented to a consumer
 * as a date. The label and the value have to be separated before either is used.
 */
function splitHeaderValue(text: string): { label: string; value: string | null } {
  const match = text.match(
    /^(.*?[A-Za-z])\s*:?\s*((?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}))$/,
  );
  if (!match || !isRecognizedLabel(match[1])) return { label: text, value: null };
  return { label: match[1].trim(), value: match[2].trim() };
}

/**
 * A row that repeats one label across every column, naming what follows
 * beneath it rather than carrying data of its own.
 */
function isSubHeadingRow(row: Cell[]): boolean {
  const texts = row.map((cell) => cell.text.trim()).filter((text) => text !== '');
  if (texts.length < 2 || new Set(texts).size !== 1) return false;
  const text = texts[0];
  return text.endsWith(':') && text.length <= 40 && isRecognizedLabel(text.replace(/[:\s]+$/, ''));
}

/** Codes whose value varies by production run, and so can belong to a date. */
const DATED_CODE_CONCEPTS = new Set<ConsumerConcept>(['lot', 'production_code', 'case_code']);
const ROW_DATE_CONCEPTS = new Set<ConsumerConcept>([
  'best_by',
  'use_by',
  'sell_by',
  'expiration',
  'freeze_by',
  'production_date',
]);

/**
 * Some tables have no product column at all: their two columns are a date and
 * the codes printed on packages carrying it.
 *
 *   Best Used By: | Lot Code
 *   12/04/19      | L18A04A
 *   12/05/19      | L18A05A, L18A05B, L18A05C
 *
 * The row IS the relationship. Read column by column it becomes two unrelated
 * global lists — twenty dates and forty codes with nothing connecting them —
 * which is worse than useless to someone holding one package. Pairing happens
 * within the row only, so a code can never acquire another row's date.
 *
 * A barcode is deliberately not paired: a UPC identifies the product, not the
 * production run, and tying it to one date would assert something false.
 */
function pairRowDatesAndCodes(facts: SemanticFact[]): SemanticFact[] {
  const dates = facts.filter((fact) => ROW_DATE_CONCEPTS.has(fact.concept));
  const codes = facts.filter((fact) => DATED_CODE_CONCEPTS.has(fact.concept));
  if (dates.length !== 1 || codes.length === 0) return facts;
  return facts.map((fact) =>
    DATED_CODE_CONCEPTS.has(fact.concept) ? { ...fact, pairedDate: dates[0].value } : fact,
  );
}

/** Interpret every product table in an announcement body. */
export function interpretTables(summaryHtml: string | null): InterpretedTable[] {
  if (!summaryHtml) return [];
  const out: InterpretedTable[] = [];
  let tableIndex = 0;
  for (const table of summaryHtml.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const interpreted = interpretTable(table[0], tableIndex++);
    if (interpreted && interpreted.variants.length > 0) out.push(interpreted);
  }
  return out;
}
