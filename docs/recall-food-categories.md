# Food categories

How a recalled product is placed in a consumer aisle category, and why the
matcher that does it is **not wired into the app**.

Phase history: C5.3A audited the corpus and proposed the vocabulary; C5.3B
froze the vocabulary, built the reviewed gold set, the deterministic matcher
and the accuracy gate — and failed its locked evaluation at 74.2%. C5.3B-2
(this document) redesigned the matcher around structural rules, froze it with
recorded hashes, measured it once against a 317-case final holdout it had
never seen — and it reached 89.5% on the natural sample against a 95% gate.
The matcher stays unintegrated, and the Category filter is recommended
deferred.

---

## 1. The frozen v1 vocabulary

Eleven categories, defined in `src/domain/food-category.ts`. Ids are persisted
and filtered on; labels are display strings and may be reworded without a data
migration. Display order is the array order and is the same everywhere.

| #   | Id             | Label               | Definition                                                                                                    |
| --- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `produce`      | Produce             | Fresh, frozen, or dried fruits, vegetables, mushrooms, sprouts, and salad components.                         |
| 2   | `meat_poultry` | Meat & poultry      | Beef, pork, chicken, turkey, lamb, deli meats, and jerky sold as meat products.                               |
| 3   | `prepared`     | Prepared meals      | Entrées, pizzas, sandwiches, soups, prepared salads, tamales, and other ready-to-eat or ready-to-heat dishes. |
| 4   | `pantry`       | Pantry staples      | Flour, grains, pasta, rice, cereal, sauces, spices, oils, nuts, seeds, and similar pantry products.           |
| 5   | `bakery`       | Bakery              | Bread, tortillas, cakes, cookies, pastries, and dough.                                                        |
| 6   | `snacks_candy` | Snacks & candy      | Chips, popcorn, chocolate, candy, snack bars, and similar snack products.                                     |
| 7   | `dairy_eggs`   | Dairy & eggs        | Milk, cheese, yogurt, butter, ice cream, and eggs.                                                            |
| 8   | `seafood`      | Seafood             | Fish, shrimp, shellfish, and other seafood products.                                                          |
| 9   | `supplements`  | Supplements         | Vitamins, capsules, powders, herbal supplements, and supplement products.                                     |
| 10  | `baby`         | Baby food & formula | Infant formula, baby food, and products explicitly sold as infant/baby feeding products.                      |
| 11  | `beverages`    | Drinks              | Juice, soda, coffee, tea, drink mixes, and other beverages.                                                   |

### Exclusions that decide the hard boundaries

The category describes **the recalled product** — never its ingredient,
flavour, allergen, hazard, retailer, recalling firm, brand, or intended
consumer.

- A fruit in a name is usually a flavour. _Dark Chocolate Cherry Granola_ is
  Pantry staples; _Iced Tea Lemon_ is Drinks.
- Dairy words are usually descriptions. _Milk chocolate_ is Snacks & candy;
  _dairy-free coconut yogurt_ is still Dairy & eggs, because yogurt is.
- Meat inside a dish is an ingredient. _Chicken enchiladas_ is Prepared meals;
  _ground beef_ is Meat & poultry.
- A protein modifier FORMS a dish on a staple head: _meat pie_, _chicken fried
  rice_, _turkey stuffed pastry_ are Prepared meals, while _apple pie_ and
  _cheese biscuits_ keep their aisle.
- Seafood is the product, not the allergen. A cookie recalled for undeclared
  shellfish is Bakery.
- _Baby_ is often a size or a cut: _baby arugula_ is Produce, _baby back ribs_
  and _smoked baby rope sausage_ are Meat & poultry. Baby food & formula needs
  a product sold for infant feeding — including a name that itself says
  "for baby".
