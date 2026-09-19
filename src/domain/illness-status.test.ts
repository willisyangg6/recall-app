/**
 * The illness-status contract (P2B7K), pinned.
 *
 * Every source sentence quoted here is REAL: it is the projected summary prose
 * of a case in the live active corpus or of a recorded fixture, copied
 * verbatim. The cases this file exists to prevent are the ones the audit found
 * in production (docs/recall-illness-status.md §3), so a regression that
 * reintroduces one fails here by name.
 *
 * The governing rule is the founder's: **the notice is about illnesses and
 * nothing else.** Injuries, adverse reactions, hospitalizations and deaths get
 * no status, no count and no badge — and they are never deleted from the
 * narrative to make room for one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveIllnessStatus,
  illnessNoticeCopy,
  narrativeKeepsIllnessSentence,
  narrativeWithoutIllness,
  resolveIllnessStatus,
  statusReportsIllness,
  type IllnessStatus,
} from './illness-status';

const copyOf = (text: string | null) => illnessNoticeCopy(deriveIllnessStatus(text));
const textOf = (text: string | null) => copyOf(text)?.text ?? null;

// ── The four states ─────────────────────────────────────────────────────────

test('the four states are distinguishable, and silence is one of them', () => {
  assert.equal(
    deriveIllnessStatus('Four (4) illnesses have been reported to date.').kind,
    'reported_count',
  );
  assert.equal(
    deriveIllnessStatus(
      'This is an ongoing outbreak, and several illnesses have been reported to the Centers for Disease Control and Prevention.',
    ).kind,
    'reported_unspecified',
  );
  assert.equal(
    deriveIllnessStatus('No illnesses have been reported to date.').kind,
    'explicit_none',
  );
  assert.equal(
    deriveIllnessStatus('The product was distributed to retail stores in Ohio.').kind,
    'unknown',
  );
  assert.equal(deriveIllnessStatus(null).kind, 'unknown');
  assert.equal(deriveIllnessStatus('').kind, 'unknown');
});

// ── No zero from missing data ───────────────────────────────────────────────

test('silence renders NOTHING — never a zero, never a placeholder', () => {
  for (const silent of [
    null,
    '',
    'The product was recalled because of undeclared milk.',
    'Acme Foods is recalling frozen beef products shipped to retail locations.',
  ]) {
    const status = deriveIllnessStatus(silent);
    assert.equal(status.kind, 'unknown');
    assert.equal(status.illnesses, null);
    assert.equal(
      illnessNoticeCopy(status),
      null,
      'unknown must have no copy at all — a caller cannot render a row for it',
    );
  }
});

test('disease education is not an illness report and yields no notice', () => {
  const education =
    'Consumption of food contaminated with Salmonella can cause salmonellosis, one of the most common bacterial foodborne illnesses. Older adults and persons with weakened immune systems are more likely to develop a severe illness.';
  assert.equal(deriveIllnessStatus(education).kind, 'unknown');
  assert.equal(copyOf(education), null);
});

test('healthcare advice and discovery prose yield no notice', () => {
  assert.equal(
    copyOf('Anyone concerned about an illness should contact a healthcare provider.'),
    null,
  );
  assert.equal(copyOf('The problem was discovered during FSIS surveillance activities.'), null);
});

// ── Illnesses only: other harms never become an illness status ──────────────

test('a denial of INJURIES is never shown as "No illnesses reported"', () => {
  const status = deriveIllnessStatus('No injuries have been reported to date.');
  assert.equal(status.kind, 'unknown');
  assert.equal(
    illnessNoticeCopy(status),
    null,
    'an injury denial establishes nothing about illness',
  );
});

test('a denial of ADVERSE REACTIONS is never shown as "No illnesses reported"', () => {
  // FSIS's dominant allergen boilerplate: 137 active cases were shown a zero.
  for (const sentence of [
    'There have been no confirmed reports of adverse reactions due to consumption of these products.',
    'To date, American Regent has not received any reports of adverse events related to this recall.',
    'There have been no reported cases of allergic reaction to these products.',
    'At this time, there have been no confirmed reports of adverse health events due to consumption of these products.',
  ]) {
    assert.equal(copyOf(sentence), null, sentence);
  }
});

test('a denial of DEATHS alone establishes nothing about illnesses', () => {
  // Live case 55ee81ad: production showed "Illnesses have been reported." here.
  assert.equal(copyOf('No deaths have been reported to date.'), null);
});

test('a positive ADVERSE REACTION is never shown as an illness', () => {
  // Live cases 9f4c2675, ba28ff60, 97369535.
  for (const sentence of [
    'One customer reported an allergic reaction to milk, which is how the firm became aware of the undeclared allergen.',
    'One adverse reaction has been reported to date.',
    'The FDA continues to receive adverse event reports related to the products identified in this Safety Alert.',
  ]) {
    assert.equal(copyOf(sentence), null, sentence);
  }
});

test('a positive INJURY is never shown as an illness', () => {
  // Live case 7331c7b5.
  assert.equal(copyOf('One consumer reported a dental injury from consuming the product.'), null);
});

test('a HOSPITALIZATION with no illness stated is not an illness report', () => {
  // Live cases 2c491bc9, 4c2f1bf1. A hospitalization implies illness; the
  // source did not state one, and the app does not infer it.
  assert.equal(
    copyOf('One hospitalization due to Listeria monocytogenes has been reported to date.'),
    null,
  );
});

test('a denial naming illnesses AND another harm still speaks about illnesses', () => {
  assert.equal(
    textOf('No illnesses or injuries have been reported to date.'),
    'No illnesses reported',
  );
  assert.equal(
    textOf(
      'At this time, no confirmed allergic reactions or illnesses have been reported related to this issue.',
    ),
    'No illnesses reported',
  );
});

// ── The false-positive class ────────────────────────────────────────────────

test('"has not received reports of illnesses" is a denial, not a report', () => {
  // Live cases f63ce211, b786ac19, fb80b9d9 — production asserted the inverse.
  for (const sentence of [
    'To date, VidaSlim has not received reports of illnesses related to the consumption of this product.',
    'King Arthur Flour has not received any confirmed reports of illnesses related to this product.',
    'To date, Elevation Foods is not aware of any reports of consumer illness related to this product.',
    'No customer illnesses have been reported to date.',
    'To date, there have been no illnesses reported.',
  ]) {
    assert.equal(textOf(sentence), 'No illnesses reported', sentence);
  }
});

// ── Counts ──────────────────────────────────────────────────────────────────

test('singular and plural copy', () => {
  assert.equal(textOf('One consumer illness has been reported to date.'), '1 illness reported');
  assert.equal(textOf('Four (4) illnesses have been reported to date.'), '4 illnesses reported');
  assert.equal(
    textOf(
      'There have been reports of 12 confirmed cases of consumers experiencing stomach illness.',
    ),
    '12 illnesses reported',
  );
});

test('the count shapes the shipped path lost are read', () => {
  const cases: [string, number][] = [
    ['Four (4) illnesses have been reported to date.', 4],
    [
      'It has been reported that there have been 92 instances of illness in connection with this problem.',
      92,
    ],
    ['To date, 55 reports of illnesses have been received by federal and state partners.', 55],
    ['The company was notified by the CDC of 12 recorded illnesses linked to the walnuts.', 12],
    ['Three Salmonella case-patients have been identified.', 3],
    ['To date, two cases of illness have been reported in this outbreak.', 2],
  ];
  for (const [sentence, expected] of cases) {
    const status = deriveIllnessStatus(sentence);
    assert.equal(status.kind, 'reported_count', sentence);
    assert.equal(status.illnesses, expected, sentence);
  }
});

test('a qualified count says so rather than pretending to be exact', () => {
  assert.equal(
    textOf('To date, approximately 12 illnesses have been reported.'),
    'Approximately 12 illnesses reported',
  );
  assert.equal(
    textOf('At least 9 illnesses have been reported to date.'),
    'Approximately 9 illnesses reported',
  );
  assert.equal(
    deriveIllnessStatus('Four (4) illnesses have been reported to date.').approximate,
    false,
  );
});

test('a figure shared with another harm is never an illness count', () => {
  // Live case 4a1af2fc. The illness share of 470 is not stated and cannot be
  // derived, so no notice renders and the sentence stays in What Happened.
  const status = deriveIllnessStatus(
    'To date, the company has received approximately 470 reports of illness or adverse reactions.',
  );
  assert.equal(status.kind, 'unknown');
  assert.equal(status.illnesses, null);
  assert.equal(illnessNoticeCopy(status), null);
});

test('an uncountable report stays uncounted rather than inventing a number', () => {
  const status = deriveIllnessStatus(
    'Illnesses have been reported; the number and extent of which are currently under investigation.',
  );
  assert.equal(status.kind, 'reported_unspecified');
  assert.equal(status.illnesses, null);
  assert.equal(illnessNoticeCopy(status)!.text, 'Illnesses reported');
});

test('two different illness numbers collapse to the uncounted form', () => {
  assert.equal(
    deriveIllnessStatus(
      'Three illnesses were reported in June. Nine illnesses were reported in July.',
    ).kind,
    'reported_unspecified',
  );
});

test('numbers that are not illness counts are never read as one', () => {
  for (const sentence of [
    'As of July 25, 2024, sick people have been identified in 13 states.',
    'The recall covers 120 cases of product distributed to 27 states.',
  ]) {
    assert.equal(deriveIllnessStatus(sentence).illnesses, null, sentence);
  }
});

test('a year and a hospitalization count are never read as the illness count', () => {
  // Live case a9437a1c.
  const status = deriveIllnessStatus(
    'There have been 20 reported cases in six (6) states with onset dates reported between July 24, 2022 and September 19, 2022 with 5 hospitalization and no deaths.',
  );
  assert.notEqual(status.illnesses, 2022);
  assert.notEqual(status.illnesses, 5, 'a hospitalization count is never an illness count');
});

test('hospitalization and death counts never reach the notice', () => {
  // Live case 10ebfa06: the notice shows the 9 and nothing else; the 8 and the
  // 1 stay in What Happened (see the de-duplication tests below).
  const status = deriveIllnessStatus(
    'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  );
  assert.equal(status.illnesses, 9);
  const copy = illnessNoticeCopy(status)!;
  assert.equal(copy.text, '9 illnesses reported');
  assert.doesNotMatch(copy.text, /hospitali|death/i);
  assert.doesNotMatch(copy.spoken, /hospitali|death/i);
});

// ── "No other illnesses": a qualified none establishes nothing (P2B7L) ──────

/**
 * The FSIS closure sentence at the centre of the P2B7L founder decision. It
 * appears verbatim on 23 live cases and is the single most common shape in
 * the qualified-none family.
 */
