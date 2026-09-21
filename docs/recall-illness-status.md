# Reported-harm status: illnesses, hospitalizations, deaths — and the audit behind them

_Audit written 2026-09-18 (P2B7J); shipped 2026-09-18 (P2B7K) under the
founder's corrected scope — **illnesses only**. Recall Detail now renders a
compact illness notice in the identity area, the four rival readers of illness
prose are down to one, and the stored `reportsIllness` flag is derived from the
same contract the screen uses. Push remains inactive. No database write, no
backfill and no job was run in either milestone; §3 was gathered read-only._

_Corrected 2026-09-18 (P2B7L.1): a disease NAME is no longer treated as
education, and supplier-chain and hedged prose are held back on their
semantics rather than on a word (§4.4). Eight cases reclassify and the prepared
repair moves from 77 to 79 (§5.3). Still read-only: nothing was written._

_Amended 2026-09-21 (P2B7Q.1, founder decision): the notice is no longer
illnesses-only. It carries **hospitalizations and deaths too, one fact per
line**, because P2B7Q measured that the "they stay in What Happened" property
this scope depended on never existed (§1.2). Everything else below — the four
illness states, the attribution rules, the education guard, the one-reader
structure — is unchanged and now governs three harms instead of one. Still
read-only: no database write, no backfill, no job, and push remains inactive._

_Completed 2026-09-19 (P2B7L.2): `botulism` joins the other disease names and
the infant-formula population is resolved on its semantics (§4.5); attribution
is separated from assertion so the answer no longer depends on where the prose
was punctuated (§4.6); and the repair dry run surfaced a live false positive —
`neither X nor Y received reports of illnesses` read as a report — which is
closed (§4.7). Nine cases reclassify and the prepared repair moves from 79 to
76 (§5.3). Still read-only: nothing was written, and push remains inactive._

This document is the authoritative home for how Lotly determines and presents
reported illnesses. Part 4 of
[recall-domain-architecture.md](recall-domain-architecture.md) remains the
authoritative home for the canonical `illness` **field**; this document owns
its derivation and its shopper-facing presentation.

## 0. Scope: three harms, and nothing else

The notice answers what the official notice **reported about people**:
illnesses, hospitalizations, and deaths. Each is derived on its own evidence
and rendered on its own line; none is inferred from another.

Injuries, adverse reactions and adverse events still get no status, no count
and no badge. They remain in the source's own words in the projection.

> **This section said "illnesses, and nothing else" until P2B7Q.1.** The
> original scope rested on a property that turned out not to exist — that a
> hospitalization or a death survived in What Happened. §1.2 has the
> measurement and the founder's decision. The rule that injuries and adverse
> reactions carry no status is unchanged.

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
incapable of disagreeing. (4) was **deleted in P2B7Q**: it never had a caller,
and a dormant second wording of the three states is exactly what this audit
exists to remove. `src/domain/illness-status-wiring.test.ts` fails if a second
reader reappears anywhere under `src/`.

### 1.2 Hospitalizations and deaths — stated, one fact per line (P2B7Q.1)

**Found by P2B7Q, closed by founder decision in P2B7Q.1.**

The compact notice was **illnesses-only** (P2B7K). That was adopted alongside a
stated safety property: a source sentence carrying a hospitalization, a death,
an injury or an adverse reaction would survive in **What Happened**,
duplicated, so no severe outcome could leave the app. The mechanism is
`narrativeWithoutIllness`, clause (3) (§6).

**That property did not hold, and never had.** `narrativeWithoutIllness` can
only PRESERVE a sentence the narrative already contains, and the narrative
contains none: `buildWhatHappened` composes What Happened from structured
slots — company, product, reason family, pathogen — and never from
announcement sentences. Measured over all 1,931 cases the function changed the
narrative **zero** times, and **zero** narratives contained an illness backing
statement at all. The consequence, over the 898 active consumer-visible cases:
**8** had a notice affirming a hospitalization or a death, and **0** showed it
on any surface.

**What ships now.** The contract derives three harms independently —
illnesses, hospitalizations, deaths — and the notice renders each on its own
line, in that fixed order. Measured over the same corpus, 11 active cases gain
a line and 3 of them previously rendered no notice at all:

