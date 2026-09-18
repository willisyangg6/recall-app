/**
 * The semantic capitalization contract (P2B7H).
 *
 * ## The rule this file enforces
 *
 * Lotly-authored interface text is written and rendered in natural case.
 * Uppercase is reserved for COMPACT STATUS BADGES — the risk label, the
 * relevance label and the notice label — where shouting is the established
 * component treatment and the word is a token rather than language. A
 * content heading, a subsection label, a settings group and a navigation
 * group are ordinary interface language and render as written.
 *
 * Before this milestone the Profile group labels (`Privacy & Data`,
 * `About & Safety`, `Legal`, `App`, `Development builds only`) and Detail's
 * `Common symptoms` eyebrow were written in title case and then shouted by
 * the component that drew them. That is the convention this replaces, and
 * DESIGN.md's "Section headings and group labels" records the change.
 *
 * ## Why the test is shaped this way, and not as a ban
 *
 * A repository-wide ban on uppercase text would be worse than no test: this
 * codebase is full of legitimate uppercase that must never be recased —
 * official notice prose, the trust and legal documents, agency and standards
 * acronyms, state codes, roman-numeral recall classes, lot codes, units, and
 * the raw government product strings the normalization modules in
 * `lib/consumer-*.ts` match against. Recasing any of those would be a
 * correctness defect, not a style improvement.
 *
 * So the boundary is drawn by SCOPE and by ALLOW-LIST, and both are visible
 * here:
 *
 *   SCOPE  — the files that render Lotly-authored interface chrome: the
 *            shopper-facing routes, every shared component, the copy
 *            modules, and the Profile group registry. Deliberately OUT:
 *            the trust/legal document bodies (`src/content/*.ts` besides
 *            the registry — authored prose, where an emphatic `AND` is the
 *            author's), the source-data normalization modules, the domain
 *            and server layers, and the development-only Design Preview
 *            harness, which is not shopper-facing and keeps its own
 *            gallery labels.
 *
 *   ALLOW  — the acronyms and badge words below, each named individually.
 *            A new uppercase string in scope fails until someone adds it
 *            here, which is the review step this test exists to force.
 *
 * The intentional badges are pinned POSITIVELY as well (section 2), so this
 * contract cannot be satisfied by quietly lowercasing `CRITICAL`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { PROFILE_DOCUMENT_GROUPS } from '@/content';
import { RISK_FILTER_TIERS } from '@/lib/feed-filters';
import { DEVELOPMENT_HEADING } from '@/lib/profile-hub';
import { agencyLabel, riskTierLabel, riskTierWord } from '@/lib/risk-display';

const SRC = join(__dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

/** Source with comments removed — a file may document what it does not do. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/**
 * Every file that renders Lotly-authored interface chrome. See the header
 * for what is deliberately absent and why.
 */
const IN_SCOPE: readonly string[] = [
  ...walk(join(SRC, 'app')),
  ...walk(join(SRC, 'components')),
  join(SRC, 'lib', 'detail-copy.ts'),
  join(SRC, 'lib', 'feed-copy.ts'),
  join(SRC, 'lib', 'error-boundary-copy.ts'),
  join(SRC, 'lib', 'personalization-copy.ts'),
  join(SRC, 'lib', 'profile-hub.ts'),
  join(SRC, 'lib', 'saved-recalls.ts'),
  // The Profile group registry — the group LABELS live here, even though the
  // document bodies beside it are out of scope as authored prose.
  join(SRC, 'content', 'index.ts'),
].filter((path) => !path.includes('.test.') && !path.includes('design-preview'));

const label = (path: string): string => path.slice(SRC.length + 1);

// ── 1. Nothing in scope transforms case at render time ──────────────────────

/**
 * The files allowed to uppercase text, and the one expression each is
 * allowed to do it in. Everywhere else a rendered `toUpperCase()` is a
 * capitalization decision hidden in a component, which is exactly what this
 * milestone removed from `ProfileSection` and `DevelopmentEntry`.
 */
