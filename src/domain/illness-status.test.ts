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
  noticeTexts,
  narrativeWithoutIllness,
  resolveIllnessStatus,
  statusReportsIllness,
  type HarmFact,
  type IllnessStatus,
} from './illness-status';

const copyOf = (text: string | null) => illnessNoticeCopy(deriveIllnessStatus(text));
/**
 * THE illness line of the notice, or null. Since P2B7Q.1 a notice may carry
 * hospitalization and death lines beside it, so this names which line it
 * means rather than assuming the notice has only one.
 */
const textOf = (text: string | null) => {
  const first = copyOf(text)?.notices[0].text;
  return first !== undefined && /illness/i.test(first) ? first : null;
};
/** The same, for a status built by hand. */
const lineOf = (status: IllnessStatus) => illnessNoticeCopy(status)!.notices[0].text;

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
  // source did not state one, and the app still does not infer it — there is
  // no illness line. P2B7Q.1 states the fact the notice DID establish, on its
  // own line, where before the whole notice stayed silent.
  const sentence = 'One hospitalization due to Listeria monocytogenes has been reported to date.';
  const status = deriveIllnessStatus(sentence);
  assert.equal(status.kind, 'unknown');
  assert.equal(status.illnesses, null);
  assert.equal(textOf(sentence), null, 'an illness line was inferred from a hospitalization');
  assert.deepEqual(noticeTexts(copyOf(sentence)!), ['1 hospitalization reported']);
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
  assert.equal(lineOf(status), 'Illnesses reported');
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

