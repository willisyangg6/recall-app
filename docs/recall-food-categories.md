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
separate ≥90% product gates it did clear. **C10A.1** (this document) made
general refinements, re-froze, drew a genuinely fresh 200-case holdout from the
870 cases no split had touched, labelled it from full source evidence and
measured **86.5%**. That misses every accepted product gate. **C10A.1 STOPS:
nothing was integrated beyond the derivation itself, the historical backfill was
not applied, and the classifier must not be re-measured against this holdout.**

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
four (`MAX_CATEGORIES_PER_CASE`). Measured multi-label rate: 1.7% of all cases,
2.6% of active cases.

---

## 2. Product-text extraction

The matcher reads one field per case, in this order (`categoryProductText`),
measured over all 1,914 stored cases:

| Basis                 | Source                                                      | All cases | Active cases |
| --------------------- | ----------------------------------------------------------- | --------: | -----------: |
| `product_description` | FDA's structured `projection.productDescription`            |     37.5% |        80.0% |
| `title_grammar`       | The FSIS title's regular product grammar                    |     56.6% |        19.2% |
| `summary_grammar`     | The announcement's product-identification sentence (C10A.1) |      5.3% |         0.4% |
| `product_lines`       | Structured `affectedProducts`, leading name segment only    |      0.1% |         0.1% |
| `title_raw`           | The whole title                                             |      0.5% |         0.2% |

### The narrow announcement fallback C10A.1 added

FSIS titles routinely state only the agency's remit ("Poultry Products") while
the real product — a salad, an entrée — never appears in the title at all. That
family is 210 of 1,914 stored cases and it was the dominant error family in
C10A. C10A.1 added ONE narrow way past it.

Both agencies' announcements are templated, and one sentence of the template
exists to name the recalled product and nothing else:

    "The microwavable ready-to-eat chicken bowl items were produced on …"
    "The ready-to-eat steak and mushroom pie items were produced from …"

Reading it is bounded by a closed grammar and three guards, all in
`productSummaryEvidence`:

1. The sentence must begin with "The" and end at "items/products was/were
   produced", and the span between may not cross a sentence boundary. Without
   the last constraint the lazy span runs into the establishment-number line
   and names a package and a plant instead of a product.
2. It is consulted ONLY where the title's own grammar already yielded a
   jurisdiction-only phrase. Title stays primary everywhere else.
3. What it yields is discarded unless it is (a) not itself jurisdiction-only —
   so generic meat evidence can never become a prepared-food reading — and (b)
   still names a regulated product, which is what rejects a brand line ("The
   Sams Choice Black Angus Vidalia Onion items were produced…", where the
   recall is beef patties).

**Hazard blindness is measured, not asserted.** Zero of the 1,196 stored FSIS
announcements yield an extracted span containing hazard or cause language.
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

`src/domain/fixtures/category-gold-set.json` — 1,296 reviewed rows.

| Split             | Rows | Purpose                                                                    |
| ----------------- | ---: | -------------------------------------------------------------------------- |
| `development`     | 1044 | Everything ever tuned or debugged against, including every spent holdout.  |
| `c10a1_natural`   |  200 | Proportional sample of the untouched corpus. **Carries the binding gate.** |
| `c10a1_challenge` |   52 | Sparse-category screens. **Diagnostic only.**                              |

**A holdout is spent when it is measured.** `development` therefore contains
C5.3B-2's 317-row final holdout AND C10A's own 307 holdout rows. Each measured
its own frozen matcher once; C10A.1 changed the classifier, so re-scoring
either would report a tuning number dressed as a generalization number. They
keep `originSplit`, and C10A.1 drew its own holdout from the **870 cases no
split had ever touched**.

Every row carries `announcementSummary`, because the classifier reads a span of
it. A fixture missing an input the derivation reads grades a classifier nobody
runs — see the disclosure in §5. That is what makes the file 5.1 MB; it is
read only by tests and by `npm run qa:categories`, never by the app.

**Freeze protocol**, enforced by tests and by `npm run qa:categories`:

1. All classifier and extraction changes completed and development-set testing
   finished; then the matcher, lexicon, vocabulary and compact mapping were
   frozen and their SHA-256 hashes recorded in `category-freeze-manifest.json`.
2. The selection procedure was written into the manifest BEFORE the draw.
3. Holdout cases were selected without running the matcher on them — the
   natural sample by largest-remainder proportional allocation over nine
   source-structure strata (agency × lifecycle × has-productDescription ×
   product-line-count bucket), the challenge sample by six frozen screens.
   Neither consults the lexicon or any prediction.
