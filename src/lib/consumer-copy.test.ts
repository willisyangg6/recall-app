/**
 * The consumer-copy rules (P2B6C): the whole-app audit's approved voice,
 * terminology and boundaries, pinned so they cannot drift back.
 *
 *  1. No em dash in Lotly-authored production copy: the shared copy modules,
 *     the trust documents, the reset copy, the questionnaire and Feed states,
 *     the push bodies, hints and plain-text renderers.
 *  2. Official or sourced content is exempt: the agencies' page titles stay
 *     as the agencies spell them, and the source-text normalizer keeps its
 *     dash vocabulary for what the notices themselves contain.
 *  3. The development-only Design Preview keeps its caption convention.
 *  4. Consumer copy says `state` and `store`, never `jurisdiction` or
 *     `retailer` — with ONE founder-approved exception, Detail's
 *     `Retailers:` label (P2B7O), which is exempt by exact string and
 *     nowhere else.
 *  5. `Recall` is never the product; the product is `Lotly`.
 *  6. `Affects me`, `All recalls`, `recall alerts`, `state` and `store`
 *     follow their approved rules; `AFFECTS YOU` lives on the label alone.
 *  7. A raw `Error.message` or HTTP status can never reach the four consumer
 *     failure surfaces (Feed, Saved, Detail, Notifications).
 *  8. The documents no longer claim that Detail renders classification
 *     explanations, or that the app shows a case timeline.
 *  9. Shopper-report explanations are conditional while the gate is off.
 * 10. The push bodies carry the approved sentences, on the same trigger facts.
 * 11. Frozen and protected copy is still present, word for word.
 * 12. The Privacy Policy and Support destinations stay tracked as unresolved
 *     launch blockers, never fabricated.
 *
 * Source-text pins read the files with comments removed, so a module may
 * still document what it does not do.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { documentBySlug, TRUST_DOCUMENTS } from '@/content';
import { documentPlainText, riskLevelText } from '@/content/document-model';
import { DETAIL_ERROR_FALLBACK, EXTERNAL_LINK_HINT } from '@/lib/detail-copy';
import {
  FEED_EMPTY_CORPUS,
  FEED_EMPTY_PERSONALIZED,
  FEED_LOAD_FAILURE,
  OLDER_NOTICES_EXPLANATION,
  PERSONALIZE_CTA,
} from '@/lib/feed-copy';
import {
  RESET_ACTION_LABEL,
  RESET_CONFIRM_BODY,
  RESET_FAILURE_MESSAGE,
  RESET_SUPPORTING_COPY,
} from '@/lib/installation-reset';
import {
  GENERIC_FAILURE,
  NOTIFICATIONS_FOOTNOTE,
  NOTIFICATIONS_INTRO,
  STATUS_ON,
  UNSUPPORTED_STATE as NOTIFICATIONS_UNSUPPORTED,
} from '@/lib/notifications-screen';
import {
  FAILED_STATE,
  PERSONALIZATION_INTRO,
  SAVE_STATUS,
  STORE_SECTION_HELPER,
} from '@/lib/personalization-screen';
import { SAVED_ACCESSIBILITY_LABEL, SAVED_UNAVAILABLE } from '@/lib/saved-recalls';
import {
  DECLINED_TITLE,
  PRIVACY_LINK_HINT,
  PRIVACY_LINK_LABEL,
  REMOVE_FAILURE,
  REPORT_ADD_ACTION,
  REPORT_EDIT_ACTION,
  REPORT_ENTRY_QUESTION,
  REPORT_PAUSED_MESSAGE,
  STATE_CONFIRM_HELP,
  SUBMISSION_DISCLOSURE,
  SUBMIT_FAILURE,
  SUCCESS_BODY,
  SUCCESS_TITLE,
} from '@/lib/shopper-report-presentation';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');
const readDoc = (name: string) => readFileSync(join(ROOT, 'docs', name), 'utf8');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Every quoted string in the code (not the comments) of a source file. */
function literals(source: string): string[] {
  return codeOnly(source).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
}

/** JSX text between tags, for the words a screen types directly. */
function jsxText(source: string): string[] {
  return (codeOnly(source).match(/>[^<>{}]*[A-Za-z]{2,}[^<>{}]*</g) ?? []).map((t) =>
    t.slice(1, -1).trim(),
  );
}