const APPROVED_UPPERCASING: Record<string, string> = {
  // The notice label ("Public Health Alert") is a compact status badge and
  // cases the contract's own words for that treatment.
  'components/ui/notice-label.tsx': '{label.toUpperCase()}',
};

test('P2B7H: no shopper-facing surface transforms text to uppercase in a style', () => {
  for (const path of IN_SCOPE) {
    const code = codeOnly(readFileSync(path, 'utf8'));
    assert.ok(!code.includes('textTransform'), `${label(path)} uses textTransform`);
  }
});

test('P2B7H: toUpperCase() at render time survives only in the approved badge renderer', () => {
  for (const path of IN_SCOPE) {
    const code = codeOnly(readFileSync(path, 'utf8'));
    if (!code.includes('toUpperCase')) continue;
    const approved = APPROVED_UPPERCASING[label(path)];
    assert.ok(approved !== undefined, `${label(path)} uppercases text and is not approved to`);
    assert.ok(code.includes(approved), `${label(path)} no longer uppercases the approved way`);
    assert.equal(
      (code.match(/toUpperCase/g) ?? []).length,
      1,
      `${label(path)} gained a second uppercasing`,
    );
  }
});

test('P2B7H: the labels this milestone corrected are rendered exactly as written', () => {
  const SECTION = read('components', 'profile', 'profile-section.tsx');
  const DEV_ENTRY = read('components', 'profile', 'development-entry.tsx');
  const DETAIL = read('app', 'recall', '[id].tsx');

  // Profile's navigation group label keeps its caption TREATMENT and loses
  // its casing transform; the words arrive already cased.
  assert.ok(SECTION.includes('variant="caption"'));
  assert.ok(SECTION.includes('{title}'));
  assert.ok(!SECTION.includes('toUpperCase'));
  assert.ok(DEV_ENTRY.includes('{DEVELOPMENT_HEADING}'));
  assert.ok(!DEV_ENTRY.includes('toUpperCase'));

  // Detail's symptom eyebrow.
  assert.ok(DETAIL.includes('Common symptoms'));
  assert.ok(!DETAIL.includes('COMMON SYMPTOMS'));
});

test('P2B7H: every group, section and navigation label is written in natural case', () => {
  const written = [
    ...PROFILE_DOCUMENT_GROUPS.map((group) => group.title),
    'App',
    DEVELOPMENT_HEADING,
    'Common symptoms',
    'Privacy & Data',
    'About & Safety',
    'Legal',
  ];
  for (const title of written) {
    assert.notEqual(title, title.toUpperCase(), `${title} is written all caps`);
    assert.equal(title[0], title[0].toUpperCase(), `${title} does not start capitalized`);
  }
  // The four founder-named groups are registered under exactly these words.
  assert.deepEqual(
    PROFILE_DOCUMENT_GROUPS.map((group) => group.title),
    ['Privacy & Data', 'About & Safety', 'Legal'],
  );
});

// ── 2. Uppercase that is intentional, pinned so it cannot be lost ───────────

test('P2B7H: the compact status and risk badges are still uppercase', () => {
  // All seven consumer tiers, through the real pipeline. `CRITICAL`,
  // `HIGH`, `MODERATE` and `PENDING` are the established badge treatment
  // and are NOT interface language.
  for (const tier of RISK_FILTER_TIERS) {
    const rendered = riskTierLabel(tier);
    assert.equal(rendered.text, riskTierWord(tier).toUpperCase());
    assert.equal(rendered.text, rendered.text.toUpperCase());
    // The SPOKEN label is never the shouted word.
    assert.equal(rendered.accessibilityLabel, `Risk level: ${riskTierWord(tier)}`);
    assert.notEqual(rendered.accessibilityLabel, rendered.accessibilityLabel.toUpperCase());
  }
  for (const word of ['CRITICAL', 'HIGH', 'MODERATE', 'PENDING']) {
    assert.ok(
      RISK_FILTER_TIERS.some((tier) => riskTierLabel(tier).text === word),
      `${word} is no longer a rendered badge`,
    );
  }
});