4. Expected labels were reviewed from full source evidence — title, product
   description, product lines AND the announcement — and frozen as
   `finalLabelsSha256` before any prediction was computed.
5. The matcher ran exactly once. A changed hash fails the suite and the QA gate.

### Disclosures

- **`baby_food_formula` and `other` cannot appear in this holdout.** The corpus
  holds 20 infant-feeding cases in total and every one was already spent by an
  earlier split; the disclosed infant-feeding screen returned zero eligible
  rows. The untouched pool held no case whose product a reviewer could not
  name. `beverages` was exempt under C10A and is **no longer** — the challenge
  screen found one and it reviewed as a beverage. The exemption shrinks as the
  evidence allows and never the other way round.
- **The natural sample holds exactly one reviewed multi-category row**, so
  multi-label accuracy is effectively unmeasured on this draw.
- **The challenge split is 52 rows, not C10A's 107**, because three of the six
  frozen screens were exhausted below their cap (supplements 10, beverages 6,
  infant-feeding 0). It carries no gate.

---

## 5. Result: 86.5% — the gates are missed, and C10A.1 stops

| Measurement                       | Exact-set |   Micro P |   Micro R |
| --------------------------------- | --------: | --------: | --------: |
| Development (tuning, not a claim) |     93.5% |     93.9% |     94.2% |
| **C10A.1 natural (200)**          | **86.5%** | **87.1%** | **87.1%** |
| C10A.1 challenge (52), diagnostic |     92.3% |     92.3% |     92.3% |

| Blocking product gate         | Threshold | Measured  | Verdict |
| ----------------------------- | --------- | --------- | ------- |
| Natural exact-set             | ≥90%      | **86.5%** | FAIL    |
| At least one correct category | ≥90%      | **87.5%** | FAIL    |
| Micro precision               | ≥90%      | **87.1%** | FAIL    |
| Micro recall                  | ≥90%      | **87.1%** | FAIL    |
| Determinism                   | stable    | stable    | pass    |
| Newly reviewed unfindable     | ≤3%       | **2.0%**  | pass    |

Per agency: FDA 86.4% (51/59), FSIS 86.5% (122/141). The legacy 95% research
threshold remains informational and remains unmet.

### Disclosed harness defect

The first execution of the evaluation harness did not pass the announcement to
`predict`, so it graded a **title-only arm** and reported 85.0%. The classifier
files and the reviewed labels were never touched — both still hash to the
values frozen before selection — and the harness was corrected so the gate
grades the derivation that actually ships. **Both numbers miss every gate**, so
the correction changed the evidence, not the verdict. Two tests now pin the
seam: the fixture must carry `announcementSummary` on every row, and `predict`
must derive differently for a summary-basis row once the announcement is
withheld.

### Where the error lives — all 27 natural failures reviewed

| How wrong                                                             | Count |
| --------------------------------------------------------------------- | ----: |
| Reasonable overlap — right family, a dish read as its protein         |     9 |
| Debatable reviewed label — a careful reviewer could defend either     |     8 |
| Clearly wrong, but in an adjacent aisle a shopper would plausibly try |     6 |
| Clearly wrong, and in an aisle no reasonable shopper would try        |     4 |

Cutting the same 27 by cause rather than by severity: **14** are a dish read as
its protein (expected Prepared foods, predicted Meat & poultry), **5** are the
conjunction gap in the jurisdiction test described below, **4** are lexical or
word-order gaps, and **4** are cases where the reviewed label is the arguable
one.

Prepared-foods **recall is 71.7%** against precision of 97.7%: the classifier
under-predicts prepared foods and is right when it does predict them. Confusion
is entirely one-directional — 14 cases expected Prepared and got Meat &
poultry, and **zero** the other way.

**Four cases were judged unfindable** (2.0%, gate ≤3%): a chocolate candy under
Pantry & staples on the word "almond"; a dietary supplement under Pantry &
staples on the word "seed"; a protein powder under Snacks & sweets because a
postposed flavour ("– Chocolate") outranked the product; a chocolate-pistachio
spread under Dairy & eggs because "cream" named the style. They are recorded by
case id with their reasoning in `REVIEWED_UNFINDABLE_CASE_IDS`. This is a
**frozen human-reviewed baseline of one review of one spent holdout**, not a
forward-looking gate: no assertion can recompute "would a shopper look here?".