const FSIS_CLOSURE_BOILERPLATE =
  'FSIS has received no additional reports of injury or illness from consumption of these products.';

test('a qualified none establishes nothing on its own — neither a report nor a denial', () => {
  // Every distinct shape the live corpus carries (docs/recall-illness-status.md
  // §5.3). P2B7K read all of these as PROOF that an illness occurred; none of
  // the 28 notices carrying them states an illness anywhere else.
  for (const sentence of [
    FSIS_CLOSURE_BOILERPLATE,
    'FSIS has received no additional reports of injury or illness from consumption of this product.',
    'There have been no additional reports of injury or illness due to consumption of this product.',
    'No other illnesses have been reported to date.',
    'No other reports of illness have been received to date.',
    'No other reports of injury or illness have been received to date.',
  ]) {
    const status = deriveIllnessStatus(sentence);
    assert.equal(status.kind, 'unknown', sentence);
    assert.equal(statusReportsIllness(status), false, sentence);
    assert.equal(illnessNoticeCopy(status), null, sentence);
  }
});

test('a qualified none is not an explicit none either — the app claims no zero', () => {
  // The correction must not swap one false claim for the opposite one:
  // "No illnesses reported" over this sentence would be just as unfounded.
  const status = deriveIllnessStatus(FSIS_CLOSURE_BOILERPLATE);
  assert.notEqual(status.kind, 'explicit_none');
  assert.equal(status.statements.length, 0, 'it backs no status, so it quotes nothing');
});

