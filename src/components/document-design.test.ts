/**
 * The Lotly trust-document design (P2B6B): one shared renderer over the
 * content registry, every document, route, link, action and safety boundary
 * preserved, and the one destructive control still exactly where it was.
 *
 * Source-text pins read the route, the renderer and the reset section as
 * text, the same approach as the other design suites; content pins read the
 * registry itself. Claims inside the documents are pinned by
 * `src/content/trust-documents.test.ts`; this suite pins the SHAPE of every
 * document and the appearance around it.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hitTarget, layout, spacing } from '@/constants/design-tokens';
import {
  documentBySlug,
  PROFILE_DOCUMENT_GROUPS,
  profileGroupFor,
  TRUST_DOCUMENTS,
} from '@/content';
import {
  blockPlainText,
  DOCUMENT_BLOCK_KINDS,
  documentPlainText,
  riskLevelText,
  type DocumentBlock,
} from '@/content/document-model';
import type { Classification } from '@/domain/recall-types';
import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import { EXTERNAL_LINK_HINT } from '@/lib/detail-copy';
import {
  DEFAULT_NAVIGATOR_TITLE,
  DOCUMENT_EXTERNAL_LINK_HINT,
  DOCUMENT_LINK_HINT,
  DOCUMENT_NOT_FOUND,
  navigatorTitle,
  RESET_BUSY_LABEL,
  RESET_HEADING,
} from '@/lib/document-screen';
import {
  RESET_ACTION_LABEL,
  RESET_CONFIRM_BODY,
  RESET_SUPPORTING_COPY,
} from '@/lib/installation-reset';
import { DOCUMENT_HINT, NOTIFICATIONS_SUMMARY } from '@/lib/profile-hub';
import { riskTierLabel, riskTierWord, riskView } from '@/lib/risk-display';
import { PRIVACY_DOCUMENT_SLUG } from '@/lib/shopper-report-presentation';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

const ROUTE = read('app', 'document', '[slug].tsx');
const ROOT_LAYOUT = read('app', '_layout.tsx');
const PROFILE = read('app', '(tabs)', 'profile.tsx');
const QUESTIONNAIRE = read('app', 'report', '[id].tsx');
const HUB = read('app', 'design-preview', 'index.tsx');
const VIEW = read('components', 'document', 'document-view.tsx');
const BLOCKS = read('components', 'document', 'document-blocks.tsx');
const RESET = read('components', 'installation-reset-section.tsx');
const MODEL = read('content', 'document-model.ts');
const LIB = read('lib', 'document-screen.ts');
const RISK_DISPLAY = read('lib', 'risk-display.ts');

/** Source with comments removed, so a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const count = (source: string, needle: string): number => source.split(needle).length - 1;

/** The hub's document gallery alone (it sits after GallerySample, outside every other slice). */
const DOCUMENT_GALLERY = HUB.slice(
  HUB.indexOf('function DocumentGallery('),
  HUB.indexOf('function LiveQuestion('),
);

const RENDERER = { route: ROUTE, view: VIEW, blocks: BLOCKS, reset: RESET };

// ── 1–2. Every document, slug and route, unchanged ──────────────────────────

const SLUGS_AND_TITLES: [slug: string, title: string][] = [
  ['sources-methodology', 'Sources & Methodology'],
  ['how-affects-me-works', 'How Affects Me Works'],
  ['risk-levels', 'Risk Levels Explained'],
  ['safety-disclaimer', 'Safety Disclaimer'],
  ['corrections-policy', 'Corrections Policy'],
  ['privacy-data-controls', 'Privacy & Data Controls'],
  ['attributions', 'Attributions'],
];

test('every document is still registered under its exact slug and title, in the same order', () => {
  assert.deepEqual(
    TRUST_DOCUMENTS.map((doc) => [doc.slug, doc.title]),
    SLUGS_AND_TITLES,
  );
  for (const [slug, title] of SLUGS_AND_TITLES) {
    assert.equal(documentBySlug(slug)?.title, title);
  }
});

