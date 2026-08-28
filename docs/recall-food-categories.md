# Food categories

How a recalled product is placed in a consumer aisle category, and why the
matcher that does it is **not yet wired into the app**.

Phase history: C5.3A audited the corpus and proposed the vocabulary; C5.3B
(this document) froze the vocabulary, built the reviewed gold set, the
deterministic matcher and the accuracy gate — and the matcher did not pass.

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
  Pantry staples.
- Dairy words are usually descriptions. _Milk chocolate_ is Snacks & candy;
  _butter flavored popcorn_ is Snacks & candy; _dairy-free coconut yogurt_ is
  still Dairy & eggs, because yogurt is.
- Meat inside a dish is an ingredient. _Chicken enchiladas_ is Prepared meals,
  not Meat & poultry; _ground beef_ is Meat & poultry.
- Seafood is the product, not the allergen. A cookie recalled for undeclared
  shellfish is Bakery.
- _Baby_ is often a size or a cut: _baby arugula_ is Produce, _baby back ribs_
  is Meat & poultry. Baby food & formula needs a product sold for infant
  feeding.
- _Cocktail shrimp_ is Seafood. _Crab cake_ is Seafood. _Ice cream bar_ is
  Dairy & eggs.
- Supplements is the dose form (capsule, tablet, herbal powder), not any
  fortified conventional food.

### No `Other`, no `Uncategorized`

A case the source does not describe well enough carries **no** category. Those
cases split into two groups no single label honestly covers — articles that are
not food at all (lead-contaminated cookware, talc) and food whose name the
reviewed lexicon does not know (`Banh Ba Xa`, `Keto Crunch Smart Mix`) — so an
`Other` chip would promise a coherent group and deliver a junk drawer.

Uncategorized cases stay fully visible whenever no Category filter is active,
and **All Recalls never hides them**.

### Multi-label, capped at four

A case may carry several categories only when its source-stated products
genuinely span them. Ingredients never add a category. Output is always
de-duplicated and sorted into display order, and capped at four
(`MAX_CATEGORIES_PER_CASE`); a case that would exceed the cap is describing a
product list too heterogeneous for a category filter to help with. Category
filtering matches when a case carries **any** selected category.

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

880 of 882 active cases (99.8%) reach a structured or regular-grammar field.
**Announcement prose is deliberately not a source** and must not be introduced
without explicit evidence that it is needed.

The matcher's input type carries only `sourceAgency`, `title`,
`productDescription` and `productLines`. It cannot accept a hazard, allergen,
firm, brand or retailer — that is enforced by the type, not by convention.

---

## 3. Matcher architecture

`src/domain/food-category-matcher.ts`, pure and dependency-free. Reviewed
lexical data lives separately in `src/domain/food-category-lexicon.ts`, so the
vocabulary of product language can be reviewed without reading an algorithm.

```
product text
  → normalize (case, entities, whitespace; hyphens preserved)
  → packaging preposition: "<bag> containing X" keeps X
  → ingredient preposition: "with / containing / in" ends the product list
  → product separators: , ; "such as" "including"
  → conjunctions: resolved structurally (below)
  → per phrase: compounds claim spans, then head terms fill the rest,
    flavour/negation-marked matches dropped, LAST survivor wins
  → union across phrases → dedupe → display order → cap at four
```

**Head nouns.** English puts the head noun of a food name last. Reading the
last surviving match is what makes _Dark Chocolate Cherry Granola_ granola. The
naive alternative — union every food word found — was measured in C5.3A at
34.8% multi-category on the active corpus, nearly all of it flavours and
ingredients.

**Compounds.** Multi-word entries matched first, claiming their whole span, for
names whose head noun is a false friend: `crab cake`, `ice cream bar`,
`frying mix`, `baby arugula`, `cracker sandwich`.

**Conjunction resolution.** `and` may join two products (_cucumbers and
salads_) or two modifiers of one (_cheese and garlic croutons_). Three
structural rules decide: a reviewed compound spanning the conjunction makes the
segment one dish; a last conjunct whose head is preceded by a modifier makes
earlier bare category words its modifiers; and a conjunct naming a prepared
dish absorbs bare component words beside it. Produce is deliberately excluded
from absorption — a contaminated-produce notice routinely recalls the raw item
and the prepared foods made from it as two real products.

### Anti-overfitting rules

Forbidden in the lexicon and in the matcher: case-id rules, full-title
overrides, brand or firm rules, retailer inference, agency inference, hazard or
allergen inference, runtime model calls, fuzzy matching, and any use of the
gold fixture as a lookup table. A test scans every lexicon entry for case ids,
URLs and corporate markers.

FSIS jurisdiction is **not** a category signal: 28% of active FSIS cases are
correctly Prepared meals or Pantry staples. The agency tells you what is _in_ a
product, never what a shopper calls it.

---

## 4. Gold set

