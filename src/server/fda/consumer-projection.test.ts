/**
 * Golden consumer-projection regressions: the recalls founder review actually
 * inspected, asserted end-to-end from recorded official source bytes through
 * Consumer Projection V2 to the exact strings the UI renders.
 *
 * These are semantic assertions, not visual snapshots — they pin what the user
 * is told, not how it is laid out.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { projectCase } from '../../domain/projection';
import { buildConsumerCase, joinValues } from '../../lib/consumer-projection';
import { auditConsumerCase } from '../../lib/consumer-qa';
import { productDisplayName } from '../../lib/consumer-summary';
import { reasonLine } from '../../lib/recall-display';
import { buildWhatHappened } from '../../lib/what-happened';
import { loadDetailPage, loadListingItems } from './fixtures';
import { parseFdaAnnouncement, slugFromPath } from './parse';

function consumerCaseFor(slug: string) {
  const item = loadListingItems().find((i) => i.path.endsWith(`/${slug}`));
  assert.ok(item, `fixture listing item missing: ${slug}`);
  assert.ok(
    existsSync(`src/server/fda/fixtures/pages/${slug}.html`),
    `fixture page missing: ${slug}`,
  );
  const normalized = parseFdaAnnouncement({
    listing: item!,
    detailMainHtml: loadDetailPage(slug),
    path: item!.path,
  });
  const projection = projectCase([normalized]);
  return {
    projection,
    consumer: buildConsumerCase(projection, projection.affectedProducts),
    audit: auditConsumerCase(slugFromPath(item!.path), projection, projection.affectedProducts),
  };
}

/** Every rendered identifier value, flattened. */
function allFields(consumer: ReturnType<typeof buildConsumerCase>) {
  return [
    ...consumer.packageCheck.fields,
    ...consumer.packageCheck.variants.flatMap((v) => v.fields),
  ];
}

function allFactValues(consumer: ReturnType<typeof buildConsumerCase>): string[] {
  return allFields(consumer).flatMap((f) => f.values);
}

function labelsOf(consumer: ReturnType<typeof buildConsumerCase>): string[] {
  return allFields(consumer).map((f) => f.label);
}

/** Everything the "Where it was sold" section can render, as one string. */
function distributionCopy(consumer: ReturnType<typeof buildConsumerCase>): string {
  const d = consumer.distribution;
  return [d.areaText, ...d.retailers, ...d.retailLocations, ...d.onlinePlatforms, ...d.channels]
    .join(' ')
    .trim();
}

test('golden: Grand Central Bakery Potato Sourdough is a designed checker, not a table dump', () => {
  const { consumer, audit } = consumerCaseFor(
    'updated-grand-central-bakery-seattle-recalls-potato-sourdough-bread-due-possible-foreign-object',
  );

  // The transposed source table becomes three real product versions…
  assert.deepEqual(consumer.variantNames, [
    'Potato Market Loaf',
    'Potato Table Loaf',
    'Mini Potato Loaf',
  ]);
  // …with the product name no longer prefixed to every value.
  for (const value of allFactValues(consumer)) {
    assert.doesNotMatch(value, /Grand Central Bakery Potato Sourdough Bread/, value);
  }
  // Raw source headings never become UI labels.
  for (const label of labelsOf(consumer)) {
    assert.doesNotMatch(
      label,
      /^(Generic name|Sold At|Intended use|Condition|Shelf life)$/i,
      label,
    );
  }
  // "Sold At" is routed to Where it was sold and aggregated once. The generic
  // "grocery stores" is dropped because the named stores below ARE the grocery
  // stores — listing both makes one distribution route read as two.
  assert.ok(consumer.distribution.channels.includes('wholesalers'));
  assert.ok(consumer.distribution.channels.includes('cafés'));
  assert.doesNotMatch(distributionCopy(consumer), /grocery stores/);
  // Useful specificity survives: the metro geography the source states, and
  // the twelve named stores it lists, are not compressed into "grocery stores".
  assert.equal(consumer.distribution.areaText, 'Seattle and Tacoma metro areas, Washington.');
  assert.ok(consumer.distribution.retailers.includes('Whole Foods Markets'));
  assert.ok(consumer.distribution.retailers.includes('Metropolitan Markets'));
  assert.ok(consumer.distribution.retailers.length >= 10);
  // …but the long list stays behind its own disclosure.
  assert.equal(consumer.distribution.retailersShown.length, 5);
  assert.ok(consumer.distribution.retailersHidden > 0);
  // Neighborhoods listed under "Café locations" are places, not retailers.
  assert.ok(!consumer.distribution.retailers.includes('Wallingford'));
  // Low-value metadata is suppressed; useful identifiers survive.
  const first = consumer.packageCheck.variants[0];
  assert.equal(first.fields.find((f) => f.key === 'size')?.value, '20 oz');
  assert.equal(first.fields.find((f) => f.key === 'upc')?.value, '733163001576');
  // The barcode belongs to THAT loaf. Restating it below the version cards
  // would invent a recall-wide relationship the source never asserted.
  assert.ok(!consumer.packageCheck.fields.some((f) => f.key === 'upc'));
  // "No Packaging" and "None" are dropped rather than shown as identifiers.
  assert.ok(!allFactValues(consumer).some((v) => /^(No Packaging|None)$/i.test(v)));
  // Photos are in-app, and the action never refers the user to FDA.
  assert.ok(consumer.photos.length >= 1);
  assert.doesNotMatch(consumer.action.text, /notice|fda\.gov/i);
  assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations));
});