| Case       | The notice says                                                       | Lotly says now                                                              |
| ---------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `10ebfa06` | "9 illnesses, 8 hospitalizations, and 1 death…"                       | `9 illnesses reported` / `8 hospitalizations reported` / `1 death reported` |
| `fca62f93` | "38 illnesses … including 11 deaths"                                  | `38 illnesses reported` / `11 deaths reported`                              |
| `f59ed265` | "39 illnesses and one death…"                                         | `39 illnesses reported` / `1 death reported`                                |
| `f8a2c8ab` | "Twelve illnesses and one death…"                                     | `12 illnesses reported` / `1 death reported`                                |
| `55ee81ad` | "All 31 infants were hospitalized."                                   | `Illnesses reported` / `31 hospitalizations reported`                       |
| `decd41aa` | "The 3 infants were hospitalized…"                                    | `3 illnesses reported` / `3 hospitalizations reported`                      |
| `c4f8c9e4` | "Both individuals were hospitalized…"                                 | `2 illnesses reported` / `Hospitalizations reported`                        |
| `f84e2407` | "Approximately half of affected case-patients have been hospitalized" | `17 illnesses reported` / `Hospitalizations reported`                       |
| `2c491bc9` | "One hospitalization due to Listeria monocytogenes…"                  | `1 hospitalization reported` _(was: nothing)_                               |
| `4c2f1bf1` | "One hospitalization … associated with the Sophelise cheese."         | `1 hospitalization reported` _(was: nothing)_                               |
| `a9437a1c` | "…with 5 hospitalization and no deaths."                              | `5 hospitalizations reported` _(was: nothing)_                              |

**The rules that keep it honest.**

- **A harm is read from the SAME own-attributed sentences the illness status
  is read from.** It can never claim an outbreak the illness line declined to
  claim. Recorded: `5a521509` states "7 illnesses resulting in 3
  hospitalizations across the United States … 3 of which **may** be linked to
  a single product" — the source does not tie the figures to this recall, so
  illness status and hospitalization are both `unknown` and the notice renders
  nothing.
- **Capability is not a report.** FDA and FSIS carry standing education
  verbatim on hundreds of notices — "the diarrhea may be so severe that the
  patient needs to be hospitalized", "HUS can lead to death", "Complications …
  can include … death", "Death has been reported in cases of severe overdose".
  A modal that governs the harm word, or a generic "in cases of" frame, vetoes
  it. This is the single largest hazard in the corpus: without the veto, a dozen
  recalls would report hospitalizations that never happened.
- **Each mention is judged on its own.** One sentence routinely affirms one
  harm and denies the other ("…with 5 hospitalization and no deaths").
- **A neighbouring figure is never borrowed.** "9 illnesses, 8
  hospitalizations, and 1 death" yields 8 and 1, because a comma or a second
  number between a figure and its noun disowns it.
- **Only affirmations render.** Illnesses keep their `No illnesses reported`
  denial line (a founder-approved reassurance); hospitalizations and deaths
  have no `explicit_none` at all, because "No deaths reported" on every
  Listeria recall would bury the one positive line that matters.
- **A reported harm always takes the `reported` treatment**, whatever the
  illness line says — a calm "no illnesses" badge over a reported death would
  be the app reassuring a shopper against its own evidence.

`src/lib/consumer-copy-evidence.test.ts` and `src/domain/illness-status.test.ts`
pin all of it, and the corpus sentences above are the fixtures.

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