test('every document is reachable: the route, the stack registration, Profile and the questionnaire', () => {
  assert.ok(existsSync(join(SRC, 'app', 'document', '[slug].tsx')));
  assert.ok(
    ROOT_LAYOUT.includes('<Stack.Screen name="document/[slug]" options={{ title: \'About\' }} />'),
  );
  assert.ok(ROUTE.includes('useLocalSearchParams<{ slug: string }>()'));
  assert.ok(ROUTE.includes('const doc = documentBySlug(slug);'));
  // Profile lists the registry's grouping, once per document.
  assert.ok(PROFILE.includes('PROFILE_DOCUMENT_GROUPS'));
  assert.equal(count(PROFILE, "pathname: '/document/[slug]'"), 1);
  const grouped = PROFILE_DOCUMENT_GROUPS.flatMap((group) => [...group.slugs]);
  assert.deepEqual([...grouped].sort(), TRUST_DOCUMENTS.map((doc) => doc.slug).sort());
  // The questionnaire's Learn more still lands on Privacy & Data Controls.
  assert.equal(PRIVACY_DOCUMENT_SLUG, 'privacy-data-controls');
  assert.ok(
    QUESTIONNAIRE.includes("pathname: '/document/[slug]', params: { slug: PRIVACY_DOCUMENT_SLUG }"),
  );
});

// ── 3–4. Every block kind renders; no content disappeared ───────────────────

test('the renderer handles every block kind the model declares, and no other kind exists', () => {
  assert.deepEqual(
    [...DOCUMENT_BLOCK_KINDS],
    ['paragraph', 'bullets', 'link', 'document-link', 'note', 'risk-levels'],
  );
  for (const kind of DOCUMENT_BLOCK_KINDS) {
    assert.ok(BLOCKS.includes(`case '${kind}':`), `the renderer has no case for ${kind}`);
    assert.ok(MODEL.includes(`kind: '${kind}'`), `the model does not declare ${kind}`);
  }
  // No table, no ordered list: no document holds one, so the model has none.
  assert.ok(!MODEL.includes("'table'") && !MODEL.includes("'numbered'"));
  assert.ok(
    !BLOCKS.includes('default:'),
    'an exhaustive switch, not a fallback that swallows a kind',
  );
  // Every kind a document actually uses is in the declared set.
  const used = new Set<string>();
  for (const doc of TRUST_DOCUMENTS) {
    for (const section of doc.sections) for (const block of section.blocks) used.add(block.kind);
  }
  assert.deepEqual([...used].sort(), [...DOCUMENT_BLOCK_KINDS].sort());
});

/** Each document's section titles and block kinds, as they stood at the redesign. */
const SHAPE: Record<string, [title: string | null, kinds: string][]> = {
  'sources-methodology': [
    [null, 'paragraph'],
    ['Where the data comes from', 'bullets link link link'],
    ['How often Lotly checks', 'paragraph'],
    ['Source snapshots and traceability', 'paragraph'],
    ['One recall, one case', 'paragraph bullets'],
    ['Active, closed, and retracted', 'paragraph bullets'],
    ['What counts as a change', 'paragraph bullets'],
    ['Official sources take precedence', 'note'],
    ['Products, packages, and stores', 'bullets'],
    ['Images', 'paragraph'],
    ['Known limitations', 'bullets'],
    ['Corrections and source revisions', 'paragraph document-link'],
  ],
  'how-affects-me-works': [
    [null, 'paragraph'],
    ['What you can choose', 'bullets paragraph'],
    ['How location matching works', 'bullets'],
    ['How allergen matching works', 'paragraph bullets'],
    ['How store matching works', 'bullets'],
    ['What Affects me is not', 'bullets'],
    ['Alerts use the same rules', 'paragraph'],
    ['Where your choices live', 'paragraph document-link'],
  ],
  'risk-levels': [
    [null, 'paragraph'],
    ['The five risk levels', 'risk-levels note'],
    ['Two states that are not risk levels', 'paragraph risk-levels'],
    ['Where the levels come from', 'bullets'],
    ['When classifications change', 'paragraph'],
  ],
  'safety-disclaimer': [
    [null, 'paragraph'],
    ['Not medical advice', 'note'],
    ['The official notice controls', 'bullets'],
    ['Absence is not safety', 'paragraph'],
    ['No affiliation', 'paragraph'],
  ],
  'corrections-policy': [
    [null, 'paragraph'],
    ['Official corrections and revisions', 'bullets'],
    ['Merged and duplicate cases', 'paragraph'],
    ['What Lotly corrects', 'bullets'],
    ['What you will see', 'paragraph'],
    ['Reporting a problem', 'paragraph'],
    ['Source precedence', 'note'],
  ],
  'privacy-data-controls': [
    [null, 'paragraph'],
    ['What stays on your device', 'bullets document-link'],
    ['What Lotly’s server stores', 'bullets paragraph'],
    ['Community shopper reports', 'paragraph bullets'],
    ['What Lotly does not collect', 'bullets paragraph'],
    ['Who processes data', 'paragraph'],
    ['Turning alerts off', 'paragraph'],
    ['Clearing and resetting', 'bullets paragraph'],
    ['Deleting the app', 'paragraph'],
  ],
  attributions: [
    ['Recall data', 'bullets link link'],
    ['Images and documents', 'paragraph'],
    ['Open-source software', 'paragraph'],
  ],
};

