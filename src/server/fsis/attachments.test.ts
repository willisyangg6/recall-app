/**
 * FSIS attachments → verified product facts, pinned against the two live
 * notices that exposed the gap (recorded 2026-11-16, fixtures/README.md):
 *
 *  - PHA-11142026: products named ONLY in a product-list PDF and a label
 *    PDF; Lotly showed the agency headline as the product name.
 *  - PHA-11062026-01 (Betterballen): three products whose label pages are
 *    printed in the REVERSE of the notice's own list — page order can never
 *    be evidence.
 *
 * Full depth: raw API record → parse → attachment reading → enrichment →
 * projection → the shared card and Detail models. Plus the failure shapes:
 * an unavailable attachment, a mismatched label, and a rerun / same-URL
 * revision through the sync, which must never duplicate a notice or notify.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { detectChanges } from '../../domain/material-change';
import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import type { AttachmentEnrichment, NormalizedSourceRecord } from '../../domain/source-record';
import type { FeedItem } from '../../lib/recall-feed';
import { buildDetailModel, buildHomeCardModel } from '../../lib/recall-presentation';
import { productSummaryFromTitle } from '../../lib/consumer-summary';
import { enrichedProjection, enrichNormalized } from './attachment-projection';
import {
  syncFsisAttachments,
  type AttachmentCandidate,
  type AttachmentSyncStore,
  type LabelVisualPage,
  type StoredAttachment,
} from './attachment-sync';
import {
  brandDisplayCase,
  buildEnrichment,
  discoverFsisAttachments,
  labelPageCaptions,
  matchLabelPages,
  noticeProductNames,
  parseProductList,
  readPdfLayout,
  type AttachmentReading,
  type PdfLayout,
} from './attachments';
import type { LabelFailureState } from './label-sync';
import { sha256 } from './labels';
import { parseFsisRecord, type FsisRawRecord } from './parse';

const FIXTURES = join(process.cwd(), 'src/server/fsis/fixtures');
const BISCUIT = 'pha-attachments-biscuit-pha-11142026.json';
const BETTERBALLEN = 'pha-attachments-betterballen-pha-11062026-01.json';
const BISCUIT_LIST = 'PHA-11142026-Product-List_0.pdf';
const BISCUIT_LABELS = 'PHA-11142026-Product-Labels.pdf';
const BETTERBALLEN_LABELS = 'PHA_11062026_01A_Label.pdf';
const RENDERS = 'https://example.supabase.co/storage/v1/object/public/product-visuals/fsis-labels/';

function record(file: string): NormalizedSourceRecord {
  const raw: FsisRawRecord = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
  return parseFsisRecord(raw);
}

function pdf(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, 'attachments', name)));
}

function renderUrl(pdfSha: string, page: number): string {
  return `${RENDERS}${pdfSha.slice(0, 20)}/p${page}.webp`;
}

/** Readings exactly as the sync assembles them, from the recorded PDFs. */
async function readings(normalized: NormalizedSourceRecord, files: Record<string, string>) {
  const out: AttachmentReading[] = [];
  for (const attachment of discoverFsisAttachments(normalized.summaryHtml)) {
    const file = files[attachment.kind];
    if (!file) continue;
    const bytes = pdf(file);
    const sha = sha256(bytes);
    const layout = await readPdfLayout(bytes);
    if (attachment.kind === 'product_list') {
      out.push({
        ...attachment,
        kind: 'product_list',
        sha256: sha,
        parse: parseProductList(layout),
      });
    } else if (attachment.kind === 'labels') {
      const captions = labelPageCaptions(layout);
      out.push({
        ...attachment,
        kind: 'labels',
        sha256: sha,
        captions,
        renderUrls: new Map(captions.map((c) => [c.page, renderUrl(sha, c.page)])),
      });
    }
  }
  return out;
}

function feedItem(projection: CaseProjection): FeedItem {
  return {
    id: 'case-1',
    title: projection.title,
    brands: projection.brands,
    firmName: projection.recallingFirm.displayName,
    productDescription: projection.productDescription,
    productNames: projection.affectedProducts.map((p) => p.name),
    noticeType: projection.noticeType,
    classification: projection.classification,
    sourceAgency: projection.sourceAgency,
    publishedAt: projection.publishedAt,
    timeline: [],
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    productCategories: projection.productCategories,
    heroImageUrl: projection.heroImageUrl,
    geography: projection.geography,
  } as unknown as FeedItem;
}

