# Product categories

How a recalled product is placed in a consumer aisle category, why that is
**not** the same thing as the hazard category, and why the derivation is
integrated as an **optional discovery filter only**.

Phase history: C5.3A audited the corpus and proposed the vocabulary. C5.3B
froze it, built the reviewed gold set, the deterministic matcher and the
accuracy gate — and failed at 74.2%. C5.3B-2 redesigned the matcher around
structural rules and measured 89.5% on a 200-case natural holdout against a
95% gate; the Category filter was deferred. **C10A** (this document) refined
the vocabulary to twelve categories with an explicit `other`, implemented and
then **reverted** the extraction correction C5.3B-2 had recommended, drew a
genuinely fresh holdout, and measured **91.5%** against the same 95% gate.
That research gate is not met and is left intact. The founder then accepted the
measured classifier for a narrower purpose — Category as an **optional
discovery tool**, never a safety, relevance, risk, notification or
feed-eligibility boundary — under separate ≥90% product gates it does clear.
The projection integration, the dry-run backfill and the QA command are built;
**nothing has been applied**.

---

## 1. The frozen C10A vocabulary

Twelve categories, defined in `src/domain/food-category.ts`. Ids are persisted
and filtered on; labels are display strings and may be reworded without a data
migration. Display order is the array order and is the same everywhere.

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
only `sourceAgency`, `title`, `productDescription` and `productLines`. It
cannot be handed a hazard, allergen, pathogen, firm, brand or retailer.

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
four (`MAX_CATEGORIES_PER_CASE`). Measured multi-label rate: 1.5% of all cases,
2.6% of active cases.

---

## 2. Product-text extraction

The matcher reads one field per agency, in this order (`categoryProductText`):

| Basis                 | Source                                                   | All cases | Active cases |
| --------------------- | -------------------------------------------------------- | --------: | -----------: |
| `product_description` | FDA's structured `projection.productDescription`         |     37.5% |        80.0% |
| `title_grammar`       | The FSIS title's regular product grammar                 |     61.9% |        19.6% |
| `product_lines`       | Structured `affectedProducts`, leading name segment only |      0.1% |         0.1% |
| `title_raw`           | The whole title                                          |      0.5% |         0.2% |

### The extraction correction C10A implemented, measured, and reverted

C5.3B-2 named its largest residual error family and blamed this seam: FSIS
titles that state only the agency's remit ("Poultry Products") while the real
product — a salad, an entrée — appears only in the structured product lines.
Its recommendation was to prefer those lines whenever the title reduces to bare
species words. C10A's whole scope was built on doing exactly that.

**It was implemented and A/B-measured on the 60 development rows it affects,
scoring both arms against identical reviewed labels:**

| Basis         | Exact-set | Rows only this arm got right |
| ------------- | --------: | ---------------------------: |
| Title grammar | **80.0%** |                       **21** |
| Product lines |     50.0% |                            3 |

**The recommendation is wrong about this corpus, and the correction was
reverted.** FSIS product lines are packaging prose — `Combo bins containing
"Beef Trimmings, BNLS, 90 L"`, `12-oz. metal cans containing "SPAM Classic"` —
and the names inside them are brand-dominated. Reading them turns confident,
correct Meat & poultry readings into `other`, into Pantry & staples (a fat
percentage read as a pantry good), and into wrong aisles (fish-skin crackers
read as bakery). Extracting only the quoted label span was also tried and also
scored 50.0%. Two of the three lines-only wins were cases whose title phrase
was already empty or generic, which fall through to the lines anyway — so the
true yield was **one case against a cost of twenty-one**.

The family is real (210 of 1,914 stored cases, 11.0%, carry a jurisdiction-only
title) and its dishes are genuinely mislabelled. The fix is not a different
basis; it is richer source text, which this app does not have.
`isJurisdictionOnlyPhrase` is kept and exported so QA can size the family and a
future milestone inherits the definition rather than guessing at it again.

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

`src/domain/fixtures/category-gold-set.json` — 1,044 reviewed rows.

| Split            | Rows | Purpose                                                                    |
| ---------------- | ---: | -------------------------------------------------------------------------- |
| `development`    |  737 | Everything ever tuned or debugged against.                                 |
| `c10a_natural`   |  200 | Proportional sample of the untouched corpus. **Carries the binding gate.** |
| `c10a_challenge` |  107 | Structural keyword screens for the hard families.                          |