test('no document content silently disappears: every section and block is still there', () => {
  for (const doc of TRUST_DOCUMENTS) {
    assert.deepEqual(
      doc.sections.map((section) => [section.title, section.blocks.map((b) => b.kind).join(' ')]),
      SHAPE[doc.slug],
      `${doc.slug} changed shape`,
    );
    // Every block still carries words, and the plain text carries every block.
    const text = documentPlainText(doc);
    for (const section of doc.sections) {
      for (const block of section.blocks) {
        for (const line of blockPlainText(block)) {
          assert.ok(line.trim().length > 0, `${doc.slug} has an empty block`);
          assert.ok(text.includes(line), `${doc.slug} plain text omits a block`);
        }
      }
    }
    assert.ok(text.includes(doc.summary));
  }
  // The registry's word count did not shrink: the redesign added links and
  // restructured the risk rows; it removed no sentence.
  const words = TRUST_DOCUMENTS.map((doc) => documentPlainText(doc).split(/\s+/).length);
  assert.ok(words.reduce((a, b) => a + b, 0) > 3900, `unexpectedly short: ${words}`);
});

// ── 5–6. Links: exact destinations, accessible treatment ────────────────────

test('external links keep their exact destinations, and document links resolve to real documents', () => {
  const external: [string, string, string][] = [];
  const internal: [string, string, string][] = [];
  for (const doc of TRUST_DOCUMENTS) {
    for (const section of doc.sections) {
      for (const block of section.blocks) {
        if (block.kind === 'link') external.push([doc.slug, block.label, block.url]);
        if (block.kind === 'document-link') internal.push([doc.slug, block.label, block.slug]);
      }
    }
  }
  assert.deepEqual(external, [
    [
      'sources-methodology',
      'FDA: Recalls, Market Withdrawals, & Safety Alerts',
      'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
    ],
    [
      'sources-methodology',
      'USDA FSIS: Recalls & Public Health Alerts',
      'https://www.fsis.usda.gov/recalls',
    ],
    ['sources-methodology', 'openFDA', 'https://open.fda.gov/'],
    ['attributions', 'openFDA', 'https://open.fda.gov/'],
    ['attributions', 'USDA FSIS', 'https://www.fsis.usda.gov/recalls'],
  ]);
  assert.deepEqual(internal, [
    ['sources-methodology', 'Corrections Policy', 'corrections-policy'],
    ['how-affects-me-works', 'Privacy & Data Controls', 'privacy-data-controls'],
    ['privacy-data-controls', 'How Affects Me Works', 'how-affects-me-works'],
  ]);
  for (const [from, label, slug] of internal) {
    const target = documentBySlug(slug);
    assert.ok(target, `${from} links an unknown document ${slug}`);
    assert.equal(label, target.title, 'a document link is labelled with the target’s own title');
    assert.notEqual(slug, from, 'a document never links to itself');
  }
  // The renderer opens exactly the block's url / slug — nothing rewritten.
  assert.ok(BLOCKS.includes('onPress={() => void Linking.openURL(block.url)}'));
  assert.ok(
    BLOCKS.includes("href={{ pathname: '/document/[slug]', params: { slug: block.slug } }}"),
  );
});