function models(
  projection: CaseProjection,
  visuals: { url: string; page: number; caption: string | null }[],
) {
  const card = buildHomeCardModel(feedItem(projection), { today: '2026-11-16', prefs: null });
  const detail = buildDetailModel(
    {
      id: 'case-1',
      projection,
      timeline: [],
      affectedProducts: projection.affectedProducts,
      visuals: visuals.map((v) => ({
        url: v.url,
        role: 'package_label',
        page: v.page,
        width: 1024,
        height: 791,
        sourceUrl: 'https://www.fsis.usda.gov/label.pdf',
        caption: v.caption,
      })),
    },
    { today: '2026-11-16', affectsYou: false } as Parameters<typeof buildDetailModel>[1],
  );
  const rows = detail.sections.affectedProducts?.table.expanded.rows ?? [];
  return { card, detail, rows };
}

// ── Discovery ───────────────────────────────────────────────────────────────

test('discovery reads link TEXT: product list, product labels, and bracketed "view labels"', () => {
  const biscuit = discoverFsisAttachments(record(BISCUIT).summaryHtml);
  assert.deepEqual(
    biscuit.map((a) => [a.kind, a.linkText]),
    [
      ['product_list', 'View the list of products subject to the public health alert'],
      ['labels', 'View product labels.'],
    ],
  );
  // The list lives under media_file/documents — no URL rule would find it.
  assert.match(
    biscuit[0].url,
    /^https:\/\/www\.fsis\.usda\.gov\/sites\/default\/files\/media_file\//,
  );

  const betterballen = discoverFsisAttachments(record(BETTERBALLEN).summaryHtml);
  assert.deepEqual(
    betterballen.map((a) => [a.kind, a.linkText]),
    [['labels', 'view labels]']],
  );

  // Historical variants: "View Labels" (PDF only), distribution lists.
  const html =
    '<a href="/sites/default/files/import/053-2017-labels.pdf">View Labels</a> ' +
    '<a href="/sites/default/files/media_file/2024/distro_list.pdf">View the retail distribution list</a> ' +
    '<a href="https://example.com/evil.pdf">View labels</a>';
  assert.deepEqual(
    discoverFsisAttachments(html).map((a) => a.kind),
    ['labels', 'distribution_list'],
    'off-host PDFs are never attachments',
  );
});

// ── PHA-11142026 ────────────────────────────────────────────────────────────

test('PHA-11142026: the product list verifies; card and Detail use the verified product', async () => {
  const normalized = record(BISCUIT);
  const before = projectCase([normalized]);
  const beforeModels = models(before, []);
  // BEFORE (what production shows): the agency headline, no photo.
  assert.equal(
    beforeModels.card.productName,
    'Ready-to-Eat Meat Products Containing Recalled Biscuits',
  );
  assert.equal(beforeModels.card.heroImageUrl, null);

  const enrichment = buildEnrichment({
    noticeProductNames: noticeProductNames(normalized.productLines),
    geography: normalized.geography,
    readings: await readings(normalized, { product_list: BISCUIT_LIST, labels: BISCUIT_LABELS }),
  });
  assert.deepEqual(
    enrichment.sources.map((s) => [s.kind, s.status]),
    [
      ['product_list', 'verified'],
      ['labels', 'verified'],
    ],
  );
  const table = enrichment.tables[0];
  assert.deepEqual(table.headers, [
    'Size',
    'Brand Name',
    'Product Name',
    'Lot Codes and/or Use By Dates',
    'EST Number',
    'States Affected',
    'Media and Consumer Contact',
  ]);
  assert.deepEqual(
    table.rows.map((r) => [r.page, ...r.cells.slice(0, 5)]),
    [
      [
        1,
        '9.5oz',
        'Mmm! MEALS MADE IN MINUTES',
        'BISCUIT & SAUSAGE GRAVY',
        '11/12/26 – 11/18/26',
        'Est. 51248',
      ],
    ],
  );
  // Provenance: URL + content hash of the exact bytes read.
  assert.match(table.sourceUrl, /PHA-11142026-Product-List_0\.pdf$/);
  assert.equal(table.sha256, sha256(pdf(BISCUIT_LIST)));

  const labelSha = sha256(pdf(BISCUIT_LABELS));
  const after = projectCase([enrichNormalized(normalized, enrichment)]);
  // The agency headline is preserved in source data.
  assert.equal(after.title, before.title);
  const { card, detail, rows } = models(after, [
    { url: renderUrl(labelSha, 1), page: 1, caption: 'Mmm! BISCUIT & SAUSAGE GRAVY' },
  ]);
  assert.equal(card.noticeLabel, 'Public Health Alert');
  assert.equal(card.productName, 'Biscuit & Sausage Gravy');
  assert.equal(card.brand.text, 'Mmm! Meals Made in Minutes');
  // A full label page is too small to identify a product in the 112 pt card
  // tile (checked 2026-11-16): no card photo, and none in the header.
  assert.equal(card.heroImageUrl, null);
  assert.equal(detail.productName, 'Biscuit & Sausage Gravy');
  assert.equal(detail.productImages, null);
  assert.equal(rows.length, 1);
  // The verified label lives on its own product row, by its caption.
  assert.equal(rows[0].image?.url, renderUrl(labelSha, 1));
  const cell = (key: string) => rows[0].cells.find((c) => c.key === key)?.text ?? null;
  assert.equal(cell('product'), 'Biscuit & Sausage Gravy');
  assert.equal(cell('size'), '9.5 oz');
  assert.equal(cell('useBy'), 'November 12–November 18, 2026');
  assert.deepEqual(after.geography.states, [
    'Arkansas',
    'Louisiana',
    'Mississippi',
    'Oklahoma',
    'Tennessee',
    'Texas',
  ]);

  // Categories stay what the notice itself supports (an attachment name is
  // not category input — "gravy" would otherwise read as a condiment).
  assert.deepEqual(after.productCategories, before.productCategories);
  assert.deepEqual(after.productCategories, ['meat_poultry']);
  // Enrichment is never a notification: no material rule fires.
  assert.deepEqual(detectChanges(before, after).material, []);
  assert.deepEqual(after.affectedProducts, before.affectedProducts);
});