test('a known INJURY followed by the boilerplate still establishes no illness', () => {
  const status = deriveIllnessStatus(
    'Two consumers reported injuries after consuming the product. ' + FSIS_CLOSURE_BOILERPLATE,
  );
  assert.equal(status.kind, 'unknown');
  assert.equal(statusReportsIllness(status), false);
  assert.equal(illnessNoticeCopy(status), null);
});

test('an ADVERSE-REACTION denial followed by the boilerplate still establishes no illness', () => {
  const status = deriveIllnessStatus(
    'There have been no confirmed reports of adverse reactions due to consumption of these ' +
      'products. ' +
      FSIS_CLOSURE_BOILERPLATE,
  );
  assert.equal(status.kind, 'unknown');
  assert.equal(statusReportsIllness(status), false);
  assert.equal(illnessNoticeCopy(status), null);
});

test('an established illness count SURVIVES a legitimate no-additional-illness sentence', () => {
  const status = deriveIllnessStatus(
    'There have been 9 illnesses reported in connection with these products. ' +
      'No additional illnesses have been reported to date.',
  );
  assert.equal(status.kind, 'reported_count');
  assert.equal(status.illnesses, 9);
  assert.equal(illnessNoticeCopy(status)!.text, '9 illnesses reported');
});

test('a count stated INSIDE the qualifier sentence is quoted, never manufactured', () => {
  const stated = deriveIllnessStatus(
    'FSIS has received no additional reports of illness beyond the 9 illnesses previously announced.',
  );
  assert.equal(stated.kind, 'reported_count');
  assert.equal(stated.illnesses, 9);

  // …and with no figure anywhere, no count is invented for it.
  const bare = deriveIllnessStatus('No other illnesses have been reported to date.');
  assert.equal(bare.illnesses, null);
  assert.equal(bare.kind, 'unknown');
});