test('golden: Momchipz surfaces Amazon distribution, best-before date, and barcode', () => {
  const { projection, consumer, audit } = consumerCaseFor(
    'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-gluten',
  );

  assert.equal(projection.recallingFirm.displayName, 'Exotique Foods Inc');
  assert.deepEqual(projection.brands, ['Momchipz']);
  // Ontario, Canada is the firm's location and must never be distribution.
  assert.deepEqual(consumer.distribution.onlinePlatforms, ['Amazon.com']);
  assert.doesNotMatch(distributionCopy(consumer), /Ontario|Canada/);

  // The identifiers a shopper can actually compare, correctly normalized.
  const fields = consumer.packageCheck.fields;
  const bestBy = fields.find((f) => f.key === 'bestBy');
  assert.equal(bestBy?.values[0], 'August 31, 2026');
  // The notice writes the same day twice ("2026 AUGUST 31" in a photo caption)
  // and appends where to look. One date, once, and the placement lives in its
  // own line — never "August 31, 2026 and 2026 AUGUST 31, back of package".
  assert.equal(bestBy?.values.length, 1);
  assert.equal(consumer.packageCheck.codeLocation?.text, 'On the back of the package.');
  assert.equal(fields.find((f) => f.key === 'upc')?.value, '628634442166');
  assert.equal(fields.find((f) => f.key === 'upc')?.label, 'Barcode (UPC)');
  assert.equal(fields.find((f) => f.key === 'size')?.value, '3 oz (85 g)');
  // Date is prioritized above the barcode — the same order on every card.
  const order = fields.map((f) => f.key);
  assert.ok(order.indexOf('bestBy') < order.indexOf('upc'));
  // Official photography is available in-app.
  assert.ok(consumer.photos.length >= 1);
  assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations));
});