/** The modules whose strings are Lotly's own voice: every authored sentence lives here or in a screen. */
const COPY_MODULES: Record<string, string> = {
  'feed-copy': read('lib', 'feed-copy.ts'),
  'detail-copy': read('lib', 'detail-copy.ts'),
  'saved-recalls': read('lib', 'saved-recalls.ts'),
  'shopper-report-presentation': read('lib', 'shopper-report-presentation.ts'),
  'personalization-copy': read('lib', 'personalization-copy.ts'),
  'personalization-screen': read('lib', 'personalization-screen.ts'),
  'notifications-screen': read('lib', 'notifications-screen.ts'),
  'profile-hub': read('lib', 'profile-hub.ts'),
  'document-screen': read('lib', 'document-screen.ts'),
  'installation-reset': read('lib', 'installation-reset.ts'),
  'installation-reset-runner.web': read('lib', 'installation-reset-runner.web.ts'),
  'risk-display': read('lib', 'risk-display.ts'),
  'document-model': read('content', 'document-model.ts'),
  'hazard-guides': read('content', 'hazard-guides.ts'),
  'push-format': read('server', 'push', 'format.ts'),
};

const DOCUMENT_SOURCES: Record<string, string> = Object.fromEntries(
  TRUST_DOCUMENTS.map((doc) => [doc.slug, read('content', `${doc.slug}.ts`)]),
);

/** The screens and components that type consumer words directly. */
const SCREENS: Record<string, string> = {
  feed: read('app', '(tabs)', 'index.tsx'),
  saved: read('app', '(tabs)', 'saved.tsx'),
  profile: read('app', '(tabs)', 'profile.tsx'),
  'tab layout': read('app', '(tabs)', '_layout.tsx'),
  'root layout': read('app', '_layout.tsx'),
  detail: read('app', 'recall', '[id].tsx'),
  report: read('app', 'report', '[id].tsx'),
  document: read('app', 'document', '[slug].tsx'),
  notifications: read('app', 'settings', 'notifications.tsx'),
  personalization: read('app', 'settings', 'personalization.tsx'),
  card: read('components', 'recall-card.tsx'),
  'save button': read('components', 'save-recall-button.tsx'),
  'community block': read('components', 'community-reports-section.tsx'),
  questionnaire: read('components', 'report-questionnaire.tsx'),
  'reset section': read('components', 'installation-reset-section.tsx'),
  'state message': read('components', 'state-message.tsx'),
  'document view': read('components', 'document', 'document-view.tsx'),
  'document blocks': read('components', 'document', 'document-blocks.tsx'),
  'personalization form': read('components', 'settings', 'personalization-form.tsx'),
  'notifications panel': read('components', 'settings', 'notifications-panel.tsx'),
  'selector sheet': read('components', 'settings', 'selector-sheet.tsx'),
  'search bar': read('components', 'ui', 'search-bar.tsx'),
  'relevance label': read('components', 'ui', 'relevance-label.tsx'),
};

const USE_FEED = read('hooks', 'use-feed.ts');
const HUB = read('app', 'design-preview', 'index.tsx');
const PREVIEW_LIB = read('lib', 'design-preview.ts');

// ── 1–3. Em dashes ──────────────────────────────────────────────────────────

test('no authored production copy contains an em dash', () => {
  for (const [name, source] of Object.entries({ ...COPY_MODULES, ...DOCUMENT_SOURCES })) {
    for (const literal of literals(source)) {
      assert.ok(!literal.includes('—'), `${name}: ${literal}`);
    }
  }
  for (const [name, source] of Object.entries(SCREENS)) {
    for (const literal of literals(source))
      assert.ok(!literal.includes('—'), `${name}: ${literal}`);
    for (const text of jsxText(source)) assert.ok(!text.includes('—'), `${name}: ${text}`);
  }
  // The rendered documents, sentence by sentence, including the plain-text
  // renderer's own joins.
  for (const doc of TRUST_DOCUMENTS) {
    assert.ok(!documentPlainText(doc).includes('—'), `${doc.slug} renders an em dash`);
  }
  const risk = documentBySlug('risk-levels')!;
  for (const section of risk.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'risk-levels') {
        for (const item of block.items) assert.ok(!riskLevelText(item).includes('—'));
      }
    }
  }
});