test('a positive illness statement without a count is still reported-unspecified', () => {
  const status = deriveIllnessStatus(
    'Illnesses have been reported in connection with the consumption of these products.',
  );
  assert.equal(status.kind, 'reported_unspecified');
  assert.equal(statusReportsIllness(status), true);
  assert.equal(illnessNoticeCopy(status)!.text, 'Illnesses reported');
});

test('the correction suppresses nothing that is independently supported', () => {
  // Each of these reports an illness on its own terms, and each is followed by
  // the boilerplate. The qualifier must not erase them.
  for (const [prose, kind] of [
    ['There have been 28 illnesses reported in connection with these products.', 'reported_count'],
    ['FSIS has received reports of illness associated with this product.', 'reported_unspecified'],
    ['This recall is associated with reported illnesses.', 'reported_unspecified'],
    ['An outbreak of illnesses has been linked to these products.', 'reported_unspecified'],
    ['Several illnesses have been linked to these products.', 'reported_unspecified'],
  ] as const) {
    const status = deriveIllnessStatus(`${prose} ${FSIS_CLOSURE_BOILERPLATE}`);
    assert.equal(status.kind, kind, prose);
    assert.equal(statusReportsIllness(status), true, prose);
  }
});

test('an explicit illness denial beside the boilerplate still denies', () => {
  const status = deriveIllnessStatus(
    'There have been no reports of illness associated with this product. ' +
      FSIS_CLOSURE_BOILERPLATE,
  );
  assert.equal(status.kind, 'explicit_none');
  assert.equal(illnessNoticeCopy(status)!.text, 'No illnesses reported');
});

test('the boilerplate is never removed from What Happened — it backs no status', () => {
  const narrative = `The product was recalled for undeclared milk. ${FSIS_CLOSURE_BOILERPLATE}`;
  const status = deriveIllnessStatus(narrative);
  assert.equal(narrativeWithoutIllness(narrative, status), narrative);
});

test('"no other illnesses" keeps a trustworthy count stated in the same notice', () => {
  const status = deriveIllnessStatus(
    'Four (4) illnesses have been reported to date. No other illnesses have been reported since.',
  );
  assert.equal(status.kind, 'reported_count');
  assert.equal(status.illnesses, 4);
});

// ── Copy rules the founder set ──────────────────────────────────────────────

