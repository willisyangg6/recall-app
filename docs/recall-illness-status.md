# Illness status: semantics, the compact illness notice, and the audit behind them

_Audit written 2026-09-18 (P2B7J); shipped 2026-09-18 (P2B7K) under the
founder's corrected scope — **illnesses only**. Recall Detail now renders a
compact illness notice in the identity area, the four rival readers of illness
prose are down to one, and the stored `reportsIllness` flag is derived from the
same contract the screen uses. Push remains inactive. No database write, no
backfill and no job was run in either milestone; §3 was gathered read-only._

This document is the authoritative home for how Lotly determines and presents
reported illnesses. Part 4 of
[recall-domain-architecture.md](recall-domain-architecture.md) remains the
authoritative home for the canonical `illness` **field**; this document owns
its derivation and its shopper-facing presentation.

## 0. Scope: illnesses, and nothing else

The notice answers one question — **did the official notice report
illnesses?** — and it is the only question it can answer. Injuries, adverse
reactions, adverse events, hospitalizations and deaths get no status, no count
and no badge. They remain in the source's own words in the projection, and the
de-duplication rule in §6 is written so they cannot be removed to make room for
an illness count.

Injury and adverse-reaction language is still recognised inside
`domain/illness-status.ts`, but only defensively: a notice that denies injuries
has not denied illnesses, and a notice reporting one allergic reaction has not
reported an illness. Both misreadings were live defects (§3.2, §3.3).

## 1. The pipeline, end to end

| Stage                   | Where                                                  | What it produces                                                                                                                      |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sentence classification | `src/domain/illness.ts` — `classifyIllnessReport`      | `{status: 'reported' \| 'none_reported' \| 'unknown', statements: string[]}` from the notice's summary prose                          |
| Normalization (FSIS)    | `src/server/fsis/parse.ts` — `extractIllnessStatement` | `NormalizedSourceRecord.illnessStatement` — the verbatim sentences, joined, or `null`                                                 |
| Normalization (FDA)     | `src/server/fda/parse.ts`                              | the same, from the announcement body                                                                                                  |
| Enforcement enrichment  | `src/server/fda-enforcement/enrich.ts`                 | `illnessStatement: null` — openFDA enforcement records carry no illness prose                                                         |
| Projection              | `src/domain/projection.ts` — `projectCaseFields`       | `CaseProjection.illnessStatement` (newest linked record) and `reportsIllness`, derived from `summaryText` through the shared contract |
| Material change         | `src/domain/material-change.ts`                        | a `health_impact` change when `reportsIllness` goes false → true                                                                      |
| Push copy               | `src/server/push/format.ts`                            | "Illnesses or adverse reactions are now reported for this recall."                                                                    |
| Detail presentation     | `src/lib/recall-presentation.ts`                       | `DetailModel.illnessNotice`: the finished notice copy, or `null`                                                                      |
| Detail render           | `src/app/recall/[id].tsx`                              | `<IllnessNotice>` in the identity area — below the brand, above the official report link                                              |

Health Risk is deliberately **not** in this chain. Its copy is standardized
hazard education owned by `src/content/hazard-guides.ts`, keyed by hazard, and
says nothing about whether _this_ recall reported illnesses. That separation is
already pinned and must survive any change here.

### 1.1 Four readers, three of them independent — the structural defect

The audit's structural finding is that **four** places decide what the illness
prose means, and only two of them share an implementation:

1. `classifyIllnessReport` (domain) — the sentence classifier.
2. `statementReportsIllness` (projection) — a one-line regex,
   `!/\bno\b[^.]*\b(reports?|illness|adverse|injur)/i`, applied to the
   already-extracted statement. It produces the stored `reportsIllness` flag
   that drives material-change detection and push copy.
3. `illnessLine` (presentation) — re-checks negation with a _different_ regex
   (`isNegatedReport`) and extracts counts with a third set of patterns.
4. `illnessDisplay` (`src/lib/recall-display.ts`) — a fourth wording of the
   same three states ("No illnesses have been reported."). It is **dead in
   production**: no screen calls it, and `recall-presentation-wiring.test.ts`
   lists it among the formatters screens may not call.

Because (2) and (3) disagree, the same recall can be described one way on
Detail and the opposite way in the notification ledger. §3.5 measures how often.