// ── PHA-11062026-01 ─────────────────────────────────────────────────────────

test('PHA-11062026-01: each product row gets ITS OWN label page, by caption, not page order', async () => {
  const normalized = record(BETTERBALLEN);
  const enrichment = buildEnrichment({
    noticeProductNames: noticeProductNames(normalized.productLines),
    geography: normalized.geography,
    readings: await readings(normalized, { labels: BETTERBALLEN_LABELS }),
  });
  assert.deepEqual(
    enrichment.sources.map((s) => [s.kind, s.status]),
    [['labels', 'verified']],
  );
  // No product list → no text field changes.
  assert.equal(enrichment.productDescription, null);

  const sha = sha256(pdf(BETTERBALLEN_LABELS));
  const captions = labelPageCaptions(await readPdfLayout(pdf(BETTERBALLEN_LABELS)));
  assert.deepEqual(
    captions.map((c) => c.caption),
    ['Bitterballen (Beef)', 'Saté Kroketten (Chicken)', 'Bami Rolls (Pork)'],
  );

  const before = projectCase([normalized]);
  const after = projectCase([enrichNormalized(normalized, enrichment)]);
  assert.equal(canonical(after), canonical(before), 'text fields are already correct and stay so');

  const visuals = captions.map((c) => ({
    url: renderUrl(sha, c.page),
    page: c.page,
    caption: c.caption,
  }));
  const { card, rows } = models(after, visuals);
  assert.equal(card.productName, 'Meat and Poultry');
  assert.deepEqual(
    rows.map((row) => [row.name, row.image?.url ?? null]),
    [
      ['Bami Rolls', renderUrl(sha, 3)],
      ['Saté Kroketten', renderUrl(sha, 2)],
      ['Bitterballen', renderUrl(sha, 1)],
    ],
  );

  // Before captions existed (production today), no row shows a label.
  const uncaptioned = models(
    after,
    visuals.map((v) => ({ ...v, caption: null })),
  );
  assert.deepEqual(
    uncaptioned.rows.map((row) => row.image),
    [null, null, null],
  );
});

