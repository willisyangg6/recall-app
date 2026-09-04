/**
 * Push copy goldens (§C2): deterministic, consumer-calm, source-grounded.
 * Titles never carry regulatory jargon; consumer risk speaks ConsumerRiskTier
 * language; a Pending-risk recall is announced from hazard facts without
 * pretending a tier exists; nothing leaks matcher internals or raw agency
 * boilerplate.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CaseProjection, OfficialClass } from '../../domain/recall-types';
import { buildPushMessage, formatPushContent, truncateForPush } from './format';
import type { DeliverableEvent } from './types';

function makeProjection(overrides: Partial<CaseProjection> = {}): CaseProjection {
  return {
    sourceAgency: 'FDA',
    noticeType: 'recall',
    state: 'active',
    closedYear: null,
    classification: { value: 'not_yet_classified', sourceText: null },
    title: 'Acme Foods Issues Allergy Alert on Undeclared Peanut in Trail Mix',
    summaryText: 'Acme Foods recalled trail mix.',
    summaryHtml: null,
    reasonText: null,
    hazardCategory: 'allergen',
    pathogenOrAllergen: 'Undeclared Peanut',
    recallingFirm: { displayName: 'Acme Foods', rawVariants: ['Acme Foods'] },
    brands: [],
    productDescription: 'Crunchy Trail Mix 16 oz',
    retailerNames: [],
    heroImageUrl: null,
    geography: { scope: 'unknown', states: [], confidence: 'inferred', sourceText: null },
    affectedProducts: [],
    quantityText: null,
    illnessStatement: null,
    reportsIllness: false,
    consumerAction: null,
    contactText: null,
    officialUrl: 'https://www.fda.gov/example',
    otherOfficialUrls: [],
    sourceIdentifiers: [],
    publishedAt: '2026-09-01',
    lastPublicActivityAt: '2026-09-01',
    ...overrides,
  };
}

function makeEvent(
  kind: 'initial' | 'material_update',
  triggerRuleId: string,
  projection: CaseProjection,
): DeliverableEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    recallCaseId: '22222222-2222-4222-8222-222222222222',
    kind,
    triggerRuleId,
    payloadSummary: 'internal summary',
    createdAt: '2026-09-02T00:00:00.000Z',
    projection,
  };
}

function classified(classes: OfficialClass[]): CaseProjection {
  return makeProjection({
    classification: {
      value: classes.length > 1 ? 'multiple_classes' : classes[0],
      sourceText: null,
      officialClasses: classes,
    },
  });
}

test('new FDA recall: product identity + hazard, no agency headline, no tier claim', () => {
  const content = formatPushContent(makeEvent('initial', 'new_case', makeProjection()));
  assert.equal(content.title, 'Recall alert: Crunchy Trail Mix 16 oz');
  assert.equal(content.body, 'Undeclared peanut allergen. Check your package.');
  // Pending risk: no invented tier, no regulatory class, no raw headline.
  assert.ok(!/class/i.test(content.title + content.body));
  assert.ok(!/critical|high|moderate|low|minimal/i.test(content.body));
  assert.ok(!content.title.includes('Issues Allergy Alert'));
});

test('new recall with microbial hazard names the pathogen', () => {
  const content = formatPushContent(
    makeEvent(
      'initial',
      'new_case',
      makeProjection({
        productDescription: 'Frozen Cooked Shrimp',
        hazardCategory: 'microbial_contamination',
        pathogenOrAllergen: 'Salmonella',
      }),
    ),
  );
  assert.equal(content.title, 'Recall alert: Frozen Cooked Shrimp');
  assert.equal(content.body, 'Possible Salmonella contamination. Check your package.');
});

test('FSIS public health alert leads with Safety alert', () => {
  const content = formatPushContent(
    makeEvent(
      'initial',
      'new_case',
      makeProjection({
        sourceAgency: 'FSIS',
        noticeType: 'public_health_alert',
        productDescription: null,
        title: 'FSIS Issues Public Health Alert for Frozen Taquitos',
        hazardCategory: 'foreign_material',
        pathogenOrAllergen: null,
        reasonText: 'Product contamination',
      }),
    ),
  );
  assert.ok(content.title.startsWith('Safety alert: '));
  assert.ok(content.body.includes('Check your package.'));
});

test('initial with no structured hazard still produces calm copy', () => {
  const content = formatPushContent(
    makeEvent(
      'initial',
      'new_case',
      makeProjection({ hazardCategory: 'unknown', pathogenOrAllergen: null, reasonText: null }),
    ),
  );
  assert.equal(content.body, 'Check your package for details.');
});

test('classification assigned (single Class I) speaks Critical, not Class I', () => {
  const content = formatPushContent(
    makeEvent('material_update', 'classification_assigned', classified(['class_I'])),
  );
  assert.equal(content.title, 'Risk update: Crunchy Trail Mix 16 oz');
  assert.equal(content.body, 'FDA classified this recall as Critical risk.');
  assert.ok(!/class[\s_]I/i.test(content.body));
});

test('classification assigned with a MIXED set never shows one scalar class', () => {
  const content = formatPushContent(
    makeEvent('material_update', 'classification_assigned', classified(['class_I', 'class_II'])),
  );
  assert.equal(
    content.body,
    'FDA gave affected products different classifications — overall High risk.',
  );
  assert.ok(!/class[\s_]?I\b/i.test(content.body));
});

test('classification upgrade and downgrade name the new tier', () => {
  const up = formatPushContent(
    makeEvent('material_update', 'classification_upgraded', classified(['class_I'])),
  );
  assert.equal(up.body, "FDA raised this recall's classification — now Critical risk.");
  const down = formatPushContent(
    makeEvent('material_update', 'classification_downgraded', classified(['class_III'])),
  );
  assert.equal(down.body, "FDA lowered this recall's classification — now Minimal risk.");
});

test('directionless class-set change claims no direction', () => {
  const content = formatPushContent(
    makeEvent('material_update', 'classification_changed', classified(['class_I', 'class_II'])),
  );
  assert.equal(content.body, "FDA updated this recall's classifications — now High risk.");
  assert.ok(!/raised|lowered/.test(content.body));
});

test('expansion, correction, health impact, instructions, retraction', () => {
  const cases: [string, string][] = [
    ['expansion_products', 'More products are now included in this recall.'],
    ['expansion_geography', 'More areas are now affected by this recall.'],
    ['correction_broadened', 'This recall now covers more than first announced.'],
    ['health_impact', 'Illnesses or adverse reactions are now reported for this recall.'],
    ['instructions_changed', 'What you should do has changed. Check the latest guidance.'],
  ];
  for (const [ruleId, body] of cases) {
    const content = formatPushContent(makeEvent('material_update', ruleId, makeProjection()));
    assert.equal(content.title, 'Recall updated: Crunchy Trail Mix 16 oz', ruleId);
    assert.equal(content.body, body, ruleId);
  }
  const retraction = formatPushContent(
    makeEvent('material_update', 'retraction', makeProjection({ sourceAgency: 'FSIS' })),
  );
  assert.equal(retraction.title, 'Recall retracted: Crunchy Trail Mix 16 oz');
  assert.equal(retraction.body, 'USDA FSIS retracted this notice.');
});

test('unknown future rule degrades to honest generic copy, never crashes', () => {
  const content = formatPushContent(
    makeEvent('material_update', 'some_future_rule', makeProjection()),
  );
  assert.equal(content.body, 'This recall was updated. Check the latest details.');
  assert.ok(!content.body.includes('some_future_rule'));
});

test('long product names truncate deterministically at a word boundary', () => {
  const long =
    'Extra Long Product Name With Many Descriptive Words That Goes On And On Forever 24 oz';
  const truncated = truncateForPush(long);
  assert.ok(truncated.length <= 60);
  assert.ok(truncated.endsWith('…'));
  assert.equal(truncateForPush('Short Name'), 'Short Name');
});

test('push message payload is small, typed, and secret-free', () => {
  const event = makeEvent('initial', 'new_case', makeProjection());
  const message = buildPushMessage(event, 'ExponentPushToken[abc123]');
  assert.equal(message.to, 'ExponentPushToken[abc123]');
  assert.deepEqual(message.data, {
    kind: 'recall',
    recallCaseId: event.recallCaseId,
    notificationEventId: event.id,
  });
  assert.equal(message.sound, 'default');
  // Expo caps the whole message at 4096 bytes; ours stays far under.
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < 1024);
});

test('P3D: a defectively lowercase product name is headline-cased in push copy only', () => {
  // Synthetic reproduction of the production-observed all-lowercase FDA
  // product description (P3D). Formatting is display-only: the projection
  // passed in stays untouched, no event or delivery exists here.
  const projection = makeProjection({
    productDescription: 'dietary supplements marketed for male sexual enhancement',
    hazardCategory: 'unknown',
    pathogenOrAllergen: null,
  });
  const content = formatPushContent(makeEvent('initial', 'new_recall', projection));
  assert.equal(
    content.title,
    'Recall alert: Dietary Supplements Marketed For Male Sexual Enhancement',
  );
  // Canonical input keeps its source casing.
  assert.equal(
    projection.productDescription,
    'dietary supplements marketed for male sexual enhancement',
  );
});

test('P3D: stylized and already-cased product names are untouched in push copy', () => {
  const stylized = formatPushContent(
    makeEvent(
      'initial',
      'new_recall',
      makeProjection({ productDescription: 'a2 Platinum Premium Infant Formula' }),
    ),
  );
  assert.equal(stylized.title, 'Recall alert: a2 Platinum Premium Infant Formula');
  const normal = formatPushContent(
    makeEvent('initial', 'new_recall', makeProjection({ productDescription: 'Crunchy Trail Mix' })),
  );
  assert.equal(normal.title, 'Recall alert: Crunchy Trail Mix');
});

test('P3D: push un-shouts an ALL-CAPS product name exactly as the app cards do', () => {
  // No recorded notice carries an ALL-CAPS product name at this boundary
  // (frozen by the corpus guard); this synthetic input proves the shared
  // displayHeadlineCase composition keeps push and Home/Detail in agreement
  // if one ever arrives.
  const content = formatPushContent(
    makeEvent(
      'initial',
      'new_recall',
      makeProjection({ productDescription: 'TOP SIRLOIN BUTT, 12 OZ' }),
    ),
  );
  // "OZ" → "Oz" is existing humanizeAllCaps behavior, identical on the cards.
  assert.equal(content.title, 'Recall alert: Top Sirloin Butt, 12 Oz');
});
