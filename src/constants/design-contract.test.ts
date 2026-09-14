/**
 * The design contract (DESIGN.md), pinned to the product it must carry.
 *
 * DESIGN.md records the shipped behaviors no visual pass may remove: the
 * three navigation destinations, the Recall Detail section order, the
 * community-report states, the questionnaire, the disclosure rules, the
 * interaction states, and the accessibility floor. Where the contract quotes
 * product copy, these tests read the same words from the presentation
 * contracts (`lib/shopper-report-presentation`, `lib/recall-presentation`),
 * so the document can never quietly drift from what the app says.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { CUSTOM_FONTS_INSTALLED, REQUIRED_FONT_FACES } from '@/constants/design-tokens';
import {
  AFFECTED_PRODUCTS_INITIAL_ROWS,
  disclosureControl,
  officialSourceLink,
  SHOW_LESS_LABEL,
  WHERE_SOLD_INITIAL_STATES,
} from '@/lib/recall-presentation';
import {
  communityReportsView,
  PRIVACY_LINK_LABEL,
  questionnaireSteps,
  REPORT_ADD_ACTION,
  REPORT_EDIT_ACTION,
  REPORT_ENTRY_QUESTION,
  STATE_CONFIRM_OPTIONS,
  STATE_QUESTION_PROMPT,
  stateConfirmPrompt,
  SUBMISSION_DISCLOSURE,
  SUBMIT_ACTION,
  SUCCESS_BODY,
  SUCCESS_TITLE,
  UPDATE_ACTION,
} from '@/lib/shopper-report-presentation';

const DESIGN_MD = readFileSync(join(__dirname, '..', '..', 'DESIGN.md'), 'utf8');

/** The body of one `##`/`###` section, up to the next heading of the same or higher level. */
function sectionBody(heading: string): string {
  const start = DESIGN_MD.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `DESIGN.md has the heading "${heading}"`);
  const level = heading.match(/^#+/)![0].length;
  const rest = DESIGN_MD.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

/** Prose with line wraps collapsed, so a phrase can be checked regardless of wrapping. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function order(text: string, phrases: string[]): void {
  let cursor = -1;
  for (const phrase of phrases) {
    const at = text.indexOf(phrase, cursor + 1);
    assert.ok(at > cursor, `"${phrase}" appears, after the previous phrase`);
    cursor = at;
  }
}

// ── Structure ───────────────────────────────────────────────────────────────

test('the contract is one document with the four-level source-of-truth order', () => {
  assert.ok(DESIGN_MD.includes('# Lotly Design System'));
  const body = sectionBody('### Source of truth');
  order(body, [
    '1. **Production code owns behavior',
    '2. **Final founder decisions override outdated Figma content.**',
    '3. **Figma owns approved visual composition**',
    '4. **This `DESIGN.md` owns reusable tokens',
  ]);
  assert.ok(flat(body).includes('never discard working product behavior'));
});

// ── Navigation ──────────────────────────────────────────────────────────────

test('bottom navigation is exactly Feed, Saved, Profile — search inside Feed, no fourth tab', () => {
  const body = sectionBody('### Bottom Navigation');
  assert.ok(body.includes('**exactly three visible destinations**'));
  order(body, ['- Feed (home icon)', '- Saved (bookmark icon)', '- Profile (user icon)']);
  assert.ok(body.includes('Search stays inside Feed.'));
  assert.ok(body.includes('There is no fourth tab'));
  assert.ok(flat(body).includes('Feed is never renamed Home in consumer-facing UI'));
  assert.ok(!/- Home/.test(body), 'no destination named Home');
});

test('the consumer screen is Feed, not Home', () => {
  const naming = sectionBody('### Naming');
  assert.ok(naming.includes('**The consumer screen is `Feed`, never `Home`.**'));
  assert.ok(DESIGN_MD.includes('### Feed'));
  assert.ok(!DESIGN_MD.includes('### Home'));
});

// ── Recall Detail ───────────────────────────────────────────────────────────

test('Recall Detail keeps its five sections in order, with Health Risk fourth', () => {
  const body = sectionBody('### Recall Detail');
  order(body, [
    '1. Header / product identity',
    '2. What Happened',
    '3. Where It Was Sold',
    '4. Health Risk',
    '5. Affected Products',
  ]);
  assert.ok(
    body.includes('Community information belongs **under** the official Where It Was Sold'),
  );
});

test('the official-source label is data-driven, exactly as the presentation contract builds it', () => {
  const body = sectionBody('### Recall Detail');
  assert.ok(body.includes('`View the official {agency} report`'));
  assert.equal(
    officialSourceLink('FDA', 'recall', 'https://example.test').label,
    'View the official FDA report',
  );
  assert.equal(
    officialSourceLink('FSIS', 'public_health_alert', 'https://example.test').label,
    'View the official FSIS alert',
  );
  assert.ok(flat(body).includes('Never hardcode `FDA` as the universal source'));
});

// ── Community reports ───────────────────────────────────────────────────────

test('the community-report states quote the shipped copy', () => {
  const body = sectionBody('### Community shopper reports');
  assert.ok(body.includes(`\`${REPORT_ENTRY_QUESTION}\``));
  assert.ok(body.includes(`\`${REPORT_ADD_ACTION}\``));
  assert.ok(body.includes(`\`${REPORT_EDIT_ACTION}\``));
  assert.ok(body.includes('`{count} shoppers reported finding it here`'));
  assert.ok(body.includes('three or more reports'));
  assert.ok(body.includes('No personal confirmation sentence appears on Recall Detail'));
  assert.ok(body.includes('Removal is available only inside the edit flow, behind a confirmation'));
  assert.ok(body.includes('Only the purchase-timeframe answer remains available'));
  assert.ok(body.includes('The server gate is authoritative'));
  assert.ok(body.includes('the app holds no local feature flag'));

  // The `{count}` placeholder is the real count line, and the states are the
  // view model's own.
  const reported = communityReportsView({ status: 'reported', count: 12 }, null);
  assert.equal(reported?.countLine, '12 shoppers reported finding it here');
  assert.equal(reported?.actionLabel, REPORT_ADD_ACTION);
  const below = communityReportsView({ status: 'below_threshold' }, null);
  assert.equal(below?.prompt, REPORT_ENTRY_QUESTION);
  assert.equal(below?.actionLabel, REPORT_ADD_ACTION);
});

// ── Questionnaire ───────────────────────────────────────────────────────────

test('the questionnaire order and copy are the shipped ones', () => {
  const body = sectionBody('### Questionnaire');
  order(body, [
    '1. **State** — always first.',
    '2. **Retailer**',
    '3. **Purchase timeframe.**',
    '4. **Review.**',
    '5. **Disclosure**',
    '6. **Submit**',
  ]);
  assert.ok(body.includes('`Did you find this product in {State}?` with Yes/No'));
  assert.equal(stateConfirmPrompt('CA'), 'Did you find this product in California?');
  assert.deepEqual(
    STATE_CONFIRM_OPTIONS.map((o) => o.label),
    ['Yes', 'No'],
  );
  assert.ok(body.includes(`\`${STATE_QUESTION_PROMPT}\``));
  assert.ok(body.includes('Unknown geography: omit the state question'));
  assert.ok(body.includes(`\`${SUBMISSION_DISCLOSURE} ${PRIVACY_LINK_LABEL}\``));
  assert.ok(body.includes(`\`${PRIVACY_LINK_LABEL}\` opens Privacy & Data Controls`));
  assert.ok(body.includes(`\`${SUCCESS_TITLE}\``));
  assert.ok(body.includes(`\`${SUCCESS_BODY}\``));
  assert.ok(body.includes('Do not collect health information'));
  assert.ok(body.includes(`\`${SUBMIT_ACTION}\``));
  assert.ok(body.includes(`\`${UPDATE_ACTION}\``));

  // Retailer only when canonical retailers exist; state always first.
  assert.deepEqual(questionnaireSteps({ allowedStateCodes: ['CA'], retailerChoices: [] }), [
    'state',
    'window',
  ]);
  assert.deepEqual(
    questionnaireSteps({ allowedStateCodes: ['CA', 'WA'], retailerChoices: ['Costco'] }),
    ['state', 'retailer', 'window'],
  );
});

// ── Disclosures ─────────────────────────────────────────────────────────────

test('jurisdiction, product-row and cell disclosures are recorded with the shipped thresholds', () => {
  const body = sectionBody('### Detail disclosure behavior');
  assert.equal(WHERE_SOLD_INITIAL_STATES, 5);
  assert.equal(AFFECTED_PRODUCTS_INITIAL_ROWS, 1);
  assert.ok(body.includes('Five or fewer: show all.'));
  assert.ok(body.includes('More than five: show the first five and `See all (N)`.'));
  assert.ok(body.includes('Initially show the first product row.'));
  assert.ok(body.includes('show `See all (N)` beside the section heading'));
  assert.ok(body.includes('Show the first two values.'));
  assert.ok(body.includes("More than two uses that cell's own independent `See all (N)` control."));
  assert.ok(body.includes('aligned line-for-line'));
  assert.ok(body.includes('A paired group expands and collapses together'));
  assert.ok(body.includes('Never reconstruct pairs by array position.'));
  assert.ok(body.includes('Do not reorder values'));
  assert.equal(
    (body.match(/`Show less`/g) ?? []).length,
    2,
    'both expanded actions read Show less',
  );

  const control = disclosureControl(10, 'jurisdictions');
  assert.equal(control.expandLabel, 'See all (10)');
  assert.equal(control.collapseLabel, SHOW_LESS_LABEL);
  assert.equal(SHOW_LESS_LABEL, 'Show less');
});

// ── States and accessibility ────────────────────────────────────────────────

test('loading, empty, error, disabled, pressed and selected states are all defined', () => {
  const body = sectionBody('## Interaction states');
  for (const state of ['Loading', 'Empty', 'Error', 'Disabled', 'Pressed', 'Selected']) {
    assert.ok(body.includes(`- **${state}**`), state);
  }
});

test('the accessibility floor is recorded: 44pt, VoiceOver, expanded state, Dynamic Type, motion, safe areas', () => {
  const body = sectionBody('## Accessibility');
  assert.ok(body.includes('**Minimum interactive target: 44×44pt.**'));
  assert.ok(body.includes('**VoiceOver labels.**'));
  assert.ok(body.includes('**Expanded/collapsed state.**'));
  assert.ok(body.includes('`accessibilityState.expanded`'));
  assert.ok(body.includes('**Dynamic Type and text wrapping.**'));
  assert.ok(flat(body).includes('no `maxFontSizeMultiplier` caps anywhere'));
  assert.ok(body.includes('**Reduced motion.**'));
  assert.ok(body.includes('**Safe areas**'));
  assert.ok(DESIGN_MD.includes('### Safe areas'));
});

test('horizontal scrolling is limited to the affected-products viewport', () => {
  const body = sectionBody('### Affected Products table');
  assert.ok(body.includes('**Horizontal scrolling is applied to the table viewport only.**'));
  assert.ok(
    body.includes('The screen/page and main inner-content frame must never horizontally pan.'),
  );
});

// ── Guardrails ──────────────────────────────────────────────────────────────

test('copying generated React/Tailwind from Figma into React Native is prohibited', () => {
  const body = sectionBody('### Do not copy generated code from Figma');
  assert.ok(body.includes('React + Tailwind'));
  assert.ok(body.includes('is prohibited'));
  assert.ok(flat(body).includes('Tailwind class, CSS variable, shadcn primitive'));
});

test('the accidental fractional Figma values are listed as normalized, not adopted', () => {
  const body = sectionBody('### Do not copy accidental fractional values');
  for (const value of ['17.786', '11.233', '12.169', '14.978', '7.489']) {
    assert.ok(body.includes(`\`${value}px\``), value);
  }
});

test('token naming follows Figma, with React Native mappings recorded separately', () => {
  const naming = sectionBody('### Naming');
  assert.ok(naming.includes('`background/page`'));
  assert.ok(naming.includes("`color['background/page']`"));
  assert.ok(DESIGN_MD.includes('### React Native mapping'));
  assert.ok(DESIGN_MD.includes('### Figma ↔ code mapping'));
});

test('the Critical treatment is canonical and label/Critical is retired', () => {
  const body = sectionBody('### Risk colors');
  assert.match(
    body,
    /\| Critical\s+\| `risk\/critical`\s+\| `#EF4E47`\s+\| `#001F3E`\s+\| `#C82728`\s+\|/,
  );
  assert.ok(body.includes('**Critical is one treatment everywhere.**'));
  assert.ok(body.includes('`label/Critical`'));
  assert.ok(body.includes('obsolete'));
  for (const label of ['Critical', 'Very High', 'High', 'Moderate', 'Low', 'Pending', 'Unknown']) {
    assert.match(body, new RegExp(`\\| ${label}\\s+\\|`), label);
  }
  assert.ok(body.includes('is business logic, not design'));
});

test('the Figma corrections list exists and names the Critical replacement first', () => {
  const body = sectionBody('## Figma corrections for Cheyenne');
  const items = body.split('\n').filter((line) => line.startsWith('- [ ]'));
  assert.ok(items.length >= 10);
  assert.ok(items[0].includes('`label/Critical`'));
  assert.ok(body.includes('`156:218`'));
  assert.ok(body.includes('Rename frame `home`'));
});

test('the fonts section states the installation truth the tokens report', () => {
  const body = sectionBody('### Fonts');
  assert.ok(
    body.includes(
      'npx expo install expo-font @expo-google-fonts/public-sans @expo-google-fonts/ibm-plex-mono',
    ),
  );
  if (CUSTOM_FONTS_INSTALLED) {
    assert.ok(!flat(DESIGN_MD).includes('not yet installed'));
    assert.ok(body.includes('Both families are installed'));
    for (const face of REQUIRED_FONT_FACES) assert.ok(body.includes(`\`${face}\``), face);
  } else {
    assert.ok(body.includes('Neither family is installed.'));
  }
});

test('dark mode is recorded as intentionally deferred and the app locked to light', () => {
  const body = sectionBody('### Dark mode');
  assert.ok(flat(body).includes('intentionally deferred'));
  assert.ok(body.includes('`userInterfaceStyle`'));
  assert.ok(body.includes('`light`'));
  assert.ok(flat(body).includes('no toggle'));
  const appJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')) as {
    expo: { userInterfaceStyle: string };
  };
  assert.equal(appJson.expo.userInterfaceStyle, 'light');
});

test('the bottom navigation shows its three labels, styled from the tokens', () => {
  const body = sectionBody('### Bottom Navigation');
  assert.ok(flat(body).includes('visibly labelled'));
  const tabs = readFileSync(join(__dirname, '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');
  for (const label of ['Feed', 'Saved', 'Profile']) {
    assert.ok(tabs.includes(`tabBarLabel: '${label}'`), label);
    assert.ok(tabs.includes(`tabBarAccessibilityLabel: '${label}'`), label);
  }
  assert.equal((tabs.match(/<Tabs\.Screen/g) ?? []).length, 3, 'exactly three destinations');
  assert.ok(!tabs.includes("'Home'"));
  assert.ok(tabs.includes("tabBarLabelStyle: textStyle('caption')"));
  assert.ok(tabs.includes("tabBarActiveTintColor: color['action/primary']"));
  assert.ok(tabs.includes("tabBarInactiveTintColor: color['text/secondary']"));
});