test('the word "yet" appears in no copy for any state', () => {
  for (const sample of [
    'No illnesses have been reported to date.',
    'Four (4) illnesses have been reported to date.',
    'One consumer illness has been reported to date.',
    'To date, approximately 12 illnesses have been reported.',
    'Illnesses have been reported; the number and extent of which are under investigation.',
  ]) {
    const copy = copyOf(sample);
    assert.ok(copy, sample);
    assert.doesNotMatch(`${copy.text} ${copy.spoken}`, /\byet\b/i, sample);
  }
});

test('tone separates a report from a denial, and unknown has neither', () => {
  assert.equal(copyOf('Four (4) illnesses have been reported to date.')!.tone, 'reported');
  assert.equal(copyOf('Illnesses have been reported to date.')!.tone, 'reported');
  assert.equal(copyOf('No illnesses have been reported to date.')!.tone, 'none');
  assert.equal(copyOf('The product was distributed in Ohio.'), null);
});

test('the copy never speaks a risk vocabulary word', () => {
  for (const sample of [
    'To date, there have been 9 illnesses linked to the soft cheese products.',
    'No illnesses have been reported to date.',
    'Illnesses have been reported to date.',
  ]) {
    const copy = copyOf(sample)!;
    assert.doesNotMatch(
      `${copy.text} ${copy.spoken}`,
      /\b(critical|high|moderate|low|class [I]+)\b/i,
      sample,
    );
  }
});

test('the spoken label states the count and explains an absent one', () => {
  assert.equal(
    copyOf('One consumer illness has been reported to date.')!.spoken,
    '1 illness reported.',
  );
  assert.match(
    copyOf('Illnesses have been reported; the number is under investigation.')!.spoken,
    /does not give a count/,
  );
});

// ── Supersession and contradiction ──────────────────────────────────────────

const status = (kind: IllnessStatus['kind'], over: Partial<IllnessStatus> = {}): IllnessStatus => ({
  kind,
  illnesses: null,
  approximate: false,
  statements: kind === 'unknown' ? [] : ['a source sentence'],
  ...over,
});

test('the newest establishing notice wins, and a larger later count supersedes', () => {
  const resolved = resolveIllnessStatus([
    status('reported_count', { illnesses: 34 }),
    status('reported_count', { illnesses: 12 }),
  ]);
  assert.equal(resolved.illnesses, 34);
});

test('silence never supersedes an established report', () => {
  const resolved = resolveIllnessStatus([
    status('unknown'),
    status('reported_count', { illnesses: 9 }),
  ]);
  assert.equal(resolved.kind, 'reported_count');
  assert.equal(resolved.illnesses, 9);
});

test('a later denial never un-reports an earlier illness — it fails safe', () => {
  const resolved = resolveIllnessStatus([
    status('explicit_none', { statements: ['No illnesses have been reported.'] }),
    status('reported_count', { illnesses: 9, statements: ['9 illnesses…'] }),
  ]);
  assert.equal(resolved.kind, 'reported_unspecified', 'must never resolve to a zero');
  assert.equal(resolved.illnesses, null, 'a contradicted count is dropped, not guessed');
  assert.equal(illnessNoticeCopy(resolved)!.tone, 'reported');
});

test('all-silent notices resolve to unknown, not to zero', () => {
  assert.equal(resolveIllnessStatus([status('unknown'), status('unknown')]).kind, 'unknown');
  assert.equal(resolveIllnessStatus([]).kind, 'unknown');
});

// ── reportsIllness: the flag behind material change and push ────────────────

test('reportsIllness is true only for a confirmed illness', () => {
  for (const sentence of [
    'Four (4) illnesses have been reported.',
    'Illnesses have been reported to date.',
    'To date, approximately 12 illnesses have been reported.',
  ]) {
    assert.equal(statusReportsIllness(deriveIllnessStatus(sentence)), true, sentence);
  }
});

test('reportsIllness is false for every non-illness and every denial', () => {
  for (const sentence of [
    'No illnesses have been reported to date.',
    'To date, VidaSlim has not received reports of illnesses related to the consumption of this product.',
    'The product was distributed to retail stores in Ohio.',
    'No injuries have been reported to date.',
    'There have been no confirmed reports of adverse reactions due to consumption of these products.',
    'One consumer reported a dental injury from consuming the product.',
    'One adverse reaction has been reported to date.',
    'One hospitalization due to Listeria monocytogenes has been reported to date.',
    'No deaths have been reported to date.',
    'Consumption of food contaminated with Salmonella can cause salmonellosis.',
  ]) {
    assert.equal(statusReportsIllness(deriveIllnessStatus(sentence)), false, sentence);
  }
});

