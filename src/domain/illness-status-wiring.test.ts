/**
 * The illness-status wiring contract (P2B7K).
 *
 * `illness-status.test.ts` pins what the contract DECIDES. This file pins
 * where that decision is allowed to travel, because the audit's structural
 * finding was not a bad regex — it was four rival readers of the same prose
 * (docs/recall-illness-status.md §1.1), which is how Recall Detail and the
 * notification ledger came to describe 23 active cases in opposite ways.
 *
 * Three properties carry that, and each is asserted below:
 *
 *   1. ONE reader. `domain/illness-status.ts` is the only module that
 *      classifies illness prose. No screen, model, or ingestion path has
 *      patterns of its own.
 *   2. Illnesses only. The notice cannot express an injury, an adverse
 *      reaction, a hospitalization or a death, and nothing downstream can
 *      make it.
 *   3. The notice is informational and in its place — below the brand, above
 *      the official report link, never a control.
 *
 * Asserted against the sources the way recall-presentation-wiring.test.ts
 * does: the screens import React Native and cannot be loaded in this suite.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * Source with comments removed, so a file may DOCUMENT what it refuses to do
 * without tripping the checks below — the same approach
 * recall-presentation-wiring.test.ts takes. Every explanation in this
 * milestone names the rival classifiers it replaced, and those names must not
 * read as the classifiers themselves.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const SRC = join(__dirname, '..');
const DETAIL = readFileSync(join(SRC, 'app', 'recall', '[id].tsx'), 'utf8');
const PRESENTATION = codeOnly(readFileSync(join(SRC, 'lib', 'recall-presentation.ts'), 'utf8'));
const NOTICE = codeOnly(readFileSync(join(SRC, 'components', 'ui', 'illness-notice.tsx'), 'utf8'));
const CONTRACT = readFileSync(join(SRC, 'domain', 'illness-status.ts'), 'utf8');
const PREVIEW = readFileSync(join(SRC, 'app', 'design-preview', 'index.tsx'), 'utf8');

/** Every .ts/.tsx under src/, with its path relative to src/. */
function sources(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'fixtures') walk(full, `${prefix}${entry}/`);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        found.push({ path: `${prefix}${entry}`, source: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SRC, '');
  return found;
}

const shipped = () => sources().filter(({ path }) => !path.endsWith('.test.ts'));

// ── 1. One reader of illness prose ──────────────────────────────────────────