**Resolved in P2B7K.** There is now exactly one reader. (3) was deleted —
`illnessLine`, its count patterns and its second negation guard are gone from
`recall-presentation.ts`. (2) delegates to the contract and reads the same
`summaryText` the screen reads, so the ledger and Detail are structurally
incapable of disagreeing. (4) is unchanged and still unreachable from any
screen. `src/domain/illness-status-wiring.test.ts` fails if a second reader
reappears anywhere under `src/`.

---

## 2. What the sources actually say

Verified against the 898 active cases and the recorded fixtures.

| Source shape                            | Example (verbatim)                                                                                          | Agency          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------- |
| Explicit zero, illnesses                | "No illnesses have been reported to date."                                                                  | both            |
| Explicit zero, adverse reactions        | "There have been no confirmed reports of adverse reactions due to consumption of these products."           | FSIS (dominant) |
| Explicit zero, injuries                 | "No injuries have been reported to date."                                                                   | FDA             |
| Denial phrased as "not received"        | "To date, VidaSlim has not received reports of illnesses related to the consumption of this product."       | FDA             |
| Exact count                             | "Four (4) illnesses have been reported to date."                                                            | FDA             |
| Count with severity                     | "To date, there have been 9 illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products." | FDA             |
| Count, epidemiological                  | "34 sick people have been identified in 13 states, including 33 hospitalizations and two deaths."           | FSIS            |
| Report without a count                  | "Illnesses have been reported; the number and extent of which are currently under investigation."           | FDA             |
| Hospitalization as the only harm        | "One hospitalization due to Listeria monocytogenes has been reported to date."                              | FDA             |
| Adverse reaction as the only harm       | "One customer reported an allergic reaction to milk…"                                                       | FDA             |
| Injury as the only harm                 | "One consumer reported a dental injury from consuming the product."                                         | FSIS            |
| Qualified none (implies a prior report) | "No other illnesses have been reported to date."                                                            | FDA             |
| Same outbreak, two dates                | "As of July 25, 2024, 34 sick people…" / "As of July 30, 2024, 34 sick people…"                             | FSIS            |
| Silent                                  | no illness sentence at all                                                                                  | both            |

**Animal illness:** none. The corpus is FSIS meat/poultry/egg recalls and FDA
human-food announcements; pet-food recalls are not ingested, and no record in
the active corpus reports non-human illness. No contract below accounts for it,
deliberately.

**What the notice does with each shape** is §4; the short version is that only
the illness rows above can produce a notice at all. The injury,
adverse-reaction, hospitalization-only, mixed-figure and silent rows all
produce none.

**Where illness counts really live:** FDA states that illness counts belong to
the CORE outbreak table, not to recall records
([recall-source-contract.md](recall-source-contract.md) §2). Everything above
is prose the firm or agency chose to include, so permanent absence is normal
and expected — 18% of the corpus, §3.1.

---

## 3. Corpus audit (read-only, 2026-09-18)

_This section records the state **before** P2B7K. It is kept verbatim because
it is the evidence the contract in §4 is shaped around; §5.1 gives the same
corpus after the change._

898 active cases (`state = active AND merged_into IS NULL`), read through the
service role; plus the 160-announcement recorded FDA corpus and the 66-record
FSIS benchmark. **No data was modified.**

### 3.1 Distribution under the SHIPPED path

| State as Detail shows it                                                                         | FDA | FSIS | Total | Share |
| ------------------------------------------------------------------------------------------------ | --- | ---- | ----- | ----- |
| `No illnesses reported.`                                                                         | 529 | 149  | 678   | 75.7% |
| `No illnesses reported.` (rescued at the presentation boundary from a `reported` classification) | 14  | 0    | 14    | 1.6%  |
| `N illnesses reported.`                                                                          | 8   | 2    | 10    | 1.1%  |
| `Illnesses have been reported.`                                                                  | 27  | 5    | 32    | 3.6%  |
| nothing rendered (source silent)                                                                 | 140 | 22   | 162   | 18.1% |

Counts actually displayed: 1, 3, 4, 7, 9, 12, 17, 39, 345.

Every displayed sentence comes from **deterministic extraction over copied
source prose**. None of it is structured data: no agency field carries an
illness count, and `openfda` supplies none.