- Rendered fats are pantry goods: _pork lard_ and _beef tallow_ sit with oils.
- A plant-based analogue of a meat product (_plant-based chik'n nuggets_) is
  Prepared meals; Meat & poultry is for meat.
- Supplements is the dose form (capsule, tablet, herbal powder), not any
  fortified conventional food.

### No `Other`, no `Uncategorized`

A case the source does not describe well enough carries **no** category — an
honest silence, never a guess. Uncategorized cases stay fully visible whenever
no Category filter is active, and **All Recalls never hides them**.

### Multi-label, capped at four

A case may carry several categories only when its source-stated products
genuinely span them (_frozen waffle and turkey sausage_). Ingredients never
add a category. Output is de-duplicated, sorted into display order, and capped
at four (`MAX_CATEGORIES_PER_CASE`).

---

## 2. Product-text extraction

The matcher reads one field per agency, in this order
(`categoryProductText`):

| Basis                 | Source                                                   | Coverage                         |
| --------------------- | -------------------------------------------------------- | -------------------------------- |
| `product_description` | FDA's structured `projection.productDescription`         | 100% of FDA cases                |
| `title_grammar`       | The FSIS title's regular product grammar                 | 179/179 active FSIS titles parse |
| `product_lines`       | Structured `affectedProducts`, leading name segment only | conservative fallback            |
| `title_raw`           | The whole title                                          | last resort                      |

The matcher's input type carries only `sourceAgency`, `title`,
`productDescription` and `productLines`. It cannot accept a hazard, allergen,
firm, brand or retailer — enforced by the type.

**The measured limit of this seam (C5.3B-2):** a class of FSIS titles names
only the agency's jurisdiction — "Poultry Products", "Ready-to-Eat Beef
Products" — while the true recalled product (chicken fried rice, steak-and-
mushroom hand pies, tamales) appears only in the announcement summary and the
structured product lines. The title grammar "succeeds" on these, so the
richer `product_lines` basis is never consulted. This is the single largest
residual error family and it is an extraction-policy problem, not a matching
problem; no classifier reading the same text could do better.

---

## 3. Matcher architecture

`src/domain/food-category-matcher.ts`, pure and dependency-free. Reviewed
lexical data lives separately in `src/domain/food-category-lexicon.ts`, which
also declares the STRUCTURAL ROLES the C5.3B failure analysis demanded:
dish-forming protein categories, dishable staple heads, flavour-taking
categories, plant-analogue markers, stated-audience markers.

```
product text
  → normalize (case, entities, whitespace; hyphens preserved)
  → packaging preposition: "<bag> containing X" keeps X
  → ingredient preposition: "with / containing / in" ends the product list
    (rescued only when the tail names a product and is not provenance:
     "…Containing Chicken From an Ineligible Country" stays uncategorized)
  → product separators: ; , followed by space · "such as" · "including"
  → conjunctions resolved by ROLE: component categories modify, bakery/snack
    conjuncts stay products, produce is dropped only as a flavour, a dish
    absorbs its bare or protein components
  → per phrase: compounds claim spans, head terms fill the rest,
    flavour/negation-marked matches dropped, LAST survivor wins, then:
      · dish formation   (protein + dishable staple head → Prepared)
      · postposed flavour (bare produce final yields to tea/candy/baby…)
      · analogue         (plant-based meat reading → Prepared)
      · honesty          (in a list, a phrase ending in an unknown word is a
                          variety name and stays silent)
  → list level: flavour enumerations collapse; "for baby" names the audience
  → union across phrases → dedupe → display order → cap at four
```

### Anti-overfitting rules

Forbidden in the lexicon and in the matcher: case-id rules, full-title
overrides, brand or firm rules, retailer inference, agency inference, hazard
or allergen inference, runtime model calls, fuzzy matching, and any use of the
gold fixture as a lookup table. A test scans every lexicon entry for case ids,
URLs and corporate markers. FSIS jurisdiction is **not** a category signal.

---

## 4. Gold set and the freeze protocol

`src/domain/fixtures/category-gold-set.json` — 737 reviewed cases. Every
expected label was assigned by human review of the recalled product; where a
generic FSIS title hid the product, the stored source summary was the
evidence (about twenty rows, each carrying a note). The matcher never
proposed a label.

| Split             | Rows | Purpose                                                                                     |
| ----------------- | ---: | ------------------------------------------------------------------------------------------- |
| `development`     |  420 | Everything ever tuned or debugged against, including BOTH spent C5.3B evaluation attempts.  |
| `final_natural`   |  200 | Proportional sample of the untouched corpus (agency × lifecycle × recency × product count). |
| `final_challenge` |  117 | Drawn by source-structure keyword screens for the hard families, plus category coverage.    |

**Freeze protocol (C5.3B-2), enforced by tests and by `npm run qa:categories`:**

1. The matcher, lexicon, vocabulary and compact mapping were frozen and their
   SHA-256 hashes recorded in `category-freeze-manifest.json` BEFORE any final
   case was selected.
2. Final cases were selected without running the matcher on them — the natural
   sample by proportional strata, the challenge sample by keyword screens
   defined in the selection script, independent of the lexicon.
3. Expected labels were reviewed and then frozen as `finalLabelsSha256`.
4. The matcher ran exactly once. No classifier or label change afterwards; a
   changed hash fails the suite and the QA gate.