| Shape                                                                                          | Why it is unsafe                                                                                  | Current behaviour                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| "No **other** illnesses have been reported"                                                    | "additional" may point at another harm; the disjunction names neither; no separate evidence       | inert (P2B7L §4.2) — neither report nor denial  |
| "…associated with **reported** salmonellosis illnesses" (FDA supplier chain, 5 cases)          | sometimes the recalled product's own outbreak, sometimes the supplier's — the clause is identical | resolved by supply framing (P2B7L.1 §4.4)       |
| "The FDA **continues to receive** adverse event reports"                                       | an adverse event is not an illness                                                                | announced as an illness                         |
| "**Death** has been reported in cases of severe overdose"                                      | hazard education about the substance, not a report about this recall                              | announced as an illness                         |
| "onset dates reported between July 24, **2022** and September 19, 2022 with 5 hospitalization" | a year sits one filler word from a harm noun                                                      | a naive count reader yields "2022 hospitalized" |
| "approximately 470 reports of illness or adverse reactions"                                    | the source's own figure is approximate and mixes two families                                     | shown as an exact count                         |
| Two notices, same outbreak, different dates                                                    | supersession                                                                                      | newest linked record wins (`projectCaseFields`) |

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

---

### 4.4 A disease name is neither education nor evidence (P2B7L.1)

**A disease name alone is never evidence that anyone became ill, and never
proof that a sentence is education.** What a sentence is depends on its
structure, not on whether it contains the word `salmonellosis`.

Before this correction the two disease names sat as bare alternations inside
the `EDUCATION` guard, so `isNonReportProse` removed **every** sentence naming
either disease before `deriveIllnessStatus` looked for evidence. Three
consequences:

1. genuine reports were inert — "The epidemiologic investigation identified a
   total of four listeriosis confirmed illnesses, including one death"
   established nothing;
2. the positive branch naming the diseases was **unreachable**: any sentence it
   could have matched was filtered one step earlier;
3. supplier-chain prose was suppressed for the wrong reason — the word rather
   than the semantics — so the suppression could not be relied on.

Measured read-only over the whole 1,931-case table, **8 cases** classified
differently once the names were narrowed to their explanatory frame. Five were
genuine reports the app was silent about; three were prose that must stay
silent and now does so on its meaning.

#### The three shapes

| Shape                     | Test                                                                                                                                                                | Result                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Education**             | the disease is the subject of a general statement — "Listeriosis is treated with antibiotics", "Symptoms of salmonellosis usually start…", "…can cause listeriosis" | inert — no notice                         |
| **Report**                | the sentence states PEOPLE, cases or illnesses AND connects them to the recalled product or case                                                                    | `reported_count` / `reported_unspecified` |
| **Supplier / background** | the illnesses belong to a supplier's product, an ingredient, another firm's recall, or the link is hedged                                                           | inert — no notice                         |

A sentence establishes an illness only when it reports people, cases or
illnesses **and** ties them to this recall with enough confidence: an exact
count, "reported illnesses associated with consumption of these products", or
another explicit event statement the notice itself makes. The same supplier
appearing in an outbreak, an ingredient under investigation, another product's
illnesses, and general outbreak background are none of those. **When linkage is
ambiguous the answer is `unknown` and no notice renders.**

#### The clause that means two things

Two FDA notices carry the identical clause, and it means different things in
each:

> SunFed initiated this recall after the FDA notified SunFed that **the
> cucumbers described above** were associated with reported salmonellosis
> illnesses…

SunFed's notice recalls those cucumbers. The illnesses are the recalled
product's, and it reports them (`reported_unspecified`).

> The recall was initiated because this product **may contain recalled** whole
> cucumbers **supplied by** SunFed Produce, LLC… **which** initiated a recall
> after the FDA notified SunFed that the cucumbers described above were
> associated with reported salmonellosis illnesses.

Walmart's notice recalls cut slices that merely _contain_ the supplier's
recalled cucumbers. The illnesses are the supplier's product's, Walmart states
none for its own, and one of the two Walmart notices says so outright — "To
date, no illnesses have been reported for the recalled Marketside Fresh Cut
Cucumber Slices." Attributing the supplier's outbreak to the downstream recall
would tell a shopper this product made people ill when its own notice does not.
So the supply framing holds the clause back, and the firm's own denial is what
the screen shows (`explicit_none`).

#### Three guards, and what each is not

- **`DISEASE_AS_SUBJECT`** (`domain/illness.ts`) — the disease name counts as
  education only in an explanatory frame. Everything else education already
  caught still applies: "can cause listeriosis" by `can cause`, "Symptoms of
  salmonellosis" by `symptoms`. Over the whole table this keeps 122 education
  sentences filtered and releases 23.