test('golden: Prince Bakery keeps rich neighborhood distribution and clean bread variants', () => {
  const { consumer, audit } = consumerCaseFor(
    'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads',
  );

  // The neighborhoods the source names beat collapsing to just "New York" —
  // the state leads, and the places arrive as typed AREAS, never retailers.
  assert.equal(consumer.distribution.areaText, 'New York.');
  assert.deepEqual(consumer.distribution.areas, ['Bronx', 'Westchester']);
  assert.deepEqual(consumer.distribution.channels, ['bodegas']);

  // Five affected breads, each with size split out and package color kept.
  assert.equal(consumer.variantNames.length, 5);
  assert.ok(
    consumer.variantNames.every((n) => !/Net Wt\./i.test(n)),
    consumer.variantNames.join('|'),
  );
  const first = consumer.packageCheck.variants[0];
  // Shared formatting reaches every source shape: "227g" becomes "227 g".
  assert.equal(first.fields.find((f) => f.key === 'size')?.value, '8 oz (227 g)');
  // Package colour has no approved consumer field, so it is held back rather
  // than rendered under a label the schema does not define. The bread stays
  // recognizable from its name, its size, and its own photograph.
  assert.ok(first.rejected.some((r) => r.concept === 'package_color'));
  assert.ok(!labelsOf(consumer).includes('Package color'));
  // Package photos are shown in-app, and each caption's photo is attached to
  // the bread it actually depicts rather than to whichever came first.
  assert.ok(consumer.photos.length >= 1);
  const italianLarge = consumer.packageCheck.variants.find((v) =>
    /Sesame Italian Bread Large/.test(v.name ?? ''),
  );
  assert.match(italianLarge?.photo?.alt ?? '', /Sesame Italian Bread Large/);
  // Very tall label photographs keep their real proportions for layout.
  assert.ok(consumer.photos.every((p) => p.aspectRatio !== null));
  assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations));
});

test('golden: Outshine hides 54 batch codes behind disclosure and surfaces the flavors', () => {
  const { projection, consumer, audit } = consumerCaseFor(
    'updated-dreyers-grand-ice-cream-inc-issues-voluntary-recall-select-outshine-fruit-bars-due-possible',
  );

  // The table's product and barcode cells say only "See Image Below", so the
  // photos carry the identity. Six rows, six package photos, in the agency's
  // own order — each flavor keeps ITS barcode and ITS batch codes instead of
  // all six merging into parallel global lists.
  assert.equal(consumer.packageCheck.variants.length, 6);
  assert.ok(
    consumer.variantNames.some((n) => /Watermelon/.test(n)),
    consumer.variantNames.join('|'),
  );
  assert.ok(consumer.variantNames.some((n) => /Variety Pack/.test(n)));

  const strawberry = consumer.packageCheck.variants[0];
  assert.match(strawberry.name ?? '', /Strawberry/);
  assert.equal(strawberry.fields.find((f) => f.key === 'upc')?.value, '041548610047');
  assert.match(strawberry.photo?.alt ?? '', /Strawberry/);
  // Each version's own dates, sorted chronologically rather than in whatever
  // order the source printed them.
  assert.deepEqual(strawberry.fields.find((f) => f.key === 'bestBy')?.values, [
    'September 30, 2027',
    'October 31, 2027',
    'November 30, 2027',
  ]);
  // …and its own collapsed code set, still paired to the dates.
  const lots = strawberry.lotCodes;
  assert.ok(lots);
  assert.ok(lots!.count > 20, `expected a large code set, got ${lots!.count}`);
  assert.equal(lots!.label, 'Batch code');
  assert.equal(lots!.pairs.length, lots!.count);
  assert.deepEqual(lots!.pairs[0], { code: 'LLA616903', date: 'September 30, 2027' });
  // No version's barcode leaks back out as a recall-wide identifier.
  assert.equal(consumer.packageCheck.fields.length, 0);
  assert.equal(consumer.packageCheck.lotCodes, null);
  // The location is true of all six flavors, so it is stated once globally and
  // never repeated inside a version card.
  assert.equal(consumer.packageCheck.codeLocation?.text, 'On the bottom of the package.');
  assert.ok(consumer.packageCheck.variants.every((v) => v.codeLocation === null));
  // Every version has its own photo, so no central checker image repeats one.
  assert.deepEqual(consumer.packageCheck.photos, []);
  for (const value of [...allFactValues(consumer), ...consumer.variantNames]) {
    assert.doesNotMatch(value, /see image below/i, value);
  }
  // Six package photos lead the gallery. The six barcode macros between them
  // appear nowhere: the checker already prints each flavor's barcode as text,
  // so a photograph of that same barcode adds nothing a shopper can act on.
  assert.equal(consumer.photos.length, 6);
  assert.ok(consumer.photos.every((p) => p.role !== 'barcode_closeup'));
  // What happened stays the concise standardized sentence.
  const happened = buildWhatHappened({
    title: projection.title,
    noticeType: projection.noticeType,
    reasonText: projection.reasonText,
    hazardCategory: projection.hazardCategory,
    pathogenOrAllergen: projection.pathogenOrAllergen,
    firmDisplayName: projection.recallingFirm.displayName,
    summaryText: projection.summaryText,
    productDescription: projection.productDescription,
  });
  assert.equal(
    happened.text,
    'Dreyer’s Grand Ice Cream recalled Outshine Fruit Bars because the products may contain pieces of glass.',
  );
  assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations));
});