test('hospitalization and death counts reach the notice, each on its own line', () => {
  // Live case 10ebfa06. P2B7K showed the 9 alone, believing the 8 and the 1
  // survived in What Happened; P2B7Q measured that they reached no surface at
  // all. P2B7Q.1 states all three.
  const status = deriveIllnessStatus(
    'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  );
  assert.equal(status.illnesses, 9);
  const copy = illnessNoticeCopy(status)!;
  assert.equal(copy.notices[0].text, '9 illnesses reported');
  assert.deepEqual(
    copy.notices.slice(1).map((n) => n.text),
    ['8 hospitalizations reported', '1 death reported'],
  );
  assert.equal(copy.spoken, '9 illnesses reported. 8 hospitalizations reported. 1 death reported.');
});

test('P2B7V: every harm combination the live corpus contains renders as its own boxes', () => {
  // Measured over the 898 consumer-visible active cases (2026-09-21). Each
  // row below is a shape that EXISTS, with the case it was taken from, so a
  // regression in any one of them fails here rather than on a screen. The
  // order is always illnesses → hospitalizations → deaths, and it does not
  // change when one of the three is absent.
  const cases: {
    label: string;
    summary: string;
    expected: [text: string, tone: string][];
  }[] = [
    {
      label: 'illnesses only, plural (23 live cases)',
      summary: 'Three illnesses have been reported to date.',
      expected: [['3 illnesses reported', 'illnesses']],
    },
    {
      label: 'illnesses only, SINGULAR (3 live cases)',
      summary: 'One illness has been reported to date.',
      expected: [['1 illness reported', 'illnesses']],
    },
    {
      label: 'positive illness with no trustworthy count (11 live cases)',
      summary: 'Illnesses have been reported in connection with this recall.',
      expected: [['Illnesses reported', 'illnesses']],
    },
    {
      label: 'illnesses + hospitalizations, both counted (decd41aa)',
      summary: 'Three illnesses and three hospitalizations have been reported.',
      expected: [
        ['3 illnesses reported', 'illnesses'],
        ['3 hospitalizations reported', 'hospitalizations'],
      ],
    },
    {
      label: 'illnesses + hospitalizations without a count (c4f8c9e4, f84e2407)',
      summary: 'Two illnesses have been reported. Hospitalizations have been reported.',
      expected: [
        ['2 illnesses reported', 'illnesses'],
        ['Hospitalizations reported', 'hospitalizations'],
      ],
    },
    {
      label: 'illnesses + deaths, singular death (f8a2c8ab — Soft Ricotta / La Colonia)',
      summary: 'There have been 12 illnesses and 1 death linked to these products.',
      expected: [
        ['12 illnesses reported', 'illnesses'],
        ['1 death reported', 'deaths'],
      ],
    },
    {
      label: 'illnesses + deaths, plural deaths (fca62f93)',
      summary: 'There have been 38 illnesses and 11 deaths linked to these products.',
      expected: [
        ['38 illnesses reported', 'illnesses'],
        ['11 deaths reported', 'deaths'],
      ],
    },
    {
      label: 'ALL THREE (10ebfa06)',
      summary:
        'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
      expected: [
        ['9 illnesses reported', 'illnesses'],
        ['8 hospitalizations reported', 'hospitalizations'],
        ['1 death reported', 'deaths'],
      ],
    },
    {
      label: 'hospitalization ALONE — no illness line at all (2c491bc9, 4c2f1bf1)',
      summary: 'One hospitalization due to Listeria monocytogenes has been reported to date.',
      expected: [['1 hospitalization reported', 'hospitalizations']],
    },
    {
      label: 'unspecified illnesses + counted hospitalizations (55ee81ad)',
      summary: 'Illnesses have been reported. 31 hospitalizations have been reported to date.',
      expected: [
        ['Illnesses reported', 'illnesses'],
        ['31 hospitalizations reported', 'hospitalizations'],
      ],
    },
    {
      label: 'explicit denial — the calm box, and the only route to it (557 live cases)',
      summary: 'No illnesses have been reported to date.',
      expected: [['No illnesses reported', 'none']],
    },
  ];

  for (const { label, summary, expected } of cases) {
    const copy = illnessNoticeCopy(deriveIllnessStatus(summary));
    assert.ok(copy !== null, label);
    assert.deepEqual(
      copy.notices.map((n) => [n.text, n.tone]),
      expected,
      label,
    );
    // Whatever the combination, every box is a complete utterance of its own
    // and the group reads as one sentence per fact.
    assert.equal(copy.spoken, `${copy.notices.map((n) => n.spoken).join('. ')}.`, label);
  }

  // The eleventh shape: silence. 296 live cases establish nothing, and they
  // render NO box — not an empty stack, not a zero (P2B7K).
  assert.equal(copyOf('The product was distributed to retail stores in Ohio.'), null);
  assert.equal(copyOf(null), null);
});

test('P2B7V: a harm keeps its own treatment wherever it lands in the stack', () => {
  // Severity belongs to the FACT, never to the position. A death is the
  // critical treatment whether it is the first box or the third, and a
  // hospitalization is never promoted to the illness treatment for being the
  // only box — which is exactly what a positional colour rule would do.
  const alone = illnessNoticeCopy(
    deriveIllnessStatus('One hospitalization has been reported to date.'),
  )!;
  assert.deepEqual(
    alone.notices.map((n) => n.tone),
    ['hospitalizations'],
  );

  const third = illnessNoticeCopy(
    deriveIllnessStatus(
      'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the products.',
    ),
  )!;
  assert.equal(third.notices[2].tone, 'deaths');

  const second = illnessNoticeCopy(
    deriveIllnessStatus('No illnesses have been reported. Two deaths have been reported.'),
  )!;
  assert.deepEqual(
    second.notices.map((n) => n.tone),
    ['none', 'deaths'],
  );
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
  assert.equal(lineOf(status), '9 illnesses reported');
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
  assert.equal(lineOf(status), 'Illnesses reported');
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
  assert.equal(lineOf(status), 'No illnesses reported');
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
    assert.doesNotMatch(`${noticeTexts(copy).join(' ')} ${copy.spoken}`, /\byet\b/i, sample);
  }
});