test('official titles and the source-text normalizer are exempt, and untouched', () => {
  const sources = documentPlainText(documentBySlug('sources-methodology')!);
  // The agencies' own page titles, after Lotly's colon prefix.
  assert.match(sources, /FDA: Recalls, Market Withdrawals, & Safety Alerts/);
  assert.match(sources, /USDA FSIS: Recalls & Public Health Alerts/);
  assert.match(sources, /“Recalls, Market Withdrawals, & Safety Alerts” listing/);
  // Sourced notice text may contain any dash; the normalizer that cleans it
  // keeps its vocabulary (the rule is about what Lotly writes, not what the
  // agencies publish).
  const text = read('domain', 'text.ts');
  assert.match(text, /mdash: '—'/);
  assert.match(text, /ndash: '–'/);
  // Typographic ranges in identifiers ("March 3–5") are en dashes, not em
  // dashes; the em dashes that file holds are inside the character classes
  // that parse source text, never in what it renders.
  const identifiers = codeOnly(read('lib', 'identifiers.ts'));
  assert.ok(identifiers.includes('}–${formatDay(end)}`'));
  assert.ok(identifiers.includes('}–${formatMonthYear(endMonth)}`'));
});

test('the development-only Design Preview keeps its caption convention and is not a product surface', () => {
  // `Label — real:` / `Label — simulated:` is the hub's own labelling
  // convention (document-design.test.ts pins the counts); it is exempt
  // because it ships in no release bundle.
  assert.ok(HUB.includes('— real:'));
  assert.ok(HUB.includes('— simulated:'));
  assert.ok(PREVIEW_LIB.includes('—'));
  assert.ok(read('app', '(tabs)', 'profile.tsx').includes('{__DEV__ ? ('));
});

// ── 4–6. Terminology ────────────────────────────────────────────────────────

/** A quoted string that is a sentence or label, not an identifier or key. */
const isProse = (literal: string) => /\s/.test(literal.slice(1, -1));

/**
 * The ONE approved use of the word "retailer" in consumer copy (P2B7O,
 * founder override). Detail's Where It Was Sold labels the retailers a notice
 * named with exactly this string.
 *
 * The rule below is otherwise unchanged: everywhere else the app says
 * "store". This is an exception granted for one label, not a relaxation —
 * "retailer" is the right consumer concept HERE because it is the word
 * personalization already uses, so a shopper who chose their Retailers in
 * preferences meets the same word on a recall. The exemption is an exact
 * string match, so a new "retailers" sentence anywhere still fails.
 */
const APPROVED_RETAILER_LABEL = 'Retailers:';

test('consumer copy says state and store, never jurisdiction or retailer', () => {
  const sources = { ...COPY_MODULES, ...DOCUMENT_SOURCES, ...SCREENS };
  for (const [name, source] of Object.entries(sources)) {
    for (const literal of literals(source).filter(isProse)) {
      assert.doesNotMatch(literal, /\bjurisdictions?\b/i, `${name}: ${literal}`);
      assert.doesNotMatch(literal, /\bretailers?\b/i, `${name}: ${literal}`);
    }
    for (const text of jsxText(source)) {
      assert.doesNotMatch(text, /\bjurisdictions?\b/i, `${name}: ${text}`);
      if (text === APPROVED_RETAILER_LABEL) continue;
      assert.doesNotMatch(text, /\bretailers?\b/i, `${name}: ${text}`);
    }
  }
  // The exemption is spent on exactly one label, on exactly one screen.
  const usages = Object.entries(sources).flatMap(([name, source]) =>
    jsxText(source)
      .filter((text) => text === APPROVED_RETAILER_LABEL)
      .map(() => name),
  );
  assert.deepEqual(usages, ['detail'], 'the approved retailer label moved or multiplied');
  for (const doc of TRUST_DOCUMENTS) {
    assert.doesNotMatch(documentPlainText(doc), /\b(jurisdictions?|retailers?)\b/i, doc.slug);
  }
  // The spoken reveal on Detail names states, in the presentation contract.
  assert.ok(
    codeOnly(read('lib', 'recall-presentation.ts')).includes(
      "disclosureControl(states.length, 'states')",
    ),
  );
});