### 3.2 False positives — the app asserts what the source denies

**5 active cases.** The presentation-layer negation guard requires a standalone
`no`, so `not received` slips through; and its harm list omits `deaths`, so a
deaths-only denial reads as a positive illness report.

| Case       | Source sentence                                                                                                                   | Detail shows                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `f63ce211` | "To date, VidaSlim has **not received** reports of illnesses…"                                                                    | `Illnesses have been reported.` |
| `b786ac19` | "…this company has **not received** reports of illnesses…"                                                                        | `Illnesses have been reported.` |
| `fb80b9d9` | "…this company has **not received** reports of illnesses…"                                                                        | `Illnesses have been reported.` |
| `1d427210` | "…has **not received** reports of illnesses… directly by any consumer; However, the FDA has notified us of 3 consumer complaints" | `Illnesses have been reported.` |
| `55ee81ad` | "**No deaths** have been reported to date."                                                                                       | `Illnesses have been reported.` |

This is the most serious class: the app states as fact the inverse of the
official notice.

### 3.3 False zeros — one harm substituted for another

**150 active cases** print `No illnesses reported.` over a source that never
mentioned illnesses:

- **137** denied only adverse reactions, adverse events, or allergic reactions.
  FSIS's dominant allergen boilerplate is exactly this sentence.
- **13** denied only injuries.

The sentence is not a lie about the world, but it is not what the source said,
and it converts an unstated fact into a stated zero.

### 3.4 Information the display cannot carry

- **Count loss: 12 of the 22 positive reports** (55%) lose a count the source
  stated — "Four (4) illnesses", "92 instances of illness", "55 reports of
  illnesses", "12 recorded illnesses", "three case-patients".
- **Hospitalizations and deaths: 7 cases.** There is no slot for either.
  `9 illnesses reported.` is shown for "9 illnesses, 8 hospitalizations, and 1
  death"; `12 illnesses reported.` for "Twelve illnesses and one death".
- **2 cases report a hospitalization as the only harm** and are announced as
  `Illnesses have been reported.`

Across the corpus: 14 records mention hospitalization, 11 mention death, 42
mention injury, 123 mention adverse reactions or events.

### 3.5 Layer disagreement — Detail versus the notification ledger

**23 active cases** where the stored `reportsIllness` flag contradicts what
Detail displays:

- **20** carry `reportsIllness = true` while Detail says `No illnesses
reported.` — e.g. "King Arthur Flour has **not received** any confirmed
  reports of illnesses related to this product." Every one of these is a case
  where a newly-ingested notice with that wording would record a
  `health_impact` material change and queue the push copy "Illnesses or adverse
  reactions are now reported for this recall."
- **3** carry `reportsIllness = false` while Detail asserts illnesses.

Push delivery is **inactive** (`jobs:push` is a no-send no-op until
`push:activate -- --confirm`), so no shopper has received a false illness
alarm.

**Resolved in P2B7K** (§5.2): the flag and the screen now classify the same
input with the same contract, so this class of disagreement cannot be
constructed. Values already stored in the database remain stale until each case
is corrected — 58 active cases would change, and no re-projection was run.
P2B7L prepared that correction and measured it over the whole corpus; see §5.3.

### 3.6 Ambiguous or unsafe source shapes

| Shape                                                                                          | Why it is unsafe                                                                               | Current behaviour                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| "No **other** illnesses have been reported"                                                    | "additional" may point at another harm; the disjunction names neither; no separate evidence    | inert (P2B7L §4.2) — neither report nor denial  |
| "…associated with **reported** salmonellosis illnesses" (FDA supplier chain, 5 cases)          | the illnesses belong to the supplier's outbreak, which is also why _this_ product was recalled | read as a report                                |
| "The FDA **continues to receive** adverse event reports"                                       | an adverse event is not an illness                                                             | announced as an illness                         |
| "**Death** has been reported in cases of severe overdose"                                      | hazard education about the substance, not a report about this recall                           | announced as an illness                         |
| "onset dates reported between July 24, **2022** and September 19, 2022 with 5 hospitalization" | a year sits one filler word from a harm noun                                                   | a naive count reader yields "2022 hospitalized" |
| "approximately 470 reports of illness or adverse reactions"                                    | the source's own figure is approximate and mixes two families                                  | shown as an exact count                         |
| Two notices, same outbreak, different dates                                                    | supersession                                                                                   | newest linked record wins (`projectCaseFields`) |