test('tone separates a report from a denial, and unknown has neither', () => {
  // P2B7V: tone is per BOX, and it names the harm the box states — which is
  // what the treatment is looked up by. An illness report and an illness
  // denial are different boxes, never the same box recoloured.
  assert.equal(
    copyOf('Four (4) illnesses have been reported to date.')!.notices[0].tone,
    'illnesses',
  );
  assert.equal(copyOf('Illnesses have been reported to date.')!.notices[0].tone, 'illnesses');
  assert.equal(copyOf('No illnesses have been reported to date.')!.notices[0].tone, 'none');
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
      `${noticeTexts(copy).join(' ')} ${copy.spoken}`,
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

const NO_HARM: HarmFact = { kind: 'unknown', count: null, approximate: false, statements: [] };
const status = (kind: IllnessStatus['kind'], over: Partial<IllnessStatus> = {}): IllnessStatus => ({
  kind,
  illnesses: null,
  approximate: false,
  statements: kind === 'unknown' ? [] : ['a source sentence'],
  hospitalizations: NO_HARM,
  deaths: NO_HARM,
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
  assert.equal(illnessNoticeCopy(resolved)!.notices[0].tone, 'illnesses');
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
  assert.equal(lineOf(derived), '9 illnesses reported');
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

test('the status shape carries exactly three harms, and nothing that is not one', () => {
  const derived = deriveIllnessStatus(
    'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
  );
  const keys = Object.keys(derived).map((key) => key.toLowerCase());
  assert.ok(keys.includes('hospitalizations'));
  assert.ok(keys.includes('deaths'));
  for (const forbidden of ['injur', 'adverse', 'denied']) {
    assert.ok(
      !keys.some((key) => key.includes(forbidden)),
      `the illness contract must not carry ${forbidden}`,
    );
  }
  for (const forbidden of ['tier', 'risk', 'class', 'severity', 'level']) {
    assert.ok(!keys.some((key) => key.includes(forbidden)), `a count is not a ${forbidden}`);
  }
});

// ── A disease name is not education, and not a report either (P2B7L.1) ──────

/**
 * The distinction this section pins is structural, not lexical.
 *
 * `salmonellosis` and `listeriosis` used to sit as bare alternations inside
 * the education guard, so naming the disease was enough to silence a sentence.
 * That silenced the sentences in which FSIS and FDA actually report the
 * outbreak, and it made the positive branch that names the diseases
 * unreachable. What makes a sentence education is the disease standing as the
 * subject of a general statement; what makes it a report is people.
 */

test('educational disease prose reports nothing, in either disease', () => {
  for (const education of [
    'Consumption of food contaminated with Salmonella can cause salmonellosis, a foodborne illness.',
    'Consumption of food contaminated with Listeria monocytogenes can cause listeriosis, a serious infection that primarily affects older adults.',
    'Listeriosis is treated with antibiotics.',
    'Listeriosis can cause fever, muscle aches, headache, stiff neck, confusion, loss of balance and convulsions.',
    'Symptoms of salmonellosis usually start 6 hours to 6 days after infection and last 4 to 7 days.',
  ]) {
    assert.equal(deriveIllnessStatus(education).kind, 'unknown', education);
    assert.equal(copyOf(education), null, education);
  }
});

test('a disease name with a count is the count the source stated', () => {
  // FSIS's epidemiologic finding, verbatim from two live notices. Before
  // P2B7L.1 the word `listeriosis` alone made this inert.
  const status = deriveIllnessStatus(
    'The epidemiologic investigation identified a total of four listeriosis confirmed illnesses, including one death, between July 8, 2017 and August 11, 2018.',
  );
  assert.equal(status.kind, 'reported_count');
  assert.equal(status.illnesses, 4);
  assert.equal(lineOf(status), '4 illnesses reported');
});

test('a disease-named outbreak linked to the recalled product reports it', () => {
  // HMC Farms, verbatim. The recalled product is the subject, the link is
  // stated outright, and the count is the source's own.
  const status = deriveIllnessStatus(
    'The recalled peaches have been linked to an outbreak of Listeriosis that has resulted in eleven illnesses.',
  );
  assert.equal(status.kind, 'reported_count');
  assert.equal(status.illnesses, 11);
});

test('the disease-named positive branch is reachable at all', () => {
  // The branch `associated with … reported … salmonellosis|listeriosis` could
  // not fire before P2B7L.1: any sentence able to match it was removed as
  // education first. These reach it — the first through its `illnesses`, the
  // second and third through the disease name itself, which is the alternative
  // that had never once run in production.
  for (const reported of [
    'The cucumbers described above were associated with reported salmonellosis illnesses between October 12 and November 15, 2024.',
    'Ill consumers were linked to reported salmonellosis in several states.',
    'The product was associated with reported listeriosis among ill consumers.',
  ]) {
    assert.equal(deriveIllnessStatus(reported).kind, 'reported_unspecified', reported);
  }
});

test('and P2B7L.2 closes the boundary: a disease name alone is enough to be READ', () => {
  // P2B7L.1 left `MENTIONS_HARM` without the disease names, so a sentence that
  // stated its illnesses only as a named disease was never even looked at. That
  // was recorded as a conservative miss costing nothing, because no notice in
  // the corpus then stated its illnesses that way.
  //
  // The infant-formula recalls do exactly that — "a total of 31 infants with
  // suspected or confirmed INFANT BOTULISM … have been reported" never uses the
  // word "illness" — so the boundary started costing real reports and is closed.
  // Eligibility is not evidence: it means only that the sentence is read.
  assert.equal(
    deriveIllnessStatus(
      'The products were linked to reported listeriosis among consumers in several states.',
    ).kind,
    'reported_unspecified',
  );
  assert.equal(
    textOf('Nine cases of salmonellosis have been reported in connection with this product.'),
    '9 illnesses reported',
  );

  // What became eligible did NOT become positive. Each of these is read now and
  // still establishes nothing.
  for (const inert of [
    'Botulism is a potentially fatal form of food poisoning.',
    'Symptoms of botulism include dizziness, blurred or double vision, and trouble with speaking or swallowing.',
    'Uneviscerated fish have been linked to outbreaks of botulism poisoning.',
    'Salmonellosis usually lasts four to seven days.',
  ]) {
    assert.equal(deriveIllnessStatus(inert).kind, 'unknown', inert);
    assert.equal(copyOf(inert), null, inert);
  }
});

test("a supplier's outbreak is not this recall's illness report", () => {
  // Walmart recalls cut slices that MAY CONTAIN RECALLED cucumbers SUPPLIED BY
  // another firm; the illnesses are that firm's product's. Telling a shopper
  // this product made people ill is the failure being prevented.
  const status = deriveIllnessStatus(
    'The recall was initiated because this product may contain recalled whole cucumbers supplied by SunFed Produce, LLC of Rio Rico, AZ, which initiated a recall after the FDA notified SunFed that the cucumbers described above were associated with reported salmonellosis illnesses.',
  );
  assert.equal(status.kind, 'unknown');
  assert.equal(illnessNoticeCopy(status), null);
});

test("and the supplier's own notice, recalling that product, does report it", () => {
  // The same clause, in the notice that recalls the cucumbers themselves.
  // Identical words, opposite answers — which is the point.
  assert.equal(
    deriveIllnessStatus(
      'SunFed initiated this recall after the FDA notified SunFed that the cucumbers described above were associated with reported salmonellosis illnesses between October 12 and November 15, 2024.',
    ).kind,
    'reported_unspecified',
  );
});

test('a hedged link establishes nothing, however many illnesses it names', () => {
  // "may be linked" is the source saying it does not yet know. An outbreak
  // total that only MIGHT belong to this product is not this product's count.
  for (const hedged of [
    'At this time, the FDA and CDC have reported that the outbreak may be linked to Rosabella Moringa Capsules.',
    'To date, there have been 7 illnesses resulting in 3 hospitalizations across the United States due to Salmonella contamination, 3 of which may be linked to a single product.',
    'Baloian initiated this recall after learning that its supplier of American cucumbers may be associated with reported salmonellosis illnesses.',
  ]) {
    assert.equal(deriveIllnessStatus(hedged).kind, 'unknown', hedged);
  }
});

test('a hedge on CONTAMINATION never silences a report beside it', () => {
  // The hedge guard is written against the link, not against the word "may".
  // A notice may call contamination possible and still report illnesses.
  const status = deriveIllnessStatus(
    'The product may be contaminated with Listeria monocytogenes. The epidemiologic investigation identified a total of four listeriosis confirmed illnesses.',
  );
  assert.equal(status.kind, 'reported_count');
  assert.equal(status.illnesses, 4);
});

test('people who ate the recalled product are a report, whoever supplied it', () => {
  // FSIS names the RECALLING establishment with "supplied by" in the very
  // sentence that reports the victims. Reading that as supplier prose would
  // discard five people who ate the recalled beef.
  assert.equal(
    deriveIllnessStatus(
      'Traceback information was available for 5 case-patients and indicated that all 5 case-patients consumed beef products supplied by Adams Farms Slaughterhouse.',
    ).kind,
    'reported_count',
  );
});

test("a firm's own denial survives the supplier prose above it", () => {
  // Both sentences are real and sit in the same FDA notice. The supplier's
  // outbreak must not overrule the firm's explicit statement about its own
  // product — and a denial must not be read as silence either.
  const status = deriveIllnessStatus(
    'The FDA and CDC are investigating illnesses in a multistate outbreak of Salmonella infections linked to fresh jalapeños supplied by Coast Citrus Distributors. To date, Taylor Fresh Foods is not aware of any reported illnesses linked to its products containing jalapeños.',
  );
  assert.equal(status.kind, 'explicit_none');
  assert.equal(lineOf(status), 'No illnesses reported');
});

test('MUTATION: the education/report distinction is load-bearing in both directions', () => {
  const report =
    'The epidemiologic investigation identified a total of four listeriosis confirmed illnesses.';
  const education = 'Listeriosis is treated with antibiotics.';

  // Same disease, same length of prose, opposite answers.
  assert.equal(deriveIllnessStatus(report).kind, 'reported_count');
  assert.equal(deriveIllnessStatus(education).kind, 'unknown');

  // Swapping one for the other flips the notice, and nothing else does.
  assert.equal(deriveIllnessStatus(`${education} ${report}`).kind, 'reported_count');
  assert.equal(deriveIllnessStatus(`${education} ${education}`).kind, 'unknown');

  // Removing the disease word from the report leaves it a report; removing it
  // from the education leaves it inert. The word is not what decides.
  assert.equal(
    deriveIllnessStatus(
      'The epidemiologic investigation identified a total of four confirmed illnesses.',
    ).kind,
    'reported_count',
  );
  assert.equal(deriveIllnessStatus('It is treated with antibiotics.').kind, 'unknown');
});

// ── P2B7L.2: botulism, and evidence that survives re-punctuation ────────────
//
// Every sentence below is copied verbatim from a live case's projected summary
// prose. The case id is named so a disagreement can be taken back to the
// source. See docs/recall-illness-status.md §4.5 for the population these were
// drawn from and §4.6 for the segmentation rule.

/** The whole notice, re-punctuated without changing a word. */
const RESEGMENT: [string, (text: string) => string][] = [
  ['split at ", which"', (t) => t.replace(/,\s+which\s+/g, '. which ')],
  ['split at ", which" capitalised', (t) => t.replace(/,\s+which\s+/g, '. Which ')],
  ['split at ", and"', (t) => t.replace(/,\s+and\s+/g, '. and ')],
  ['semicolons become periods', (t) => t.replace(/;\s+/g, '. ')],
  ['periods become semicolons', (t) => t.replace(/\.\s+(?=[a-z])/g, '; ')],
];

/** Assert a notice reads the same however its clauses are punctuated. */
function assertSegmentationInvariant(notice: string, expected: string): void {
  const base = deriveIllnessStatus(notice);
  assert.equal(`${base.kind}/${base.illnesses}`, expected, 'as published');
  for (const [label, mutate] of RESEGMENT) {
    const got = deriveIllnessStatus(mutate(notice));
    assert.equal(`${got.kind}/${got.illnesses}`, expected, label);
  }
}

// ── Botulism: the seven shapes the live corpus actually publishes ───────────

test('botulism education is inert — the seriousness of the disease proves nothing', () => {
  // `decd41aa`, `815dc152`, `55ee81ad` all carry this sentence; twenty more
  // cases carry the "potentially fatal form of food poisoning" variant.
  for (const education of [
    'Infant botulism is a rare but potentially fatal illness that presents a serious threat to the health of infants which occurs when Clostridium botulinum spores are ingested and colonize the intestinal tract, producing botulinum neurotoxins in the immature gut of infants.',
    'Botulism is extremely uncommon in dairy products or infant formula, and is naturally occurring in environmental sources like soil, select vegetables, and dust.',
    'Botulism , a potentially fatal form of food poisoning, can cause the following symptoms: general weakness, dizziness, double-vision and trouble with speaking or swallowing.',
    'Clostridium botulinum is a bacterium which can cause life- threatening illness or death.',
  ]) {
    assert.equal(deriveIllnessStatus(education).kind, 'unknown', education);
    assert.equal(copyOf(education), null, education);
  }
});

test('a contamination risk is a statement about the product, not about anyone', () => {
  // The dominant botulism shape: twenty live cases recall a food because it
  // COULD carry the organism. Nobody is said to be ill, and nobody is said not
  // to be. `Clostridium botulinum` names the organism and is deliberately not a
  // disease name.
  for (const risk of [
    'Tops Friendly Markets of Williamsville, NY is recalling all codes of Christopher Ranch Peeled Garlic and Garland Peeled Garlic because it has the potential to be contaminated with Clostridium botulinum due to the product being kept at insufficient temperatures.',
    'The sale of uneviscerated fish is prohibited under New York State Agriculture and Markets regulations because Clostridium botulinum spores are more likely to be concentrated in the viscera than any other portion of the fish.',
  ]) {
    assert.equal(deriveIllnessStatus(risk).kind, 'unknown', risk);
  }
});

test('an investigation existing is not an illness report', () => {
  // `815dc152` and `55ee81ad`. An outbreak being investigated says that a
  // question is open, not that this recall answered it.
  for (const investigation of [
    'The FDA has an ongoing investigation of infant botulism among babies in the U.S.',
    'FDA and CDC, in collaboration with the California Department of Public Health (CDPH), Infant Botulism Treatment and Prevention Program (IBTPP), and other state and local partners, continue to investigate a multistate outbreak of infant botulism.',
    'The recall was initiated in response to an ongoing investigation into a recent outbreak of infant botulism and since then Clostridium botulinum was identified by ByHeart in some samples of its formula.',
  ]) {
    assert.equal(deriveIllnessStatus(investigation).kind, 'unknown', investigation);
  }
});

test('"has not identified a direct link" is unknown — never a denial', () => {
  // `815dc152`. The FDA declining to connect the cases to the product is not
  // the firm saying nobody fell ill, so it must not print "No illnesses
  // reported"; and it is not a report either.
  const status = deriveIllnessStatus(
    'The FDA has not identified a direct link between any infant formula and these cases and there is no historical precedent of infant formula causing infant botulism.',
  );
  assert.equal(status.kind, 'unknown');
  assert.equal(illnessNoticeCopy(status), null);
});

test('ByHeart, November 7: cases, exposure, and an explicit no-direct-link — unknown', () => {
  // `815dc152`, verbatim and in the source's own order. 83 cases exist
  // nationwide; 13 infants had the formula "at some point"; the FDA says the
  // link is not established. Exposure is not causation, so nothing is reported.
  const notice =
    'ByHeart was notified by the FDA on November 7, 2025 of an estimated 83 cases of infant botulism that were reported nationwide since August 2025. ' +
    'Of these, the FDA also noted that 13 infants received ByHeart formula at some point. ' +
    'The FDA has not identified a direct link between any infant formula and these cases and there is no historical precedent of infant formula causing infant botulism.';
  assertSegmentationInvariant(notice, 'unknown/null');
  assert.equal(copyOf(notice), null);

  // The disclaimer is what holds it. Remove it and the exposure sentence still
  // establishes nothing on its own, because exposure is not illness.
  assert.equal(
    deriveIllnessStatus(
      'Of these, the FDA also noted that 13 infants received ByHeart formula at some point.',
    ).kind,
    'unknown',
  );
});

test('ByHeart, November 19: linked cases, and no count the source states for them', () => {
  // `55ee81ad`. The update drops the no-direct-link disclaimer and writes
  // CONFIRMED EXPOSURE, so the cases are this recall's and it reports them.
  //
  // It reports no trustworthy COUNT. 31 is "suspected or confirmed"; 27 is the
  // subset whose onset date is known. Neither is "31 illnesses", so the notice
  // says illnesses were reported and declines to put a number on them.
  const notice =
    'As of November 19, 2025, a total of 31 infants with suspected or confirmed infant botulism and confirmed exposure to ByHeart Whole Nutrition infant formula (various lots) have been reported from 15 states (see map). ' +
    'Laboratory confirmation for some cases is ongoing. ' +
    'For 27 cases with illness onset information available, illnesses started on dates ranging from August 9 to November 13, 2025. ' +
    'All 31 infants were hospitalized. No deaths have been reported to date.';
  assertSegmentationInvariant(notice, 'reported_unspecified/null');
  assert.equal(textOf(notice), 'Illnesses reported');

  // 27 is never printed. It is the source's number for a different fact.
  assert.notEqual(textOf(notice), '27 illnesses reported');
  // And the deaths-only denial beside it does not become an illness denial.
  assert.equal(deriveIllnessStatus('No deaths have been reported to date.').kind, 'unknown');
});

test('Nara Organics: three cases, explicitly linked by consumption — a counted report', () => {
  // `decd41aa`. The CDC reports three infants with infant botulism who CONSUMED
  // the recalled formula. That is people, an illness, and an explicit link to
  // this product, which is the whole positive test.
  const notice =
    'The Food and Drug Administration (FDA) and Center for Disease Control (CDC) contacted Nara Organics late Friday, June 12, 2026, and provided information about 3 cases of infant botulism in infants who CDC reported had consumed Nara formula. ' +
    'The 3 infants were hospitalized and treated with BabyBIG (Botulism Immune Globulin Intravenous) in California, Washington, and Pennsylvania. ' +
    'There are no reported deaths. ' +
    'To date, Nara infant formula has not tested positive for C. botulinum.';
  assertSegmentationInvariant(notice, 'reported_count/3');
  assert.equal(textOf(notice), '3 illnesses reported');

  // "information ABOUT 3 cases" is the preposition, not a hedge. The source
  // states exactly three, so the app must not say "approximately".
  assert.equal(deriveIllnessStatus(notice).approximate, false);

  // A negative TEST result is not a denial of illness — the notice reports
  // three while its own product has not tested positive.
  assert.equal(
    deriveIllnessStatus('To date, Nara infant formula has not tested positive for C. botulinum.')
      .kind,
    'unknown',
  );
});

test('MUTATION: remove the linkage from Nara and the report goes quiet', () => {
  const linked =
    'FDA and CDC provided information about 3 cases of infant botulism in infants who CDC reported had consumed Nara formula.';
  assert.equal(deriveIllnessStatus(linked).kind, 'reported_count');

  // Same three cases, no statement that anyone consumed the product.
  const unlinked = 'FDA and CDC provided information about 3 cases of infant botulism nationwide.';
  assert.equal(deriveIllnessStatus(unlinked).kind, 'unknown');

  // Same three cases, the link hedged rather than stated.
  const hedged =
    'FDA and CDC provided information about 3 cases of infant botulism that may be associated with Nara formula.';
  assert.equal(deriveIllnessStatus(hedged).kind, 'unknown');

  // And a genuine explicit count, explicitly linked, is heard.
  assert.equal(
    textOf('Nine illnesses have been reported in connection with the recalled formula.'),
    '9 illnesses reported',
  );
});

test('an explicit denial about the recalled product is explicit_none, botulism or not', () => {
  const notice =
    'Tops Friendly Markets is recalling all codes of Christopher Ranch Peeled Garlic because it has the potential to be contaminated with Clostridium botulinum. ' +
    'Botulism , a potentially fatal form of food poisoning, can cause the following symptoms: general weakness, dizziness, double-vision and trouble with speaking or swallowing. ' +
    'No illnesses have been reported to date.';
  assertSegmentationInvariant(notice, 'explicit_none/null');
  assert.equal(textOf(notice), 'No illnesses reported');
});

// ── Segmentation invariance on the supplier-chain corpus ───────────────────

test('SEGMENTATION: a supplier clause frames its illnesses across a sentence break', () => {
  // `a37f3a42`, as published: one sentence. Before P2B7L.2, splitting it at the
  // relative clause moved the illnesses out of reach of "supplied by" and the
  // supplier's outbreak became Walmart's.
  const walmart =
    'The recall was initiated because this product may contain recalled whole cucumbers supplied by SunFed Produce, LLC of Rio Rico, AZ, which initiated a recall after the U.S. Food and Drug Administration (“FDA”) notified SunFed that the cucumbers described above were associated with reported salmonellosis illnesses.';
  assertSegmentationInvariant(walmart, 'unknown/null');

  // The same clause in the SUPPLIER's own notice reports, because there the
  // recalled product is the cucumbers themselves (`fbd54ba0`).
  assert.equal(
    deriveIllnessStatus(
      'SunFed initiated this recall after the US Food and Drug Administration (“FDA”) notified SunFed that the cucumbers described above were associated with reported salmonellosis illnesses between October 12 – November 15, 2024.',
    ).kind,
    'reported_unspecified',
  );
});

test("SEGMENTATION: a supplier's outbreak never overrides the firm's own denial", () => {
  // `95adea9a`. Walmart's notice carries both, and the firm's own denial is
  // what a shopper must see. Splitting the supplier sentence used to let the
  // supplier's illnesses win.
  const supplier =
    'The recall was initiated because this product may contain recalled whole cucumbers supplied by Bedner Growers, Inc. of Boynton Beach, FL, which initiated a recall after the US Food and Drug Administration ("FDA") notified Bedner Growers Inc. that the cucumbers described above were associated with reported salmonellosis illnesses.';
  const denial =
    'To date, no illnesses have been reported for the recalled Marketside Fresh Cut Cucumber Slices.';

  // Denial after the supplier prose, and denial before it: same answer.
  assertSegmentationInvariant(`${supplier} ${denial}`, 'explicit_none/null');
  assertSegmentationInvariant(`${denial} ${supplier}`, 'explicit_none/null');
});

test('SEGMENTATION: a direct-victim report survives "supplied by" beside it', () => {
  // FSIS uses "supplied by" for the RECALLING establishment in the very
  // sentence that reports the victims (Adams Farms). Suppressing it would
  // discard five people who ate the recalled beef.
  const adams =
    'Traceback information was available for 5 case-patients and indicated that all 5 case-patients consumed beef products supplied by Adams Farms Slaughterhouse.';
  assertSegmentationInvariant(adams, 'reported_count/5');

  // And it still reports when unrelated supplier prose sits next to it.
  const withNeighbour = `This product may contain recalled ingredients supplied by another firm. ${adams}`;
  assert.equal(deriveIllnessStatus(withNeighbour).kind, 'reported_count');
});

test('SEGMENTATION: hedged linkage stays hedged however it is punctuated', () => {
  // `eb2dd0e5`, Baloian Farms. The hedge is on the LINK, and it holds.
  const baloian =
    'Baloian initiated this recall after learning from SunFed Produce, LLC, that its supplier of American cucumbers, “Agrotato, S.A. de C.V.,” may be associated with reported salmonellosis illnesses between October 12 – and November 15, 2024.';
  assertSegmentationInvariant(baloian, 'unknown/null');
});

test('SEGMENTATION: order alone never decides — a report outranks a later qualified none', () => {
  // The invariant that must NOT be satisfied by "denials always win": a notice
  // may report illnesses and then say there have been no additional ones, and
  // it is still a positive report (`760612b0`, HMC Farms shape).
  const report =
    'The recalled peaches have been linked to an outbreak of Listeriosis that has resulted in eleven illnesses.';
  const qualified = 'No additional illnesses have been reported to date.';

  for (const notice of [`${report} ${qualified}`, `${qualified} ${report}`]) {
    assert.equal(textOf(notice), '11 illnesses reported', notice);
  }

  // The qualifier alone still establishes nothing at all.
  assert.equal(deriveIllnessStatus(qualified).kind, 'unknown');
});

// ── Counts the source gives for something else ─────────────────────────────

test('a figure qualified by "information available" counts records, not illnesses', () => {
  // `55ee81ad` and `5f7e9891`. The subset whose data investigators happen to
  // hold is not the size of the outbreak.
  assert.equal(
    deriveIllnessStatus(
      'For 27 cases with illness onset information available, illnesses started on dates ranging from August 9 to November 13, 2025.',
    ).illnesses,
    null,
  );

  // The unqualified figure in the same notice is still read (`5f7e9891`).
  const ptFarm =
    'Based on epidemiological investigation, 14 case-patients have been identified with illness onset dates ranging from June 15 to July 10, 2016. ' +
    'Traceback for 11 case-patients for whom data was available led back to a single slaughter date at PT Farm.';
  assert.equal(textOf(ptFarm), '14 illnesses reported');
});

test('a figure counting which case-patients were hospitalized is not an illness count', () => {
  // `57ae49ff`. Six case-patients; one of them hospitalized. The notice reports
  // six illnesses, not one.
  const notice =
    'Based on epidemiologic investigation, 6 case-patients have been identified in Minnesota with illness onset dates ranging from August, 17, 2014 to September, 27, 2014. ' +
    'Among the 6 case-patients with available information, 1 case-patient was hospitalized; 0 deaths have been reported. ' +
    'All 6 case-patients reported chicken Kiev consumption prior to illness onset.';
  assertSegmentationInvariant(notice, 'reported_count/6');

  // The separate-figures shape is untouched: "9 illnesses, 8 hospitalizations,
  // and 1 death" must keep its 9.
  assert.equal(
    textOf(
      'To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products.',
    ),
    '9 illnesses reported',
  );
});

test('a precaution that does not work is education, not a denial of illness', () => {
  // `753a28b9`. "Thoroughly cooking product does not prevent illness" describes
  // a heat-stable toxin. Read as a denial it prints "No illnesses reported".
  for (const education of [
    'Thoroughly cooking product does not prevent illness.',
    'Freezing will not kill the organism.',
  ]) {
    assert.equal(deriveIllnessStatus(education).kind, 'unknown', education);
    assert.equal(copyOf(education), null, education);
  }
});

test('"neither X nor Y received reports of illnesses" is a denial, not a report', () => {
  // Found by the P2B7L.2 repair dry run. Four live cases asserted illnesses
  // over a notice that denies them, because `neither` was not a denial lead and
  // the verb-leading assertion pattern then matched "received … reports of …
  // illness" word for word. The prepared repair was about to store that.
  for (const denial of [
    'Neither FSIS nor the company received any reports of illnesses associated with consumption of this product.',
    'To date, neither Pork King Good nor our suppliers have received any reports of illness or injury related to these products.',
    'Neither Too Good Gourmet or Meijer have received any customer complaints or claims of illness associated with this recall to date.',
  ]) {
    assert.equal(textOf(denial), 'No illnesses reported', denial);
  }

  // And it must not manufacture an ILLNESS denial out of some other harm. These
  // deny only injuries or only adverse reactions, and stay silent.
  for (const otherHarm of [
    'Neither the company nor FSIS has received any reports of injury associated with consumption of this product.',
    'Neither FSIS nor the company has received reports of adverse reactions due to consumption of these products.',
  ]) {
    assert.equal(deriveIllnessStatus(otherHarm).kind, 'unknown', otherHarm);
    assert.equal(copyOf(otherHarm), null, otherHarm);
  }
});