test('Recall is never the product; the product is Lotly', () => {
  const product = [
    /\bRecall(’s|'s)\b/,
    /\b(in|by|to|from|about|within|Open|Personalize) Recall\b/,
    /\bRecall (is|does|never|cannot|checks|shows|works|renders|detects|re-collects|may|also|processes|reconciles|collects|organizes|reports|extracted|mobile app)\b/,
    /Personalize Lotly/,
  ];
  const sources = { ...COPY_MODULES, ...DOCUMENT_SOURCES, ...SCREENS };
  for (const [name, source] of Object.entries(sources)) {
    for (const literal of literals(source).filter(isProse)) {
      for (const pattern of product) assert.doesNotMatch(literal, pattern, `${name}: ${literal}`);
    }
    for (const text of jsxText(source)) {
      for (const pattern of product) assert.doesNotMatch(text, pattern, `${name}: ${text}`);
    }
  }
  assert.equal(PERSONALIZE_CTA.title, 'Set up personalization');
  assert.equal(
    PERSONALIZE_CTA.body,
    'Choose your state, allergens, and stores to see matching recalls in Affects me.',
  );
  assert.equal(SAVED_UNAVAILABLE.title, 'Available in the app');
  assert.match(SAVED_UNAVAILABLE.body, /Open Lotly on your phone/);
});

test('Affects me, All recalls, recall alerts and AFFECTS YOU follow their rules', () => {
  const documents = TRUST_DOCUMENTS.map((doc) => documentPlainText(doc)).join('\n');
  // `Affects me` in prose and section headings; title case only in the one
  // document title.
  // document title (and the links that name that document).
  const outsideTitle = documents.replace(/How Affects Me Works/g, '');
  assert.doesNotMatch(
    outsideTitle,
    /Affects Me/,
    'Affects Me (title case) outside the document title',
  );
  assert.equal(documentBySlug('how-affects-me-works')!.title, 'How Affects Me Works');
  assert.match(documents, /Affects me is a shortlist/);
  // `All recalls` in prose; the chip alone says `All`.
  assert.doesNotMatch(documents, /All Recalls/);
  assert.match(documents, /All recalls always remains available/);
  assert.match(FEED_EMPTY_PERSONALIZED.body, /Switch to All to see every current recall/);
  assert.match(SCREENS.feed, /Filtering All recalls · /);
  for (const module of Object.values(COPY_MODULES)) {
    for (const literal of literals(module).filter(isProse)) {
      assert.doesNotMatch(literal, /Affects Me|All Recalls/, literal);
    }
  }
  // `AFFECTS YOU` is the relevance label's word alone; nothing else shouts it.
  assert.ok(SCREENS['relevance label'].includes("'AFFECTS YOU'"));
  for (const [name, source] of Object.entries({ ...COPY_MODULES, ...DOCUMENT_SOURCES })) {
    assert.ok(!codeOnly(source).includes('AFFECTS YOU'), name);
  }
  // `recall alerts` is the feature; `notifications` is the permission and the screen.
  assert.equal(
    NOTIFICATIONS_UNSUPPORTED.body,
    'Recall alerts are available in the Lotly mobile app.',
  );
  assert.doesNotMatch(documents, /Push alerts/);
  assert.match(documents, /Recall alerts are decided by the same relevance evaluation/);
  assert.match(NOTIFICATIONS_FOOTNOTE, /recall alerts/);
  assert.match(STATUS_ON, /^Recall alerts are on for this device\.$/);
  assert.match(PERSONALIZATION_INTRO, /Affects me and your recall alerts/);
  // `state` and `store`, in the two helpers that define them.
  assert.match(STORE_SECTION_HELPER, /Choose stores you shop at/);
  assert.equal(STATE_CONFIRM_HELP, 'Reports can only name states listed in the official notice.');
});

// ── 7. Failure boundaries ───────────────────────────────────────────────────

test('a raw error message or HTTP status can never reach the four consumer failure surfaces', () => {
  const consumer = [FEED_LOAD_FAILURE, DETAIL_ERROR_FALLBACK, GENERIC_FAILURE];
  for (const sentence of consumer) {
    assert.match(sentence, /^Lotly couldn’t /);
    assert.doesNotMatch(sentence, /HTTP|\d|EAS|eas init|Error|backend|stall/i);
  }
  // Feed and Saved: the hook is the only writer of the failure body, and it
  // writes the one sentence; the cause goes to the development console.
  const hook = codeOnly(USE_FEED);
  assert.ok(hook.includes("import { FEED_LOAD_FAILURE } from '@/lib/feed-copy';"));
  // Written inline into the one error state the hook can produce. (It was
  // bound to a local until P2B7S removed the stale-notice path that also
  // used it; the guarantee is unchanged — one approved sentence, no cause.)
  assert.ok(hook.includes("{ status: 'error', message: FEED_LOAD_FAILURE }"));
  assert.ok(!hook.includes('error.message'), 'the feed hook exposes error.message');
  assert.ok(hook.includes("if (__DEV__) console.warn('Feed sync failed', error);"));
  assert.ok(SCREENS.saved.includes('body={state.message}'));
  assert.ok(!codeOnly(SCREENS.saved).includes('error.message'));
  assert.ok(!codeOnly(SCREENS.feed).includes('error.message'));
  // Detail.
  const detail = codeOnly(SCREENS.detail);
  assert.ok(detail.includes("setState({ status: 'error', message: DETAIL_ERROR_FALLBACK });"));
  assert.ok(!detail.includes('error.message'), 'Detail exposes error.message');
  // Notifications.
  const notificationsLib = codeOnly(COPY_MODULES['notifications-screen']);
  assert.ok(notificationsLib.includes('return GENERIC_FAILURE;'));
  assert.ok(!notificationsLib.includes('error.message'), 'failureMessage exposes error.message');
  assert.ok(!codeOnly(SCREENS.notifications).includes('error.message'));
  // The empty corpus is a consumer state, not an operator instruction.
  assert.deepEqual(FEED_EMPTY_CORPUS, {
    title: 'No recalls loaded yet',
    body: 'Pull down to refresh.',
  });
  assert.doesNotMatch(FEED_EMPTY_CORPUS.body, /ingest|backend|FSIS|FDA/);
});

// ── 8–9. The documents describe the shipped product ────────────────────────

test('the documents no longer claim that Detail explains classifications or that a timeline is shown', () => {
  for (const doc of TRUST_DOCUMENTS) {
    const text = documentPlainText(doc);
    assert.doesNotMatch(text, /detail screen/i, `${doc.slug} describes the detail screen`);
    assert.doesNotMatch(text, /timeline/i, `${doc.slug} describes a timeline`);
    assert.doesNotMatch(text, /\b(simply|honest|honestly)\b/i, `${doc.slug}: ${doc.slug}`);
  }
  const risk = documentPlainText(documentBySlug('risk-levels')!);
  assert.match(
    risk,
    /preserved exactly as assigned and available through each recall’s official notice link/,
  );
  assert.match(risk, /the official notice link on each recall leads to it/);
  assert.match(risk, /its Updated date reflects the change/);
  const corrections = documentPlainText(documentBySlug('corrections-policy')!);
  assert.match(corrections, /appears as the Update line and the Updated date on the recall/);
  const sources = documentPlainText(documentBySlug('sources-methodology')!);
  assert.match(sources, /records it as a material change to the case/);
  assert.match(sources, /FSIS Public Health Alerts carry their own Public Health Alert label/);
  // Detail itself still renders the label alone (the founder decision the
  // documents now describe), and the notice link.
  const detail = codeOnly(SCREENS.detail);
  assert.ok(!detail.includes('risk.official'));
  assert.ok(!detail.includes('risk.note'));
  assert.ok(detail.includes('model.officialSource.url'));
});

test('the interim launch-placeholder corrections are applied, and nothing is invented', () => {
  const privacy = documentPlainText(documentBySlug('privacy-data-controls')!);
  assert.doesNotMatch(privacy, /being prepared|formal privacy policy|verified current behavior/i);
  assert.match(
    privacy,
    /This page explains, in plain language, what the current app stores and sends\./,
  );
  const corrections = documentPlainText(documentBySlug('corrections-policy')!);
  assert.doesNotMatch(corrections, /will arrive|support contact/i);
  assert.match(
    corrections,
    /A way to report a suspected data problem from inside the app is not available yet\. The official source link on every notice is the authoritative reference for that recall\./,
  );
  for (const doc of TRUST_DOCUMENTS) {
    const text = documentPlainText(doc);
    assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]{2,}/i, `${doc.slug} invents an email`);
    assert.doesNotMatch(
      text,
      /https?:\/\/(?!www\.fda\.gov|open\.fda\.gov|www\.fsis\.usda\.gov)/,
      doc.slug,
    );
    assert.doesNotMatch(
      text,
      /effective date|Terms of (Service|Use)|support@|contact us/i,
      doc.slug,
    );
  }
});