---

## 4. The semantic contract

`src/domain/illness-status.ts`. Pure, deterministic, and the only reader of
illness prose in the app.

```ts
type IllnessStatusKind =
  | 'reported_count' // a trustworthy count, exact or explicitly approximate
  | 'reported_unspecified' // illness confirmed, no trustworthy count
  | 'explicit_none' // the source explicitly denies ILLNESSES
  | 'unknown'; // everything else — renders nothing at all

interface IllnessStatus {
  kind: IllnessStatusKind;
  illnesses: number | null; // non-null iff kind is 'reported_count'
  approximate: boolean; // the source qualified the count
  statements: string[]; // the verbatim sentences backing this status
}
```

There is no field for a hospitalization, a death, an injury or an adverse
reaction, and there is no harm-family discriminator. The restriction is
structural: nothing downstream can render what the shape cannot carry.

### 4.1 `unknown` is deliberately large

It is the safety net, and everything the app does not know lands in it:

- the source is silent;
- the source denies only injuries, or only adverse reactions/events, or only
  deaths;
- the source reports only an injury or only an adverse reaction;
- the source reports a hospitalization with no illness stated (a
  hospitalization implies illness; the app does not infer it);
- a figure is shared between illness and another harm and cannot be separated
  ("approximately 470 reports of illness or adverse reactions");
- the prose is hazard education, healthcare advice, or discovery.

`illnessNoticeCopy` returns `null` for `unknown`, so no caller can render a
row, a placeholder or a zero for any of them. **Absence is never a zero.**

### 4.2 A qualified none establishes nothing (P2B7L)

"No **other** / **additional** / **further** … illness" is **inert**: neither a
report nor a denial. The rest of the notice decides, and where the rest is
silent the answer is `unknown` — no notice renders.

This supersedes the P2B7K reading, which took the shape as proof that an
illness occurred somewhere on the page. That inference holds for an outbreak
notice. It does not hold for the sentence FSIS actually publishes:

> FSIS has received **no additional** reports of injury or illness from
> consumption of these products.

The founder decision (P2B7L) names four reasons it establishes nothing:
"additional" may point back at an **injury** rather than an illness; "injury or
illness" is a **disjunction** that identifies neither harm; FSIS publishes the
sentence over notices with **no confirmed adverse reactions at all**; and the
28 live cases carrying it contain **no separate illness evidence** once the
sentence is removed (§5.3).

What survives unchanged:

| Shape                                                   | Result                              |
| ------------------------------------------------------- | ----------------------------------- |
| The qualifier alone                                     | `unknown` — no notice               |
| A known **injury**, then the qualifier                  | `unknown` — no illness status       |
| An **adverse-reaction denial**, then the qualifier      | `unknown` — no illness status       |
| A trustworthy **count**, then "no additional illnesses" | the count stands (`reported_count`) |
| A positive illness statement with **no count**          | `reported_unspecified`              |
| An explicit **illness denial** beside the qualifier     | `explicit_none`                     |