**Disclosures.** The natural sample is drawn blind to category, and by chance
contains no Baby, Drinks, or uncategorized rows — forcing them in would
un-naturalize it, so category coverage is guaranteed across the UNION of the
two final splits (a supplemental keyword-screened challenge draw added baby,
beverage, and boundary rows). The untouched corpus pool contained **no**
remaining non-food or product-class-free case, so a final gold-uncategorized
row was impossible; uncategorized behaviour is exercised by the development
split and unit tests.

---

## 5. Gates

Natural holdout (the accuracy): exact-set ≥95%, micro precision ≥95%, micro
recall ≥95%, FDA ≥95%, FSIS ≥95%, per-category floors (80% precision and
recall at ≥5 support), deterministic output, cap ≤4. Challenge holdout:
exact-set ≥90%, micro precision ≥90%, micro recall ≥90%, every failure
manually reviewed. The predeclared compact seven-category mapping
(`food-category-compact.ts` — Produce · Meat & seafood · Prepared · Pantry &
drinks · Bakery & snacks · Dairy & eggs · Baby & supplements) is evaluated on
the SAME frozen predictions and labels, mechanically merged on both sides.

`npm run qa:categories` reports development cross-validation, both final
holdouts, the compact diagnostic, every individual failure, and the verdict.
It exits 0 only on a full eleven-category GREEN; a compact-only pass is a
product-decision YELLOW and still exits 1.

---

## 6. Result: NOT PASSING — the matcher stays unintegrated

| Measurement                         | Exact-set |   Micro P |   Micro R |
| ----------------------------------- | --------: | --------: | --------: |
| Development 5-fold CV (not a claim) |     98.8% |     99.3% |     98.8% |
| **Final natural (200)**             | **89.5%** | **90.0%** | **90.0%** |
| **Final challenge (117)**           | **91.5%** | **91.5%** | **92.3%** |
| Compact diagnostic, natural         |     90.0% |     90.0% |     90.5% |
| Compact diagnostic, challenge       |     91.5% |     91.5% |     92.3% |

The challenge holdout PASSES its 90% gates; the natural holdout fails the 95%
gates (FDA 85.5%, FSIS 91.3%; prepared recall 27/41). The compact mapping
gains only +0.5pp — the dominant confusion (Prepared vs Meat & poultry) does
not merge away in seven categories, so **a coarser vocabulary would not
rescue accuracy** and is not recommended.

### Where the remaining error lives (all 31 failures reviewed)

1. **Source-text poverty (~10 of 31).** Jurisdiction-only FSIS titles whose
   true product is a dish. Fixable only at the extraction seam (prefer
   structured product lines when the FSIS phrase reduces to bare
   protein/jurisdiction words) — not by any classifier reading the same text.
2. **Catchable structural/vocabulary gaps (~10).** "Stuffed chicken" as a
   composed entrée, bare "bowl" heads, "chicken with cheese burrito", samsa,
   coxinha, mojibake "EntrÇes", pickled-vegetable condiments.
3. **Genuine judgment boundaries (~11).** Canned fruit vs produce, honey sold
   as a supplement, sprinkles, cream bars described as "mango bars",
   pepperoni rolls, bakery-vs-snack wafer lines.

C5.3B measured 74.2% with a 20-point generalization gap. C5.3B-2's structural
redesign closed most of that: +15–17pp on never-seen data, with development
stability (5-fold stdev 0.75pp). What remains is mostly not a parsing problem.

---

## 7. Decision (C5.3B-2)

Per the milestone's decision rules, with neither the eleven-category matcher
nor the compact diagnostic passing the natural gates:

- **The Category filter is deferred.** Search, Location, and Risk filters can
  ship without it; nothing in them depends on category derivation.
- Nothing is integrated into projection, Home, or the feed. The matcher,
  gold set, gates and freeze protocol remain as evaluation infrastructure.
- No further holdout may be drawn against the current frozen matcher; the
  next attempt, if the founder wants one, needs a new milestone that changes
  the EXTRACTION policy for jurisdiction-only FSIS titles (the structured
  product lines already name the real products) plus the catchable gap list
  above, then a fresh freeze and a fresh holdout. That is a founder decision
  about scope, not a default next step.

---

## 8. Commands

```bash
npm run qa:categories   # offline; exits non-zero unless eleven-category GREEN
```

The gold set is committed, so this needs no database, no network and no
credentials, and produces identical numbers on any machine.