**A holdout is spent when it is measured.** `development` therefore includes
C5.3B-2's own 317-row final holdout: it measured the C5.3B-2 matcher once, and
C10A changed the classifier, so re-scoring it would report a tuning number
dressed as a generalization number. Those rows keep `originSplit`. C10A drew
its own holdout from the **1,177 cases no split had ever touched**.

**Freeze protocol**, enforced by tests and by `npm run qa:categories`:

1. The matcher, lexicon, vocabulary and compact mapping were frozen and their
   SHA-256 hashes recorded in `category-freeze-manifest.json` BEFORE any C10A
   holdout case was selected.
2. Holdout cases were selected without running the matcher on them — the
   natural sample by largest-remainder proportional allocation over nine
   source-structure strata, the challenge sample by ten structural screens.
   Neither consults the lexicon or any prediction.
3. Expected labels were reviewed from full source evidence (title, product
   description and product lines) and frozen as `finalLabelsSha256`.
4. The matcher ran exactly once. A changed hash fails the suite and the QA gate.

### Disclosures

- **`beverages`, `baby_food_formula` and `other` cannot appear in any fresh
  holdout.** The corpus holds only 13 beverage and 20 infant-feeding cases in
  total and the C5.3B-2 development set already contains every one of them; the
  untouched pool held no case whose product a reviewer could not name. A
  disclosed supplemental screen found 1 beverage-shaped and 0 infant-shaped
  candidates, and none reviewed as those categories. Those three are exercised
  by the development split and by unit tests. The exemption is pinned in code
  and fails loudly if a later draw does cover one.
- Seven supplemental challenge rows were added by a disclosed structural screen
  and landed on Notification Report titles, a real hard family. `c10a_natural`
  is untouched by any supplemental draw.
- **Seven development labels were corrected in C10A.** Their original C5.3B-2
  review saw only a jurisdiction-only title ("Poultry Products") and recorded
  Meat & poultry; the case's own product lines name a prepared salad, a frozen
  entrée or pork rinds. Each carries a `note` and `labelCorrectedIn: C10A`.
  Correcting them makes the matcher look _worse_, because it unmasks errors a
  label assigned from the same impoverished text had been hiding.
- After the single run, `prettier --write` re-wrapped whitespace in
  `food-category.ts` and `food-category-lexicon.ts`. No token of logic or data
  changed and the re-run reproduces the recorded numbers exactly; both the
  original and current hashes are in the manifest under `disclosedReformat`.

---

## 5. Result: 91.5% — accepted for optional discovery

| Measurement                       | Exact-set |   Micro P |   Micro R |
| --------------------------------- | --------: | --------: | --------: |
| Development (tuning, not a claim) |     93.9% |     95.1% |     95.1% |
| **C10A natural (200)**            | **91.5%** | **92.1%** | **91.6%** |
| C10A challenge (107)              |     89.7% |     90.2% |     91.8% |
| Compact diagnostic, natural       |     91.5% |     92.1% |     91.6% |
| Compact diagnostic, challenge     |     90.7% |     91.0% |     92.7% |

The RESEARCH gates are 95% (exact-set, micro P, micro R, per-agency) for the
natural split and 90% for challenge. **Both fail**, FDA natural at 88.3% and
FSIS at 92.9%, and those gates are deliberately left intact and still reported:
a gate weakened after seeing results is not a gate. The compact seven-category
merge gains only +1.0pp on challenge and nothing on natural, confirming that a
coarser vocabulary does not rescue accuracy.

The founder then accepted this measurement for a DIFFERENT purpose. See
section 6.

### Discovery accuracy, which is the question an optional filter asks

| Measure                           |     Value |
| --------------------------------- | --------: |
| Exact-set accuracy                |     91.5% |
| **At least one correct category** | **92.0%** |
| Zero overlap with reviewed truth  |      8.0% |

Relaxing exact-set to "at least one correct" buys only **+0.5pp**, because
just one of the seventeen natural failures is a partial match. That is worth
stating plainly: exact-set strictness is NOT what holds this number down, and
neither inclusive matching nor a primary-plus-tags model would rescue it. The
measured counterfactual for blanket dual-tagging is in section 6.

### Where the remaining error lives

Every one of the 17 natural and 11 challenge failures was reviewed.