test('links are real links with the approved treatment: role, hint, glyph and a 44pt target', () => {
  // External: the same treatment as Recall Detail's official-source link.
  assert.equal(DOCUMENT_EXTERNAL_LINK_HINT, EXTERNAL_LINK_HINT);
  assert.equal(EXTERNAL_LINK_HINT, 'Opens in your browser.');
  assert.ok(BLOCKS.includes('accessibilityHint={DOCUMENT_EXTERNAL_LINK_HINT}'));
  assert.ok(BLOCKS.includes('<LinkRow label={block.label} icon="external-link" />'));
  // Internal: the navigation chevron and Profile's own hint.
  assert.equal(DOCUMENT_LINK_HINT, DOCUMENT_HINT);
  assert.ok(BLOCKS.includes('accessibilityHint={DOCUMENT_LINK_HINT}'));
  assert.ok(BLOCKS.includes('<LinkRow label={block.label} icon="chevron-right" />'));
  // Both are links, named by their label, coloured as actions with a glyph
  // as the second channel, on a row at least the minimum target tall.
  assert.equal(count(BLOCKS, 'accessibilityRole="link"'), 2);
  assert.equal(count(BLOCKS, 'accessibilityLabel={block.label}'), 2);
  assert.ok(BLOCKS.includes('color="action/secondary"'));
  assert.ok(BLOCKS.includes('<Icon name={icon} size={16} color="icon/brand" />'));
  assert.ok(BLOCKS.includes('minHeight: hitTarget.minimum,'));
  assert.equal(hitTarget.minimum, 44);
});

// ── 7. Risk Levels: the production labels, the seven-word vocabulary ────────

test('Risk Levels renders the production Risk Label for exactly the seven tiers, spelled by the contract', () => {
  const doc = documentBySlug('risk-levels');
  assert.ok(doc);
  const rows = doc.sections
    .flatMap((section) => section.blocks)
    .filter(
      (block): block is Extract<DocumentBlock, { kind: 'risk-levels' }> =>
        block.kind === 'risk-levels',
    );
  assert.equal(rows.length, 2, 'the five levels, then the two states');
  assert.deepEqual(
    rows.flatMap((block) => block.items.map((item) => item.tier)),
    RISK_FILTER_TIERS,
  );
  assert.deepEqual(
    rows[0].items.map((item) => item.tier),
    ['critical', 'very_high', 'high', 'moderate', 'low'],
  );
  assert.deepEqual(
    rows[1].items.map((item) => item.tier),
    ['pending', 'unknown'],
  );
  // The renderer draws the one Risk Label with the label the product speaks.
  assert.ok(BLOCKS.includes("from '@/components/ui/risk-label'"));
  assert.ok(BLOCKS.includes('const label = riskTierLabel(item.tier);'));
  assert.ok(BLOCKS.includes('label={label.text}'));
  assert.ok(BLOCKS.includes('accessibilityLabel={label.accessibilityLabel}'));
  assert.ok(BLOCKS.includes('accessibilityLabel={`${label.accessibilityLabel}. ${item.meaning}`}'));
  // riskTierLabel is what riskView itself renders, tier for tier.
  const sample: Record<string, Classification> = {
    critical: { value: 'class_I', sourceText: null, officialClasses: ['class_I'] },
    very_high: {
      value: 'multiple_classes',
      sourceText: null,
      officialClasses: ['class_I', 'class_II'],
    },
    high: { value: 'class_II', sourceText: null, officialClasses: ['class_II'] },
    moderate: {
      value: 'multiple_classes',
      sourceText: null,
      officialClasses: ['class_II', 'class_III'],
    },
    low: { value: 'class_III', sourceText: null, officialClasses: ['class_III'] },
    pending: { value: 'not_yet_classified', sourceText: null, officialClasses: [] },
    unknown: { value: 'not_applicable_pha', sourceText: null, officialClasses: [] },
  };
  for (const tier of RISK_FILTER_TIERS) {
    // The Risk Levels document explains the seven words themselves, not one
    // notice — so every row is read as a recall, where no label is suppressed.
    const view = riskView(sample[tier], 'FDA', 'recall');
    assert.equal(view.tier, tier);
    assert.equal(riskTierLabel(tier).text, view.badgeLabel);
    assert.equal(riskTierLabel(tier).accessibilityLabel, view.accessibilityLabel);
    assert.equal(riskTierLabel(tier).text, riskTierWord(tier).toUpperCase());
  }
  assert.ok(RISK_DISPLAY.includes('const label = riskTierLabel(tier);'));
  // The document's words still carry every tier word, once per row, and the
  // meaning reads as a sentence beside the label.
  for (const block of rows) {
    for (const item of block.items) {
      assert.ok(riskLevelText(item).startsWith(`${riskTierWord(item.tier)}: `));
      assert.match(item.meaning, /^[A-Z]/);
    }
  }
  // Public Health Alerts' missing classification is still explained.
  assert.match(
    documentPlainText(doc),
    /public health alert, which never receives a classification/i,
  );
});

// ── 8–9. Limitations and qualifications stay ────────────────────────────────

