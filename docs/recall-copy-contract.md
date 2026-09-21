# Lotly-authored recall copy: the evidence contract

**Status: established by P2B7Q (2026-09-20), the one systematic audit of every
sentence Lotly _constructs_ about a recall rather than reproducing from its
source.** This is the authoritative home for the copy taxonomy, the evidence
rule each family must satisfy, who owns each family, and the cross-surface
rules. Voice and vocabulary — em dashes, "store" not "retailer", "Lotly" not
"Recall" — live in [`src/lib/consumer-copy.test.ts`](../src/lib/consumer-copy.test.ts)
and are not restated here.

The failure mode this document exists to prevent is shared by every template in
the inventory: **a sentence that reads as an official statement while asserting
something the notice never said.**

---

## 1. The taxonomy

Every shopper-facing string about a recall is exactly one of these.

| Kind                         | What it is                                                        | Rule                                                             |
| ---------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Agency verbatim**          | The notice's own words, cleaned but not reworded                  | Never paraphrased into a claim; casing/emphasis fixes only       |
| **Deterministic paraphrase** | One fixed template per structured slot value                      | The slot must exist; no template for an absent slot              |
| **Derived factual status**   | A verdict computed from stored evidence (illness, location, risk) | Three-way: stated / explicitly denied / unknown, never collapsed |
| **General education**        | Hazard information true of the hazard, not of this recall         | Reviewed, identical for every recall carrying that hazard        |
| **Interface copy**           | Labels, states, controls, failures                                | Carries no recall-specific factual claim                         |

## 2. The evidence rule

Every factual app-authored sentence must be traceable to **either** a
structured source field with defined semantics, **or** exact agency prose
through a deterministic, tested transformation. Nothing else may produce one.

Specifically forbidden, each with a test in
[`src/lib/consumer-copy-evidence.test.ts`](../src/lib/consumer-copy-evidence.test.ts):

- absence becoming zero or "none";
- possibility becoming certainty;
- an upstream supplier's event becoming this product's event;
- an investigation becoming confirmed causation;
- a publication date, or a date the notice merely _references_, becoming the
  date of an update;
- a generic source change becoming a specific claim about what changed;
- a retailer list being presented as exhaustive;
- a raw narrative keyword establishing a typed relationship;
- a fallback reading like an agency-authored fact.

## 3. The inventory: one owner per family

| Family                   | Owner                                                       | Kind                      | Surfaces                         |
| ------------------------ | ----------------------------------------------------------- | ------------------------- | -------------------------------- |
| Card reason line         | `recall-presentation.conciseReasonLine` + `cardSummaryText` | paraphrase                | Feed, Saved, **push**            |
| What Happened narrative  | `what-happened.buildWhatHappened` + `detailNarrative`       | paraphrase                | Detail                           |
| Update / history note    | `what-happened.normalizedUpdate`                            | paraphrase (see §5)       | Detail                           |
| Recall quantity sentence | `recall-presentation.recallQuantitySentence`                | paraphrase                | Detail (inside What Happened)    |
| Illness notice           | `domain/illness-status.illnessNoticeCopy`                   | derived status            | Detail                           |
| Health Risk              | `content/hazard-guides` via `healthRiskSection`             | general education         | Detail                           |
| Where it was sold        | `recall-presentation.whereSoldModel`                        | derived status            | Detail                           |
| Card location summary    | `recall-presentation.homeLocationSummary`                   | derived status            | Feed, Saved                      |
| Retailers named          | `domain/retailer-display` via `whereSoldModel`              | agency verbatim (names)   | **Detail only** (P2B7O)          |
| Announced / Updated line | `recall-presentation.activityDisplay`                       | derived status            | Feed, Saved, Detail              |
| Risk label and tier note | `lib/risk-display.riskView`                                 | derived status            | Feed, Saved, Detail (label only) |
| Category tag             | `recall-presentation.cardCategoryLabel`                     | derived status            | Feed, Saved                      |
| Consumer action          | `consumer-projection.buildConsumerAction`                   | verbatim **or** app voice | _built, not rendered_            |
| Share message            | `lib/share-message.buildShareMessage`                       | composed from the above   | _built, not rendered_            |
| Push copy                | `server/push/format.formatPushContent`                      | paraphrase + rule facts   | push (inactive)                  |
| Feed / Detail states     | `lib/feed-copy`, `lib/detail-copy`                          | interface copy            | Feed, Saved, Detail              |