- **`SUPPLIER_CHAIN`** (`domain/illness-status.ts`) — "supplied by", "its
  supplier", "supplier's lot", "may contain … recalled". Deliberately **not**
  "produced by" or "manufactured by": FSIS names the _recalling_ establishment
  that way in the very sentence that links the illnesses to it.
- **`HEDGED_LINKAGE`** — "may be associated", "might be linked", "possibly
  related". Written against the **link**, not against the word "may": a notice
  may call contamination possible and still report illnesses plainly, and that
  report still counts.

Both are overridden by **`DIRECT_VICTIM`** — a sentence stating that people
fell ill or ate the product is a direct report whatever framing surrounds it.
FSIS writes "all 5 case-patients **consumed** beef products **supplied by**
Adams Farms Slaughterhouse", naming the recalling firm with the same words a
third-party supplier would take; suppressing that would discard five people who
ate the recalled beef. The module cannot resolve firm identity and does not
try — it asks instead whether the sentence reports people, which is what makes
a report a report.

None of this is a per-case list. There is no allowlist and no denylist of
recalls anywhere in the classifier; every rule above is a sentence shape.

#### Two boundaries, both closed in P2B7L.2

P2B7L.1 left these open and named them as conservative misses. Both cost real
reports once the infant-formula recalls arrived, and §4.5 closes them.

- **A disease name needed human harm beside it.** Eligibility was gated on
  `MENTIONS_HARM`, and the disease names were not in it, so "Nine cases of
  salmonellosis have been reported in connection with this product" read
  `unknown`. No notice then stated its illnesses that way. The FDA
  infant-formula advisories do exactly that — "a total of 31 infants with
  suspected or confirmed **infant botulism** … have been reported" never writes
  the word _illness_ — so the disease names are now in `MENTIONS_HARM`.
  Eligibility is not evidence: it means only that the sentence is read.
- **`botulism` was still a bare name in `EDUCATION`.** It is now matched in the
  same explanatory frame as the other two. §4.5 is the audit that settled it.

---

### 4.5 Botulism: the whole population, and what each shape means (P2B7L.2)

**27 stored cases** name `botulism` or `botulinum` — 25 FDA, 2 FSIS-closed,
read read-only over the whole 1,931-case table. Before this correction, **22
sentences across 10 of them** were held back by the bare word alone.

The word was doing two incompatible jobs at once: silencing genuine education
and silencing genuine reports. Splitting them is the whole correction.

| Shape                                | Cases   | Example (verbatim)                                                                                                   | Answer                     |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Contamination risk + explicit denial | 20      | "…has the potential to be contaminated with Clostridium botulinum" + "No illnesses have been reported to date."      | `explicit_none`            |
| Contamination risk, source silent    | 4       | "…may have experienced temperature deviation and may contain Clostridium perfringens … and/or Clostridium botulinum" | `unknown`                  |
| Disease education                    | (in 10) | "Infant botulism **is** a rare but potentially fatal illness…"                                                       | inert                      |
| Symptom education                    | (in 20) | "**Symptoms** of botulism include dizziness, blurred or double vision…"                                              | inert                      |
| Category hazard                      | (in 5)  | "Uneviscerated fish have been linked to outbreaks of botulism poisoning."                                            | inert                      |
| Investigation exists                 | (in 3)  | "The FDA has an ongoing investigation of infant botulism among babies in the U.S."                                   | inert                      |
| Authority declines the link          | 1       | "The FDA **has not identified a direct link** between any infant formula and these cases…"                           | `unknown` — never a denial |
| Cases linked by exposure             | 1       | "…31 infants with suspected or confirmed infant botulism and **confirmed exposure to** ByHeart … have been reported" | `reported_unspecified`     |
| Cases linked by consumption          | 1       | "…3 cases of infant botulism in infants who CDC reported **had consumed** Nara formula"                              | `reported_count` (3)       |

**`Clostridium botulinum` is deliberately not a disease name.** It names the
ORGANISM, and "has the potential to be contaminated with Clostridium botulinum"
is the standard uneviscerated-fish and low-acid-canning hazard sentence — a
statement about the product, not about anyone's health. Twenty live cases rest
on that wording and none of them reports an illness.