// ── What Happened de-duplication ────────────────────────────────────────────

test('the backing illness sentence is removed once the notice fully represents it', () => {
  const narrative =
    'Acme Foods is recalling frozen beef. Four (4) illnesses have been reported to date. The product was shipped to retail locations.';
  const deduped = narrativeWithoutIllness(narrative, deriveIllnessStatus(narrative));
  assert.doesNotMatch(deduped, /Four \(4\) illnesses/);
  assert.match(deduped, /recalling frozen beef/);
  assert.match(deduped, /shipped to retail locations/);
});

test('a hospitalization or a death is NEVER deleted to avoid a duplicate', () => {
  const sentence =
    'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.';
  const narrative = `Acme is recalling cheese. ${sentence} The recall covers 1,200 cases.`;
  const derived = deriveIllnessStatus(narrative);
  const deduped = narrativeWithoutIllness(narrative, derived);
  assert.match(deduped, /8 hospitalizations, and 1 death/);
  assert.equal(narrativeKeepsIllnessSentence(narrative, derived), true);
  // …and the notice still renders the illness count beside it.
  assert.equal(illnessNoticeCopy(derived)!.text, '9 illnesses reported');
});

test('an injury or adverse-reaction sentence is never removed', () => {
  for (const sentence of [
    'One consumer reported a dental injury from consuming the product.',
    'One customer reported an allergic reaction to milk.',
    'No injuries have been reported to date.',
    'There have been no confirmed reports of adverse reactions due to consumption of these products.',
  ]) {
    const narrative = `The firm is recalling the product. ${sentence}`;
    const derived = deriveIllnessStatus(narrative);
    assert.ok(
      narrativeWithoutIllness(narrative, derived).includes(sentence),
      `must keep: ${sentence}`,
    );
  }
});

test('a qualified illness sentence is kept — the notice does not reproduce the qualification', () => {
  const sentence =
    'Three Salmonella case-patients have been identified with illness onset dates ranging from July 5 to July 7, 2016.';
  const narrative = `The firm is recalling the product. ${sentence}`;
  const derived = deriveIllnessStatus(narrative);
  assert.match(narrativeWithoutIllness(narrative, derived), /onset dates ranging/);
});

test('unknown removes nothing and fabricates nothing', () => {
  const narrative = 'Acme Foods is recalling frozen beef products shipped to retail locations.';
  const derived = deriveIllnessStatus(narrative);
  assert.equal(derived.kind, 'unknown');
  assert.equal(narrativeWithoutIllness(narrative, derived), narrative);
});

test('the recall explanation is never removed', () => {
  const narrative =
    'The recall was initiated after routine testing found Listeria monocytogenes. No illnesses have been reported to date. The recall covers 1,200 cases.';
  const deduped = narrativeWithoutIllness(narrative, deriveIllnessStatus(narrative));
  assert.match(deduped, /routine testing found Listeria/);
  assert.match(deduped, /covers 1,200 cases/);
  assert.doesNotMatch(deduped, /No illnesses have been reported/);
});

test('removal never empties the narrative', () => {
  const only = 'No illnesses have been reported to date.';
  assert.equal(narrativeWithoutIllness(only, deriveIllnessStatus(only)), only);
});

// ── The contract carries no harm but illness ────────────────────────────────

test('the status shape has no field for any harm but illness', () => {
  const derived = deriveIllnessStatus(
    'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  );
  const keys = Object.keys(derived).map((key) => key.toLowerCase());
  for (const forbidden of ['hospitaliz', 'death', 'injur', 'adverse', 'harm', 'denied']) {
    assert.ok(
      !keys.some((key) => key.includes(forbidden)),
      `the illness contract must not carry ${forbidden}`,
    );
  }
  for (const forbidden of ['tier', 'risk', 'class', 'severity', 'level']) {
    assert.ok(!keys.some((key) => key.includes(forbidden)), `a count is not a ${forbidden}`);
  }
});