test('P2B7H: AFFECTS YOU stays uppercase, and is still spoken in natural case', () => {
  const RELEVANCE = read('components', 'ui', 'relevance-label.tsx');
  assert.ok(RELEVANCE.includes("RELEVANCE_LABEL_TEXT = 'AFFECTS YOU'"));
  assert.ok(RELEVANCE.includes("RELEVANCE_ACCESSIBILITY_LABEL = 'Affects you'"));
  // The visible token is a badge; the spoken one is language.
  assert.notEqual('Affects you', 'Affects you'.toUpperCase());
});

test('P2B7H: the notice label still cases its contract words for the badge treatment', () => {
  const NOTICE = read('components', 'ui', 'notice-label.tsx');
  assert.ok(NOTICE.includes('<Text variant="label">{label.toUpperCase()}</Text>'));
  // A screen reader hears the contract's own words, not the shouted badge.
  assert.ok(NOTICE.includes('accessibilityLabel={label}'));
});

// ── 3. Acronyms and source-data casing are preserved ────────────────────────

/**
 * The uppercase tokens Lotly-authored interface text is allowed to contain.
 * Agencies, standards and identifiers — each one a proper name or an
 * established abbreviation that would be WRONG in any other case.
 */
const ALLOWED_UPPERCASE = new Set([
  // Agencies and standards bodies.
  'FDA',
  'USDA',
  'FSIS',
  'CDC',
  // Identifiers and formats named in interface copy.
  'UPC',
  'URL',
  'PDF',
  'GTIN',
  // The relevance badge, the one intentionally shouted phrase in scope.
  'AFFECTS',
  'YOU',
  // The developer-only backend hint points at the repository's own README.
  'README',
]);

test('P2B7H: shopper-facing copy contains no uppercase string but the approved acronyms and badges', () => {
  const offenders: string[] = [];
  for (const path of IN_SCOPE) {
    const code = codeOnly(readFileSync(path, 'utf8'));
    // Quoted literals and bare JSX text alike — a label is just as shouted
    // when it is typed between the tags as when it is a constant.
    const literals = code.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|>\s*([A-Za-z][^<>{}\n]*?)\s*</g);
    for (const match of literals) {
      const text = match[1] ?? match[2] ?? match[3] ?? '';
      for (const token of text.matchAll(/\b[A-Z]{2,}\b/g)) {
        if (ALLOWED_UPPERCASE.has(token[0])) continue;
        offenders.push(`${label(path)}: ${token[0]} in "${text.slice(0, 70)}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], `unapproved uppercase interface text:\n${offenders.join('\n')}`);
});

test('P2B7H: the agency acronyms are still spelled as the agencies spell them', () => {
  assert.equal(agencyLabel('FSIS'), 'USDA FSIS');
  assert.equal(agencyLabel('FDA'), 'FDA');
  for (const acronym of ['FDA', 'USDA', 'FSIS']) {
    assert.equal(acronym, acronym.toUpperCase());
    assert.ok(ALLOWED_UPPERCASE.has(acronym));
  }
});

test('P2B7H: recasing stopped at Lotly-authored chrome — source data and documents are untouched', () => {
  // The normalization modules match RAW government product strings, which
  // are frequently all caps. Recasing them would break matching, so they
  // are out of scope and must STILL contain their uppercase corpus.
  const SUMMARY = read('lib', 'consumer-summary.ts');
  assert.ok(SUMMARY.includes("'LLC'"), 'the source-data casing corpus was recased');
  assert.ok(SUMMARY.includes("'BBQ'"));
  // The trust documents are authored prose, including one deliberate
  // emphatic AND; this milestone did not touch them.
  const AFFECTS_ME = read('content', 'how-affects-me-works.ts');
  assert.ok(AFFECTS_ME.includes('only about allergens AND names which allergens'));
  // The dev-only harness keeps its own gallery labels.
  const PREVIEW = read('app', 'design-preview', 'index.tsx');
  assert.ok(PREVIEW.includes('FEED CARD MATRIX'), 'the dev harness was recased needlessly');
});