function canonical(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

// ── Failure shapes ──────────────────────────────────────────────────────────

test('a mismatched label never reaches a row or the card; the attachment is flagged', () => {
  // Captions that name a different product, and one naming two.
  const matches = matchLabelPages(
    [
      { page: 1, caption: 'Pork Dumplings (Pork)' },
      { page: 2, caption: 'Bami Rolls and Bitterballen' },
      { page: 3, caption: null },
    ],
    ['Bami Rolls', 'Saté Kroketten', 'Bitterballen'],
  );
  assert.deepEqual(matches, [
    { page: 1, productIndex: null, reason: 'no_match' },
    { page: 2, productIndex: null, reason: 'ambiguous' },
    { page: 3, productIndex: null, reason: 'no_caption' },
  ]);

  const enrichment = buildEnrichment({
    noticeProductNames: ['Biscuit & Sausage Gravy'],
    geography: { scope: 'states', states: ['Texas'], confidence: 'stated', sourceText: 'Texas' },
    readings: [
      {
        kind: 'labels',
        url: 'https://www.fsis.usda.gov/labels.pdf',
        linkText: 'View labels',
        sha256: 'a'.repeat(64),
        captions: [{ page: 1, caption: 'Chicken Pot Pie' }],
        renderUrls: new Map([[1, renderUrl('a'.repeat(64), 1)]]),
      },
    ],
  });
  assert.equal(enrichment.sources[0].status, 'needs_review');
  assert.deepEqual(enrichment.sources[0].reviewReasons, [
    'page 1: no match',
    'no label page names "Biscuit & Sausage Gravy"',
  ]);

  // Two pages both naming the one product: neither is preferred by position.
  assert.deepEqual(
    matchLabelPages(
      [
        { page: 1, caption: 'Bami Rolls front' },
        { page: 2, caption: 'Bami Rolls back' },
      ],
      ['Bami Rolls'],
    ).map((m) => m.productIndex),
    [null, null],
  );
});

test('a product list naming states the notice does not is flagged, not adopted', async () => {
  const normalized = record(BISCUIT);
  const enrichment = buildEnrichment({
    noticeProductNames: noticeProductNames(normalized.productLines),
    geography: { scope: 'states', states: ['Texas'], confidence: 'stated', sourceText: 'TX' },
    readings: await readings(normalized, { product_list: BISCUIT_LIST }),
  });
  assert.equal(enrichment.sources[0].status, 'needs_review');
  assert.match(enrichment.sources[0].reviewReasons[0], /Arkansas, Louisiana/);
  assert.equal(enrichment.productDescription, null);
  assert.deepEqual(enrichment.tables, []);
});

test('PHA-11142026 revised: a continuation page without a repeated header continues the table', async () => {
  // FSIS's 2026-11-19 revision added four Granna's meals; the table runs onto
  // page 2 with the running page title but no header. Before 2026-11-22 that
  // page sent the whole list to review and withdrew the verified enrichment.
  const parse = parseProductList(
    await readPdfLayout(pdf('PHA-11142026-Product-List_0.revised-2026-11-19.pdf')),
  );
  assert.equal(parse.status, 'verified');
  assert.ok(parse.status === 'verified');
  assert.deepEqual(
    parse.table.rows.map((row) => [row.page, row.cells[2]]),
    [
      [1, 'BISCUIT & SAUSAGE GRAVY'],
      [1, '400 Chicken Pot Pie, Green Beans and Pineapples'],
      [1, '400 chicken pot pie, green beans & pineapples'],
      [2, '505 Biscuit and Gravy with Sausage, Hashbrowns, and Flavored Applesauce'],
      [2, '505 biscuit & gravy with meat crumbles flavored applesauce and peaches'],
    ],
  );
});

test('PHA-11142026 revised: five products of two brands add brands, never a generic title', async () => {
  const parse = parseProductList(
    await readPdfLayout(pdf('PHA-11142026-Product-List_0.revised-2026-11-19.pdf')),
  );
  const enrichment = buildEnrichment({
    noticeProductNames: ['Biscuit & Sausage Gravy'],
    geography: {
      scope: 'states',
      states: ['Arkansas', 'Louisiana', 'Mississippi', 'Oklahoma', 'Tennessee', 'Texas'],
      confidence: 'stated',
      sourceText: null,
    },
    readings: [
      { kind: 'product_list', url: 'list', linkText: 'list', sha256: 'a'.repeat(64), parse },
    ],
  });
  assert.equal(enrichment.sources[0].status, 'verified');
  // The notice's own "…Containing Recalled Biscuits" stands.
  assert.equal(enrichment.productDescription, null);
  assert.deepEqual(enrichment.brands, ['Mmm! Meals Made in Minutes', 'Granna’s']);
  assert.equal(enrichment.tables[0].rows.length, 5);
});

test('a headerless page is a continuation only when it fits the previous columns', () => {
  const header = (y: number) => [
    { text: 'Size', x: 30, y, width: 20 },
    { text: 'Product Name', x: 150, y, width: 60 },
    { text: 'Dates', x: 300, y, width: 30 },
  ];
  const row = (y: number, name: string) => [
    { text: '9 oz', x: 30, y, width: 20 },
    { text: name, x: 150, y, width: 80 },
    { text: '1/1/27', x: 300, y, width: 30 },
  ];
  const title = { text: 'Products List', x: 500, y: 760, width: 80 };
  const verified = parseProductList({
    numPages: 2,
    pages: [
      { page: 1, items: [title, ...header(700), ...row(680, 'Beef Stew')] },
      { page: 2, items: [title, ...row(740, 'Chicken Stew')] },
    ],
  });
  assert.equal(verified.status, 'verified');
  // Prose on the continuation page that sits above every product row is not
  // a table row: the page is refused, exactly as a header page would be.
  const refused = parseProductList({
    numPages: 2,
    pages: [
      { page: 1, items: [title, ...header(700), ...row(680, 'Beef Stew')] },
      {
        page: 2,
        items: [
          { text: 'Thank you for your cooperation.', x: 150, y: 760, width: 200 },
          ...row(740, 'Chicken Stew'),
        ],
      },
    ],
  });
  assert.equal(refused.status, 'needs_review');
});

test('an unrecognized table layout is needs_review, with nothing kept', () => {
  const layout: PdfLayout = {
    numPages: 1,
    pages: [
      { page: 1, items: [{ text: 'Thank you for your cooperation.', x: 72, y: 700, width: 200 }] },
    ],
  };
  const parse = parseProductList(layout);
  assert.equal(parse.status, 'needs_review');
});

test('fallback titles never end in agency "Recalled"', () => {
  assert.equal(
    productSummaryFromTitle(
      'FSIS Issues Public Health Alert for Ready-to-Eat Meat Products Containing Biscuits Recalled Due to Possible Listeria Contamination',
    ),
    'Ready-to-Eat Meat Products Containing Recalled Biscuits',
  );
  assert.equal(
    productSummaryFromTitle('FSIS Issues Public Health Alert for Chicken Products Recalled'),
    'Chicken',
  );
});

test('printed brands are un-shouted word by word, never respelled', () => {
  assert.equal(brandDisplayCase('Mmm! MEALS MADE IN MINUTES'), 'Mmm! Meals Made in Minutes');
  assert.equal(brandDisplayCase('McCormick'), 'McCormick');
});

// ── The sync: unavailable attachment, rerun, same-URL revision ───────────────

class MemoryStore implements AttachmentSyncStore {
  attachments = new Map<string, StoredAttachment>();
  failures = new Map<string, LabelFailureState>();
  visuals = new Map<string, { sha256: string; pages: LabelVisualPage[] }>();
  normalized: NormalizedSourceRecord;
  projection: CaseProjection;
  cases = 1;
  upserts = 0;
  projectionWrites = 0;

  constructor(normalized: NormalizedSourceRecord) {
    this.normalized = normalized;
    this.projection = projectCase([normalized]);
  }

  async listCandidates(): Promise<AttachmentCandidate[]> {
    return [
      {
        sourceRecordId: 'sr-1',
        recallCaseId: 'case-1',
        nativeId: this.normalized.nativeId,
        publishedAt: this.normalized.publishedAt,
        summaryHtml: this.normalized.summaryHtml,
        productLines: this.normalized.productLines,
        geography: this.normalized.geography,
        enrichment: this.normalized.attachmentEnrichment ?? null,
      },
    ];
  }
  async listAttachments() {
    return [...this.attachments.values()];
  }
  async upsertAttachment(row: StoredAttachment) {
    this.upserts += 1;
    this.attachments.set(`${row.sourceRecordId}|${row.url}`, row);
  }
  async labelVisuals(urls: string[]) {
    return new Map([...this.visuals].filter(([url]) => urls.includes(url)));
  }
  async setVisualCaptions(
    url: string,
    sha: string,
    captions: { page: number; caption: string | null }[],
  ) {
    const entry = this.visuals.get(url);
    if (!entry || entry.sha256 !== sha) return 0;
    let n = 0;
    entry.pages = entry.pages.map((p) => {
      const caption = captions.find((c) => c.page === p.page)?.caption ?? null;
      if (p.caption !== null || caption === null) return p;
      n += 1;
      return { ...p, caption };
    });
    return n;
  }
  async listFailures() {
    return [...this.failures.values()];
  }
  async recordFailure(state: LabelFailureState) {
    this.failures.set(state.sourceUrl, state);
  }
  async clearFailure(url: string) {
    this.failures.delete(url);
  }
  async applyEnrichment(_candidate: AttachmentCandidate, enrichment: AttachmentEnrichment) {
    const enriched = enrichNormalized(this.normalized, enrichment);
    const projection = enrichedProjection(
      this.projection,
      [{ id: 'sr-1', normalized: this.normalized }],
      'sr-1',
      enriched,
    );
    const same =
      JSON.stringify(enriched) === JSON.stringify(this.normalized) &&
      JSON.stringify(projection) === JSON.stringify(this.projection);
    this.normalized = enriched;
    if (JSON.stringify(projection) !== JSON.stringify(this.projection)) this.projectionWrites += 1;
    this.projection = projection;
    return same ? ('unchanged' as const) : ('applied' as const);
  }
}

function biscuitStore(): MemoryStore {
  const store = new MemoryStore(record(BISCUIT));
  const sha = sha256(pdf(BISCUIT_LABELS));
  // Rendered before captions existed — exactly production's state.
  store.visuals.set(
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-11/PHA-11142026-Product-Labels.pdf',
    { sha256: sha, pages: [{ page: 1, url: renderUrl(sha, 1), caption: null }] },
  );
  return store;
}

function agency(files: Record<string, Uint8Array | Error>) {
  const calls: string[] = [];
  return {
    calls,
    fetchPdf: async (url: string) => {
      calls.push(url);
      const name = Object.keys(files).find((key) => url.endsWith(key));
      const body = name ? files[name] : new Error('HTTP 404');
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

const NOW = () => new Date('2026-11-16T12:00:00Z');

test('sync: an unavailable attachment keeps the notice and flags it; nothing is guessed', async () => {
  const store = biscuitStore();
  const before = store.projection;
  const source = agency({
    [BISCUIT_LIST]: new Error('HTTP 503'),
    [BISCUIT_LABELS]: pdf(BISCUIT_LABELS),
  });
  const metrics = await syncFsisAttachments(store, {
    mode: 'recent',
    now: NOW,
    fetchPdf: source.fetchPdf,
    fetchDelayMs: 0,
    log: () => {},
  });

  assert.equal(metrics.unreadable, 1);
  const list = [...store.attachments.values()].find((a) => a.kind === 'product_list')!;
  assert.equal(list.status, 'unreadable');
  assert.match(list.reviewReasons[0], /HTTP 503/);
  assert.equal(store.failures.size, 1, 'retried later under backoff');
  // The label still verifies against the notice's own product item and is
  // captioned for its Detail row; it is never a card photo…
  const label = [...store.attachments.values()].find((a) => a.kind === 'labels')!;
  assert.equal(label.status, 'verified');
  assert.equal(
    store.visuals.values().next().value!.pages[0].caption,
    'Mmm! BISCUIT & SAUSAGE GRAVY',
  );
  assert.equal(store.projection.heroImageUrl, null);
  // …and no product name or table is invented without the list.
  assert.equal(store.projection.productDescription, null);
  assert.equal(store.projection.attachmentTables, undefined);
  assert.equal(store.projection.title, before.title);
  assert.deepEqual(detectChanges(before, store.projection).material, []);
});

test('sync: rerunning writes nothing; a same-URL revision updates the ONE row, never a second notice', async () => {
  const store = biscuitStore();
  const original = store.projection;
  const listBytes = pdf(BISCUIT_LIST);
  const source = agency({ [BISCUIT_LIST]: listBytes, [BISCUIT_LABELS]: pdf(BISCUIT_LABELS) });
  const options = { now: NOW, fetchPdf: source.fetchPdf, fetchDelayMs: 0, log: () => {} };

  await syncFsisAttachments(store, { mode: 'recent', ...options });
  assert.equal(store.projection.productDescription, 'Biscuit & Sausage Gravy');
  assert.deepEqual(store.projection.brands, ['Mmm! Meals Made in Minutes']);
  assert.equal(store.attachments.size, 2);
  const firstUpserts = store.upserts;
  const firstWrites = store.projectionWrites;
  const firstFetches = source.calls.length;

  // Rerun (recent mode): nothing fetched, nothing written.
  const rerun = await syncFsisAttachments(store, { mode: 'recent', ...options });
  assert.equal(source.calls.length, firstFetches, 'no agency traffic for unchanged work');
  assert.equal(store.upserts, firstUpserts);
  assert.equal(store.projectionWrites, firstWrites);
  assert.equal(rerun.enrichmentsApplied, 0);

  // FSIS republishes the list at the SAME URL with changed bytes (a revised
  // document). The daily sweep re-verifies and catches it.
  const revisedBytes = new Uint8Array([...listBytes, 0x0a]);
  const revised = agency({ [BISCUIT_LIST]: revisedBytes, [BISCUIT_LABELS]: pdf(BISCUIT_LABELS) });
  const metrics = await syncFsisAttachments(store, {
    mode: 'full',
    ...options,
    fetchPdf: revised.fetchPdf,
  });
  assert.equal(metrics.revised, 1);
  const lists = [...store.attachments.values()].filter((a) => a.kind === 'product_list');
  assert.equal(lists.length, 1, 'one row per (record, URL)');
  assert.equal(lists[0].sha256, sha256(revisedBytes));
  assert.equal(lists[0].previousSha256, sha256(listBytes));
  assert.ok(lists[0].revisedAt);
  assert.equal(store.cases, 1, 'no second notice');
  assert.equal(store.projection.attachmentTables?.[0].sha256, sha256(revisedBytes));
  // And never a notification.
  assert.deepEqual(detectChanges(original, store.projection).material, []);
  assert.deepEqual(store.projection.affectedProducts, original.affectedProducts);
  assert.deepEqual(store.projection.geography, original.geography);
});

test('the projection patch copies only attachment-owned keys, so it cannot widen a case', () => {
  const normalized = record(BISCUIT);
  const stored = projectCase([normalized]);
  const widened: NormalizedSourceRecord = {
    ...normalized,
    geography: { scope: 'nationwide', states: [], confidence: 'stated', sourceText: 'Nationwide' },
  };
  // The patch copies only attachment-owned keys, so even a record whose
  // geography differs cannot widen the case through this path…
  const patched = enrichedProjection(stored, [{ id: 'sr-1', normalized }], 'sr-1', widened);
  assert.deepEqual(patched.geography, stored.geography);
});

test('sync: a dry run reads and plans but writes NOTHING, even for an unreadable attachment', async () => {
  const store = biscuitStore();
  const before = JSON.stringify([store.projection, store.normalized, [...store.visuals]]);
  const source = agency({
    [BISCUIT_LIST]: new Error('HTTP 503'),
    [BISCUIT_LABELS]: pdf(BISCUIT_LABELS),
  });
  const metrics = await syncFsisAttachments(store, {
    mode: 'full',
    dryRun: true,
    now: NOW,
    fetchPdf: source.fetchPdf,
    fetchDelayMs: 0,
    log: () => {},
  });
  assert.equal(store.upserts, 0);
  assert.equal(store.failures.size, 0);
  assert.equal(JSON.stringify([store.projection, store.normalized, [...store.visuals]]), before);
  assert.equal(metrics.plan.length, 1);
  assert.equal(metrics.plan[0].captionsToWrite, 1);
  assert.equal(metrics.plan[0].write, false, 'a label alone changes no product field');
});

test('the one-row label exception needs a caption AND no hero; announcement photos never use it', async () => {
  const normalized = record(BISCUIT);
  const enrichment = buildEnrichment({
    noticeProductNames: noticeProductNames(normalized.productLines),
    geography: normalized.geography,
    readings: await readings(normalized, { product_list: BISCUIT_LIST }),
  });
  const projection = projectCase([enrichNormalized(normalized, enrichment)]);
  const url = renderUrl('b'.repeat(64), 1);
  const named = { url, page: 1, caption: 'Mmm! BISCUIT & SAUSAGE GRAVY' };
  assert.equal(models(projection, [named]).rows[0].image?.url, url);
  // Uncaptioned: nothing.
  assert.equal(models(projection, [{ ...named, caption: null }]).rows[0].image, null);
  // A caption naming another product: nothing.
  assert.equal(models(projection, [{ ...named, caption: 'Chicken Pot Pie' }]).rows[0].image, null);
  // A stored hero identifies the one product already: the label stays off the row.
  const withHero = { ...projection, heroImageUrl: 'https://www.fda.gov/files/hero.jpg' };
  assert.equal(models(withHero, [named]).rows[0].image, null);
});