test('shopper-report explanations are conditional while the gate is off, and still say what is stored', () => {
  const privacy = documentPlainText(documentBySlug('privacy-data-controls')!);
  assert.match(
    privacy,
    /When community shopper reports are available for a recall, the recall invites you/,
  );
  assert.match(privacy, /Not every recall offers them\./);
  assert.match(
    privacy,
    /When community shopper reports are available for a recall, any report you choose to submit/,
  );
  assert.doesNotMatch(privacy, /Some recalls invite you/);
  // What a report stores, and how it is deleted, stays exact.
  assert.match(privacy, /A report saves four things/);
  assert.match(privacy, /random installation identifier that makes the report yours to change/);
  assert.match(
    privacy,
    /Removing it deletes it, and it stops counting toward the total immediately/,
  );
  assert.match(privacy, /kept for up to 12 months/);
  assert.match(
    privacy,
    new RegExp(`“${RESET_ACTION_LABEL}” below also deletes every shopper report`),
  );
  const affects = documentPlainText(documentBySlug('how-affects-me-works')!);
  assert.match(
    affects,
    /community shopper report you choose to submit, when reports are available for a recall/,
  );
  assert.match(affects, /it never affects Affects me/);
});

// ── 10. Push bodies ─────────────────────────────────────────────────────────