### Found after the run, and deliberately NOT fixed

Reading the failures exposed four general defects. Acting on any of them
requires a new freeze and a new holdout drawn from the 618 cases that remain
untouched — fixing them now would tune the classifier on the holdout that
measured it.

1. **`isJurisdictionOnlyPhrase` does not strip conjunctions.** "Beef and
   Chicken Products", "Poultry and Meat Products" and "Chicken, Pork and Beef
   Products" therefore do not read as jurisdiction-only, and the announcement
   fallback never fires on them. Four of the 27 failures are that one gap, and
   a fifth is its mirror image: "frozen assorted meat and poultry" passes the
   not-jurisdiction-only guard on the word "and" and is admitted as new
   evidence when it adds none.
2. **The canonical sentence requires the noun "items" or "products".**
   Announcements that name the product directly — "The fried pork rinds were
   produced from…", "The beef and chicken blintzes were produced on…" — do not
   match and fall back to a jurisdiction-only title.
3. **Head-last reading loses marketing word order.** "Bao Curry Chicken" reads
   as chicken though "bao" is in the lexicon; "Protein Powder – Chocolate"
   reads as chocolate because the flavour is postposed after a compound.
4. **"pasties" is absent from the lexicon.**

### What each refinement did on the fresh holdout

| Basis of the row |   n | Exact-set | At least one correct |
| ---------------- | --: | --------: | -------------------: |
| Structured name  |  59 |     86.4% |                86.4% |
| Title grammar    | 128 |     86.7% |                87.5% |
| Announcement     |  13 |     84.6% |                92.3% |

Scored post-hoc with the announcement fallback disabled, the same holdout gives
85.0% / 85.5%: the fallback is worth **+1.5pp exact-set and +2.0pp
at-least-one-correct** on fresh data, fixing five rows and breaking one. That
is a real gain and it is nowhere near enough. Nothing was selected on this
number — the holdout is spent either way and C10A.1 stops regardless.

---

## 6. Refinements: what was retained and what was rejected

**A. Pastry vocabulary — RETAINED.** `kringle` as a compound so "raspberry
kringle" is not read as fruit. "Danish" as a pastry only in pastry context: a
pastry-form head after it ("Danish pastries"), a filling or fruit modifier
before it ("cheese Danish"), or the plural count noun ("Danishes"). Bare
"Danish" stays a demonym, and tests pin Danish ham, Danish blue cheese and
Danish-style feta to their real aisles. **`sambusa` joins the samosa dumpling
family, NOT pastry** — C10A had pinned that gap open deliberately.

**B. Prepared-food vocabulary — AUDITED, one addition.** Every enumerated
synonym (samosa, samsa, dumpling, potsticker, gyoza, ravioli, tortellini, deli
salad, wrap, sandwich, party tray) already derived Prepared foods; only
`sambusa` was missing. Composed deli assortments gained `(party | deli |
charcuterie | antipasto | appetizer | sandwich) (tray | platter)`. **"meat
tray" and "cheese tray" were deliberately excluded**: they also name packaging,
and the corpus contains "Re-packaged various weight beef stew meat trays",
where the product is stew meat.

**C. Supplement powder forms — REJECTED.** No general product-form rule was
retained. A powder's aisle comes from what is powdered, never from the form:
cinnamon powder and asafoetida powder are spices, aquafaba powder is a pantry
good, powdered infant formula is baby food, and supplement-ness comes from the
reviewed botanical vocabulary (moringa, kratom, protein, greens). The candidate
rule — `root powder` → Supplements — has a corpus support of **one case** and
would misfile lotus-root, ginger-root and arrowroot powders, so it is a
case-specific patch wearing a general rule's clothes. **The beet-root example
is left unresolved**, exactly as the brief permits, and the counterexamples
that rejected the rule are pinned by a test.

**D. Narrow FSIS product-summary fallback — RETAINED** (see §2), and it
measured **+1.5pp** on the fresh holdout.

**Two false-positive repairs, found by D's mandated audit and retained.** A
loaf named by its protein is a meat product, not bakery ("ground beef loaf",
"ham loaf"); a fish steak is seafood, not butcher meat. Both are general
product-language rules and both are pinned by tests with their counterexamples
("sourdough loaves", "ribeye steak").

**One general normalization repair.** The descriptor test is now
punctuation-insensitive, so FSIS's "ready-to-eat (RTE)" reads as the same
descriptor as "ready-to-eat". Without it the parenthesised copy counted as a
content word and made a modifier run look like a second product.