#### The three infant-formula cases

The founder named these; the third is a different firm in the same
investigation, which is what makes the set worth reading together.

**`815dc152` — ByHeart, November 7 2025 → `unknown`.** The notice states 83
cases of infant botulism reported **nationwide**, notes that 13 infants
"received ByHeart formula **at some point**", and states twice that "The FDA
has not identified a direct link between any infant formula and these cases."
Nothing here reports illnesses **for this product**: the cases are a national
population, receipt of a product is exposure rather than illness, and the
authority explicitly declines the connection. A linkage denial denies a LINK,
not an illness, so the answer is `unknown` and **not** `explicit_none` — telling
a shopper "No illnesses reported" over an active outbreak investigation would be
its own false statement.

**`55ee81ad` — ByHeart, November 19 2025 → `reported_unspecified`.** The update
drops the no-direct-link disclaimer, states that ByHeart's own testing
"identified Clostridium botulinum in some samples", and writes "a total of 31
infants with suspected or confirmed infant botulism and **confirmed exposure to**
ByHeart Whole Nutrition infant formula (various lots) have been reported from 15
states." That is people, a disease, and an explicit tie to the recalled product,
so it reports.

It reports **no count**. The notice carries two figures and neither is an
illness count the source states: **31** is "suspected **or** confirmed", and
**27** is "cases with illness onset **information available**" — the subset whose
onset date investigators happen to hold. The shipped classifier was printing
`27 illnesses reported`, quoting a real number of the source's against a fact it
was never given for. §4.8 is the general guard.

**`decd41aa` — Nara Organics, June 2026 → `reported_count` (3).** A different
firm, the same investigation. "The FDA and CDC contacted Nara Organics … and
provided information about **3 cases of infant botulism in infants who CDC
reported had consumed Nara formula**." People, the disease, an explicit count,
and linkage by **consumption** — every element the conservative rule requires,
so the count stands. Its neighbours stay inert: "The 3 infants were
hospitalized" is a hospitalization with no illness stated, "There are no
reported deaths" denies only deaths, and "Nara infant formula has not tested
positive for C. botulinum" denies a **test result**, not an illness.

#### The rule, stated once

A notice reports illnesses when it says that **people became ill** and ties
those people to **this recall or the recalled product** — by consumption, by
confirmed exposure, or by a link the notice draws itself. It reports a **count**
only when the source states that number **for those linked illnesses**.

Everything else is inert: general education about the disease, its symptoms, its
severity, the food category's hazard, the existence of an investigation, a
national case population, an upstream supplier's or ingredient's outbreak, a
hedged link, and an authority's statement that no link has been identified. The
seriousness of botulism is never evidence that anyone fell ill, and the absence
of evidence is never a zero.

There is **no per-case allowlist or denylist anywhere in the classifier.** Every
rule above is a sentence shape, and the reviewed notices are preserved as
bounded fixtures (§5.4), not as identifiers the code branches on.

---

### 4.6 Attribution, not position: the segmentation correction (P2B7L.2)

**The defect.** Every frame — supplier chain, hedged linkage — was tested
against the candidate sentence alone, so the answer depended on where
`splitSentences` happened to cut. Walmart's notice reads, as one published
sentence:

> The recall was initiated because this product may contain recalled whole
> cucumbers **supplied by** SunFed Produce, LLC of Rio Rico, AZ, **which**
> initiated a recall after the FDA notified SunFed that the cucumbers described
> above were associated with reported salmonellosis illnesses.

