/**
 * The approved replacement recall card (2026-10-14): its one spoken label
 * and its stacking rule, driven against the real modules.
 *
 * The card is one VoiceOver element whose label is built here, and the photo
 * inside it is decorative — so the product name must be spoken exactly once
 * (the old card spoke it twice: once in the grouped text, once as the photo's
 * description). Every part comes from the model; nothing is composed here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  recallCardFooterStacks,
  recallCardGeometry,
  recallCardStacks,
} from '@/constants/recall-card-design';
import { recallCardAccessibilityLabel } from '@/lib/recall-card-accessibility';
import type { HomeCardModel } from '@/lib/recall-presentation';

/** Structural fixture only — not a recall; no text here is shown in the app. */
function model(overrides: Partial<HomeCardModel> = {}): HomeCardModel {
  return {
    id: 'fixture-1',
    noticeLabel: null,
    risk: {
      tier: 'pending',
      badgeLabel: 'PENDING',
      headlineLabel: 'PENDING',
      accessibilityLabel: 'Risk level: Pending',
      note: null,
      official: null,
    },
    activity: { kind: 'announced', dateIso: '2026-10-09', text: 'Announced Oct 9' },
    affectsYou: false,
    productName: 'Fixture Product Name',
    brand: { text: 'Fixture Brand', brands: ['Fixture Brand'], usedBrand: true },
    reasonLine: 'Fixture reason',
    categoryLabel: 'Fixture Category',
    categoryId: 'produce',
    heroImageUrl: 'https://example.invalid/fixture.jpg',
    locationSummary: 'MA, CA +48',
    ...overrides,
  } as HomeCardModel;
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

test('the card speaks every model part once, in reading order, with the title exactly once', () => {
  const label = recallCardAccessibilityLabel(model({ affectsYou: true }), false);
  assert.equal(
    label,
    'Risk level: Pending. Announced Oct 9. Affects you. Fixture Product Name. Fixture Brand. ' +
      'Fixture Category. Fixture reason. MA, CA +48. Not saved',
  );
  assert.equal(count(label, 'Fixture Product Name'), 1);
});

test('a suppressed risk label speaks no risk, and a Public Health Alert names itself', () => {
  const label = recallCardAccessibilityLabel(
    model({
      noticeLabel: 'Public Health Alert',
      risk: {
        tier: 'unknown',
        badgeLabel: null,
        headlineLabel: null,
        accessibilityLabel: 'Risk level: Unknown',
        note: null,
        official: null,
      },
    }),
    true,
  );
  assert.ok(!label.includes('Risk level'), 'a suppressed risk label was spoken');
  assert.ok(label.startsWith('Public Health Alert. Announced Oct 9.'));
  assert.ok(label.endsWith('. Saved'));
});

test('absent parts leave no gap, and relevance is spoken only when the verdict says so', () => {
  const label = recallCardAccessibilityLabel(
    model({ reasonLine: null, categoryLabel: null, categoryId: null, heroImageUrl: null }),
    false,
  );
  assert.ok(!label.includes('. .'));
  assert.ok(!label.includes('Affects you'));
  assert.ok(!label.includes('Fixture Category'));
  assert.equal(count(label, 'Fixture Product Name'), 1);
});

test('the card stacks at accessibility sizes and only when the title column would be too narrow', () => {
  const { photoSide, columnGap, minimumIdentityWidth, stackFontScale } = recallCardGeometry;
  const narrowest = photoSide + columnGap + minimumIdentityWidth;
  // Accessibility text always stacks, whatever the width.
  assert.equal(recallCardStacks(400, stackFontScale), true);
  assert.equal(recallCardStacks(0, 3.571), true);
  // At default text the photo stays beside the title down to the 140pt rule.
  assert.equal(recallCardStacks(narrowest, 1), false);
  assert.equal(recallCardStacks(narrowest - 1, 1), true);
  // A 320pt phone (card content ≈ 266pt) and a 402pt phone keep the photo beside.
  assert.equal(recallCardStacks(266, 1), false);
  assert.equal(recallCardStacks(348, 1.35), false);
  // An unmeasured row keeps the beside layout until it has a width.
  assert.equal(recallCardStacks(0, 1), false);
});

test('the location moves below the reason from 1.15x text, before the rest of the card stacks', () => {
  // iOS text sizes: Large 1.0, XL ≈ 1.12, XXL ≈ 1.24, XXXL ≈ 1.35, AX1+ ≥ 1.5.
  assert.equal(recallCardGeometry.footerStackFontScale, 1.15);
  assert.equal(recallCardFooterStacks(false, 1), false);
  assert.equal(recallCardFooterStacks(false, 1.12), false);
  assert.equal(recallCardFooterStacks(false, 1.15), true);
  assert.equal(recallCardFooterStacks(false, 1.24), true);
  // Whenever the card itself stacks, the footer stacks too.
  assert.equal(recallCardFooterStacks(true, 1), true);
  // The reason is 15/20; the location beside it is capped at 132pt, not fixed.
  assert.equal(recallCardGeometry.reasonFontSize, 15);
  assert.equal(recallCardGeometry.reasonLineHeight, 20);
  assert.equal(recallCardGeometry.locationWidth, 132);
});