test('the push bodies carry the approved sentences on the same trigger facts', () => {
  const format = codeOnly(COPY_MODULES['push-format']);
  for (const sentence of [
    '`${agency} raised this recall’s classification. Its risk level is now ${tierWord}.`',
    '`${agency} lowered this recall’s classification. Its risk level is now ${tierWord}.`',
    '`${agency} updated this recall’s classifications. Its risk level is now ${tierWord}.`',
    '`${agency} assigned affected products different classifications. The overall risk level is ${tierWord}.`',
  ]) {
    assert.ok(format.includes(sentence), sentence);
  }
  // The triggering facts are unchanged: the rule ids, the rated gate and the
  // mixed-set check decide which sentence, exactly as before.
  for (const fact of [
    "case 'classification_assigned':",
    "case 'classification_upgraded':",
    "case 'classification_downgraded':",
    "case 'classification_changed':",
    "const rated = tier !== 'pending' && tier !== 'unknown';",
    "classificationStatus(projection.classification) === 'mixed'",
    "'The official classification of this recall changed.'",
  ]) {
    assert.ok(format.includes(fact), fact);
  }
});

// ── 11. Frozen and protected copy ───────────────────────────────────────────

test('frozen and protected copy is still present, word for word', () => {
  assert.equal(REPORT_ENTRY_QUESTION, 'Did you find this product here?');
  assert.equal(REPORT_ADD_ACTION, 'Add your report');
  assert.equal(REPORT_EDIT_ACTION, 'Edit your report');
  assert.equal(
    SUBMISSION_DISCLOSURE,
    'Your anonymous report contributes to community totals and does not change official recall information.',
  );
  assert.equal(PRIVACY_LINK_LABEL, 'Learn more.');
  assert.equal(SUCCESS_TITLE, 'Thanks for contributing!');
  assert.equal(SUCCESS_BODY, 'Your report helps other shoppers make safer decisions.');
  assert.equal(RESET_ACTION_LABEL, 'Reset app and delete my data');
  assert.match(RESET_CONFIRM_BODY, /saved recalls/);
  assert.match(RESET_SUPPORTING_COPY, /Lotly’s server/);
  assert.match(RESET_SUPPORTING_COPY, /along with your saved recalls/);
  assert.match(RESET_SUPPORTING_COPY, /Recall information itself is public and is not affected\./);
  assert.equal(STATUS_ON, 'Recall alerts are on for this device.');
  assert.equal(
    NOTIFICATIONS_INTRO,
    'Get alerts when a relevant recall is announced or changes. Lotly does not send marketing notifications.',
  );
  assert.ok(SCREENS.feed.includes('placeholder="Search product, company, brand, or code"'));
  assert.ok(
    codeOnly(read('lib', 'recall-presentation.ts')).includes("'Warning: This recall affects you.'"),
  );
  assert.ok(SCREENS.detail.includes('title="What Happened"'));
  // P2B7H: the eyebrow keeps its caption treatment, cased as written.
  assert.ok(SCREENS.detail.includes('Common symptoms'));
  assert.ok(!SCREENS.detail.includes('COMMON SYMPTOMS'));
  // The approved P2B6C sentences themselves.
  assert.equal(DECLINED_TITLE, 'Thanks. Nothing was submitted.');
  assert.equal(SUBMIT_FAILURE, 'Your report could not be sent. Nothing was saved. Try again.');
  assert.equal(REMOVE_FAILURE, 'Your report could not be removed. Nothing was changed. Try again.');
  assert.equal(
    REPORT_PAUSED_MESSAGE,
    'Shopper reports are temporarily unavailable, so this report can’t be edited right now. You can still remove it.',
  );
  assert.equal(
    OLDER_NOTICES_EXPLANATION,
    'Still listed as active by the issuing agency, with no announcement or update in the last 60 days.',
  );
  assert.equal(
    RESET_FAILURE_MESSAGE,
    'Could not delete your data. Nothing was changed. Check your connection and try again.',
  );
  assert.equal(
    FAILED_STATE.body,
    'Nothing was changed. Go back and open this screen again to retry.',
  );
  assert.equal(
    SAVE_STATUS.local_only,
    'Saved on this device. It will sync the next time you open Lotly online.',
  );
  // P2B7H: the save control is icon-only, so its spoken name is the only
  // wording it has and names the ACTION rather than the condition.
  assert.equal(SAVED_ACCESSIBILITY_LABEL, 'Remove from saved recalls');
});