1. **Jurisdiction-only FSIS titles — 10 of 17 natural failures (59%), 4 of 11
   challenge.** Every one is `expected prepared_foods, got meat_poultry` on a
   title reading "Poultry Products", "Chicken Products" or "Beef and Poultry
   Products", where the recalled product is a salad, a kebab, a sambusa or a
   ready meal. This is the same family C5.3B-2 identified, it is now the
   dominant one, and section 2 records that its recommended remedy was measured
   and makes matters worse. It shows up as `prepared_foods` **recall** of 80.0%
   against precision of 95.7%: the matcher under-predicts prepared foods and is
   right when it does predict them.
2. **Genuine judgment boundaries — most of the remainder.** Ahi tuna poke
   (seafood vs a prepared dish), a vegan frozen dessert, fruit paletas, dried
   bean curd, tortilla strips, a honey cough syrup, a pancake-and-waffle mix.
   Reasonable reviewers disagree; the labels record one defensible reading.
3. **Small vocabulary gaps.** "Sambusa" (the Somali spelling of samosa) is not
   in the lexicon, so the dish reads as its protein. It is **left unfixed and
   pinned by a test**: adding it now would tune the classifier on the holdout
   that measured it, which the freeze protocol forbids.

---

## 6. Decision: accepted for optional discovery, integrated, not applied

The founder accepted the measured classifier as sufficient to build the
Category-filter foundation, on an explicit product argument:

> Category is an optional discovery tool, not a safety, relevance, risk,
> notification, or feed-eligibility boundary. Every notice remains available
> through All Recalls and every other surface.

### Three different things, deliberately not conflated

`npm run qa:categories` reports all three. Only the first one gates anything.

**1. Automated product regression gates — BLOCKING.**

| Gate                          | Threshold | Measured  |
| ----------------------------- | --------- | --------- |
| Natural exact-set             | ≥90%      | **91.5%** |
| At least one correct category | ≥90%      | **92.0%** |
| Micro precision               | ≥90%      | **92.1%** |
| Micro recall                  | ≥90%      | **91.6%** |
| Determinism                   | stable    | stable    |

These decide PASS/FAIL and the exit code. They are recomputed from the frozen
gold set on every run, so they genuinely detect a classifier that has drifted
from the one that was measured. They are **intentionally weaker than the
personalization and notification gates and must never be cited to relax
them** — a miscategorized card is a discovery miss with the entire unfiltered
feed still behind it, whereas a missed allergen match is an alert that reaches
nobody. The separation is structural, not a promise:
`src/lib/category-invariance.test.ts` attaches categories to the objects each
decision path consumes and requires the decision to be byte-identical, and
`npm run qa:product-categories` re-measures that over the live corpus.

**2. Legacy research benchmark — NOT MET, informational only.**

The original 95% threshold this classifier was built against and did not clear
(91.5% natural, 89.7% challenge). Every number is still printed and the
threshold is never weakened, but it is rendered as a comparison rather than as
a failure: it gates nothing, and a non-blocking benchmark printed as `FAIL`
beside a zero exit code is operationally confusing. The honest record is the
number, not the word.

**3. Frozen human-reviewed unfindable baseline — 4/200 = 2.0% (gate ≤3%).**

Four cases in the frozen natural holdout were judged by review to be placed
where no reasonable shopper would look (§5). The automated assertion verifies
the frozen manifest, the recorded case ids, their reasoning records, and the
arithmetic.

**It cannot detect a new unfindable error introduced by a future classifier
change.** "Would a shopper look here?" is a human judgement that is not in the
data, so nothing can recompute it. This is a record of one review of one spent
holdout; it does not generalize to a changed classifier and must not be read as
ongoing coverage. **Refreshing it requires C10A.1 to draw and review a newly
frozen holdout** — the 2.0% cannot be carried forward across a classifier
change.

### What is integrated, and what is not

- `projectCase` derives categories; the projection carries `productCategories`.
- A dry-run-first historical backfill exists and **has not been applied**.
- A read-only QA command exists.
- The filter's semantics and predicate exist and are tested; **the UI is not
  wired**, and the feed loader does not yet select the column — both are C10B.
- Nothing has been applied, committed, pushed, dispatched, or written live.

### Rejected alternatives, with the measurement that rejected them

1. **Merging Prepared foods and Meat & poultry — rejected.** It would absorb
   ten of the seventeen failures, but the categories are independently useful,
   product semantics must not vary by source agency, and improving a benchmark
   by coarsening the taxonomy reduces the product. A meat-based prepared meal
   appearing under Meat & poultry is an understandable discovery result.
