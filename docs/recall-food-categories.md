# Product categories

How a recalled product is placed in a consumer aisle category, why that is
**not** the same thing as the hazard category, and why the derivation is
integrated as an **optional discovery filter only**.

Phase history: C5.3A audited the corpus and proposed the vocabulary. C5.3B
froze it, built the reviewed gold set, the deterministic matcher and the
accuracy gate — and failed at 74.2%. C5.3B-2 redesigned the matcher around
structural rules and measured 89.5% on a 200-case natural holdout against a 95%
gate. C10A refined the vocabulary to twelve categories with an explicit
`other`, drew a fresh holdout, measured **91.5%**, and the founder accepted that
for a narrower purpose — Category as an **optional discovery tool** — under
separate ≥90% product gates it did clear. C10A.1 made general refinements,
re-froze, drew a genuinely fresh holdout from the 870 untouched cases and
measured **86.5%**, missing every gate. **C10A.2** (this document) fixed the
four structural defects C10A.1 had written down, re-froze the classifier **and
the harness**, drew the last 200-case holdout this corpus supports from the 618
cases no split had touched, labelled it from full source evidence and measured
**87.5%**.

**C10A.2 STOPPED.** Four of the five accuracy gates are missed and so is the
new per-category floor. No failed case was patched and no further holdout may
be drawn — the untouched pool cannot support another 200. Three phases have now
measured this classifier against three independent fresh holdouts, at 91.5%,
86.5% and 87.5%; the honest reading is that its true accuracy sits near the
high 80s and that the remaining error is one boundary, not a scatter of lexical
gaps.

**C10B then shipped it anyway, deliberately** (§8). Not by tuning, re-scoring
or relabelling — the classifier is frozen and the numbers below are unchanged —
but by narrowing the promise: Category is an optional discovery filter over All
Recalls, every recall stays reachable without it, only **1.0%** of the final
holdout was placed somewhere unreasonable, and the weakest category (Prepared
foods, 64.8% recall) is hidden from the filter entirely. The historical
backfill **was applied**. Sections 1–7 are the C10A.2 record and are unchanged;
§8 and §9 carry the launch decision and its consequences.

---

## 1. The frozen C10A vocabulary

Twelve categories, defined in `src/domain/food-category.ts`. Ids are persisted
and filtered on; labels are display strings and may be reworded without a data
migration. Display order is the array order and is the same everywhere. C10A.1
changed nothing here.

| #   | Id                  | Label               | Definition                                                                                                    |
| --- | ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `produce`           | Fruits & vegetables | Fresh, frozen, or dried fruits, vegetables, mushrooms, sprouts, and salad components.                         |
| 2   | `meat_poultry`      | Meat & poultry      | Beef, pork, chicken, turkey, lamb, deli meats, and jerky sold as meat products.                               |
| 3   | `seafood`           | Seafood             | Fish, shrimp, shellfish, and other seafood products.                                                          |
| 4   | `dairy_eggs`        | Dairy & eggs        | Milk, cheese, yogurt, butter, ice cream, and eggs.                                                            |
| 5   | `prepared_foods`    | Prepared foods      | Entrées, pizzas, sandwiches, soups, prepared salads, tamales, and other ready-to-eat or ready-to-heat dishes. |
| 6   | `bakery_grains`     | Bakery              | Bread, tortillas, cakes, cookies, pastries, and dough.                                                        |
| 7   | `snacks_sweets`     | Snacks & sweets     | Chips, popcorn, chocolate, candy, snack bars, and similar snack products.                                     |
| 8   | `beverages`         | Beverages           | Juice, soda, coffee, tea, drink mixes, and other beverages.                                                   |
| 9   | `pantry_condiments` | Pantry & staples    | Flour, grains, pasta, rice, cereal, sauces, spices, oils, nuts, seeds, and similar pantry products.           |
| 10  | `baby_food_formula` | Baby food & formula | Infant formula, baby food, and products explicitly sold as infant/baby feeding products.                      |
| 11  | `supplements`       | Supplements         | Vitamins, capsules, powders, herbal supplements, and supplement products.                                     |
| 12  | `other`             | Other               | A recalled product this app cannot honestly place in an aisle.                                                |

### Two labels deliberately do not match their ids

`bakery_grains` reads **"Bakery"** and `pantry_condiments` reads **"Pantry &
staples"**. The derivation files flour, rice, pasta and cereal under
`pantry_condiments`; a label promising grains under Bakery would send a shopper
looking for a flour recall to the wrong chip. The ids keep their spelling —
this is a label clarification, not a taxonomy migration.

### Product category is NOT hazard category

`CaseProjection.hazardCategory` says **why** a notice exists (allergen,
pathogen, foreign material). A product category says **what** was recalled.
They are independent, and conflating them is the error the module exists to
prevent:

- Undeclared **milk** in a potato chip is **Snacks & sweets**, never Dairy.
- Undeclared **wheat** in a sauce is **Pantry & staples**, never Bakery.
- A cookie recalled for undeclared **shellfish** is **Bakery**, never Seafood.
- **Salmonella** in cucumbers is **Fruits & vegetables** — the pathogen is not
  a signal at all.

This is enforced by the type, not by discipline: `CategoryCaseInput` accepts
only `sourceAgency`, `title`, `productDescription`, `productLines` and (C10A.1)
`announcementSummary`. It cannot be handed a hazard, allergen, pathogen, firm,
brand or retailer, and §2 explains why the announcement is not a hole in that.

### Other exclusions that decide the hard boundaries

- A fruit in a name is usually a flavour. _Dark Chocolate Cherry Granola_ is
  Pantry & staples; _Iced Tea Lemon_ is Beverages.
