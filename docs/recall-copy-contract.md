# Lotly-authored recall copy: the evidence contract

**Status: established by P2B7Q (2026-09-20), the one systematic audit of every
sentence Lotly _constructs_ about a recall rather than reproducing from its
source, and amended by the founder decisions in P2B7Q.1 — which removed two
copy families outright and added hospitalizations and deaths to a third.** This is the authoritative home for the copy taxonomy, the evidence
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
a shopper reads them): the share message, the affected-products scope statement
and coverage note, the tier note, and the official classification block. Each is
a live contract with tests; none reaches a screen.

The consumer action was on that list and is **gone** (P2B7Q.1): the founder
retired the "What should I do?" concept rather than the wiring, so
`buildConsumerAction` and `consumerActionDisplay` are deleted and no dormant
generator is left for a future screen to pick up.

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

## 5. The update note: removed, generator and all (P2B7Q.1)

There is no generated update note. `normalizedUpdate` paraphrased the newest
Editor's Note into a sentence of the app's own —
`Updated Feb 9, 2024: additional affected products were added.` — and P2B7Q
hardened it until every clause was earned by the source and every date was one
the notice stated about itself.

The founder then removed the treatment entirely, and the generator with it.
The reasoning is worth keeping, because the copy was not wrong by then:

- **THAT a recall changed is already told, honestly.** The recall returns to
  **Recent activity** (`feedTier`, keyed on `lastPublicActivityAt`) and its
  card and Detail header read `Updated <date>` — a label earned from the
  material-change ledger, which an agency wording edit or a maintenance write
  cannot produce.
- **WHAT changed was editorial prose the app has no business writing.** Every
  clause was a classification of somebody else's paragraph into one of three
  buckets. Even when accurate it read as an official statement Lotly had
  authored.
- **Identity is untouched.** An update is the same case: one id, one row, one
  card. Nothing about resurfacing or identity ever came from this generator.

It is deleted rather than disabled, per the standing rule in §3: a dormant copy
generator is exactly what this audit exists to remove.

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

Illnesses are the only harm with an `explicit_none` line
(`No illnesses reported`). Hospitalizations and deaths render a line **only
when the notice affirms them** (P2B7Q.1): "No deaths reported" on every
Listeria recall is noise, and three negative lines would bury the one positive
line that matters.

## 7. Cross-surface rules

**Must agree.** The Feed card, Saved and Detail read one presentation contract,
so the activity line, the risk label, the category tag and the location verdict
are the same string by construction. Push reads the **same** reason sentence as the card (P2B7Q):
before that it built its own, and the two disagreed on 534 of 898 active cases,
including the certainty word.

**Intentionally different.** Detail states more than a card, because it has
room: the complete jurisdiction list against the card's `CT, IL +4`; the full
What Happened paragraph against the card's compact reason; and **retailers,
which are Detail-only by founder decision** (P2B7O) — Feed and Saved carry no
retailer content at all, while search still matches on retailer names silently.

**Location is one VALUE, formatted two ways (P2B7Q.2).** `CT, IL +4` and the
complete list are the same `projection.geography.states`, and so are the
Location filter's verdict and the geography half of Affects Me. Detail no
longer reads the announcement for states of its own. The rule that makes this
safe is upstream, not here: the derivation must be RIGHT, because every surface
now repeats it. See
[recall-domain-architecture.md §5.4](recall-domain-architecture.md).

## 8. Founder exceptions on the record

- **`Retailers:`** — the one place consumer copy says "retailer" rather than
  "store", scoped to that exact string (P2B7O).
- **Search matches are never explained** — matching is silent (P2B7O).
- **The illness notice carries illnesses, hospitalizations and deaths**, one
  fact per line (P2B7Q.1, superseding P2B7K's illnesses-only decision). A
  denial renders a line for illnesses only.
- **There is no generated update note and no "What should I do?"** — both
  concepts were retired with their generators (P2B7Q.1); see §5 and §3.
- **Freshness is never shown to shoppers** — no "last checked", no stale state.
- **Coverage/helper prose under Affected Products is not rendered** (P2a).

## 9. Open items

One of P2B7Q's four was closed by founder decision in P2B7Q.1; one was moot;
one was closed by P2B7Q.2; one remains.

**Closed.**

1. ~~Hospitalizations and deaths reach no shopper surface.~~ Closed: they are
   stated on the Detail notice, one fact per line
   ([recall-illness-status.md §1.2](recall-illness-status.md)). 11 active cases
   gained a line; 3 of them previously rendered no notice at all.
2. ~~`Update:` versus `Updated <date>:`~~ Moot: the update note is gone (§5).

**Closed by P2B7Q.2.**

3. ~~The card and Detail disagree about location.~~ Closed: one derivation now
   answers for every surface, and it is a corrected one. The disagreement was
   **19** of 911 active cases at its final measurement — 11 where the card said
   `Distribution not specified` while Detail named up to 15 states, 7 where
   both named states but different ones, and 1 where Detail named a metro area
   the card cannot express. Neither old derivation could simply win: the
   canonical one missed states stated later in the body, while the display-time
   one worked at PARAGRAPH scope and swept up "Publix locations in Virgina and
   North Carolina are **not** impacted" and the Michigan Department of
   Agriculture that ran the sampling. The repair was upstream, where it had to
   be — the feed row carries no announcement prose, so a display-time answer
   can never reach the Location filter. Contract:
   [recall-domain-architecture.md §5.4](recall-domain-architecture.md);
   stored rows are corrected by `npm run repair:geography`, which needs its own
   founder authorization.

**Still open.**

1. **A stored `productDescription` clipped at 255 characters enters the What
   Happened sentence mid-word** on 1 active case ("… Flavored Chee because the
   products may be contaminated…"), and 3 cases end the product slot on a
   dangling adverb ("… Ineligible Meat and Poultry Products Illegally
   because…"). Both are title/description parsing, adjacent to P3D/P2B7M.