2. **Reading structured product lines on jurisdiction-only titles —
   rejected, and measured.** Title 80.0% vs product lines 50.0%; see section 2.
   It stays reverted.
3. **Dual-tagging every generic FSIS meat/poultry title — rejected, and
   measured.** On the natural holdout, adding `prepared_foods` to every
   jurisdiction-only title predicted `meat_poultry` would fix **6** cases and
   wrongly tag **49**, collapsing Prepared foods precision from 95.7% to
   roughly 46%. The multi-label model is right in principle — a chicken salad
   genuinely is both — but the blocker is extraction, not representation: the
   classifier cannot tell which "Poultry Products" notice is a cut and which
   is a salad, so it cannot know when to add the second tag.

### Honest limitations to carry forward

- **Prepared foods recall is 80.0%** (precision 95.7%). It under-predicts and
  is right when it does predict. The cause is older FSIS titles that state only
  "Poultry Products" or "Meat and Poultry Products".
- Those cases **normally remain discoverable under Meat & poultry**, which is
  why the reviewed-unfindable rate is 2.0% and not 8.0%.
- **Three catchable vocabulary gaps** were found in the holdout: a
  Danish/kringle, a beet-root supplement powder, and "sambusa" (the Somali
  spelling of samosa). **They are deliberately NOT patched.** The holdout that
  measured this classifier is spent, and patching examples it flagged would
  make the accepted measurement stop describing what ships. The sambusa gap is
  pinned by a test so it cannot be fixed by accident.
- `beverages`, `baby_food_formula` and `other` have no holdout support at all
  (section 4), so their accuracy is unmeasured.

### C10A.1 — the refinement that must precede a historical apply

A later milestone may add GENERAL rules — never case-specific patches — and
measure once against a newly frozen holdout drawn from the ~870 corpus cases no
split has touched. Candidates: parsing the FSIS announcement summary (the one
field that does describe the product), and the three vocabulary gaps as general
lexicon entries.

**Historical enrichment should not be applied until that decision is made.**
Applying now would write 1,914 rows that C10A.1 would immediately rewrite, and
would spend the corpus's remaining unmeasured cases on a classifier that is
about to change. New and re-projected cases pick categories up automatically in
the meantime, at no cost.

---

## 7. Commands

```bash
npm run qa:categories               # offline; product gates + legacy benchmark
npm run qa:product-categories       # read-only; live distribution + structural gates
npm run backfill:product-categories:dry   # read-only; the historical write plan
npm run backfill:product-categories       # APPLY — do not run before C10A.1
```

`qa:categories` needs no database, no network and no credentials — the gold set
is committed, so it produces identical numbers on any machine. It gates on the
product regression thresholds and reports the legacy 95% benchmark and the
frozen unfindable baseline alongside them, as §6 describes.

`qa:product-categories` reads the live corpus and enforces the structural
invariants: every case categorized, ids valid and ordered, `other` never mixed,
derivation deterministic and hazard-blind, and — the load-bearing one — zero
change to All Recalls membership/order, Affects Me, or personal relevance when
categories are attached.

---

## 8. C10B handoff

The data foundation is built. What C10B still owns:

- **Select the column in the feed loader.** `recall-feed.ts` does not yet add
  `product_categories:projection->productCategories` to `FEED_SELECT`, so
  `FeedItem` carries no categories and the filter has nothing to read on a
  card. That is one line plus the `toFeedItem` mapping; the egress cost is
  roughly 30 bytes per case (~26 KB over the whole active feed).
- **Wire the UI.** `feed-filters.ts` already carries `categoryIds`,
  `matchesCategoryFilter`, and the OR-within / AND-across composition, all
  tested. The sheet needs chips built from `FOOD_CATEGORIES` in display order,
  reading labels through `foodCategoryLabel` and never hard-coding one.
- **Decide what an un-enriched case does in the UI.** Before the historical
  apply, every stored case lacks the field, so any category selection returns
  an empty list. Either gate the filter's availability on the backfill having
  run, or show an explicit empty state — silently showing nothing would read as
  "no recalls in this aisle", which is false.
- **Designed no-image fallbacks**, which is what the taxonomy was wanted for:
  a category is now available per card to choose an illustration.

Order matters: C10A.1 (section 6) should settle the refinement question before
the historical apply, and the apply should precede shipping the filter.