// ── Accessibility copy ──────────────────────────────────────────────────────

test('authored hints end with a full stop, and the Feed’s Edit action names what it edits', () => {
  for (const hint of [
    EXTERNAL_LINK_HINT,
    PRIVACY_LINK_HINT,
    'Opens the recall details.',
    'Narrows the recalls below as you type.',
  ]) {
    assert.match(hint, /\.$/, hint);
  }
  const hintLiterals = /accessibilityHint="([^"]+)"/g;
  for (const [name, source] of Object.entries(SCREENS)) {
    for (const match of codeOnly(source).matchAll(hintLiterals)) {
      assert.match(match[1], /\.$/, `${name}: ${match[1]}`);
    }
  }
  for (const [name, source] of Object.entries(COPY_MODULES)) {
    for (const match of codeOnly(source).matchAll(/_HINT = '([^']+)'/g)) {
      assert.match(match[1], /\.$/, `${name}: ${match[1]}`);
    }
  }
  assert.ok(
    SCREENS.card.includes("export const CARD_ACCESSIBILITY_HINT = 'Opens the recall details.';"),
  );
  assert.ok(SCREENS.feed.includes('accessibilityLabel="Edit personalization"'));
  // A failed refresh over a corpus already on screen is now SILENT
  // (P2B7S, founder decision): no notice, no live region, no announcement.
  // Shoppers are never told about ingestion state; the dead-man heartbeat
  // tells the founder instead. The only surviving failure surface is the
  // honest no-data error, which is a StateMessage and not a live region.
  for (const [name, screen] of [
    ['feed', SCREENS.feed],
    ['saved', SCREENS.saved],
  ] as const) {
    assert.ok(
      !codeOnly(screen).includes('accessibilityLiveRegion'),
      `${name} announces a refresh-state change`,
    );
    assert.ok(!codeOnly(screen).includes('Freshness'), `${name} regained a freshness surface`);
  }
  // The Callout primitive keeps its live-region option for the surfaces
  // that legitimately use it; nothing in the feed path passes it.
  assert.ok(
    read('components', 'ui', 'callout.tsx').includes("accessibilityLiveRegion?: 'polite';"),
  );
});

// ── 12. Launch blockers stay tracked, never fabricated ─────────────────────

test('the Privacy Policy and Support destinations remain tracked as unresolved launch blockers', () => {
  const blockers = readDoc('recall-launch-blockers.md');
  assert.match(blockers, /- \[ \] Support email \/ support destination/);
  assert.match(blockers, /- \[ \] Public domain\/URL to host the Privacy Policy/);
  assert.match(blockers, /Expo display name/);
  assert.match(blockers, /push delivery itself remains not activated/);
  // The app links neither, and the registry holds neither.
  assert.equal(documentBySlug('privacy-policy'), undefined);
  assert.equal(documentBySlug('support'), undefined);
  assert.ok(!SCREENS.profile.includes('privacy-policy'));
  assert.ok(!/Support/.test(codeOnly(SCREENS.profile)));
});