test('Affects Me limitations and the shopper-report exception remain present', () => {
  const text = documentPlainText(documentBySlug('how-affects-me-works')!);
  assert.match(text, /not a guarantee of safety or completeness/i);
  assert.match(text, /does not mean a product is safe/i);
  assert.match(text, /never knows or guesses what you actually bought/i);
  assert.match(text, /shopper report you choose to submit/i);
  assert.match(text, /never affects Affects Me/i);
  assert.match(text, /no store flag never means/i);
});

test('safety and source qualifications remain present, and Lotly never sounds official', () => {
  const disclaimer = documentPlainText(documentBySlug('safety-disclaimer')!);
  const sources = documentPlainText(documentBySlug('sources-methodology')!);
  assert.match(disclaimer, /not medical advice/i);
  assert.match(disclaimer, /contact a healthcare professional/i);
  assert.match(disclaimer, /not affiliated with, sponsored by, or endorsed by/i);
  assert.match(disclaimer, /official notice controls/i);
  assert.match(sources, /official notice controls/i);
  assert.match(sources, /Known limitations/);
  assert.match(sources, /not a real-time feed/i);
  const all = TRUST_DOCUMENTS.map(documentPlainText).join('\n');
  assert.doesNotMatch(all, /official (FDA|USDA|government) app|on behalf of the (FDA|USDA)/i);
  // The notes are the information tone only: lime is personal relevance.
  assert.ok(BLOCKS.includes('<Callout tone="information">{block.text}</Callout>'));
  assert.ok(!codeOnly(BLOCKS).includes('tone="warning"'));
});

// ── 10–11. The reset: one place, unchanged behaviour ────────────────────────

test('the reset exists only at the bottom of Privacy & Data Controls', () => {
  assert.match(
    ROUTE,
    /doc\.slug === 'privacy-data-controls' \? <InstallationResetSection \/> : null/,
  );
  assert.ok(
    ROUTE.indexOf('<DocumentView doc={doc} />') < ROUTE.indexOf('<InstallationResetSection />'),
  );
  assert.equal(count(ROUTE, 'InstallationResetSection'), 2, 'one import, one mount');
  for (const file of [
    ['app', '(tabs)', 'profile.tsx'],
    ['app', '(tabs)', 'index.tsx'],
    ['app', '(tabs)', 'saved.tsx'],
    ['app', 'settings', 'personalization.tsx'],
    ['app', 'settings', 'notifications.tsx'],
    ['components', 'document', 'document-view.tsx'],
    ['components', 'document', 'document-blocks.tsx'],
  ]) {
    assert.ok(
      !read(...file).includes('InstallationResetSection'),
      `${file.join('/')} mounts the reset`,
    );
  }
  assert.ok(!codeOnly(HUB).includes('<InstallationResetSection'));
});

test('the reset behaviour and confirmation are unchanged beneath the new appearance', () => {
  assert.ok(RESET.includes('Alert.alert(RESET_CONFIRM_TITLE, RESET_CONFIRM_BODY, ['));
  assert.match(RESET, /\{ text: RESET_CONFIRM_CANCEL, style: 'cancel' \}/);
  assert.match(RESET, /style: 'destructive', onPress: \(\) => void run\(\)/);
  assert.equal(count(RESET, 'void run()'), 1);
  assert.ok(RESET.includes('const result = await runInstallationReset();'));
  assert.ok(RESET.includes("if (result.status === 'deleted') forgetSavedRecallsCache();"));
  assert.ok(RESET.includes('if (!resetAvailable()) return null;'));
  assert.ok(RESET.includes("if (state === 'running') return;"));
  assert.ok(RESET.includes("prior === 'running' ? prior : 'running'"));
  // The consequence reads before the action; the action keeps its exact label
  // and its busy, disabled and outcome states; both outcomes are announced.
  assert.ok(RESET.indexOf('{RESET_SUPPORTING_COPY}') < RESET.indexOf('label={RESET_ACTION_LABEL}'));
  assert.equal(RESET_ACTION_LABEL, 'Reset app and delete my data');
  assert.ok(RESET.includes("busy={state === 'running'}"));
  assert.ok(RESET.includes('busyLabel={RESET_BUSY_LABEL}'));
  assert.ok(RESET.includes("disabled={state === 'running'}"));
  assert.equal(RESET_BUSY_LABEL, 'Deleting…');
  assert.equal(count(RESET, 'accessibilityLiveRegion="polite"'), 2);
  assert.ok(RESET.includes('{RESET_SUCCESS_MESSAGE}') && RESET.includes('{RESET_FAILURE_MESSAGE}'));
  // Danger is carried by words and the strong border, not by a colour: no
  // risk token, no new destructive token, the shared secondary Button.
  assert.ok(RESET.includes('<Surface radius={12} border="border/strong"'));
  assert.ok(RESET.includes('variant="secondary"'));
  assert.ok(!codeOnly(RESET).includes('risk'));
  assert.ok(!read('constants', 'design-tokens.ts').includes('destructive'));
  assert.equal(RESET_HEADING, 'Delete my data');
  assert.ok(RESET.includes('{RESET_HEADING}'));
  assert.ok(!codeOnly(RESET).includes('toUpperCase'));
  // The document and the dialog still agree on the saved recalls.
  assert.match(RESET_CONFIRM_BODY, /saved recalls/);
  assert.match(RESET_SUPPORTING_COPY, /Lotly’s server/);
  assert.ok(
    documentPlainText(documentBySlug('privacy-data-controls')!).includes(RESET_ACTION_LABEL),
  );
});