- Dairy words are usually descriptions. _Milk chocolate_ is Snacks & sweets;
  _dairy-free coconut yogurt_ is still Dairy & eggs, because yogurt is.
- Meat inside a dish is an ingredient. _Chicken enchiladas_ is Prepared foods;
  _ground beef_ is Meat & poultry.
- A protein modifier FORMS a dish on a staple head: _meat pie_, _chicken fried
  rice_ are Prepared foods, while _apple pie_ keeps its aisle.
- _Baby_ is often a size or a cut: _baby arugula_ is Produce, _baby back ribs_
  is Meat & poultry.
- Rendered fats are pantry goods: _pork lard_ and _beef tallow_ sit with oils.
- A plant-based analogue of a meat product is Prepared foods.
- Supplements is the dose form, not any fortified conventional food.

### `other`, and why C10A reversed C5.3B-2 on it

C5.3B-2 emitted **no** category for a product the source does not describe well
enough, arguing that an `Other` chip promises a coherent group and delivers a
junk drawer. C10A reverses that. The corpus supports the reversal: measured
across all 1,914 stored cases, **0.9%** land there. At that rate it is a small
honest remainder, and totality is what lets a future Category filter promise
complete coverage of All Recalls.

Two rules keep it honest: `other` **never** co-occurs with a real category, and
the derivation is **total** — `orderFoodCategories([])` is `['other']`, so
every case carries at least one category by construction.

### Multi-label, capped at four

A case may carry several categories only when its source-stated products
genuinely span them (_frozen waffle and turkey sausage_). Ingredients never add
a category. Output is de-duplicated, sorted into display order, and capped at
four (`MAX_CATEGORIES_PER_CASE`). Measured multi-label rate: 1.9% of all cases,
2.6% of active cases.

---

## 2. Product-text extraction

The matcher reads one field per case, in this order (`categoryProductText`),
measured over all 1,914 stored cases:

| Basis                 | Source                                                      | All cases | Active cases |
| --------------------- | ----------------------------------------------------------- | --------: | -----------: |
| `product_description` | FDA's structured `projection.productDescription`            |     37.5% |        80.0% |
| `title_grammar`       | The FSIS title's regular product grammar                    |     52.6% |        18.6% |
| `summary_grammar`     | The announcement's product-identification sentence (C10A.1) |      9.4% |         1.0% |
| `product_lines`       | Structured `affectedProducts`, leading name segment only    |      0.1% |         0.1% |
| `title_raw`           | The whole title                                             |      0.5% |         0.2% |

### The narrow announcement fallback (C10A.1, widened by C10A.2)

FSIS titles routinely state only the agency's remit ("Poultry Products", "Beef
and Chicken Products") while the real product — a salad, an entrée — never
appears in the title at all. Measured after C10A.2's conjunction fix, that
family is **473 of 1,914 stored cases**, and it has been the dominant error
family since C10A. There is exactly ONE narrow way past it.

Both agencies' announcements are templated, and one sentence of the template
exists to name the recalled product and nothing else:

    "The microwavable ready-to-eat chicken bowl items were produced on …"
    "The ready-to-eat steak and mushroom pie items were produced from …"
    "The fried pork rinds were produced from …"

80.0% of stored FSIS notices carry that sentence; the announcement rescues
**179 of the 473** jurisdiction-only cases, and the rest fall through to the
title as before. Reading it is bounded by a closed grammar and four guards, all
in `productSummaryEvidence`:

1. The sentence must begin with "The" and end at "was/were produced", and the
   span between may not cross a sentence boundary. Without the last constraint
   the lazy span runs into the establishment-number line and names a package
   and a plant instead of a product. C10A.2 made the noun "items"/"products"
   optional so a directly named product subject is read too.
2. It is consulted ONLY where the title's own grammar already yielded a
   jurisdiction-only phrase. Title stays primary everywhere else.
3. The subject must read as a NAME, not a clause (C10A.2). A relative pronoun,
   a finite verb or a subordinator rejects it — "products subject to recall",
   "the scope of this recall expansion now includes…" — and so does pathogen,
   allergen, illness, firm, establishment or distribution language.