**Built but rendered nowhere today** (measured P2B7Q — stated so nobody assumes
a shopper reads them): the consumer action, the share message, the affected-
products scope statement and coverage note, the tier note, and the official
classification block. Each is a live contract with tests; none reaches a screen.

## 4. Paraphrase versus quote

Lotly **quotes** when the source's own words are the fact: retailer names,
package identifiers, the notice's own consumer instruction, the official
headline. Lotly **paraphrases** only from a structured slot, and only through a
fixed per-value template — never by assembling press-release sentences. A
free-text reason enters a sentence only as a bounded noun phrase, through the
grammar gates in `recall-reason.ts`; an ungrammatical one drops its clause
rather than being glued on.

The raw projection is never mutated by rendering: `buildDetailModel`,
`buildHomeCardModel` and `formatPushContent` are pure over it, pinned by test.

## 5. The update note (the "Feb 9" family)

The note is derived **at display time** from the newest Editor's Note in
`summaryText` — never stored — so every future ingest inherits the current
rules with no backfill.

A clause is rendered only when a sentence of the note _states_ the thing the
clause claims, is not negated, and is not a future possibility. Three clauses
exist and no others; an unclassifiable note renders nothing.

A date is accepted only when the note states it as **its own**: a leading
dateline (`Feb. 9, 2024 – …`, `, Oct. 25, 2019: …`, `(May 5, 2017): …`) or the
direct object of an update verb (`…were updated April 27, 2022, to …`). Any
other date in a note belongs to something else — most often the notice being
expanded — and the note renders undated as `Update: …`. The month word is
validated against the month table, so a date-shaped string that is not a date
never renders as one.

## 6. Unknown and null

| Fact                | Unknown renders as                    | Never renders as    |
| ------------------- | ------------------------------------- | ------------------- |
| Illness             | **nothing at all** (no notice)        | "0", "none", "yet"  |
| Distribution        | `Distribution not specified`          | "Nationwide", empty |
| Retailers           | nothing (no heading, no row)          | "None", "+N more"   |
| Category            | nothing                               | `Other`             |
| Classification      | `PENDING` / `UNKNOWN`, PHA suppressed | a risk level        |
| Package identifiers | source-silent ≠ unstructured          | one merged state    |

An explicit source denial is a different answer from silence, and the two are
worded differently everywhere.

## 7. Cross-surface rules

**Must agree.** The Feed card, Saved and Detail read one presentation contract,
so the activity line, the risk label, the category tag and the location verdict
are the same string by construction. Push reads the **same** reason sentence as
the card (P2B7Q): before that it built its own, and the two disagreed on 534 of
898 active cases, including the certainty word.

**Intentionally different.** Detail states more than a card, because it has
room: the complete jurisdiction list against the card's `CT, IL +4`; the full
What Happened paragraph against the card's compact reason; and **retailers,
which are Detail-only by founder decision** (P2B7O) — Feed and Saved carry no
retailer content at all, while search still matches on retailer names silently.

## 8. Founder exceptions on the record

- **`Retailers:`** — the one place consumer copy says "retailer" rather than
  "store", scoped to that exact string (P2B7O).
- **Search matches are never explained** — matching is silent (P2B7O).
- **The illness notice is illnesses-only** (P2B7K); see §9.
- **Freshness is never shown to shoppers** — no "last checked", no stale state.
- **Coverage/helper prose under Affected Products is not rendered** (P2a).

## 9. Open founder decisions (P2B7Q found, deliberately did not change)

1. **Hospitalizations and deaths reach no shopper surface.** 8 of 898 active
   cases have a notice affirming one; none shows it. Full evidence and the
   table of cases: [recall-illness-status.md §1.2](recall-illness-status.md).
2. **The card and Detail contradict each other about location on 11 of 898
   active cases** — the card says `Distribution not specified` while Detail
   lists specific states. Two geography derivations, not a copy defect; the
   fix is upstream and has filtering and personalization consequences.
3. **A stored `productDescription` clipped at 255 characters enters the What
   Happened sentence mid-word** on 1 active case ("… Flavored Chee because the
   products may be contaminated…").
4. **`Update:` versus `Updated <date>:`** — 35 of 82 notes are now honestly
   undated. Whether an undated note earns its place on Detail is a wording
   decision, not a truth one.