// ── 12. Unfinished legal documents stay hidden ──────────────────────────────

test('the unfinished Privacy Policy and Terms remain hidden', () => {
  assert.equal(documentBySlug('privacy-policy'), undefined);
  assert.equal(documentBySlug('terms'), undefined);
  for (const doc of TRUST_DOCUMENTS) assert.ok(!/^(privacy policy|terms)/i.test(doc.title));
  assert.ok(!PROFILE.includes('privacy-policy') && !PROFILE.includes("'terms'"));
  assert.ok(!ROUTE.includes('privacy-policy'));
  const all = TRUST_DOCUMENTS.map(documentPlainText).join('\n');
  assert.doesNotMatch(all, /Terms of (Service|Use)|End User License/i);
});

// ── 13. Tokens and the heading hierarchy ────────────────────────────────────

test('the shared renderer, the route and the reset draw from the tokens and the shared primitives', () => {
  for (const [name, source] of Object.entries(RENDERER)) {
    const code = codeOnly(source);
    for (const forbidden of [
      'ThemedText',
      'ThemedView',
      "from '@/constants/theme'",
      'Spacing.',
      'Radii.',
      'Colors.',
      'MaxContentWidth',
      'fontSize:',
      'fontWeight:',
      'fontFamily:',
      'lineHeight:',
      'letterSpacing:',
      'borderRadius:',
      'backgroundColor:',
      'useColorScheme',
      'Animated',
      'LayoutAnimation',
      'LinearGradient',
      'BlurView',
      'WebView',
      'Markdown',
      'dangerouslySetInnerHTML',
    ]) {
      assert.ok(!code.includes(forbidden), `${name} contains ${forbidden}`);
    }
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${name} contains a hex literal`);
    assert.ok(
      !/\b(padding|margin|gap|rowGap|columnGap|minHeight|minWidth)[A-Za-z]*:\s*-?[1-9]/.test(code),
      `${name} contains an off-scale number`,
    );
    assert.ok(code.includes("from '@/constants/design-tokens'"), `${name} imports the tokens`);
  }
  for (const source of [VIEW, BLOCKS, RESET]) {
    assert.ok(source.includes("from '@/components/ui/text'"));
  }
  // The page: the warm surface, the margins, the content cap, the safe area.
  assert.ok(ROUTE.includes('<Surface background="background/page" style={styles.page}>'));
  assert.ok(ROUTE.includes('paddingHorizontal: layout.pageMargin,'));
  assert.ok(ROUTE.includes('maxWidth: layout.maxContentWidth,'));
  assert.ok(ROUTE.includes('paddingBottom: spacing[24] + insets.bottom'));
  assert.equal(layout.pageMargin, 16);
  assert.equal(spacing[32], 32);
  // Not found is the shared state message, with the copy from the leaf.
  assert.ok(ROUTE.includes('<StateMessage {...DOCUMENT_NOT_FOUND} />'));
  assert.deepEqual(DOCUMENT_NOT_FOUND, {
    title: 'Not found',
    body: 'This page could not be found.',
  });
  // Long-form text reads in body type on the page; no card per paragraph.
  assert.ok(BLOCKS.includes('<Text variant="body" selectable>'));
  assert.ok(!codeOnly(VIEW).includes('<Surface'));
  assert.ok(VIEW.includes('gap: spacing[32],'));
});

test('one title treatment: the navigator names the Profile group, the page names the document', () => {
  for (const doc of TRUST_DOCUMENTS) {
    const group = profileGroupFor(doc.slug);
    assert.ok(group, `${doc.slug} is in no Profile group`);
    assert.equal(navigatorTitle(doc), group.title);
    assert.notEqual(navigatorTitle(doc), doc.title, 'never the same words twice');
    // No section repeats the document's title either.
    for (const section of doc.sections) assert.notEqual(section.title, doc.title);
  }
  assert.deepEqual(
    TRUST_DOCUMENTS.map((doc) => navigatorTitle(doc)),
    [
      'About & Safety',
      'About & Safety',
      'About & Safety',
      'About & Safety',
      'About & Safety',
      'Privacy & Data',
      'Legal',
    ],
  );
  assert.equal(DEFAULT_NAVIGATOR_TITLE, 'About');
  assert.ok(ROUTE.includes('<Stack.Screen options={{ title: navigatorTitle(doc) }} />'));
  // The page: the full title as heading-1, the summary as the standfirst,
  // then content section headings in heading-3 — never uppercased.
  assert.ok(VIEW.includes('<Text variant="heading-1" accessibilityRole="header" selectable>'));
  assert.ok(VIEW.includes('{doc.title}'));
  assert.ok(VIEW.indexOf('{doc.title}') < VIEW.indexOf('{doc.summary}'));
  assert.ok(VIEW.includes('<Text variant="heading-3" accessibilityRole="header" selectable>'));
  assert.ok(VIEW.includes('{section.title}'));
  for (const source of [VIEW, BLOCKS, RESET, ROUTE]) {
    assert.ok(!codeOnly(source).includes('toUpperCase'));
    assert.ok(!codeOnly(source).includes('variant="caption"') || source === BLOCKS);
  }
  assert.equal(count(VIEW, 'accessibilityRole="header"'), 2);
  assert.ok(RESET.includes('<Text variant="heading-3" accessibilityRole="header">'));
});

// ── 14–15. Dynamic Type; nothing pans sideways ──────────────────────────────

test('Dynamic Type is not capped and nothing is truncated', () => {
  for (const [name, source] of Object.entries(RENDERER)) {
    for (const forbidden of [
      'maxFontSizeMultiplier',
      'numberOfLines',
      'allowFontScaling',
      'ellipsizeMode',
    ]) {
      assert.ok(!source.includes(forbidden), `${name} contains ${forbidden}`);
    }
  }
  assert.ok(!read('components', 'ui', 'text.tsx').includes('maxFontSizeMultiplier={'));
});

test('no document can pan the page sideways: no horizontal scroll and no table', () => {
  for (const [name, source] of Object.entries(RENDERER)) {
    const code = codeOnly(source);
    assert.ok(!code.includes('horizontal'), `${name} scrolls horizontally`);
    assert.ok(!/\bwidth:\s*\d{3,}/.test(code), `${name} fixes a wide width`);
    assert.ok(!code.includes('FlatList') && !code.includes('SectionList'));
  }
  assert.equal(count(ROUTE, '<ScrollView'), 1, 'the one vertical scroll view');
  assert.ok(ROUTE.includes("width: '100%',"));
  assert.ok(BLOCKS.includes('flex: 1,'), 'row text takes the remaining width and wraps');
});

// ── 16. The gallery cannot delete, prompt or contact anything ───────────────

test('the Design Preview document gallery renders the production renderer and cannot invoke a deletion', () => {
  assert.ok(DOCUMENT_GALLERY.length > 0);
  assert.ok(HUB.includes("from '@/components/document/document-view'"));
  assert.ok(HUB.includes("from '@/components/document/document-blocks'"));
  assert.ok(HUB.includes("import { ResetPanel } from '@/components/installation-reset-section';"));
  assert.ok(HUB.includes('DOCUMENT RENDERER AND STATES'));
  const code = codeOnly(HUB);
  for (const forbidden of [
    'runInstallationReset',
    'installation-reset-runner',
    'resetInstallationData',
    'deleteInstallationData',
    'InstallationResetSection',
    'Alert.alert',
    'RESET_ACTION_LABEL',
  ]) {
    assert.ok(!code.includes(forbidden), `the hub references ${forbidden}`);
  }
  for (const state of ['idle', 'running', 'deleted', 'failed']) {
    assert.ok(DOCUMENT_GALLERY.includes(`<ResetPanel state="${state}" onPress={noop} />`), state);
  }
  // The gallery's document samples are the registry's own; nothing invented.
  assert.ok(DOCUMENT_GALLERY.includes('<DocumentView doc={shortest} />'));
  assert.ok(DOCUMENT_GALLERY.includes('<DocumentView doc={longest} />'));
  assert.ok(!DOCUMENT_GALLERY.includes("paragraph('") && !DOCUMENT_GALLERY.includes('bullets(['));
  for (const label of [
    'Short document',
    'Long document',
    'Paragraphs and a section heading',
    'Bulleted list',
    'Internal link',
    'External link',
    'Information callout',
    'Warning callout',
    'Risk-label explanation',
    'Dense comparison',
    'Reset section, idle',
    'Reset section, confirming',
    'Reset section, busy',
    'Reset section, success',
    'Reset section, failure',
    // P3C1.5: the probe that shows the real root error boundary.
    'Root error boundary',
  ]) {
    assert.ok(
      DOCUMENT_GALLERY.includes(`caption={\`${label} —`) ||
        DOCUMENT_GALLERY.includes(`caption="${label} —`),
      label,
    );
  }
  assert.equal(count(DOCUMENT_GALLERY, '— real:'), 10);
  assert.equal(count(DOCUMENT_GALLERY, '— simulated:'), 6);
});