A count stated **inside** the qualifier sentence ("no additional reports of
illness beyond the 9 illnesses previously announced") is also kept: quoting a
figure the source wrote is not manufacturing one. A qualifier carrying no
figure never manufactures a count — that is exactly the failure this rule
removes.

The sentence is never deleted from `What Happened`. It backs no status, so
`narrativeWithoutIllness` has nothing it may drop, and the source's own words
stay on the screen.

### 4.3 Supersession and contradiction

`resolveIllnessStatus(newestFirst)`:

1. **Silence never supersedes.** A later notice that says nothing leaves an
   earlier report standing — an update about packaging does not retract an
   outbreak.
2. **A denial never supersedes a report.** If the newest establishing notice
   denies illnesses but an older linked notice reported them, the result is
   `reported_unspecified` carrying both statements, never `explicit_none`. The
   contradicted count is dropped rather than guessed.
3. A later report with a **larger** count supersedes normally.

---

## 5. Exact shopper copy

| State                       | Visible                               | Spoken                                                  |
| --------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `reported_count`, 1         | `1 illness reported`                  | "1 illness reported."                                   |
| `reported_count`, n         | `12 illnesses reported`               | "12 illnesses reported."                                |
| `reported_count`, qualified | `Approximately 12 illnesses reported` | "Approximately 12 illnesses reported."                  |
| `reported_unspecified`      | `Illnesses reported`                  | "Illnesses reported. The notice does not give a count." |
| `explicit_none`             | `No illnesses reported`               | "No illnesses reported."                                |
| `unknown`                   | _nothing renders_                     | —                                                       |

Rules, pinned by `src/domain/illness-status.test.ts`:

- **No zero from missing data.** `unknown` has no copy at all.
- **The word `yet` appears nowhere.** "No illnesses reported yet" predicts
  illnesses the source never predicted.
- **Never a risk vocabulary word** — not "critical", "high", "moderate",
  "low", or a class.
- **No harm but illness** ever appears in the text or the spoken label, even
  when the backing sentence states one.

### 5.1 Effect on the live corpus

Re-derived over the same 898 active cases:

|                        | shipped before | now   |
| ---------------------- | -------------- | ----- |
| `explicit_none`        | 692            | 552   |
| `reported_count`       | 10             | 30    |
| `reported_unspecified` | 32             | 18    |
| renders nothing        | 165            | 298   |
| false positives (§3.2) | 5              | **0** |
| false zeros (§3.3)     | 150            | **0** |

Counts now displayed: 1, 2, 3, 4, 7, 8, 9, 12, 17, 26, 27, 28, 38, 39, 55, 92, 345. Twenty cases gain a count the app was silent about; no case in the corpus
states a qualified illness count, so `Approximately …` is currently unexercised
in production and is pinned by unit test only.

`unknown` rose from 165 to 298 because injury-only and adverse-reaction-only
statements now correctly establish nothing. FSIS is where this bites hardest —
its `explicit_none` count falls from 150 to 33 — because its dominant allergen
boilerplate denies _adverse reactions_, not illnesses. Those sentences are not
lost: they remain in the projection, and the notice simply does not speak for
them.

### 5.2 The stored flag, and what is still stale

`reportsIllness` is now `statusReportsIllness(deriveIllnessStatus(summaryText))`
— true only for `reported_count` or `reported_unspecified`. The previous
regex was read against the _extracted_ `illnessStatement`, which is empty for
FSIS outbreak notices that plainly report illnesses; that is how the flag came
to be false on cases Detail described as reporting illnesses.

Values already in the database are unchanged and will not agree until each case
is corrected. Measured read-only on 2026-09-18 over the consumer-visible active
corpus: **58 active cases** would change — 35 from true to false (adverse-event
denials, hazard education, the CDC reporting-lag boilerplate) and 23 from false
to true (real outbreak counts, including `8 illnesses reported` and
`28 illnesses reported`). Nothing is shopper-visible in the meantime: Detail
derives fresh, and push is inactive.

### 5.3 The prepared correction (P2B7L)

Two read-only dry runs were run over the **whole** `recall_cases` table (1,931
cases), not the consumer-visible active corpus §5.2 measured. Nothing was
written in either.

**First measurement, against the P2B7K classifier: 95 stale values** — 41
true → false, 54 false → true. That run is what surfaced the qualified-none
defect: 23 of the 54 false → true corrections rested entirely on the FSIS
closure boilerplate, and would have written "this recall reported illnesses"
into storage for 23 notices that report none. A further 5 cases carried a
stored `true` that agreed with the same misreading, so the run counted them as
already correct.

**After the §4.2 correction: 77 stale values.** The two runs reconcile exactly:

```
95  (P2B7K classifier)
−23  qualified-none cases no longer read as reports; their stored false is now right
 +5  qualified-none cases whose stored true is now stale in the other direction
───
 77  (P2B7L classifier)
```

| Scope                    | Total  | true → false | false → true |
| ------------------------ | ------ | ------------ | ------------ |
| Active, consumer-visible | 58     | 37           | 21           |
| Active but merged-hidden | 1      | 0            | 1            |
| Closed                   | 18     | 9            | 9            |
| **Whole table**          | **77** | **46**       | **31**       |

Refused: 0 (`no-evidence` 0, `missing-flag` 0). Plan failures: 0. Already
correct: 1,854.

The single merged-hidden case is `9ccfa5b4…` (Infinite Herbs basil, merged into
`fe905dd2…`), which RLS hides from consumers — it is why a whole-table count of
active cases reads one higher than a consumer-scope audit of the same corpus.

**The correction does not go through re-projection.** `reportsIllness` is the
one field `detectChanges` diffs, and a normal re-projection of these cases
would raise **30** `health_impact` notification-ledger events for notices that
have not changed since publication, while also rewriting other projected fields
on **76 of the 77**. The repair instead writes the single key through a narrow
compare-and-set port (`updateCaseReportsIllness`), using this same shared
contract, so a later legitimate re-projection recomputes the identical answer
rather than erasing a repaired one. Operational detail, guardrails and the
rollback plan live in [recall-operations.md](recall-operations.md), "Illness
flag: a PREPARED historical correction (P2B7L)".

**Regression corpus.** All 28 qualified-none notices are recorded verbatim in
`src/domain/fixtures/illness-qualifier-corpus.json` (re-record with
`npx tsx scripts/record-illness-qualifier-corpus.ts`, read-only) and pinned by
`src/domain/illness-qualifier-corpus.test.ts`. That suite asserts every one now
classifies as `unknown`, that none became a false `explicit_none`, and — by
mutation, case by case — that each would still report an illness if its own
prose established one, still deny if its own prose denied one, and that
removing the qualifier sentence changes nothing, which is the evidence the
sentence carried no fact. It also pins Detail, `reportsIllness` and the repair
plan to one answer per case, under mutation as well as on the quiet path.

---

## 6. `What Happened` de-duplication

`narrativeWithoutIllness(narrative, status)`. A sentence is dropped only when
**all** of these hold:

1. a notice renders at all (`unknown` drops nothing);
2. the sentence is one of the sentences backing the status;
3. the sentence carries **no** fact the notice cannot display — no
   hospitalization, death, injury, adverse reaction, or qualification
   (onset windows, state counts, investigations, suspicion, hedged links).

Clause (3) is the whole safety property. "To date, there have been 9
illnesses, 8 hospitalizations, and 1 death linked to the soft cheese products"
is never dropped, because the notice shows only the 9. **Showing an illness
count twice is a blemish; taking a death out of the app is a correctness
failure.** If removal would empty the narrative, the narrative is kept whole,
and when nothing is dropped the original text is returned untouched rather than
re-joined.

### 6.1 It is currently a guard, not a visible change

Measured against the real narrative on 2026-09-18: of the 600 active cases that
render a notice, **the illness sentence appears in the What Happened narrative
zero times.** `buildWhatHappened` composes a structured sentence from typed
slots (company, product, reason family, pathogen) and never copies source
prose, so there is nothing to de-duplicate today. Before P2B7K the illness
sentence was a _separate line_ appended after that narrative, which is what the
notice replaces.

Run against the raw summary prose instead, the rule removes 465 sentences and
**deliberately keeps 135** for a fact the notice cannot show — which is the
behaviour that matters if a future narrative ever carries source sentences.

### 6.2 What is not displayed anywhere

A consequence worth stating plainly, because it is a **pre-existing gap this
milestone did not close**: because the narrative is composed from typed slots,
hospitalization, death, injury and adverse-reaction prose from the source
summary is not rendered on Recall Detail at all — before or after this change.
It is preserved in the projection and on the linked official notice. Surfacing
it is out of scope here (the founder's correction forbids dedicated treatments
for those facts) and would be a narrative change, not a notice change.

---

## 7. The compact illness notice

`src/components/ui/illness-notice.tsx`, rendered by
`src/app/recall/[id].tsx` in the identity area: **below the brand, above the
official FDA/FSIS report link.**

|          | reported                                        | explicit none                    |
| -------- | ----------------------------------------------- | -------------------------------- |
| Glyph    | `warning`, 12px                                 | `info`, 12px                     |
| Surface  | `illness-notice/reported/background`            | `illness-notice/none/background` |
| Border   | `illness-notice/reported/border`                | same as its surface              |
| Type     | `caption`, sentence case                        | `caption`, sentence case         |
| Geometry | `radius/4`, 8×4 padding, auto-width, shrinkable | same                             |

### 7.1 Its own treatment, and why

`illnessNoticePalette` is a dedicated semantic treatment in
`design-tokens.ts` and `DESIGN.md`. **The Risk Label remains the only consumer
of `riskPalette`** — `design-foundation.test.ts` still asserts that exactly,
and a second test asserts the notice palette is read only by the notice.

Every value in it is an existing foundation colour re-expressed under a
semantic name, so the notice introduces no hex and cannot become a second
Critical. A pinned test proves it holds no severity colour and no lime.

**Open design question.** The founder asked for a "compact soft-danger
treatment" for the positive state. The system has no soft-danger tint: the only
reds are `risk/*`, and reusing those is precisely what the one-treatment rule
forbids. A genuinely soft red would be a **new approved hex**, which is a design
decision rather than an implementation one. Until it exists, the reported state
carries urgency the way the rest of Lotly does — the word, the `warning` glyph,
and a stronger border. Swapping in an approved tint is a one-line change to
`illnessNoticePalette` and `DESIGN.md`, and nothing else.

### 7.2 Observed on device (iPhone 17 Pro, iOS 26.3)

- **Reported** (`10ebfa06`): `⚠ 9 illnesses reported` on one line under
  "Clover Hill Dairy", above "View the official FDA report", beside a 12-line
  product title and the hero image. No wrapping.
- **Explicit none** (`ab66f0a6`): `ⓘ No illnesses reported` on the soft-blue
  surface, clearly separate from the PENDING risk badge above it.
- **Unknown** (`3e42b053`, an FSIS adverse-reaction-only notice that previously
  displayed a false "No illnesses reported."): brand runs straight into the
  link. No row, no spacer, no placeholder.

The identity column is about **194pt** beside a hero on a 390pt screen, which
is why the notice is auto-width and `flexShrink: 1` rather than a full-width
band.

### 7.3 Accessibility

- **Role** `text`; the container is `accessible`, so it is **one** spoken
  element, never a glyph plus a fragment.
- **Spoken label** is the contract's `spoken` string, which expands the
  shorthand and states the uncounted case explicitly.
- **Decorative glyph is not announced** — it merges into the parent node.
- **Reading order**: risk label → activity date → Save → product name → brand →
  **illness notice** → official source link.
- **Without colour**: the words differ, and the glyph differs (`warning` vs
  `info`). Either channel carries the distinction alone.
- **No control is introduced.** No `Pressable`, no `onPress`, no button role,
  no hint. Pinned by `illness-status-wiring.test.ts`.

### 7.4 It is not a risk level, and not personal relevance

The contract carries no tier, class or severity, and the copy cannot speak a
risk word. The Risk Label is uppercase IBM Plex Mono on a filled severity
colour at a 24pt minimum height; the notice is sentence-case sans on a
foundation surface. Affects You is a full-width lime Callout about _this
shopper_; the notice is compact, auto-width, and about the recall. A Critical
recall can report no illnesses, and a Low one can report many.

---

## 8. Design Preview

**ILLNESS NOTICE** in the development-only harness draws the shipped component
over real source prose, in the real identity geometry, in every
production-relevant state: 1 illness, multiple illnesses, a qualified count,
illnesses without a count, explicit no illnesses, unknown, and the four states
that render **no** notice while keeping their sentence in the narrative — an
injury statement, an adverse-reaction statement, a hospitalization-and-death
statement, and a mixed figure. It also shows the notice with no image, with
multiple images, with a long title, at simulated accessibility type, beside the
Affects You callout, and beside the CRITICAL badge.

The P2B7J exploration alternatives (the outlined row, the filled panel, and the
harm-family badge variants) are removed: there is one shipped component and the
preview draws it.

---

## 9. Related documents

- [recall-domain-architecture.md](recall-domain-architecture.md) — Part 4, the
  canonical `illness` field; Part 8.4, projection.
- [recall-source-contract.md](recall-source-contract.md) — §2, why illness
  counts live in outbreak systems rather than recall records.
- [recall-feed-usability.md](recall-feed-usability.md) — the consumer
  presentation contract the Detail model belongs to.
- [recall-design-preview.md](recall-design-preview.md) — the development-only
  harness the alternatives are drawn in.
- [recall-push-delivery.md](recall-push-delivery.md) — the inactive delivery
  path §3.5 would reach.
- [DESIGN.md](../DESIGN.md) — tokens, and the one-treatment rule for the risk
  palette.