### Rejected alternatives, with the measurement that rejected them

1. **Merging Prepared foods and Meat & poultry — rejected.** It would absorb
   fourteen of the twenty-seven failures, but the categories are independently
   useful, product semantics must not vary by source agency, and improving a
   benchmark by coarsening the taxonomy reduces the product. The compact
   seven-category diagnostic confirms it: 86.5% natural, identical to the full
   vocabulary.
2. **Reading structured product lines on jurisdiction-only titles — rejected,
   and measured.** Title 80.0% vs product lines 50.0%; see §2.
3. **Dual-tagging every generic FSIS meat/poultry title — rejected, and
   measured under C10A.** It would fix 6 and wrongly tag 49, collapsing
   Prepared-foods precision from 95.7% to roughly 46%.

---

## 7. Decision: STOP

The fresh natural holdout misses every accepted product gate. Under the
milestone's own stop conditions:

- **Nothing was integrated beyond the canonical derivation and its inert
  projection field.** The derivation change ships in `projectCase` because that
  is where categories have been derived since C10A; no consumer surface, no
  filter, no UI, no feed column changed.
- **The historical backfill was NOT applied**, and must not be. Applying now
  would write 1,914 rows from a classifier that failed its gate.
- **No second holdout may be drawn** and the classifier must not be re-measured
  against `c10a1_natural`. It is spent.
- 618 corpus cases remain untouched by any split, which is what a C10A.2 would
  have to draw from.

The separation between Category and everything that matters is unchanged and
still proven rather than promised: `src/lib/category-invariance.test.ts`
attaches categories to the objects each decision path consumes and requires the
decision to be byte-identical, and `npm run qa:product-categories` re-measures
that over the live corpus — All Recalls membership and order, Affects Me
eligibility and order, personal relevance, risk tier, push copy and
material-change detection all come out unchanged.

### Honest limitations to carry forward

- **Prepared-foods recall is 71.7%** (precision 97.7%). It under-predicts and is
  right when it does predict. The cause is FSIS titles that state only the
  agency's remit, and §5 lists the four specific, general, unfixed defects that
  keep the announcement fallback from reaching most of them.
- Those cases **normally remain discoverable under Meat & poultry**, which is
  why the reviewed-unfindable rate is 2.0% and not 13.5%.
- `baby_food_formula` and `other` have no holdout support at all (§4), so their
  accuracy is unmeasured; `beverages`, `dairy_eggs`, `produce`, `seafood` and
  `supplements` have single-digit support and their per-category rates should be
  read as numerator/denominator, not as percentages.

---

## 8. Commands

```bash
npm run qa:categories               # offline; product gates + legacy benchmark
npm run qa:product-categories       # read-only; live distribution + structural gates
npm run backfill:product-categories:dry   # read-only; the historical write plan
npm run backfill:product-categories       # APPLY — blocked: the gate is not met
```

`qa:categories` needs no database, no network and no credentials — the gold set
is committed, so it produces identical numbers on any machine. It currently
exits non-zero, which is correct: the classifier does not clear the bar the
founder accepted.

`qa:product-categories` reads the live corpus and enforces the structural
invariants: every case categorized, ids valid and ordered, `other` never mixed,
derivation deterministic and hazard-blind (announcement included), and — the
load-bearing one — zero change to All Recalls membership/order, Affects Me, or
personal relevance when categories are attached. It passes.

---

## 9. Handoff

### What a C10A.2 would own

The four defects in §5 are general, they are written down, and together they
account for most of the Prepared-foods recall gap. Fixing them means:
re-freezing the classifier, and drawing a NEW holdout from the **618 remaining
untouched cases** — enough for one more 200-case natural draw, and then the
corpus is exhausted for this purpose.

### What C10B still owns, unchanged

- **Select the column in the feed loader.** `recall-feed.ts` does not yet add
  `product_categories:projection->productCategories` to `FEED_SELECT`.
- **Wire the UI.** `feed-filters.ts` already carries `categoryIds`,
  `matchesCategoryFilter`, and the OR-within / AND-across composition, all
  tested.
- **Decide what an un-enriched case does in the UI.** Every stored case lacks
  the field, so any category selection returns an empty list.
- **Designed no-image fallbacks**, which is what the taxonomy was wanted for.

Order matters, and it has not changed: the refinement question must be settled
before the historical apply, and the apply must precede shipping the filter.
C10A.1 did not settle it.