// ── 17. Lotly names the product; "recall" names a recall ────────────────────

test('product-name uses became Lotly in every document without touching generic uses of "recall"', () => {
  const product = [
    /\bRecall(’s|'s)\b/,
    /\b(in|by|to|from|about|within) Recall\b/,
    /\bRecall (is|does|never|cannot|checks|shows|works|renders|detects|re-collects|may|also|processes|reconciles|collects|organizes|reports|extracted)\b/,
    /\bRecall mobile app\b/,
  ];
  for (const doc of TRUST_DOCUMENTS) {
    const text = documentPlainText(doc);
    for (const pattern of product) {
      assert.doesNotMatch(text, pattern, `${doc.slug} still names the product "Recall"`);
    }
    assert.match(text, /Lotly/, `${doc.slug} never names Lotly`);
  }
  for (const source of [RESET_SUPPORTING_COPY, RESET_CONFIRM_BODY]) {
    assert.doesNotMatch(source, /Recall’s server/);
  }
  assert.ok(read('lib', 'installation-reset-runner.web.ts').includes('the Lotly mobile app'));
  // Generic uses stay exactly as they were: a recall is a recall.
  const attributions = documentBySlug('attributions')!;
  assert.equal(attributions.sections[0].title, 'Recall data');
  assert.match(documentPlainText(attributions), /^Recall announcement data is collected/m);
  const sources = documentPlainText(documentBySlug('sources-methodology')!);
  assert.match(sources, /FDA: Recalls, Market Withdrawals, & Safety Alerts/);
  assert.match(sources, /USDA FSIS: Recalls & Public Health Alerts/);
  assert.match(sources, /Where recall information comes from/);
  assert.match(
    documentPlainText(documentBySlug('how-affects-me-works')!),
    /All recalls always remains available/,
  );
  assert.match(
    documentPlainText(documentBySlug('privacy-data-controls')!),
    /Recall reads are made with a shared application key/,
  );
  assert.match(RESET_SUPPORTING_COPY, /Recall information itself is public/);
  assert.equal(NOTIFICATIONS_SUMMARY, 'Recall alerts for this device.');
  // No new em dash entered the authored copy this milestone added.
  for (const authored of [
    RESET_HEADING,
    RESET_BUSY_LABEL,
    DOCUMENT_NOT_FOUND.title,
    DOCUMENT_NOT_FOUND.body,
    DOCUMENT_LINK_HINT,
  ]) {
    assert.ok(!authored.includes('—'));
  }
});

// ── 18. Client-side only ────────────────────────────────────────────────────

test('the renderer, the route, the content and the leaf import nothing server-side', () => {
  for (const [name, source] of Object.entries({ ...RENDERER, model: MODEL, lib: LIB, hub: HUB })) {
    for (const forbidden of ['@/server', 'scripts/', 'supabase', 'process.env', 'fetch(']) {
      assert.ok(!codeOnly(source).includes(forbidden), `${name} references ${forbidden}`);
    }
  }
  for (const doc of TRUST_DOCUMENTS) {
    const source = read('content', `${doc.slug}.ts`);
    assert.ok(!source.includes('@/server') && !source.includes('process.env'), doc.slug);
  }
});