test('only the contract classifies illness prose — no module has patterns of its own', () => {
  const offenders = shipped().filter(
    ({ path, source }) =>
      path !== 'domain/illness-status.ts' &&
      path !== 'domain/illness.ts' &&
      // A regex that reads an illness word out of source prose.
      /\/[^\n/]*\\b\(?:?illness/i.test(source),
  );
  assert.deepEqual(
    offenders.map(({ path }) => path),
    [],
    'a second reader of illness prose is how Detail and the ledger came to disagree',
  );
});

test('the retired presentation-layer illness formatter is gone', () => {
  for (const retired of ['illnessLine', 'COUNTED_ILLNESS', 'isNegatedReport', 'NEGATED_REPORT']) {
    assert.ok(
      !PRESENTATION.includes(retired),
      `${retired} was a rival classifier and must not return`,
    );
  }
});

test('the stored reportsIllness flag is derived from the contract, not a regex', () => {
  const projection = codeOnly(readFileSync(join(SRC, 'domain', 'projection.ts'), 'utf8'));
  assert.match(projection, /statusReportsIllness\(deriveIllnessStatus\(statement\)\)/);
  assert.ok(
    !/\\bno\\b\[\^\.\]\*\\b\(reports\?\|illness/.test(projection),
    'the old one-line regex must not return',
  );
});

test('the material-change rule and push copy still read the canonical flag', () => {
  const materialChange = readFileSync(join(SRC, 'domain', 'material-change.ts'), 'utf8');
  assert.match(materialChange, /prev\.reportsIllness && next\.reportsIllness/);
  // Push stays inactive in this milestone, and gains no injury or
  // adverse-reaction behaviour of its own.
  const pushFormat = readFileSync(join(SRC, 'server', 'push', 'format.ts'), 'utf8');
  assert.ok(!pushFormat.includes('illness-status'), 'push formats copy, it does not classify');
});

// ── 2. Illnesses only ───────────────────────────────────────────────────────

test('the contract carries hospitalizations and deaths, and still no injury or adverse reaction', () => {
  const exported = CONTRACT.slice(CONTRACT.indexOf('export interface IllnessStatus'));
  const shape = exported.slice(0, exported.indexOf('}'));
  // P2B7Q.1 added exactly two harms, each as its own field.
  assert.match(shape, /hospitalizations: HarmFact;/);
  assert.match(shape, /deaths: HarmFact;/);
  // Injuries and adverse reactions still get no status: they are recognised
  // only defensively, inside the classifier, and can never reach a shopper.
  for (const forbidden of ['injur', 'adverse']) {
    assert.ok(
      !shape.toLowerCase().includes(forbidden),
      `IllnessStatus must not carry ${forbidden} — it is not a general harm badge`,
    );
  }
});

test('the notice component can render only what the contract gives it', () => {
  // Its only data input is IllnessNoticeCopy. It reads no projection, no
  // statement, no count — so it cannot acquire a second subject.
  assert.match(NOTICE, /copy: IllnessNoticeCopy/);
  // The words "hospitalization" and "death" are composed by the CONTRACT, not
  // by this component: it renders `copy.lines` and knows nothing about what a
  // line says (P2B7Q.1).
  for (const forbidden of ['injur', 'adverse', 'summaryText', 'statements']) {
    assert.ok(
      !NOTICE.toLowerCase().includes(forbidden.toLowerCase()),
      `the notice must not mention ${forbidden}`,
    );
  }
});

test('no shipped surface renders an injury or adverse-reaction badge', () => {
  const badges = shipped().filter(({ source }) =>
    /(?:Injury|AdverseReaction|Hospitalization|Death)(?:Notice|Badge|Label|Row)\b/.test(source),
  );
  assert.deepEqual(
    badges.map(({ path }) => path),
    [],
  );
});

// ── 3. Placement, and the screen composing nothing ──────────────────────────

test('Detail renders the notice below the brand and above the official source link', () => {
  const identity = DETAIL.slice(
    DETAIL.indexOf('<View style={styles.titleBlock}>'),
    DETAIL.indexOf('{model.productImages ?'),
  );
  const brand = identity.indexOf('{model.brand.text}');
  const notice = identity.indexOf('model.illnessNotice');
  const link = identity.indexOf('model.officialSource.url');
  assert.ok(brand > -1 && notice > -1 && link > -1, 'all three are in the identity area');
  assert.ok(brand < notice, 'the notice follows the brand');
  assert.ok(notice < link, 'the notice precedes the official report link');
});

test('the illness status no longer renders inside What Happened', () => {
  const section = DETAIL.slice(
    DETAIL.indexOf('<Section title="What Happened">'),
    DETAIL.indexOf('<Section\n          title="Where It Was Sold"'),
  );
  assert.ok(!section.includes('illnessNotice'), 'the notice moved out of What Happened');
  assert.ok(!section.includes('illnessLine'), 'the retired sentence must not return');
});

test('Detail composes no illness copy and classifies no prose', () => {
  for (const forbidden of [
    'deriveIllnessStatus',
    'illnessNoticeCopy',
    'narrativeWithoutIllness',
    'statusReportsIllness',
    'No illnesses reported',
    'illnesses reported',
  ]) {
    assert.ok(!DETAIL.includes(forbidden), `Detail must not contain ${forbidden}`);
  }
});

test('the notice is informational — never a control', () => {
  assert.ok(!NOTICE.includes('Pressable'), 'the notice is not pressable');
  assert.ok(!NOTICE.includes('onPress'), 'the notice has no press handler');
  assert.ok(!NOTICE.includes('accessibilityRole="button"'));
  assert.ok(!NOTICE.includes('accessibilityHint'), 'nothing to hint at — it does nothing');
  assert.match(NOTICE, /accessibilityRole="text"/);
  // ONE accessible element PER BOX, each speaking that box's own contract
  // sentence (P2B7V). The glyph stays decorative, so a reader hears "12
  // illnesses reported" and never "warning, image".
  assert.match(NOTICE, /accessibilityLabel=\{notice\.spoken\}/);
  assert.match(NOTICE, /accessible\b/);
  assert.ok(!NOTICE.includes('accessibilityLabel={copy.'), 'the group speaks over its boxes');
});

test('one fact is one box: the boxes are never recombined into a shared container', () => {
  // P2B7V. The defect this replaces is precise: three facts shared one
  // outlined container under one glyph, so the second and third sat indented
  // with no icon of their own and one treatment had to carry three
  // severities. The component therefore maps the contract's boxes and renders
  // each COMPLETE — its own border, its own glyph, its own treatment, its own
  // accessible element.
  assert.match(NOTICE, /copy\.notices\.map\(/);
  // Exactly one bordered box definition, used per notice — not one wrapper
  // border with lines inside it.
  assert.equal((NOTICE.match(/borderWidth: 1/g) ?? []).length, 1);
  // The glyph is rendered inside the per-notice box, keyed off that box's own
  // tone: a single shared glyph above a list of lines cannot come back.
  assert.match(NOTICE, /GLYPH\[notice\.tone\]/);
  assert.match(NOTICE, /harmNoticePalette\[notice\.tone\]/);
  // No stacked lines inside one box: nothing maps over a list of sentences.
  assert.ok(!/\.lines\.map\(/.test(NOTICE), 'the boxes were recombined into stacked lines');
  // And no notice is indented relative to another — the stack aligns them all
  // to one left edge, and no box carries a leading inset of its own.
  assert.match(NOTICE, /alignItems: 'flex-start'/);
  assert.ok(!/marginLeft|paddingLeft/.test(NOTICE), 'a box carries unexplained left whitespace');
});

test('no harm box has a fixed height — every one grows with Dynamic Type', () => {
  // The only `height` in the file is the glyph box, which is deliberately one
  // caption LINE tall so the icon stays centred on the first line of text at
  // any reader type size. A height on the box itself, or a minHeight, would
  // clip a wrapped sentence at accessibility sizes.
  const heights = NOTICE.match(/\bheight: [^,\n]+/g) ?? [];
  assert.deepEqual(heights, ['height: typography.caption.lineHeight']);
  assert.ok(!NOTICE.includes('minHeight'), 'a harm box has a minimum height');
  assert.ok(!NOTICE.includes('maxHeight'));
  assert.ok(!NOTICE.includes('numberOfLines'), 'a harm sentence can be truncated');
});

test('the notice is visually distinct from the Risk Label and the Affects You callout', () => {
  // Sentence-case caption type, not the Risk Label's uppercase mono `label`.
  assert.match(NOTICE, /variant="caption"/);
  assert.ok(!NOTICE.includes('variant="label"'), 'that is the Risk Label’s type');
  assert.ok(!NOTICE.includes('riskPalette'), 'illness status is not a risk level');
  assert.ok(!NOTICE.includes('relevancePalette'), 'illness status is not personal relevance');
  // Auto-width: it is not a full-width band like the Affects You callout.
  assert.match(NOTICE, /alignSelf: 'flex-start'/);
});

// ── The preview shows the shipped component, in the corrected scope ─────────

test('the preview draws the production component, not an alternative of its own', () => {
  assert.match(PREVIEW, /import \{ IllnessNotice \} from '@\/components\/ui\/illness-notice';/);
  for (const retired of ['IllnessRowA', 'IllnessPanelB', 'IllnessBadgeC', 'IllnessTreatmentView']) {
    assert.ok(!PREVIEW.includes(retired), `the P2B7J alternative ${retired} must be gone`);
  }
});

test('the preview covers every production-relevant state, including the no-notice ones', () => {
  for (const state of [
    '1 illness',
    'multiple illnesses',
    'qualified illness count',
    'illnesses without a count',
    'explicit no illnesses',
    'unknown — no notice renders',
    'injury statement',
    'adverse-reaction statement',
    'mixed figure',
    // P2B7V — every harm COMBINATION the live corpus contains, so the box
    // ordering, the three treatments and the singular/plural grammar are all
    // visible in the gallery rather than only in a test.
    'illnesses + hospitalizations + deaths',
    'illnesses + 1 death',
    'illnesses + plural deaths',
    'illnesses + hospitalizations, no death',
    'hospitalization ALONE',
    'hospitalizations without a count',
  ]) {
    assert.ok(PREVIEW.includes(state), `the preview covers: ${state}`);
  }
  // The retired claim must not come back: hospitalizations and deaths are
  // SHOWN here, not "retained in What Happened".
  assert.ok(
    !PREVIEW.includes('never in the notice'),
    'the preview still claims a harm is kept out of the notice',
  );
});