test('golden: Dairyland jalapeños lead with real dates and keep the printed codes', () => {
  const { consumer, audit } = consumerCaseFor(
    'hardies-fresh-foods-recalls-jalapenos-because-possible-health-risk',
  );

  // The notice's only visual is a photograph of the bag's LABEL, which
  // necessarily includes a barcode. It is the authoritative way to recognize
  // the product, so it stays a primary image — a "contains a barcode →
  // exclude" rule would leave this recall with no picture at all.
  assert.equal(consumer.photos.length, 1);
  assert.equal(consumer.photos[0].role, 'package_label');
  assert.equal(consumer.primaryPhoto?.role, 'package_label');

  // "Production dates are: 26192 (07/11/26), …" — 26192 is a Julian pack code
  // whose day-of-year IS July 11, so the notice states the same day twice and
  // proves its own date order. Consumers get the readable date…
  // Production dates are not a package-card row: they lead the production-code
  // disclosure, where the readable date explains the opaque code beneath it.
  // Each date renders complete: P3C-1 removed the same-month collapse, so this
  // reads as five dates to compare rather than one month and five bare days.
  assert.equal(
    consumer.packageCheck.productionDates,
    'July 11, 2026, July 15, 2026, July 16, 2026, July 18, 2026, July 22, 2026',
  );
  assert.ok(!labelsOf(consumer).includes('Production date'));
  // …and the opaque code printed on the bag is preserved, mapped to its date,
  // because that is what they will actually compare against.
  const codes = consumer.packageCheck.productionCodes;
  assert.ok(codes);
  assert.equal(codes!.label, 'Production code');
  assert.deepEqual(codes!.pairs[0], { code: '26192', date: 'July 11, 2026' });
  assert.equal(codes!.pairs.length, 5);

  // Seven lot codes stay available in-app behind their own disclosure step.
  assert.equal(consumer.packageCheck.lotCodes?.count, 7);
  assert.ok(consumer.packageCheck.lotCodes?.codes.includes('X2748743'));

  // Retailer and geography compose into one sentence somebody would write.
  assert.equal(consumer.distribution.areaText, 'Texas.');
  assert.deepEqual(consumer.distribution.retailers, ['Costco']);
  assert.equal(audit.violations.length, 0, JSON.stringify(audit.violations));
});

test('golden: GreenWise/Publix keeps company, brand, and retailer distinct', () => {
  const { projection, consumer } = consumerCaseFor(
    'publix-recalls-all-lots-greenwise-organic-frozen-blueberries-and-whole-mixed-berries-due-potential-e',
  );
  assert.equal(projection.recallingFirm.displayName, 'Publix');
  assert.deepEqual(projection.brands, ['GreenWise']);
  assert.deepEqual(consumer.distribution.retailers, ['Publix']);
  assert.equal(
    reasonLine(projection.reasonText, projection.hazardCategory, projection.pathogenOrAllergen),
    'Possible E. coli contamination',
  );
  // The notice writes "UPC 41415-06453". It is shorter than a scannable
  // barcode, and it is what Publix prints on the box — so it reaches the
  // consumer under the label the source gave it, not a generic "Product code".
  const upc = consumer.packageCheck.fields.find((f) => f.key === 'upc');
  assert.equal(upc?.label, 'Barcode (UPC)');
  assert.ok(upc?.values.includes('41415-06453'), upc?.value);
  assert.equal(
    consumer.packageCheck.scopeStatement,
    'All lots and dates of the products below are included in this recall.',
  );
});