4. What survives is discarded unless it is (a) not itself jurisdiction-only —
   so generic meat evidence can never become a prepared-food reading, and a
   COORDINATED generic span like "frozen assorted meat and poultry" is caught
   too since C10A.2 — and (b) still names a regulated product, which is what
   rejects a brand line ("The Sams Choice Black Angus Vidalia Onion items were
   produced…", where the recall is beef patties).

**Hazard blindness is measured, not asserted.** Zero of the 1,196 stored FSIS
announcements yield an extracted span containing hazard or cause language, and
guard 3 above now asserts that property rather than leaving it to the
template's habits.
`npm run qa:categories` includes unit variants that rewrite the cause,
pathogen, allergen, firm, retailer and geography clauses and require identical
categories, and `npm run qa:product-categories` re-derives all 1,914 live cases
with EVERY non-product sentence of the announcement replaced by loud hazard,
firm, retailer and illness prose. Both come out byte-identical.

### The product-lines correction C10A tried, measured, and reverted — still reverted

C5.3B-2 blamed the same seam but recommended a different second basis: the
structured product lines. C10A implemented it and A/B-measured it on the 60
development rows it affects, scoring both arms against identical labels:

| Basis         | Exact-set | Rows only this arm got right |
| ------------- | --------: | ---------------------------: |
| Title grammar | **80.0%** |                       **21** |
| Product lines |     50.0% |                            3 |

FSIS product lines are packaging prose — `Combo bins containing "Beef
Trimmings, BNLS, 90 L"` — and the names inside them are brand-dominated. A
blanket preference for them stays **prohibited**, and a test pins it. The
announcement sentence is not that: it is one closed grammar whose whole job is
to name the product.

---

## 3. Matcher architecture

`src/domain/food-category-matcher.ts`, pure and dependency-free. Reviewed
lexical data lives in `src/domain/food-category-lexicon.ts`, which also
declares the structural roles: dish-forming protein categories, dishable staple
heads, flavour-taking categories, plant-analogue markers, stated-audience
markers.

```
product text
  → normalize (case, entities, whitespace; hyphens preserved)
  → packaging preposition: "<bag> containing X" keeps X
  → ingredient preposition: "with / containing / in" ends the product list
  → product separators: ; , followed by space · "such as" · "including"
  → conjunctions resolved by ROLE
  → per phrase: compounds claim spans, head terms fill the rest,
    flavour/negation-marked matches dropped, LAST survivor wins, then
    dish formation / postposed flavour / analogue / honesty rules
  → list level: flavour enumerations collapse; "for baby" names the audience
  → union → dedupe → display order → cap at four → [] becomes ['other']
```

### Anti-overfitting rules

Forbidden in the lexicon and in the matcher: case-id rules, full-title
overrides, brand or firm rules, retailer inference, agency inference, hazard or
allergen inference, runtime model calls, fuzzy matching, and any use of the
gold fixture as a lookup table. A test scans every lexicon entry for case ids,
URLs and corporate markers. FSIS jurisdiction is **not** a category signal.

---

## 4. Gold set and the freeze protocol

`src/domain/fixtures/category-gold-set.json` — 1,496 reviewed rows.

| Split           | Rows | Purpose                                                                    |
| --------------- | ---: | -------------------------------------------------------------------------- |
| `development`   | 1296 | Everything ever tuned or debugged against, including every spent holdout.  |
| `c10a2_natural` |  200 | Proportional sample of the untouched corpus. **Carries the binding gate.** |

**A holdout is spent when it is measured.** `development` therefore contains
C5.3B-2's 317 final-holdout rows, C10A's 307 and C10A.1's 252. Each measured
its own frozen matcher once; C10A.2 changed the classifier, so re-scoring any
of them would report a tuning number dressed as a generalization number. They
keep `originSplit`, a test requires every retired split to still be findable by
it, and C10A.2 drew its own holdout from the **618 cases no split had touched**.

**C10A.2 drew no challenge split.** C10A.1's was diagnostic, carried no gate,
and a second one would have spent 52 more untouched cases producing a number
nothing depends on. Preserving the remainder was worth more.

Every row carries `announcementSummary`, because the classifier reads a span of
it. A fixture missing an input the derivation reads grades a classifier nobody
runs — the defect C10A.1 shipped and §5 records.

**Freeze protocol**, enforced by tests and by `npm run qa:categories`:

1. All classifier, extraction **and harness** changes completed and
   development-set testing finished; then the matcher, lexicon, vocabulary,
   compact mapping **and the evaluation harness** were frozen and their SHA-256
   hashes recorded in `category-freeze-manifest.json`.
2. The selection procedure was written into the manifest BEFORE the draw.
3. Holdout cases were selected without running the matcher on them — 200 by
   largest-remainder proportional allocation over nine source-structure strata
   (agency × lifecycle × has-productDescription × product-line-count bucket),
   ordered within each stratum by FNV-1a(caseId). No stratum consults the
   lexicon, the matcher's output or any prediction.
4. Expected labels were reviewed from full source evidence — title, product
   description, product lines AND the announcement — and frozen as
   `finalLabelsSha256` before any prediction was computed.
5. The matcher ran exactly once. A changed hash fails the suite and the QA gate.

### Why the harness is frozen too, and what that forced

C10A.1 froze only the classifier and then shipped a **harness** defect that
moved its headline number three points. A harness edited after a run can
rewrite a result as easily as a classifier can, so C10A.2 hashes
`category-evaluation.ts` and `scripts/qa-categories.ts` alongside it.

That freeze is only credible if nothing in those files has to change after the
run — and two things a post-run review _produces_ used to live there. Both were
moved into the manifest as **data**:

- `finalReview.unfindable` — which cases a reviewer judged unfindable, and why.
- `holdout.uncoverableCategories` — which categories the draw could not cover.

The harness now holds the arithmetic and the thresholds; the manifest holds the
review. A test still checks the disclosure both ways: a disclosed category the
holdout _does_ cover is reported as stale, and dropping a disclosure re-exposes
the gap it was hiding.

### Harness equivalence — the gate grades the derivation that ships

`predict` is what the gate runs; `deriveProductCategories` is what `projectCase`,
the historical backfill and live QA all run. Four tests hold them together:

- they return identical categories for **every** fixture row;
- the constraint is **not vacuous** — at least one fixture row derives
  differently once the announcement is withheld, so a harness that silently
  dropped it would fail rather than pass;
- a **synthetic** summary-dependent row proves the same thing independently of
  what the corpus happens to contain;
- the fixture's recorded `productText`/`basis` must be exactly what the shipping
  extraction produces from the row's own stored inputs.

### Disclosures

- **Four of the twelve categories have zero support in this holdout**:
  `seafood`, `beverages`, `baby_food_formula` and `supplements`. The draw is
  proportional over source structure and blind to category, and the untouched
  pool is 72% FSIS — an agency whose remit is meat, poultry, egg and
  Siluriformes products — so a proportional 200 of it contains no beverage, no
  infant-feeding product and no supplement, and its only fish evidence is an
  ingredient rather than a product. Their accuracy is **unmeasured** here.
- Support where it exists: meat_poultry 92, prepared_foods 54, produce 20,
  pantry_condiments 16, dairy_eggs 11, bakery_grains 6, snacks_sweets 2,
  other 1. Only the first three clear the support-20 per-category floor.
- **The sample holds exactly two reviewed multi-category rows**, so multi-label
  accuracy is close to unmeasured — the same limitation C10A.1 disclosed.
- **Prediction observation, disclosed before the draw.** The milestone requires
  both a corpus-wide false-positive audit of every new rule and a holdout for
  which no prediction has been computed. Over one corpus those cannot both hold
  absolutely. 21 of the 618 pool cases had classifier output observed during
  that audit; they were **not** excluded, because removing exactly the cases the
  new rules affect would bias the draw against the change being measured. Five
  of them were drawn. §5 reports the result with and without them.

---

## 5. Result: 87.5% — the gates are missed, and C10A.2 stops

| Measurement                    | Exact-set |   Micro P |   Micro R |
| ------------------------------ | --------: | --------: | --------: |
| Development 5-fold CV (tuning) |     92.6% |     93.1% |     93.4% |
| **C10A.2 natural (200)**       | **87.5%** | **88.0%** | **87.1%** |

| Blocking product gate             | Threshold | Measured  | Verdict |
| --------------------------------- | --------- | --------- | ------- |
| Natural exact-set                 | ≥90%      | **87.5%** | FAIL    |
| At least one correct category     | ≥90%      | **88.0%** | FAIL    |
| Micro precision                   | ≥90%      | **88.0%** | FAIL    |
| Micro recall                      | ≥90%      | **87.1%** | FAIL    |
| Per-category P and R, support ≥20 | ≥80%      | see below | FAIL    |
| Determinism                       | stable    | stable    | pass    |
| Newly reviewed unfindable         | ≤3%       | **1.0%**  | pass    |

Per agency: **FDA 92.9% (52/56)**, **FSIS 85.4% (123/144)**. The legacy 95%
research threshold remains informational and remains unmet.

### The per-category floor C10A.2 added, and why

An overall number can clear 90% while one large category quietly collapses —
C10A.1's prepared-foods recall was 71.7% behind an 86.5% headline and nothing
in the gate surfaced it. `PRODUCT_GATES` now blocks on precision **and** recall
≥80% for every category with support ≥20:

| Category         | Support |      Precision |            Recall | Verdict  |
| ---------------- | ------: | -------------: | ----------------: | -------- |
| `meat_poultry`   |      92 | 83.3% (90/108) |     97.8% (90/92) | pass     |
| `prepared_foods` |      54 |  94.6% (35/37) | **64.8% (35/54)** | **FAIL** |
| `produce`        |      20 | 100.0% (19/19) |     95.0% (19/20) | pass     |

Prepared foods is the whole story, and it is the same story C10A.1 told: the
classifier **under-predicts** prepared foods and is right when it does predict
them. Recall fell from 71.7% to 64.8% while precision rose from 97.7% to 94.6%
— but these are independent draws and the movement is not a trend, only a
restatement of the same defect on new evidence.

### Where the error lives — all 25 failures reviewed

| How wrong                                                             | Count |
| --------------------------------------------------------------------- | ----: |
| Reasonable overlap — right family, a dish read as its protein         |    12 |
| Debatable reviewed label — a careful reviewer could defend either     |     6 |
| Clearly wrong, but in an adjacent aisle a shopper would plausibly try |     5 |
| Clearly wrong, and in an aisle no reasonable shopper would try        |     2 |

Cut by cause rather than severity, **20 of the 25 are the Prepared foods ↔
Meat & poultry boundary** — 18 expected Prepared and got Meat, 2 the reverse.
The remaining five are: a multi-label row that got one of its two categories, a
non-food item read as food, a produce case silenced to `other`, a beef-tallow
seasoning base read as meat, and a lentil snack read as a pantry pulse.

**Two cases were judged unfindable** (1.0%, gate ≤3%), and **both predate
C10A.2** — the C10A.1 classifier placed them identically:

- a lead-contaminated **24 cm milk pan** under Dairy & eggs, because
  `NON_FOOD_TERMS` carries "saucepans" but not "milk pan";
- **"Cantaloupe Chunks and Cubes and Fruit Mixes and Medleys Containing
  Cantaloupe"** silenced to `other`, because every phrase's final substantive
  word — chunks, cubes, mixes, medleys — is unknown to the lexicon and the
  honest-silence rule then silenced all of them.

The other 23 land in an aisle a shopper would plausibly try, which is why the
rate is 1.0% and not 12.5%. This is a **frozen human-reviewed baseline of one
review of one spent holdout**, not a forward-looking metric: no assertion can
recompute "would a shopper look here?", and this corpus has no untouched 200
left to refresh it with.

### What the disclosed prediction observation was worth

| Subset                          |   n | Exact-set | At least one |
| ------------------------------- | --: | --------: | -----------: |
| All                             | 200 |     87.5% |        88.0% |
| Prediction-observed (disclosed) |   5 |    100.0% |       100.0% |
| **Never observed (clean)**      | 195 | **87.2%** |    **87.7%** |

The disclosed contamination moved the headline by **+0.3pp** and the verdict is
FAIL on either subset, so it did not manufacture the result.

### What each refinement did on the fresh holdout

| Basis of the row |   n | Exact-set | At least one correct |
| ---------------- | --: | --------: | -------------------: |
| Structured name  |  56 |     92.9% |                92.9% |
| Title grammar    | 130 |     85.4% |                86.2% |
| Announcement     |  14 |     85.7% |                85.7% |

Scored post-hoc with the announcement fallback disabled, the same holdout gives
**86.0% / 86.5%**: the fallback is worth **+1.5pp on both**, fixing three rows
(egg rolls, tamales, a turkey enchilada) and breaking **none**. C10A.1's
narrower version fixed five and broke one. Nothing was selected on this number
— the holdout is spent either way and C10A.2 stops regardless.

---

## 6. Refinements: what was retained and what was rejected

**A. Jurisdiction-only normalization — RETAINED.** `contentWordsOf` now drops
coordinating conjunctions, so a coordinated species list reads as the
jurisdiction it is: "Beef and Chicken Products", "Poultry and Meat Products",
"Chicken, Pork and Beef Products". Measured over the live corpus this admits
**55 distinct title phrases and every one is a bare species list** — none names
a product form, dish, cut, package or preparation, because the "every content
word is a species word" test still fails the moment one word does. It cuts both
ways on purpose, and the second direction matters as much: `productSummaryEvidence`
now correctly **refuses** a coordinated generic span ("frozen assorted meat and
poultry"), which C10A.1 recorded as the mirror-image defect.

**B. Bounded summary sentence grammar — RETAINED.** The literal noun
"items"/"products" is now optional, so an announcement naming the product as its
own subject is read: "The fried pork rinds were produced from…", "The beef and
chicken blintzes were produced on…". The sentence still must begin at "The",
still must end at "was/were produced", and still may not cross a sentence
boundary. The wider subject is paid for by a new rejection guard,
`namesProductSubject`:

- a **relative pronoun, finite verb or subordinator** proves the span is a
  clause about the recall, not a product name — "products subject to recall",
  "the scope of this recall expansion now includes…", "product labeled as X,
  which may actually contain Y";
- **pathogen, allergen, illness, firm, establishment or distribution** language
  is cause, who or where rather than what.

A rejection can only ever restore the C10A.1 answer, never invent a new one.
The mandated corpus audit found 12 cases outside every gold split whose reading
changes: **11 are clearly correct** (egg rolls, dumplings, taquitos, tamales,
burritos, wraps, chicken salad, bone broth, chicken gravy, a chicken pie beside
a meatloaf, a mixed deli-meat list beside a meat pie) and **1 over-classifies**
(a Monte Cristo sandwich gains Dairy & eggs and Meat & poultry from a
parenthesised ingredient list).

**C. Product-head precedence — PARTLY RETAINED.**

_Retained:_ a **variant postposed after a spaced dash** does not outrank the
product before it. "Protein Powder – Chocolate" is a supplement; "Cookies -
Chocolate Chip" is bakery. It is punctuation-driven, not vocabulary-driven, and
it is guarded: the cut fires only when the text **before** the dash already
names a product, so "New Orleans – Roasted Chicken Wings" still reads on the far
side. A bare hyphen still binds words. Corpus support is honest and small —
seven stored cases carry a spaced dash, the cut changes one and leaves six
identical, because their variants were pack sizes the lexicon never matched.

_Rejected:_ preferring a **leading product-form head**, which would repair "Bao
Curry Chicken" and "Spread Pistachio Cacao Cream". "Sandwich meat", "taco meat",
"burger patties" and "sushi grade tuna" are ordinary phrases it would break, and
they are pinned by a test.

_Rejected:_ demoting **"cream"** to a style word. Twenty-four of the twenty-five
corpus cases carrying it are genuine dairy; the rule would repair one and risk
all of them.

**D. Vocabulary — RETAINED.** `pasty`/`pasties` as Prepared foods, filed with
the empanada, pierogi and samosa family already there rather than under Bakery;
the word boundary keeps `pastr(y|ies)` with the bakery terms. **Corpus support
is one case and that case is spent**, so this is a vocabulary completion
justified by general product language, not by frequency, and it could not have
moved the final number.

**One false-positive repair, found by B's mandated audit and retained.**
Widening the grammar surfaced "frozen, raw beef tripe, beef feet, and lamb tripe
items", where every phrase's head noun was unknown to the lexicon and the
honest-silence rule collapsed the case to `other` — strictly worse than the
Meat & poultry the title gave. Repaired generally with `<species> <offal cut>`
as a compound. **The species is required**, and is what separates "beef hearts"
from "artichoke hearts", "pig ears" from "ears of corn", and "beef maw" from
"fish maw".

### Development-set effect, and why it is not the claim

All 1,296 spent rows are tuning evidence. Across them C10A.2 moves 1,197 →
**1,200** exact-set (92.4% → 92.6%): 6 fixed, 4 broken, 2 sideways.

| Spent split (diagnostic only) | Before | After |
| ----------------------------- | -----: | ----: |
| development core (420)        |  97.6% | 97.1% |
| `final_natural` (200)         |  89.5% | 89.0% |
| `final_challenge` (117)       |  94.0% | 94.0% |
| `c10a_natural` (200)          |  91.5% | 92.5% |
| `c10a_challenge` (107)        |  87.9% | 87.9% |
| `c10a1_natural` (200)         |  86.5% | 88.5% |
| `c10a1_challenge` (52)        |  92.3% | 92.3% |

Of the 4 broken rows, **2 are the label artefact C10A.1 already described** — a
reviewed label assigned from the very jurisdiction-only title the fallback
exists to look past. "Beef and chicken burritos" and "pork meat and beef tripe
stew" are Prepared foods under the taxonomy's own written rule that a dish is
not its protein, so the _new_ answer is the defensible one. **Those labels were
not corrected**: rewriting a spent holdout's label to flatter a change is the
circularity the freeze protocol exists to prevent. The other 2 are genuine harms
— "ready-to-eat pork patty rolls" now reads as Bakery on the word "rolls", and
one offal case regressed to `other` before the repair above fixed it.

### Rejected alternatives, with the measurement that rejected them

1. **Merging Prepared foods and Meat & poultry — rejected**, and prohibited by
   the milestone. It would absorb twenty of the twenty-five failures, but the
   categories are independently useful, product semantics must not vary by
   source agency, and improving a benchmark by coarsening the taxonomy reduces
   the product. The compact seven-category diagnostic confirms it: 87.5%,
   identical to the full vocabulary.
2. **Reading structured product lines on jurisdiction-only titles — rejected,
   and measured** under C10A: title 80.0% vs product lines 50.0%. A test pins it.
3. **Dual-tagging every generic FSIS meat/poultry title — rejected, and
   measured** under C10A: it would fix 6 and wrongly tag 49.

### Found after the run, and deliberately NOT fixed

Reading the failures exposed three more general defects. Acting on any of them
would require a new freeze and a new holdout, and **this corpus can no longer
supply one** — fixing them now would tune the classifier on the holdout that
measured it.

1. **`of` is not a descriptor.** "California Firm Expands Recall **of** Beef
   Products" yields the phrase "of Beef Products", which fails the
   jurisdiction-only test on the word "of", so the announcement fallback never
   fires.
2. **"shelf" and "stable" are not descriptors**, so "heat-treated, not fully
   cooked, not shelf stable meat and poultry items" passes the
   not-jurisdiction-only guard and is admitted as evidence that adds nothing.
3. **Lexical gaps in composed-dish vocabulary**: `sfiha`, `korma`, `hot pocket`
   and `pepperoni roll` all read as their protein.

---

## 7. Decision: STOP (C10A.2 — superseded by §8)

> **Superseded, not deleted.** This section is C10A.2's own decision, recorded
> as it stood on 2026-08-31 before the founder made a product call. Its
> measurements remain exactly true; its two forward-looking bullets do not.
> **C10B applied the historical backfill and shipped the filter** — under a
> narrower promise and with the weakest category hidden — for the reasons in
> §8. Read the two together: §7 is why the classifier is not good enough for
> the original brief, §8 is why a smaller brief was chosen instead.

The fresh natural holdout misses four of the five accuracy gates and the new
per-category floor. Under the milestone's own stop conditions:

- **Nothing was integrated beyond the canonical derivation and its inert
  projection field.** The derivation change ships in `projectCase` because that
  is where categories have been derived since C10A; no consumer surface, no
  filter, no UI, no feed column changed.
- **No failed case was patched.**
- **The historical backfill was NOT applied**, and must not be. Applying now
  would write 1,899 rows from a classifier that failed its gate.
- **No further holdout may be drawn.** 418 cases remain untouched — not enough
  for another 200-case natural draw at this stratification, and drawing a
  smaller one would trade the last untouched evidence for a weaker number.

The separation between Category and everything that matters is unchanged and
still proven rather than promised: `src/lib/category-invariance.test.ts`
attaches categories to the objects each decision path consumes and requires the
decision to be byte-identical, and `npm run qa:product-categories` re-measures
that over the live corpus — All Recalls membership and order, Affects Me
eligibility and order, personal relevance, risk tier, push copy and
material-change detection all come out unchanged.

### The hazard-blindness instrumentation defect C10A.2 found and fixed

`qa:product-categories` re-derives all 1,914 cases with every non-product
sentence of the announcement rewritten as loud cause, firm, retailer and illness
prose. After C10A.2 widened the classifier's sentence grammar, that script still
**preserved only the old shape**, so its rewrite deleted the product sentence on
exactly the 12 cases the widening newly reads — and reported them as
hazard-sensitive. They were not. With the shipped shape preserved, **zero of the
1,914 stored cases move.** A shape that under-matches there does not test hazard
blindness at all; it tests what happens when you erase the product name, which
is supposed to change the answer. The script now tracks the classifier's shape
and says so in a comment, and the gate is back to 0.

### Honest limitations to carry forward

- **Prepared-foods recall is 64.8%** (precision 94.6%). It under-predicts and is
  right when it does predict. The cause is FSIS titles that state only the
  agency's remit; §6 lists the three specific, general, unfixed defects and the
  lexical gaps that keep the announcement fallback from reaching the rest.
- Those cases **normally remain discoverable under Meat & poultry**, which is
  why the reviewed-unfindable rate is 1.0% and not 12.5%.
- `seafood`, `beverages`, `baby_food_formula` and `supplements` have **no
  holdout support at all** (§4), so their accuracy is unmeasured;
  `bakery_grains`, `snacks_sweets` and `other` have single-digit support and
  their rates should be read as numerator/denominator, not as percentages.
- **Multi-label is effectively unmeasured**: two reviewed rows, both missed.
- Three independent fresh holdouts now read 91.5%, 86.5% and 87.5%. Treating any
  one of them as _the_ accuracy over-reads a 200-case sample; the range is the
  honest summary.

---

## 8. Founder acceptance and launch (C10B)

C10A.2 stopped at §7 and recommended no further tuning. C10B did not resume
tuning. It made a **product decision on the measurement as it stands** and
shipped Category under a narrower promise than the original brief assumed.

### The decision, and the number it actually rests on

Accepted for launch, unchanged and unre-run:

| Measure                                   |         Value |
| ----------------------------------------- | ------------: |
| final untouched holdout, exact-set        |     **87.5%** |
| at-least-one-correct                      |     **88.0%** |
| micro precision / recall                  | 88.0% / 87.1% |
| human-reviewed **unreasonable** placement |      **1.0%** |

The accuracy figure is not what decided it. **1.0% (2/200)** is: that is the
share of the holdout a human judged to be placed where no reasonable shopper
would look. The other 23 mismatches are near-misses between adjacent aisles,
and 20 of the 25 are a single boundary — Prepared foods ↔ Meat & poultry —
whose weaker side is **hidden from the launch filter** for exactly that reason.

The argument is about what Category is permitted to do, not about the score:

- it applies **only to All Recalls**, only on an explicit selection;
- **every recall remains accessible through the unfiltered feed**, plus search,
  Affects Me, risk, and push/notifications — none of which consults a category;
- a miscategorized card is a **discovery miss with the whole feed behind it**.
  A missed allergen match is a missed alert. Different failures, different
  bars, and `category-invariance.test.ts` proves they share no input.

**Category is an optional convenience filter, not a completeness or safety
boundary.** Nothing in this document may be cited to relax the personalization
or notification thresholds.

### The research benchmarks stay missed

87.5% against the original **95%** research bar and against the C10A.2 **90%**
milestone bar. Both are still printed, neither was weakened, and neither gates
release any more. No merge of the compact vocabulary, no re-score of a spent
holdout, and no relabelling converts the high-80s into a ≥90% result.

**No future accuracy claim without new independent evidence.** A newly drawn,
blind-labelled holdout is the only thing that can move this number, and this
corpus has no untouched 200 left — that requires corpus growth, not arithmetic.

### Launch-visible allowlist

`src/domain/food-category-launch.ts` is the one canonical list, separate from
the frozen twelve-id vocabulary and **derived** from it, so chip order is the
canonical display order by construction and no id can be silently neither
offered nor hidden. Nine offered: Fruits & vegetables, Meat & poultry, Seafood,
Dairy & eggs, Bakery, Snacks & sweets, Beverages, Pantry & staples, Baby food &
formula.

Three hidden — **valid internally, absent from the menu**:

| ID               | Why hidden                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepared_foods` | Known recall weakness: **64.8% recall (35/54)** at 94.6% precision. About a third of genuine prepared-food recalls file elsewhere. High precision is why the id is still stored.              |
| `supplements`    | Insufficient validation: the final holdout has **zero** supplement rows, so nothing is known about how the shipped classifier places them; an earlier phase filed one under Pantry & staples. |
| `other`          | Internal fallback, not an aisle. It exists so the derivation is total; nobody browses for "Other".                                                                                            |

Hidden ≠ deleted. Cases keep carrying these ids, the backfill keeps writing
them, QA keeps reporting them, and every one of those recalls stays in the
unfiltered feed. Un-hiding is a one-line change plus a QA acknowledgement.

## 8b. Commands

```bash
npm run qa:categories               # offline; LAUNCH gate — exits 0 when sound
npm run qa:categories:launch        # the same launch gate, named after its script
npm run qa:categories:frozen        # offline; the frozen C10A.2 report, unmodified
npm run qa:product-categories       # read-only; derivation + PERSISTED gates
npm run backfill:product-categories:dry   # read-only; the historical write plan
npm run backfill:product-categories       # APPLY — executed once by C10B
```

`qa:categories` needs no database, no network and no credentials. It now runs
the **frozen** `scripts/qa-categories.ts` as a subprocess and reprints its
output verbatim — that file is hash-recorded in the freeze manifest and was not
edited — then adds the founder-accepted baseline, relabels the research bars as
NOT MET, and gates on freeze integrity, determinism, the ≤3% unreasonable
baseline, the production invariance suites, and the launch allowlist. It exits
0 when the shipped classifier is still the one that was measured.

`qa:product-categories` reads the live corpus and enforces the derivation
invariants (every case categorized, ids valid and ordered, `other` never mixed,
deterministic, hazard-blind including the announcement, and zero change to All
Recalls membership/order, Affects Me, or personal relevance) **and** the
persisted-column gates over the raw jsonb. `-- --pre-backfill` downgrades only
the missing-categories gate, for the single pre-apply run.

---

## 9. Handoff

### The historical backfill — APPLIED (C10B)

Superseding C10A.2's "planned and NOT applied". Pre-apply dry run against the
live corpus, immediately before the write:

| Field                               | Value |
| ----------------------------------- | ----: |
| cases examined                      |  1916 |
| already carrying categories         |    17 |
| planned writes                      |  1899 |
| would overwrite an existing list    |     0 |
| unchanged                           |    17 |
| failures                            |     0 |
| unresolved concurrent modifications |     0 |
| network requests / timeline writes  | 0 / 0 |
| notification events / new cases     | 0 / 0 |

The 17 pre-existing lists were written by **scheduled ingestion**, not a
backfill: `projectCase` has derived categories since C10A, so any case
re-projected by a normal FDA/FSIS run gains the field. All 17 agreed with the
current derivation, so the plan overwrote none of them.

The apply ran while scheduled ingestion was live and needed **three
invocations**, because it was interrupted twice by its environment rather than
by anything in the data:

| Pass |                                                  Writes | Ended by                                     |
| ---- | ------------------------------------------------------: | -------------------------------------------- |
| 1    |                                                   1,271 | tooling timeout (SIGTERM at 10 min)          |
| 2    |                                                     504 | transient `fetch failed` on a `getCase` read |
| 3    |                                                     124 | completed normally                           |
|      | **1,899** total, 0 failures, 0 concurrent modifications |

This is exactly the case the design was built for: every decision is made from
current state, so re-running the same command resumes from live state instead
of repeating work, and each pass's dry-run-equivalent plan shrinks to what is
actually left (1,899 → 628 → 124 → 0). No CAS was bypassed and no failed case
was patched. It is recorded here because "the apply was run exactly once" would
be a less accurate sentence than this one.

The interruptions also produced a stronger proof than a clean run would have.
Measured at the pass-1 interruption point, with 1,271 category writes already
landed, `notification_events` was unchanged **and** the
`(id, last_changed_at, timeline)` digest over all 1,916 cases was
byte-identical to the pre-apply baseline. An enrichment that cannot move those
after 1,271 writes cannot move them after 1,899.

### Post-apply verification

| Check                               | Result                                  |
| ----------------------------------- | --------------------------------------- |
| dry run re-run                      | **would update: 0**, 1,916 unchanged    |
| cases carrying categories           | **1,916 / 1,916** (active 899 / 899)    |
| persisted QA (17 blocking gates)    | all PASS, including the raw-jsonb gates |
| `notification_events`               | 2,347 → **2,347** (unchanged)           |
| `notification_deliveries`           | 0 → **0**                               |
| cases whose `last_changed_at` moved | **1 of 1,916** — see below              |
| active job leases                   | 0                                       |
| push activation                     | not activated, 0 subscriptions          |

The one case that moved (`6061bbb8…`, an FDA allergy alert) changed at
20:49:53, inside the `fda_announcements` run spanning 20:44:25→20:50:02 — a
scheduled re-projection, which also added the single new timeline entry and
gave the case its categories through `projectCase` in the normal way. **If the
enrichment could move `last_changed_at`, that number would be ~1,899.** Material
timeline entries were unchanged at 431, and no notification event was created
by either the backfill or that re-projection.

### Resulting distribution (all cases · active cases)

| Category            | All | %     | Active | %     |
| ------------------- | --: | ----- | -----: | ----- |
| Meat & poultry      | 778 | 40.6% |     95 | 10.6% |
| Prepared foods      | 429 | 22.4% |    171 | 19.0% |
| Pantry & staples    | 170 | 8.9%  |    150 | 16.7% |
| Fruits & vegetables | 129 | 6.7%  |    127 | 14.1% |
| Snacks & sweets     | 120 | 6.3%  |    104 | 11.6% |
| Dairy & eggs        |  85 | 4.4%  |     79 | 8.8%  |
| Bakery              |  83 | 4.3%  |     79 | 8.8%  |
| Seafood             |  79 | 4.1%  |     46 | 5.1%  |
| Supplements         |  32 | 1.7%  |     32 | 3.6%  |
| Baby food & formula |  20 | 1.0%  |     19 | 2.1%  |
| Other               |  18 | 0.9%  |      9 | 1.0%  |
| Beverages           |  13 | 0.7%  |     13 | 1.4%  |
| _(multi-category)_  |  37 | 1.9%  |     23 | 2.6%  |

Meat & poultry dominates the whole corpus (40.6%) and not the active slice
(10.6%): FSIS recalls close, so the inactive history is meat-heavy while the
live feed is much flatter. **700 of 899 active cases (77.9%)** are reachable
from at least one launch-visible chip. The remaining 199 carry only hidden ids
— 171 Prepared foods, 32 Supplements, 9 Other, overlapping slightly — and every
one of them stays fully visible in the unfiltered feed, search, Affects Me and
notifications. That 22.1% is the measured cost of hiding three categories, and
it is a cost in _menu coverage_, never in recall availability.

Egress cost of the new feed field, measured with `npm run qa:egress` over the
complete 886-case active feed: **+33.8 KB decompressed (1728.8 → 1762.6 KB,
+2.0%)** and **+3.5 KB gzipped (330.3 → 333.8 KB, +1.1%)** — about 39 bytes
per case.

### What a C10A.3 would own — and why it cannot be another holdout run

The defects in §6 are general and written down, and together they account for
most of the Prepared-foods recall gap. But **418 untouched cases remain**, which
is not enough for another 200-case natural draw at this stratification. A future
milestone therefore has to choose between:

- **accepting the measured range** (91.5% / 86.5% / 87.5% across three
  independent draws) and shipping Category under a lower, explicitly restated
  bar; or
- **enlarging the corpus** — the ingestion jobs add cases continuously, so the
  untouched pool regrows — and only then drawing again; or
- **abandoning the aisle taxonomy** for something the source text can actually
  support.

What it may **not** do is re-measure against `c10a2_natural`. It is spent.

### What C10B delivered

- **The column is selected in the feed loader.** `FEED_SELECT` carries
  `product_categories:projection->productCategories` — the derived ids only,
  never the classifier's inputs. Normalized by
  `domain/product-categories-stored.ts`, a leaf module importing only the
  frozen vocabulary, so the app bundle contains no classifier (proved by an
  `expo export` marker scan of both the iOS and web bundles).
- **The UI is wired.** A Category chip in the existing All-only filter row,
  the existing sheet pattern, `Category · N` when active, multi-select with
  Apply / Clear / Cancel. Selections are sanitized against the launch allowlist
  at the state boundary, so a hidden or unknown id cannot enter the filter.
- **Un-enriched cases are handled honestly.** Missing is not `['other']`: a
  case with no stored categories matches no active selection and is never shown
  under a chip, while remaining fully visible in the unfiltered feed. After the
  backfill no active case is in that state, and persisted QA gates on it.
- **The feed cache schema is bumped to 2**, so a pre-category cache cannot
  masquerade as an enriched one.

### What is still open

- **Designed no-image fallbacks**, which is what the taxonomy was originally
  wanted for. Category ids are now available on every card to key them from.
- **Prepared foods and Supplements are hidden**, not fixed. Un-hiding either
  requires new evidence: for Prepared foods a materially better recall than
  64.8%, for Supplements any holdout that actually contains supplement rows.
- **Final visual polish** — Cheyenne's mockups restyle the chip row; the
  filter logic lives in pure libs and is untouched by restyling.

Order still matters and was followed: the accuracy question was settled (by
decision, not by tuning), then the historical apply, then the filter shipped.