Split it at the relative clause — the same words, two sentences — and the half
carrying the illnesses no longer carried "supplied by". Measured on the real
notices: `a37f3a42` turned from `unknown` into `reported_unspecified`, and on
`95adea9a` the supplier's outbreak **overrode the firm's own explicit denial**
("To date, no illnesses have been reported for the recalled Marketside Fresh Cut
Cucumber Slices"), which is the exact failure the supply framing exists to
prevent.

**The correction has two halves.**

**1. Attribution is separated from assertion.** `assertsIllness` now answers only
_"is this a positive illness statement?"_; a separate `provenanceOf` answers
_"about whom?"_. Evidence attributed elsewhere is **discarded**, not outranked:

```
own assertion      →  reported_count / reported_unspecified
else own denial    →  explicit_none
else                  unknown
```

This is deliberately **not** "denials beat assertions". An own-product report
still beats an own-product denial, which is what keeps a notice that reports
illnesses and later says "no additional illnesses" positive. What a supplier's
outbreak cannot do is beat the recalling firm's own denial — because it was
never this recall's evidence to begin with.

Provenance, in order:

| Test                                                                   | Result      |
| ---------------------------------------------------------------------- | ----------- |
| A direct-victim clause, or a link the sentence draws to _this_ product | `own`       |
| The notice states no direct link has been identified                   | `elsewhere` |
| Confirmed exposure to the recalled product                             | `own`       |
| Cases scoped to the country (`nationwide`)                             | `elsewhere` |
| Supplier chain or hedged linkage **in the framing context**            | `elsewhere` |
| Otherwise                                                              | `own`       |

**2. Framing reaches across a punctuation split — but only into a
continuation.** A well-formed sentence in this corpus opens with a capitalised
subject ("Twelve illnesses and one death have been reported to date"). The
fragment a split leaves behind opens lowercase, or with a relative pronoun or a
bare conjunction. Framing carries forward only into the latter, walking back
through consecutive continuations, so a clause broken into three pieces is
reassembled as surely as one broken into two and there is no window size to
tune.

A purely positional window was tried first and **measured to be wrong**: letting
any preceding sentence frame the next silenced seven genuine reports in the live
corpus, among them "Twelve illnesses and one death have been reported to date",
which merely happened to follow a sentence naming the firm's supplier.
Adjacency is not framing.

**Measured invariance** over all 1,931 stored notices, comparing each notice's
answer with the same notice re-punctuated:

| Re-punctuation                 | Before | After |
| ------------------------------ | ------ | ----- |
| split at `, which`             | 2      | **0** |
| split at `, which` capitalised | 2      | **0** |
| split at `, and`               | 1      | **0** |
| semicolons become periods      | 1      | **0** |
| periods become semicolons      | 0      | **0** |
| newlines deleted               | 4      | 4     |

The last row is **not a re-segmentation and is out of scope by design.** In this
corpus a newline _is_ a sentence boundary — FSIS and FDA summaries are stripped
HTML whose hard breaks often carry no terminal punctuation, which is why
`splitSentences` treats them as boundaries (`domain/text.ts`). Deleting them
glues a table row onto a sentence ("Expiration Range: 07/26-03/27 No illnesses
or allergic reactions have been reported to date"), manufacturing a number
beside a harm noun. That is input corruption, not the same prose re-punctuated,
and the four affected cases are identical before and after this milestone.

---

### 4.7 `neither X nor Y` — a live false positive the repair would have stored

Found by the P2B7L.2 dry run, not by reading code. **Four live cases** asserted
illnesses over a notice that denies them outright:

> **Neither** FSIS **nor** the company received any reports of illnesses
> associated with consumption of this product.

`neither` was not among the denial leads (`no`, `not`, `never`, `without`), so
the denial guard let the sentence through and the verb-leading assertion pattern
— "received … reports of … illness" — matched it word for word. This is the §3.2
class, the most serious one: the app stating the inverse of the official notice.
It mattered immediately, because all four carried a stored `false` that the
prepared repair was about to overwrite with `true`.

`neither` is now a denial lead. The guard still requires an **illness** word, so
the four neighbouring notices that deny only injuries or only adverse reactions
("Neither the company nor FSIS has received any reports of injury…") remain
`unknown` rather than becoming false zeros.

---

### 4.8 A figure the source gives for something else is not a count

Two shapes, both real, both quoting a number the source wrote against a fact it
never stated it for. Same family as the existing year guard.

- **Availability subsets.** "For **27 cases with illness onset information
  available**, illnesses started on dates…"; "Traceback for **11 case-patients
  for whom data was available**…". The figure counts records whose datum is
  known.
- **Further-harm subsets.** "Among the 6 case-patients…, **1 case-patient was
  hospitalized**." The figure counts which of the ill were hospitalized.

Deliberately narrow: "9 illnesses, 8 hospitalizations, and 1 death" keeps its
**9**, because there the hospitalizations are a separate figure beside the
illness count rather than a predicate on it. Only a number whose own noun phrase
is the subject of the further-harm verb is disowned.

Two counts are **recovered** by this: `5f7e9891` now reads `14 illnesses
reported` (its 11-case traceback subset no longer collides with the 14 the
notice states) and `57ae49ff` reads `6 illnesses reported`.

A related misreading is closed with them: **"about" is not always a hedge.**
"provided information **about** 3 cases" is the preposition, and reading it as
an approximation printed `Approximately 3 illnesses reported` over a source that
states exactly three. No case in the live corpus renders `Approximately …`.

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

Re-derived over the same 898 active, consumer-visible cases. The P2B7K column
is the milestone measurement; the last is a fresh read-only re-derivation on
2026-09-18 after §4.2 and §4.4:

|                        | shipped before | P2B7K | P2B7L.1 | now   |
| ---------------------- | -------------- | ----- | ------- | ----- |
| `explicit_none`        | 692            | 552   | 554     | 557   |
| `reported_count`       | 10             | 30    | 30      | 30    |
| `reported_unspecified` | 32             | 18    | 13      | 12    |
| renders nothing        | 165            | 298   | 301     | 299   |
| false positives (§3.2) | 5              | **0** | **0**   | **0** |
| false zeros (§3.3)     | 150            | **0** | **0**   | **0** |

`reported_unspecified` fell from 18 to 13 across the two later corrections:
§4.2 made the qualified-none notices inert, and §4.4 moved two supplier-chain
notices to the denial their own firms wrote while admitting one genuine report
(SunFed). The `explicit_none` rise is those two firms' denials becoming
audible.

Counts now displayed: 1, 2, 3, 4, 7, 8, 9, 11, 12, 17, 26, 28, 38, 39, 55, 92,
345 — `11` is HMC Farms, which §4.4 recovered, and `3` is Nara Organics, which
§4.5 recovered. **`27` is gone**: it was ByHeart's availability subset, and the
notice now reports without a count (§4.8). No case in the corpus states a
qualified illness count, so `Approximately …` is unexercised in production —
measured over all 1,931 stored cases, zero render it — and is pinned by unit
test only.

P2B7L.2 moved three of these 898: ByHeart from a wrong count to an uncounted
report, Nara from silence to `3 illnesses reported`, and two of the
`neither … nor` denials (§4.7) from a false "Illnesses reported" to the denial
their notices actually wrote. The `explicit_none` rise is those denials becoming
audible.

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

**After the §4.4 correction: 79 stale values.** Re-measured read-only over the
same whole table on 2026-09-18. Eight cases reclassify (§4.4) and five of them
move in or out of the plan:

```
 77  (P2B7L classifier)
 +2  true → false  Taylor Fresh Foods, Ambrosia Brands — supplier outbreak and hedged link
                    no longer read as this product's illnesses
 −2  true → false  Johnston County Hams, SunFed Produce — their stored true is now RIGHT,
                    so they need no write
 +3  false → true  HMC Farms, C. Corporation, Tyson Foods — real reports the disease-name
                    guard had silenced
 −1  false → true  Whole Foods Market — its own denial is now heard, so its stored false
                    is already correct
───
 79  (P2B7L.1 classifier)
```

The direction split is unchanged at 46 true → false, because the two additions
and two removals cancel exactly; all of the net growth is in false → true.

**After P2B7L.2: 76 stale values.** Re-measured read-only over the same whole
table on 2026-09-19. Nine cases reclassify and five of them move in or out of
the plan:

```
 79  (P2B7L.1 classifier)
 +1  false → true  Nara Organics — 3 cases of infant botulism in infants who
                    consumed the recalled formula, silenced until now by the
                    bare `botulism` word (§4.5)
 −4  false → true  Tyson Fresh Meats, Skyline Provisions, Pork King Good,
                    Champion Foods — "neither X nor Y received any reports of
                    illnesses" is a DENIAL, so their stored false is already
                    right and the plan was about to overwrite it (§4.7)
───
 76  (P2B7L.2 classifier)
```

The other four reclassifications move no plan row, because the stored flag
already agreed with the corrected answer: ByHeart `55ee81ad` stays a
false → true correction but as `reported_unspecified` rather than a wrong count
of 27; `7a45af45` moves from silence to an audible denial (stored `false`,
derived `false`); and `5f7e9891` and `57ae49ff` recover a count they had lost to
a subset figure while staying `true` (§4.8).

The direction split is now **46 true → false, 30 false → true** — the true →
false side is untouched by every correction since P2B7L, and all movement has
been on the false → true side, which is the side that would have written a
claim of illness into storage.

| Scope                    | Total  | true → false | false → true |
| ------------------------ | ------ | ------------ | ------------ |
| Active, consumer-visible | 58     | 38           | 20           |
| Active but merged-hidden | 1      | 0            | 1            |
| Closed                   | 17     | 8            | 9            |
| **Whole table**          | **76** | **46**       | **30**       |

Refused: 0 (`no-evidence` 0, `missing-flag` 0). Plan failures: 0. Already
correct: 1,855. The dry run's own totals read `active 59 / inactive 1020`,
counting the merged-hidden case among the active.

The single merged-hidden case is `9ccfa5b4…` (Infinite Herbs basil, merged into
`fe905dd2…`), which RLS hides from consumers — it is why a whole-table count of
active cases reads one higher than a consumer-scope audit of the same corpus.

**The correction does not go through re-projection.** `reportsIllness` is the
one field `detectChanges` diffs, and a normal re-projection of these cases
would raise **29** `health_impact` notification-ledger events for notices that
have not changed since publication, while also rewriting other projected fields
on **75 of the 76** (re-measured 2026-09-19; `sourceIdentifiers` moves on almost
every one, `affectedProducts`, `classification`, `retailerNames` and
`heroImageUrl` on many). No case was unavailable and no re-projection threw. The repair instead writes the single key through a narrow
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

**Disease-name corpus (P2B7L.1, widened P2B7L.2).** The **29** cases whose
notices name `salmonellosis`, `listeriosis` or `botulism` outside an educational
frame are recorded the same way in
`src/domain/fixtures/illness-disease-corpus.json` (re-record with
`npx tsx scripts/record-illness-disease-corpus.ts`, read-only) and pinned by
`src/domain/illness-disease-corpus.test.ts`. The recorder reads the disease list
from the contract itself (`DISEASE_NAME`), so the recorded population cannot
drift from the population the classifier governs. The population is heterogeneous on
purpose — counted reports, uncounted reports, explicit denials, supplier-chain
prose, hedged linkage and education-only headings — because telling those apart
is the whole job. The suite derives fresh and asserts the recorded answer back,
that no status anywhere rests on an educational, supplier-chain or hedged
sentence, and — by mutation — that education stays inert when the report beside
it is removed, that turning a report into education silences it, and that one
genuine illness sentence is still heard over every notice in the corpus. The
repair plan and `health_impact` eligibility are pinned against the same
fixture in `src/server/illness-repair.test.ts`.

**Segmentation invariance (P2B7L.2).** `src/domain/illness-status.test.ts`
carries an `assertSegmentationInvariant` helper that re-punctuates a notice five
ways — splitting at `, which` in both capitalisations, at `, and`, and
converting between semicolons and periods — and asserts one answer throughout.
It is applied to both ByHeart notices, Nara, Walmart against both of its
suppliers, the Walmart denial in both orders, SunFed, Baloian, Adams Farms and
the two recovered counts. The same sweep run over all 1,931 stored notices
reports zero differences on every punctuation-preserving mutation (§4.6).

Alongside it the suite mutates meaning rather than formatting: removing the
direct linkage from the Nara sentence silences it, replacing that linkage with a
hedge silences it, adding a genuine explicit count is heard, "no additional
illnesses" after a real report keeps the report, and a real illness sentence
appended to any notice in the disease corpus is heard over it. Each of those is
a property the classifier must have in both directions, not a single expected
value.

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