test('golden: Bakr keeps its lot in the checker and out of the action', () => {
  const { consumer } = consumerCaseFor(
    'bear-stewart-llc-issues-allergy-alert-undeclared-soy-bakr-brown-butter-chocolate-chunk-ready-bake',
  );
  assert.ok(allFactValues(consumer).includes('2606022'));
  assert.doesNotMatch(consumer.action.text, /2606022/);
  // Undeclared soy → the action addresses people with that sensitivity.
  assert.match(consumer.action.text, /^If you are allergic or sensitive to soy, /);
  assert.equal(
    consumer.packageCheck.codeLocation?.text,
    'On the bottom-left of the back of the pouch.',
  );
  // Merchandising is not distribution: "sold in the frozen section" says
  // nothing about whether the recall reached a given shopper.
  assert.equal(consumer.distribution.areaText, 'Arizona, California, Nevada, and Utah.');
  assert.doesNotMatch(distributionCopy(consumer), /frozen/i);
});

test('golden: Rooted in RARE aquafaba keeps both barcodes and both best-by dates', () => {
  const { projection, consumer } = consumerCaseFor(
    '529-commerce-llc-recalls-rooted-rare-brand-aquafaba-powder-due-undeclared-eggs',
  );
  const values = allFactValues(consumer);
  assert.ok(values.includes('199284530959'), values.join(' | '));
  assert.ok(values.includes('199284306226'), values.join(' | '));
  // Dates reach the one consumer standard whatever the source printed.
  assert.ok(values.includes('December 14, 2026'), values.join(' | '));
  assert.ok(values.includes('December 12, 2027'), values.join(' | '));
  // How much was recalled has exactly one home: What happened.
  assert.equal(consumer.quantityText, '3,860 units');
  assert.equal(projection.quantityText, '3,860 units');
  assert.ok(!allFactValues(consumer).some((v) => /3,?860/.test(v)));
  assert.match(consumer.action.text, /^If you are allergic or sensitive to egg, /);
});

test('golden: every consumer surface is free of external-notice instructions', () => {
  const slugs = [
    'updated-grand-central-bakery-seattle-recalls-potato-sourdough-bread-due-possible-foreign-object',
    'exotique-foods-inc-recalls-momchipz-veggie-chips-broccoli-florets-cauliflower-due-undeclared-gluten',
    'prince-bakery-inc-issues-allergy-alert-undeclared-milk-and-sesame-prince-bakery-breads',
    'updated-dreyers-grand-ice-cream-inc-issues-voluntary-recall-select-outshine-fruit-bars-due-possible',
    'publix-recalls-all-lots-greenwise-organic-frozen-blueberries-and-whole-mixed-berries-due-potential-e',
    'bear-stewart-llc-issues-allergy-alert-undeclared-soy-bakr-brown-butter-chocolate-chunk-ready-bake',
    '529-commerce-llc-recalls-rooted-rare-brand-aquafaba-powder-due-undeclared-eggs',
  ];
  for (const slug of slugs) {
    const { projection, consumer } = consumerCaseFor(slug);
    const product = productDisplayName(projection.productDescription, projection.title);
    const copy = [
      distributionCopy(consumer),
      consumer.action.text,
      consumer.packageCheck.scopeStatement,
      product,
      consumer.packageCheck.codeLocation?.text ?? '',
      ...allFactValues(consumer),
      ...labelsOf(consumer),
      ...consumer.packageCheck.fields.map((f) => joinValues(f.values)),
    ];
    for (const text of copy) {
      assert.doesNotMatch(
        text,
        /\b(?:check|see|open|refer to|consult)\b[^.]{0,40}\b(?:official notice|notice|fda\.gov|fda page)\b/i,
        `${slug}: ${text}`,
      );
      assert.doesNotMatch(text, /see image below/i, `${slug}: ${text}`);
    }
    // Every case has a usable action and an honest package statement.
    assert.ok(consumer.action.text.length > 10, slug);
    assert.match(consumer.packageCheck.scopeStatement, /[.!?]$/, slug);
  }
});