`src/domain/fixtures/category-gold-set.json` — 420 reviewed cases.

Every expected label was assigned by human review of the recalled product. The
matcher was used only to **stratify candidate selection**, never to propose a
label. Rows store the case and source id, agency, lifecycle, recency, product
count, title, product description, the canonical product text and its basis,
the expected categories, the split, and a reviewer note where a boundary is
non-obvious. No announcement HTML is stored.

Selection is deterministic and stratified across FDA/FSIS, active/closed/
retracted, recent/older, single/multi-product, all eleven categories,
uncategorized cases, multi-category cases, and the error families C5.3A named.

### Splits

| Split         | Rows | Purpose                                                                                |
| ------------- | ---: | -------------------------------------------------------------------------------------- |
| `development` |  300 | The lexicon was written against these. Its accuracy is a debugging aid, never a claim. |
| `evaluation`  |  120 | Locked. Measured once. The only number that may be quoted as accuracy.                 |

**Disclosed split change.** The fixture was originally 189 development / 111
evaluation. The first locked run scored 81.1%; its failures were read and acted
on, which spends an evaluation split. All 111 rows — failures and passes alike —
were therefore reclassified as development, and 120 cases drawn from the 1,599
the fixture had never touched became the new locked evaluation. Nothing was
moved to improve a number; the replacement set is strictly harder because it
has never been seen.

### Gates

Locked evaluation must reach exact-set accuracy ≥95%, micro precision ≥95%,
micro recall ≥95%, and ≥95% exact-set for each agency. Per-category floors
(80% precision and recall) apply only once a category has ≥5 reviewed
occurrences; below that, numerator/denominator is reported and every failure is
inspected by hand. Output must be deterministic and never exceed four
categories. `npm run qa:categories` exits non-zero when any gate is missed.

---

## 5. Result: the matcher is NOT integrated

| Split                       | Exact-set | Micro precision | Micro recall |
| --------------------------- | --------: | --------------: | -----------: |
| Development (300)           |     94.0% |           95.4% |        96.3% |
| **Locked evaluation (120)** | **74.2%** |       **77.1%** |    **85.7%** |

The gates are not met, so the matcher stays out of `projectCase`, out of the
feed, and out of the UI. Two independent held-out measurements (81.1% on the
first evaluation set, 70.8% then 74.2% on the second) both failed, and the
20-point gap between development and held-out accuracy is the finding: a
hand-written lexicon reaches high accuracy on the cases it was written against
and does not yet generalize.

### Known limitations, asserted in tests so they stay visible

- **Coordinated modifiers vs co-equal products.** _Cheese and garlic croutons_
  (one product) and _frozen waffle and turkey sausage products_ (two) have the
  same shape. The matcher applies the modifier reading and drops the waffles.
- **Component absorption over-reaches.** A bare staple beside a dish is read as
  its ingredient, which is right for _meat and poultry dumplings_ and wrong for
  _fresh cucumbers, salsa and salads_.
- **Genuine source ambiguity.** Bare _Salads_ is bagged greens from one firm and
  chicken salad from another; nothing in the product text separates them.
- **Vocabulary coverage.** Non-English product names remain a real floor.
- **Source defects.** A misspelled _Silurifomes_ is not matched; correcting for
  it would be overfitting to one record.

---

## 6. Known ambiguity policy

When the product text does not support a confident choice, the matcher returns
**no category** rather than a guess. An uncategorized case is visible in All
Recalls and in any unfiltered view; a miscategorized one is invisible to the
shopper who filtered for its real aisle. Coverage is never bought with
precision.

---

## 7. Next milestones

**C5.3B-2 — close the generalization gap (prerequisite).** Expand the reviewed
lexicon and the structural rules against the 300-row development set and the
failure families above, then measure on a **third** sample drawn from cases
neither split has touched. Only that number may be quoted. Until it clears the
gates, nothing downstream begins.

**C5.3C — projection and historical repair.** One canonical derivation owned by
`projectCase`, alongside `retailerNames` and `geography`. Identical FDA/FSIS
semantics, no adapter-specific system, stable ids persisted. Historical repair
follows the C5.2A pattern: dry-run first, narrow compare-and-set, **zero**
`NotificationEvent`s, **zero** new `RecallCase`s, no `lastChangedAt` movement,
no material timeline entries.

**C5.3D — filter UI.** `All | Affects Me | Location | Category | Risk`. All and
Affects Me are mutually exclusive scopes; Location, Category and Risk compose.
OR within a dimension, AND across dimensions. Category opens a multi-select.
All Recalls stays complete regardless of category coverage, and category
filters operate over the complete loaded corpus.

---

## 8. Commands

```bash
npm run qa:categories   # offline; reports both splits, exits non-zero on a gate miss
```

The gold set is committed, so this needs no database, no network and no
credentials, and produces identical numbers on any machine.
