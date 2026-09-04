# Feed usability foundation (C6) and the consumer presentation contract (P1)

_Written 2026-08-28; P1 presentation contract added 2026-09-01; P2a identity,
typed reasons, and the simplified Detail page applied 2026-09-01 (founder
decisions); P2b product identity, affected-version decomposition, and the
compact Affected Products table applied 2026-09-02; P2c global image-role
allocation applied 2026-09-02. Functional milestones on
the temporary UI — final visual design happens separately and may restyle
everything here without touching the business logic, which lives entirely in
pure libs._

## The consumer presentation contract (P1)

This document is the authoritative home for how recall data becomes the exact
consumer-facing fields the app renders. The implementation is
`src/lib/recall-presentation.ts`: one pure, deterministic layer that maps
canonical data to a **Home card model** (`buildHomeCardModel`) and a **Detail
model** (`buildDetailModel`). Both screens consume these models and derive no
recall wording of their own —
`src/lib/recall-presentation-wiring.test.ts` pins the wiring, and
`src/lib/recall-presentation.test.ts` pins the behavior below.

Governing rules: canonical/raw recall data is never modified for display;
every transformation is pure and deterministic; missing or uncertain
information is omitted or stated honestly, never invented; unsafe
transformations fall back to the source-supported value. Time is injected
(`todayIso()` → the builders' `today`), so formatting is timezone-stable and
testable with a fixed date.

### The one activity date

Every card and the detail header show exactly **one** activity label:

- `Announced <date>` when no material update exists;
- `Updated <date>` only when the material-change ledger
  (`domain/material-activity.ts` — `hasMaterialUpdate` / `materialActivityAt`)
  records an authoritative event after the announcement. Agency wording edits,
  `lastPublicActivityAt` drift, and our own maintenance writes can never
  produce "Updated".

Formats: `Today`, `Yesterday`, `Aug 29`, and `Aug 29, 2025` when the year
differs from today's. Source precision is day-level at both agencies, so
hour-level phrasing ("2 hours ago") is unknowable and never produced. Feed
_ordering_ is unchanged — sections still sort by their canonical dates; only
the displayed label moved to material activity.

### Product name

Home and Detail share one cleaned name (`cleanProductName`), derived from the
same canonical inputs on both screens:

1. `productDisplayName` (FDA's structured description beats title parsing;
   the official title is the last resort).
2. A **trailing package measurement — or a comma/and-joined LIST of them**
   ("… 7 oz", "… 150g", "… 500 ml, 250 ml, and 100 ml" — P2b,
   `splitTrailingMeasurements` in `lib/variant-identity.ts`) is removed only
   when a meaningful name remains AND every removed measurement is preserved
   in the supported affected-product/package evidence — otherwise the
   official wording stays. No product-to-size pairing is ever invented. A
   name derived from the **structured product description** counts that
   description's own trailing sizes as evidence, because the consumer
   projection deterministically preserves them: `buildPackageCheck` surfaces
   any description-tail size not already stated elsewhere as case-level Size
   evidence (the **description-size guarantee**), so the sizes move into the
   Affected Products data rather than being lost, and both screens apply the
   identical rule to the identical field (corpus-scan-pinned in
   `src/server/fda/presentation-regressions.test.ts`). Title-derived names
   keep the strict line-evidence gate.
3. A duplicated **displayed-brand prefix** is removed when safe (remainder ≥ 3
   chars with letters, and not the word "Brand"); otherwise the repetition is
   tolerated.
4. Conservative un-shouting of all-caps names (`humanizeAllCaps`).

The stored title is never mutated; titles are never generatively rewritten.

### Brand and identity roles (P2a)

One presentation-level identity decision (`caseIdentity`) assigns three roles,
and no surface improvises its own:

- **`brand`** — the one brand/company line (`displayBrand`): the consumer
  brand leads whenever the source states one; the company display name is only
  the fallback; both are never shown together. A known brand is never replaced
  by its parent company merely because the product name repeats it. Multi-brand
  recalls compact deterministically to the first two known brands plus `+N` (a
  source-written comma list stored as one brands entry is expanded first).
  Placeholder values are never brands anywhere — "various", "and Others",
  "unbranded", and the FDA listing placeholders "No Brand Name" / "Multiple
  brand names" all fall through to the company. With no brand and no company,
  the honest fallbacks are "Multiple products and brands" (when the title
  supports it) or "Company not specified". A displayed brand must be a
  **plausible concise identity** (P2b): a stored entry shaped like prose — a
  sentence, product enumeration, or recall description (the recorded Russ
  Davis entry "Crazy Fresh and Quick & Easy an Unbranded and Bountiful Fresh
  gift baskets") — never displays. The bound is the same 40-character cap the
  What Happened subject uses, so the brand line and the sentence subject
  share one identity contract; an over-long entry is skipped (never sliced
  into a fabricated brand), another concise stored brand wins when one
  exists, and the safe company fallback stands otherwise.
- **`legalFirm`** — the recalling company's display name, preserved for
  official traceability (share copy, provenance, tests). It is never
  substituted into consumer prose merely because it issued the notice.
- **`whatHappenedSubject`** — the subject of "X recalled Y": the ONE reliable
  consumer brand when exactly one is displayed and it reads as a name (a
  length-capped guard keeps stored prose out of the sentence frame). For
  multi-brand or brandless recalls the subject is null and What Happened falls
  back to the company — the firm, not any single brand, is the accurate actor
  there, and a subject is never invented. Recorded proof: the Comforts/Kroger
  announcement reads "Comforts recalled …"; Chocolatey Eyeballs reads "Little
  Temptations recalled …" while the firm Crystal Temptations stays traceable;
  Kofinas reads "Kofinas recalled …" while the firm displays as "LMSI" — an
  unpronounceable short all-caps token is an initialism and survives
  un-shouting (`humanizeAllCaps`), never "Lmsi", while ordinary all-caps words
  ("KROGER", "SPRITE") are still un-shouted.

### The typed reason (P2a) and the concise reason line (Home)

One bounded typed-reason interpretation (`interpretReason`,
`src/lib/recall-reason.ts`) classifies the canonical reason evidence into a
closed family set — pathogen contamination, undeclared allergen, foreign
material, chemical, inspection failure, import violation, insanitary
conditions, processing defect, unfit, mislabeling/misbranding,
nutrition/formulation (infant formula), unapproved ingredient, declared
contents, gated verbatim, unknown. Home's concise line and Detail's What
Happened clause are two renderings of the SAME interpretation, so the two
surfaces cannot disagree about what kind of problem a recall is. A family is
assigned only from structured canonical fields or a verified source-text
pattern; a hazard or allergen is never invented.

**Home/Detail semantic parity (P3A).** The two surfaces call the one
interpreter and differ only in how much canonical evidence they can supply. A
Home feed row carries `reasonText`, `hazardCategory`, `pathogenOrAllergen`
and `title`; Detail additionally has the announcement body (`summaryText`).
The body is deliberately **not** on the feed — it is the largest field in the
corpus (measured: ~2.9 KB/case, which would grow a cold feed load by ~175% on
the wire) and the standing feed-SELECT contract keeps the app receiving
derived answers rather than source evidence. So the guarantee is **not** equal
specificity; it is that the surfaces can never contradict, because more
evidence can only refine:

- **family** is decided by structured fields alone → identical on every
  notice;
- **allergen list** comes from `pathogenOrAllergen` alone → identical;
- **named material or agent**: Detail's haystack is Home's plus an _appended_
  summary, so a material Home names still wins in Detail. Home names either
  nothing or exactly what Detail names — never a third thing;
- **uncertainty** is honest on both: an unnamed agent renders as its family's
  generic form, and **packaging material is never the hazard on either
  screen**.

Worked examples from the recorded corpus. FDA Palermo Villa states its
contaminant in its own title, so both surfaces say plastic (never metal,
despite the dual "Potential Metal or Chemical Contaminant" reason category).
FSIS 005-2026 and PHA-10092020-01 state glass only in the body: Detail names
glass, Home stays honestly generic, and neither ever says plastic — which is
what their packaging is made of. 115-2017 reads as undeclared fish on both.
Corpus-scanned over every recorded FDA and FSIS notice: **zero family
disagreements, zero agent/material contradictions, zero packaging false
positives.**

**Foreign-material evidence ownership.** `extractForeignMaterialEvidence`
(`src/domain/hazard.ts`) is evidence-gated (a material word counts only inside
a bounded construction that states it as the contaminant, never as
packaging) and is the owner both the FSIS category parser and the consumer
reason line (Home/Detail parity above) call. P3A removed one genuine
duplicate — the dead `foreignMaterialAgent` bare-keyword helper in
`src/server/fda/parse.ts` and its private vocabulary, which had no caller,
import, or test — and proved FDA normalized output byte-identical across all
163 recorded announcements after that deletion.

**Now unified (P3B): the FDA `Potential Metal or Chemical Contaminant`
category gate.** This was the last canonical branch running a bare-keyword
scan of its own (`FOREIGN_MATERIAL_WORDS` in `src/server/fda/parse.ts`); it
now calls the shared owner, so no derivation anywhere can name a material the
evidence rule did not accept. The FDA heading is **disjunctive** — it covers a
physical fragment hazard and a chemical/radiological one — and a category
naming two possibilities states neither, so it is never evidence of a
contaminant. The parser change is byte-identical over every recorded FDA and
FSIS announcement; the defect it closed is production-only, and the three
stored records were corrected by the separate, reviewed P3B repair (**applied
and verified 2026-09-04** — see [recall-operations.md](recall-operations.md),
"FDA contaminant category: a historical correction (P3B)"). The two Cs-137
shrimp notices now name **Cesium-137** on Home and Detail instead of a
nameless foreign-material line, the talc notice names **asbestos** and no
longer reads as foreign-material contamination, and no packaging material is
named as a hazard on either surface — confirmed by manual simulator QA.
Affects-Me allergen matching is unchanged (none is an allergen case), and the
feed/cache payload shapes were untouched.

`conciseReasonLine` renders the family as one deterministic sentence:
`Potential <pathogen> contamination.` (approved wording is **Potential**, not
"Possible"; common pathogens display their consumer names — Salmonella,
Listeria, E. coli — and unlisted agents stay verbatim), `Undeclared
<allergen(s)> allergen(s).` naming only source-supported allergens,
`Potential <material> contamination.` for foreign material, and fixed
sentences for the FSIS regulatory families plus the infant-formula nutrition
family. **Documented fallback:** for the source-text families, a short
cleaned verbatim source reason (≤ 60 chars) renders as its own sentence
(safe standalone even when it could not glue onto "because of"); an
organism-less microbial hazard whose wording is too long still earns
`Potential contamination.`; otherwise the line is omitted — a concise reason
is never hallucinated from prose. Home shows only this line, never the What
Happened paragraph.

### What Happened, illness, quantity (Detail)

- **What Happened** stays `buildWhatHappened`, template-built from the shared
  typed reason. The subject of "X recalled Y" is the identity decision's
  consumer brand when reliable, the company otherwise ("[Consumer brand or
  safe company fallback] recalled …"). Every reason family has a fixed
  grammatical clause — the pathogen pattern "… because the products may be
  contaminated with <Pathogen>", the allergen pattern "… because the products
  may contain <allergen>, an allergen that is not declared on the label", the
  unapproved-ingredient pattern "… because it contains <ingredient> that is
  not approved for <use>" (singular/plural agreement from the product
  wording; recorded Kofinas exact). The free-text fallback is grammar-gated:
  a source reason that is not a noun phrase can never glue onto "because of",
  so "because of contains…", "because of product did not…", "because of glass
  prone…" are unproducible (corpus-scanned in
  `src/server/fda/presentation-regressions.test.ts`); a gated reason drops
  the clause — "<Subject> recalled <product>." — rather than rendering broken
  grammar. PHAs keep alert wording — "A public health alert was issued for …
  from <company>" — the from-clause states official provenance, not shelf
  identity.
- **Illness** is one line with four honest states (`illnessLine`): explicit
  zero → `No illnesses reported.`; a reliably counted report → `1 illness
reported.` / `55 illnesses reported.` (a count only when exactly one
  unambiguous illness count is stated — hospitalizations and deaths never
  fold in); reported without a reliable count → `Illnesses have been
reported.`; source silence → the line is omitted entirely. Silence is never
  converted to zero, and a **negated statement** ("No customer illnesses have
  been reported…") that slips past the domain classifier's explicit-zero
  patterns is re-checked at this boundary so it can never render as a
  positive report. Home carries no illness line.
- **Quantity** (`recallQuantitySentence`, FDA only — the FSIS `quantityText`
  field is the amount _recovered_, a different fact, and stays unshown): the
  complete authoritative quantity as `The recall covers <quantity>.`, never
  truncated mid-word and never manufactured from package sizes. A stored span
  carrying a clipped reason tail keeps its full quantity and drops only the
  non-quantity clause. Omitted when What Happened already states the figure.
  Since P3C-1 it is a **sentence of the What Happened narrative**, not a field
  of its own: `detailNarrative` composes reason → quantity, the illness line
  follows, and there is no separate model value for a screen to style. See
  "P3C — affected-product data and presentation correctness", item E.

### Geography

- **Home** (`homeLocationSummary`): one or two state abbreviations, then
  `CA, WA +N`; `Nationwide`; or the honest `Distribution not specified`.
  States come from the canonical tri-state geography, whose derivation
  already applies the exclusions (containment artifacts, firm-address noise)
  before display — nothing is re-added here.
- **Detail** (`whereSoldModel` over the consumer distribution — P2a founder
  decision): the section renders **only the one state representation** — the
  complete full-name state list (never a "13 states." count beside the same
  names), `Nationwide`, a stated metro phrase, or the honest unspecified
  line — with **no trailing period** ("Texas", not "Texas."). The separate
  consumer **AREAS subsection stays retired**. Nothing else renders at this
  stage: named retailers, store addresses, online platforms, and channel
  evidence stay fully preserved in the model (`retailers`, `retailLocations`,
  `onlinePlatforms`, `channels`, plus the consumer-venue subset
  `venueChannels`) for the later collapsed retailer-list milestone, and no
  dead retailer control exists meanwhile. Generic trade/distribution channel
  nouns — wholesalers, distributors, independent retailers, food service —
  are never rendered as if they were stores. Affects-Me relevance and
  personalization semantics are untouched by any of this.

### Affects you

The `Affects you` flag rides every Home card — All feed included — whenever
the one relevance evaluation (`lib/relevance.ts`, unchanged) says
`affectsMe`. Detail shows the generic banner `Warning: This recall affects
you.` exactly when the same verdict holds; match-reason bullets are not added
to the banner. Matching logic itself is unchanged.

### Official source

Home cards carry **no per-card source attribution**. Detail shows the dynamic
official link **exactly once**, prominently under the product heading —
`View the official FDA report` / `View the official FSIS report` / `View the
official FSIS alert` (PHAs) — preserving the official URL. The legacy bottom
Official source block — duplicate link, official-title quote,
source-organization disclaimer, and the bottom "Share this recall" control —
is retired (P2a founder decision). The URL, official title, organization,
and share-message contract stay in the model/libs for later surfaces (share
will eventually be a top-right icon; no nonfunctional icon is added
meanwhile).

### Notice and risk labels

Home and Detail render the **same** consumer risk state from the shared
`riskView` (P2a): rated tiers badge their tier; an unclassified FDA recall
reads `Risk pending` on both surfaces; a PHA's absent class reads
`Not rated` — never Unknown. Public Health Alerts always carry the explicit
`Public Health Alert` label (the chip on Home, the badge-row label on
Detail) — a notice type, never confused with a risk state. Founder decision:
"Risk pending" is sufficient by itself — no explanatory classification copy
renders on Detail (the model's pending `official` block is null so the top
state is never restated below), and the Detail header carries no
`Recall · Active` metadata line: it is exactly the risk badge, the one
material activity date beside it, product name, brand, and the single
official link. A retracted notice keeps its explicit callout.

### Imagery

Home shows the selected hero (`heroImageUrl`, existing authoritative
selection policy — frozen FSIS label policy untouched); Detail shows the
**same** hero once, near the title, and no image repeats lower on the page
(P2a founder decision — the lower Product photos gallery and the
compare-photos block no longer render). Absent imagery renders nothing — no
placeholders, no carousel.

**Image-role allocation (P2c).** One shared pure allocator
(`src/lib/recall-images.ts`, consumed only through `buildDetailModel` →
`DetailModel.images`) owns every display role: the hero (the stored
authoritative selection resolved, never re-ranked), at most one
evidence-matched image per affected-product row (keyed by the stable P2b
row identity), a deduplicated deterministic gallery reserved for the future
top carousel, and retained non-visible supporting close-ups. The same
underlying asset never holds two visible roles — never two rows, never a
gallery repeat — except the one evidence-proven hero-to-row reuse in a
multi-version table (docs/recall-imagery.md §13), and no image is
assigned to a row by array position, guessed between sibling versions, or
sourced unofficially. Rows without a confident official match render no
image and no placeholder. Screens render the allocation's verdicts only
(wiring-test-pinned). The authoritative matching contract — evidence
classes, the caption contradiction veto, ambiguity rules, and the pinned
corpus census — is docs/recall-imagery.md §13.

### Affected products

`affectedProductsModel` consumes **only** the gated Consumer Projection V2
package checker (closed schema, type gates — never raw fact bags, never
`rejected` facts, so internal artifacts like the "40 lb" lot candidate are
structurally unreachable). Fields the closed schema does not support (e.g.
establishment numbers) cannot appear until the schema itself admits them.
Identifier fidelity is preserved exactly (leading zeroes, periods, hyphens,
letters). **The consumer table has no shared-facts section. Facts proven to
apply to every version repeat in every row; ambiguous case-level facts do
not render in the table** (founder decision — repetition is preferable to a
separate shared block; the model still distinguishes proven-shared from
version-specific evidence internally, and the table materializes the proven
set into each row's cells). Large code sets stay behind their disclosure;
production dates lead their codes.

**The compact table (P2b).** Detail renders the versions through one shared
pure table model (`affectedProductsTable` over the item model — the screen
composes no columns, labels, or cell values of its own; wiring-test-pinned):

- Column labels render **once** as the uppermost row. Product is the first
  column when any row has a product name; the others follow the stable field
  order — Package Size, Packaging, Best by / Use by / Sell by / Expiration
  (each keeping its exact source-specific meaning; a Sell by is never
  relabeled), Barcode (UPC), Lot codes, Batch codes.
- One affected version per row, in source order. **Columns are computed
  from the rows currently rendered** (integration correction, 2026-09-02):
  the model supplies a collapsed view (the first three rows, columns
  justified by exactly those rows) and an expanded view (all rows, columns
  recomputed), so a column every currently visible row would leave empty
  never renders — `See all` may reveal a column along with the rows that
  justify it (recorded Taylor Fresh). Where at least one visible row has a
  field, the column exists and the other rows keep honest **empty** cells —
  no dash, no "unknown", and never a value borrowed from another version
  (recorded YoCrunch). Rows show the same value only when the source
  associates it with every version, in which case it repeats inside each
  row — never in a separate visible block.
- At most **three rows** render initially; beyond that a functional
  `See all (N)` control reveals the rest inline and collapses again
  (`AFFECTED_PRODUCTS_INITIAL_ROWS`).
- The table scrolls horizontally as one unit, header and rows aligned.
- Each row carries a **stable row identity** (the projection's source-row
  scope). P2c keys version-specific image assignment to it: a row whose
  identity the shared allocator confidently matched to an official image
  renders that image left of its Product value; every other row renders no
  image and no placeholder, and the hero never repeats inside the table.
- **A version's codes live inside its own table row** (integration
  correction, 2026-09-02 — the below-table row-code disclosure area is
  retired; the table is the only affected-product presentation). A small
  set renders inline in the row's Lot/Batch codes cell; a large collapsed
  set renders as that row's own in-cell `View N codes` control, which opens
  a plain accessible modal (no dependency, no navigation route) titled by
  the row's product identity, showing exactly that row's codes and its
  source-supported code/date pairs, with an explicit Close — never a
  sibling's codes, never a recall-wide pile, and never a long list expanded
  beneath the table. Case-level production-code and case-code disclosures
  (codes no single version owns) are unchanged.
- The official attachment links ("Product labels (PDF)", "Product list
  (PDF)") stay preserved in the model (`attachments`) for a later
  source/image surface; **no orphan attachment link renders** under Affected
  Products.

**Composite packaging cells.** A table row whose only recognized column is
packaging can still state the version's identity inside the cell itself —
the recorded Chocolatey Eyeballs table (Style # / "Packaging (as labeled)")
writes "“Crystal Temptations” plastic bag with designed header card –
Chocolatey Eyeballs, 10 oz." per row. `decomposePackagingIdentityFacts`
splits that shape into the facts it states — the version's name, its size,
its packaging, the printed brand — **per row**, so each version keeps only
its own packaging and size; the association is the source's row plus the
cell's own dash delimiter, never array position. Every part is gated (the
head must contain a container noun from the closed packaging vocabulary; the
name must pass the closed identity contract and be neither packaging- nor
measurement-only; a size tail is required), a row that already names its
product is left untouched, and a cell failing any gate stays a plain
packaging fact. Without this, five per-row packaging descriptions flattened
into one unreadable case-level Packaging enumeration
(fixture-pinned in `src/server/fda/presentation-regressions.test.ts`).

**Demoted version names.** A version name that is **only a package
measurement** ("62.4-oz", "5 lb") is package-size evidence, and one that is
**only a packaging description** ("Cardboard boxes", "Plastic bags" — P2b) is
packaging evidence; neither is ever a consumer product name. The list parser
first recovers the source's own pairing where it exists ("62.4-oz. ALUMINUM
PAN … containing "Ukrop's Baked Spaghetti"" names the quoted product with the
size as its Size field, and — P2b — "Cardboard boxes containing 100 pieces of
"BUFFALO CHICKEN RANGOON"" names the quoted product with the container as
Packaging and the stated piece count as Package Size, recorded FSIS
018-2026). Any residual measurement-only or packaging-only name is demoted by
the presentation model into the row's Size or Packaging field — the row keeps
its own identifying facts and renders with an empty Product cell, and no
product name is ever invented. Both recognizers (`measurementOnlyName`,
`packagingOnlyName` — `src/lib/variant-identity.ts`) are conservative and
whole-candidate: numeric brands, UPCs, lot codes with decimal-like
punctuation, dates, full product names ending in a size, and product names
containing packaging words ("Boxed Water", "Cup Noodles", "7-Eleven Wrap")
can never match. The closed identity gate (`variantIdentityRejection`) also
rejects label-metadata statements outright (P2c correction, 2026-09-02): a
country-of-origin statement ("Product of Korea") and a net-weight statement
("Net weight 7.05 oz/200g") are never affected versions — recorded Sun Hong,
where a package-description comma list flattened into prose variants. The
rejections are whole-candidate and anchored, so genuine names containing
these words ("Korean Rice Cakes", "Weight Watchers…", "Net Cost…") are
untouched, and a free-floating measurement statement becomes Package Size
only through a path that proves which row it belongs to — never by guessed
association. Corpus scans (`src/server/fda/presentation-regressions.test.ts`,
`src/server/fsis/presentation-regressions.test.ts`) pin that no measurement,
packaging value, origin/net-weight statement, or other non-identity renders
as Product anywhere in the recorded corpus.

Coverage is graded in the model (P2a): `structured` (identifying details
survived), `partial` (only packaging/size evidence — the model's scope
wording is conservative and a surviving packaging blob can never claim
complete coverage), `source_silent`, and `unstructured` (a parser miss is
**never** presented as source silence). Founder decision: none of this
produces consumer-facing prose on the Detail page — the visible section is
just `Affected Products` with the gated data (shared fields, the version
rail, production dates, code disclosures, official attachment links). The
coverage state and scope statements remain internal to the model for
correctness and QA; the "Find the Code" block, compare-photos block, and all
helper/disclaimer copy are removed from the render while their data stays in
the model. No empty cards, no dead controls.

### Optional-section visibility (P3A) — model-owned

**Implemented.** A consumer-facing section never renders a heading, a
container, a divider, or its surrounding spacing above nothing. The decision
belongs to the shared presentation contract and nowhere else:
`buildDetailModel` returns `sections`, and each optional section is either a
model with meaningful content or `null`. The Detail screen renders that
decision and re-evaluates no rows, columns, codes, or geography — pinned by
`src/lib/recall-presentation-wiring.test.ts`.

**What counts as meaningful content** (`affectedProductsSection`):

- an affected-product row carrying a consumer-facing value — a supported
  product name, or any populated approved field;
- a row's own collapsed code set (its in-cell "View N codes" control);
- an accepted case-level disclosure that still renders: recall-level lot or
  batch codes, production codes, or the production dates they stand for.

**What is explicitly NOT meaningful:**

- an empty row object, or a row whose every value is null, empty, rejected,
  or whitespace;
- internal ids and stable row keys;
- rejected package-check facts (structurally unreachable from this model);
- an empty column set;
- an image allocated to a row that carries no meaningful value — an image is
  decoration for a product row, never a reason to open a section;
- the coverage/helper/disclaimer prose the P2a founder decision removed
  (`model.note`): an explanation of why there is nothing to show is not
  something to show.

A minimal row is preserved on purpose: **a supported product name alone is
meaningful.** A real affected product is never hidden because the notice
states no size, barcode, date, or code for it.

`Where it was sold` follows the same rule (`whereSoldSection`): it renders
its one representation — the full state list, "Nationwide", a stated metro
phrase, or the honest unspecified statement — or it is absent. The complete
retailer/address/channel evidence stays on `DetailModel.whereSold` for the
later retailer-list milestone; only the render decision moved.

`What happened` is not optional: `buildWhatHappened` always produces text
(the cleaned official headline is its last resort), so it can never be an
empty heading. No fallback copy is ever invented to fill an optional section.

Measured over every recorded FDA and FSIS notice (230 records): the Affected
Products section is visible for 177 both before and after — **zero legitimate
rows lost** — and 53 empty headings disappear, each proven to have carried no
rows, no codes and no dates. Nine notices lose an empty `Where it was sold`
heading. Corpus-scanned in both presentation-regression suites.

### What the Detail page no longer renders (P2a founder decision)

Removed from the render — the underlying extracted data is untouched and
stays in the model/projection for its assigned later surface:

- the `Recall · Active` metadata line and every explanatory risk note;
- the retailer summary, store-address disclosure, online platforms, and all
  channel prose under Where It Was Sold;
- every Affected Products helper/coverage/disclaimer sentence, the
  compare-photos block, and Find the Code;
- the lower Product photos gallery (the hero renders once, near the title);
- What You Should Do and Health Risk (they move to the future
  "I have this product, what should I do?" destination — the CTA is not
  added until that destination exists; no dead controls);
- the bottom Official source block and the bottom Share control (share
  becomes a top-right icon later; no nonfunctional icon meanwhile);
- the official-title quote and agency-provenance copy.

Still deliberately absent: Saved state/Save button, retailer link/modal,
image carousel, new navigation.

### P2c — global image-role allocation (implemented 2026-09-02)

_P2b (the compact affected-versions table) shipped as specified above — the
reference shape is recorded and test-pinned
(`announcement-jaimes-spanish-village-jalapeno-ranch.json`): one table
header and one data row — Product "Jalapeno Ranch Dressing", Barcode (UPC)
199284564923, Lot codes "69, 86, 108, 113, 116, and 121"; no Package Size or
date column, because this version has no supported values for them._

P2c shipped the shared image-role allocation described under Imagery above:
one hero at the top; a product-version image beside that version's product
name only when the allocator confidently matches the image to that exact
version (the Outshine flavor shape, source-established; the Crystal
Temptations shape, caption name+size); no empty placeholder when no
version-specific match exists. The integration correction (2026-09-02)
superseded the absolute no-reuse rule with the narrower one: in a
multi-version table the hero may ALSO render as the thumbnail of exactly
the one row it provably depicts (Outshine Strawberry, Crystal 10 oz, Great
One Mushroom Fish Ball), while a single-row notice stays hero-only
(Jalapeno Ranch renders its package image exactly once) and the hero never
re-enters the gallery. The recorded
regression shapes and the corpus-wide allocation census are pinned in
`src/server/fda/presentation-regressions.test.ts`; the matching contract
lives in docs/recall-imagery.md §13. The interactive carousel and all final
visual styling remain design-system work.

### P3C — affected-product data and presentation correctness (PARTIALLY IMPLEMENTED)

The findings below came from manual simulator review of the AquaStar and
Dynarex notices on 2026-09-04 (the same notices P3B corrected for hazard
category — P3C is about their affected-product data, not their hazard), and
from the source-backed audit that followed. **P3C is not complete.** It splits
in two, and only the first part is built:

| Part      | Items                                                                                                             | Status                        |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **P3C-1** | B (date parsing and formatting), C (barcode correctness), D (identifier-list punctuation), E (quantity paragraph) | **implemented, display-time** |
| **P3C-2** | A (row-owned lot and batch codes — affected-product row ownership)                                                | **deferred, not implemented** |

**P3C-1 is display-time only.** Every one of its four corrections happens in
the shared read path over preserved source data. It requires **no production
repair, no migration, no backfill, no cache-schema bump, no re-projection, and
no notification** — the audit's central question, "is any of this persisted
wrong?", answered no for all four. It is implemented and locally verified, and
at the time of writing **not committed and not deployed**, so nothing in
production has changed.

**The pre-fix production counts quoted in this section are historical audit
findings**, measured on 2026-09-04 before the fix, over the read-only audit's
own comparison — they are not post-fix production verification, and no
production read was made after the fix.

#### A. Row-owned lot and batch codes — P3C-2 (DEFERRED, NOT IMPLEMENTED)

**Nothing below is implemented.** P3C-1 deliberately left affected-product row
ownership untouched, and proved it: measured over every recorded FDA and FSIS
notice, P3C-1 changed zero product rows, zero row ids, zero row images, zero
row code sets, and moved no below-table disclosure into a row. The AquaStar and
Dynarex below-table blocks described here are exactly as they were.

Lot, batch, production, and similar identifier facts render inconsistently
across notices:

- AquaStar Cocktail Shrimp renders its lot codes as a **table column**.
- AquaStar Raw Shrimp / Cooked Shrimp / Shrimp Skewers renders its lot codes
  in a **separate expandable block below the table**.
- Dynarex Baby Powder likewise renders its batch codes below its product
  table.

**Founder product rule (the target contract).** A fact that belongs to an
affected product renders **in that product's own table row**. A separate
below-table or "applies to all" disclosure must not be created merely to
avoid repetition. If one code set genuinely applies to several affected
versions, it **repeats in every applicable row**. Codes are never assigned by
array position or any other unsupported inference. This is the same rule the
"Affected products" section states above; the observed below-table blocks are
the inconsistency to resolve.

P3C must **inspect the official source structure before deciding ownership** —
the below-table rendering may be the existing case-level disclosure path
correctly reporting codes the source does not attribute to a single version,
or it may be a parser miss. That determination comes from the source, not from
the shape of the rendered output.

#### B. Date parsing and formatting — P3C-1 (implemented)

Best-by dates are inconsistently normalized, **including within a single
row**. Observed:

- Raw Shrimp / Cooked Shrimp / Shrimp Skewers displays compact values such as
  `03 26 27`, `04 07 27`, and `11 07 2027`.
- Mercado Frozen Cooked Shrimp formats its first entries as
  `November 19, 2027` and `November 20, 2027`, but leaves later entries in the
  same field as `11 19 2027` and `11 20 2027`.

**Target contract.** Every supported date token in a labeled
best-by / use-by / expiration / sell-by field renders in one consumer-readable
format such as `November 19, 2027`. The formatter must handle supported
space-, slash-, and hyphen-delimited numeric dates and both two- and
four-digit years; it must process **every** token in a list rather than only
the leading values; and it must stay bounded to date evidence so that a
product code is never reinterpreted as a date. The existing field-label
meanings are unchanged — a Sell by is still never relabeled.

**Implemented (P3C-1).** The one shared calendar-day owner
(`parseCalendarDay`, `src/lib/identifiers.ts`) gained the space-delimited
month-first form beside the slash, dot and hyphen forms it already read, under
the same two-digit-year policy and the same month/day validation. The token
must be **complete** — three numeric groups, the first two of one or two digits
— so no date is carved out of a longer lot or production code: AquaStar's own
lot code `10662 5085 10` opens with five digits and can never match. A first
component that cannot be a month is refused rather than reordered, so
`13 19 2027` and the day-first `30 10 2026` are preserved exactly as the source
wrote them. Because the parsed value carries the same canonical key as any
other spelling of that day, a notice that prints `Best Before 11/19/2027` in
its prose and `Best Before 11  19  2027` in a photo caption now renders
November 19, 2027 **once**.

One related honesty repair travelled with it. A date cell holding several
values used to keep only the parts that parsed, dropping the rest — so a list
was silently shortened in the one field where completeness is the point. Every
sibling is now kept, each type-checked on its own; an unsupported marking
renders as the source wrote it rather than disappearing.

**Deliberately not added: `Mfg. Dt.` and `Exp. Dt.` label support.** Dynarex's
product table is **day-first** (`01.11.2023`), so reading those columns
month-first would misstate them. They stay unsupported and hidden — deferred
source ambiguity, not a parser gap.

#### C. Barcode correctness — P3C-1 (implemented; the audit question is answered)

The Raw Shrimp / Cooked Shrimp / Shrimp Skewers Barcode (UPC) column includes
values such as `10222027`, `11072027`, `11082027`, `11132027`, and `11152027`.
These **look like compact dates rather than UPCs**, which is a strong and
specific correctness concern — but it is **not yet established that they are
wrong**, and this document does not claim they are. Only the notice's own
archived official source can settle it.

P3C must therefore:

- compare **every** displayed barcode against the notice's own archived
  official source;
- determine whether table alignment or field routing placed best-by dates into
  the barcode field;
- preserve leading zeroes throughout;
- **never** infer or repair a barcode from digit length alone;
- correct the shared parser/projection owner rather than adding a
  notice-specific exception;
- audit equivalent source-table shapes across both the recorded fixture corpus
  and the production corpus, since a routing defect would not be confined to
  one notice.

**Answered: they were wrong, and the cause was neither table alignment nor
field routing.** The archived AquaStar payloads state each product on its own
line — `UPC 20011110643906, lot code 10662 5085 10, Best If Used By: 03 26 27`
— so the source itself labels every value correctly. The defect was in the
prose **barcode-continuation** rule (`src/lib/prose-identifiers.ts`), which
existed so that "with UPC #199284530959 (4oz) and #199284306226 (12oz)" keeps
both barcodes when only the first carries the label. It promoted _every_ digit
run of a UPC-compatible length inside a sentence mentioning UPC — and
`10 22 2027` is eight digits.

**The correction is ownership, not shape.** A run becomes a barcode only when
the label GOVERNING its position is a barcode label; the nearest label to its
left wins, exactly as a reader resolves it. The competing vocabulary is built
from the module's own label list rather than a second keyword table, plus the
printed abbreviations a package carries (`BBD`, `BBE`, `BB`, a bare `EXP`) and
FSIS's "packaging date". A run already published by a label-anchored pass under
a non-barcode label is refused on that evidence alone. Digit length decides
nothing in either direction, which is what keeps two things simultaneously
true: AquaStar's eight-digit best-before dates are gone from the barcode field,
and **Cocktail Shrimp's source-printed ELEVEN-digit UPC `19434612191` is
preserved verbatim** — no leading zero is invented to make it a valid length,
and it is not dropped for failing to be one. Leading zeroes survive throughout
(`011110626196`).

Nothing is lost: each rejected value is still extracted, under the date label
that owns it, and still renders in its Best by cell.

**The values, from the pre-fix production audit (historical).** Six notices
carried a date- or lot-labelled value in the barcode field: the AquaStar
combined notice (`10222027`, `10232027`, `11072027`, `11082027`, `11132027`,
`11152027`), AquaStar Skewers (`11072027`, `11082027`), D. Coluccio
(`15012025`, `29052025`, under `BBD`), Stonewall Kitchen (`03102025`, under
Best By), Water Lilies — FSIS (`07122017`, `07122016`, under best-by /
packaging date), and Hearty Acquisitions (`03222024`, under `lot #`). The
recorded fixture corpus contains **no** case of this shape, which is why the
bounded regression fixtures exist
(`src/server/{fda,fsis}/fixtures/identifier-ownership-notices.json`). Those
fixtures distinguish two grades of evidence on purpose: bounded verbatim
excerpts from archived source snapshots, which drive the extractor end to end,
and an **audit ledger** for the four notices whose payload was never archived —
recording the exact values and the governing label, with the source wording
deliberately absent rather than reconstructed.

#### D. Identifier-list punctuation — P3C-1 (implemented)

Machine identifier lists should not carry a natural-language final
conjunction. Desired display:

```text
43240304, 230420340240, 324020340
```

Not:

```text
43240304, 230420340240, and 324020340
```

This contract applies consistently to structured barcode, UPC, lot-code,
batch-code, production-code, and case-code lists. It is **not** a global
removal of the word "and": natural-language conjunctions are preserved in
prose and in geography, where they are correct.

P3C must first establish whether the conjunction is **stored data** or
**presentation-time list joining**, and fix the shared owner accordingly.

**Established: presentation-time joining.** No stored value carries a
conjunction; `joinFactValues` (`src/lib/consumer-projection.ts`) added one when
composing a field's display text. It is now **field-aware by construction** —
the decision is made from the CONCEPT, which is what determines the approved
field, so no caller can get it wrong. Barcode/UPC, lot codes, batch codes,
production codes, case codes, item numbers and every structured date (best by,
use by, sell by, expiration, production date) separate with commas only. The
two approved fields that hold ordinary phrases, **Size and Packaging**, keep
their grammar, and `joinValues` — the prose joiner used by geography, allergen
lists and summaries — is untouched. Values themselves are never mutated:
leading zeroes and the spacing inside a printed code survive exactly.

A two-value list is included — `10662 5139, 10662 5140`, not `10662 5139 and
10662 5140` — so a short list and a long one read alike.

**The same-month date collapse is removed** (founder decision, P3C-1 final).
Five production dates that once read `July 11, 15, 16, 18, and 22, 2026` now
read `July 11, 2026, July 15, 2026, July 16, 2026, July 18, 2026, July 22,
2026`, and two same-month best-by days read `November 19, 2027, November 20,
2027`. Every successfully parsed calendar date keeps its own month, day and
year, because a shopper checks one printed marking at a time and compares it
character by character; a shared month with a bare day is a sentence about the
set, not a value to match against a package. It applies to Best by, Use by,
Sell by, Expiration and the structured production-date list — the whole
structured-date family, decided in the one owner (`joinFactValues`).

Nothing else in the date model moved: a **range** is one value and is never
split into its endpoints (`July 20–August 17, 2026`), an unsupported marking is
still preserved verbatim beside the parsed dates, announced/updated dates and
prose are untouched, and no value is altered — only how whole dates are joined.

Measured over every recorded FDA and FSIS notice: **608 structured cells lost a
final conjunction** and **23 date cells across 13 notices lost the collapse** —
the individual values in every one of them are byte-identical before and
after, and no non-date field changed.

#### E. Recall quantity paragraph consistency — P3C-1 (implemented)

A source-supported quantity sentence belongs in the normal What Happened
paragraph, not in a muted disclaimer-like line beneath it. Observed
inconsistency:

- Raw Shrimp / Cooked Shrimp / Shrimp Skewers renders "The recall covers
  49,920 bags." as **gray secondary text**.
- Cocktail Shrimp and Mercado Frozen Cooked Shrimp integrate their quantity
  sentences into the normal What Happened paragraph.

**Target contract.** Source-supported recall quantity reads as part of the
normal What Happened narrative, in the same text style as the surrounding
paragraph. Duplication is avoided when the generated reason already states the
quantity (the existing `quantityLine` omission rule above). The quantity is
**preserved**, not dropped — it is useful consumer context. The fix belongs to
the shared presentation/model owner, never to styling an individual notice.

**Implemented (P3C-1), by removing the presentation path rather than
restyling it.** `DetailModel.quantityLine` is gone. The model now assembles the
narrative itself (`detailNarrative`, `src/lib/recall-presentation.ts`): the
reason sentence, then a source-supported quantity sentence the reason did not
already state, as one paragraph — and the illness-status sentence renders after
it, so the order a reader always gets is **reason → quantity → illness**, all
in the same body type. The screen has no quantity slot to style, mute, or
reorder, which `recall-presentation-wiring.test.ts` pins.

The two standing rules are unchanged: the FSIS `quantityText` field is the
amount **recovered** and is still deliberately not consumer-rendered, and a
figure the reason already carries is still suppressed so the paragraph can
never state it twice. Measured over the recorded corpus, all **7** muted lines
became narrative sentences — none dropped, none duplicated.

#### F. Investigation boundary (met for P3C-1; still required for P3C-2)

P3C begins with a source-backed audit. **For P3C-1 this completed**: the audit
traced every product, date, barcode, code and quantity on the AquaStar,
Mercado and Dynarex notices from the archived official payloads through
parsing, projection, presentation model and screen; all four defects proved
**display-only**, so the canonical-data delta is zero and no production repair,
migration, cache bump, re-projection or notification is needed. The boundary
below still governs P3C-2, which has not begun.

The audit steps:

1. Inspect the complete archived official payloads for the three AquaStar
   notices and Dynarex.
2. Trace each product, date, barcode, lot/batch code, and quantity through
   parsing, normalized data, consumer projection, presentation model, and
   screen.
3. Separate **canonical parsing defects** from **display-only formatting
   defects**.
4. Scan the recorded fixtures and the production snapshots for equivalent
   source shapes, so a shared defect is not fixed as a one-notice special
   case.
5. Quantify every proposed canonical-data delta.
6. **Do not assume a production repair is needed.** Decide only after
   determining whether the incorrect values are persisted or derived at
   display time.
7. If persisted data would change, that requires a **separate reviewed dry run
   and its own explicit apply authorization** — see
   [recall-operations.md](recall-operations.md).
8. Preserve row identity and evidence ownership throughout; never use array
   position.

## Control hierarchy (C6.1)

Home renders **two conceptual levels**, not one row of peer chips:

1. **Feed mode** — a segmented `All | Affects me` control. Which feed you are
   looking at. Mutually exclusive.
2. **All-only filters** — a horizontally scrollable `Location · Risk ·
Category · Clear all` row, rendered **only while All is active**. Category is
   last because it is the only dimension whose values are _derived_ rather than
   stated by the agency (C10B).

In Affects me the filter row, its active counts, and Clear all are absent
entirely — they cannot be opened, read, or cleared from there, and the earlier
"Location/Risk filters apply to All recalls — selections kept" sentence is
gone. The selections survive silently in session state and return with All. A
short context row (`Based on your personalization` + `Edit` → the existing
settings screen) replaces the instruction; it holds no preference logic.
Search stays visible in both modes and is never reset by a mode switch.

## Filter model

- **All / Affects me** are mutually exclusive feed modes, unchanged: the same
  default-mode rule (personalized once preferences exist, chosen once per
  session), the same eligibility (`lib/relevance.ts`), the same ranking
  (`lib/affects-me-ranking.ts`).
- **Location / Risk / Category** are browsing filters over the complete All
  Recalls feed (`lib/feed-filters.ts`): multi-select sheets with Apply / Clear
  / Cancel, a count on the chip when active, and a global Clear all chip. OR
  within a dimension, AND across dimensions. They are session-only view state —
  never persisted, never part of the personalization profile, never applied to
  Affects me.
- **Location semantics** (canonical tri-state geography): a selected
  jurisdiction matches notices explicitly distributed there and nationwide
  notices; explicitly-elsewhere and unknown-geography notices do not match.
  Nothing is inferred from headquarters, firm address, or retailer footprint.
  The vocabulary is the same 52 jurisdictions preferences use.
- **Risk semantics**: the seven canonical consumer tiers
  (`domain/risk-tier.ts`), existing labels only, Pending and Not rated as
  their own selectable levels — never renamed or collapsed.
- With no search and no filters, the pipeline returns the same arrays it was
  given, so All Recalls sectioning/ordering is byte-for-byte the pre-C6
  output (test-pinned).

### Location ordering (C6.1)

With one or more jurisdictions selected, results are ordered **within the
existing sections** (`orderByLocationTiers`), four levels deep:

1. **Location tier** — Tier 1: the notice's own state list names a selected
   jurisdiction. Tier 2: canonically nationwide. Every explicit match is one
   tier: "California", "California + Texas", and "California + 40 others"
   weigh the same, because a narrower list is not better evidence that the
   product reached you.
2. **Consumer risk** — the canonical display sequence, imported from the one
   place it is defined (`RISK_PRIORITY`) so All Recalls and Affects me can
   never sequence tiers differently.
3. **Activity date**, newest first, and 4. **case id** — both _inherited_
   rather than restated: the sort is stable and runs over a list
   `buildFeedSections` has already ordered, so each section keeps its own
   canonical date (`lastPublicActivityAt` for Recent activity, `publishedAt`
   for Older active notices) and its id tie-break, with no second copy able
   to drift.

Location specificity outranks risk and recency: an explicit California notice
stays above a nationwide one that is newer or more severe. Ordering never
changes membership — an old notice is never promoted into Recent activity by
matching the selected location. Measured live on the California filter: 351 of
882 cases admitted (139 explicit, 212 nationwide), every explicit match ahead
of every nationwide one in both sections, risk non-decreasing within each tier.

## Search

`lib/feed-search.ts`, pure and index-based (built once per load, ~38 ms for
882 cases; per-keystroke filter+search+section mean ~0.2 ms). Operates on the
selected mode: in All, after the active filters; in Affects me, over the
already-eligible ranked output only (an ineligible notice has no path in).

Fields: title, product description, affected product/variant lines, brands,
recalling firm, retailer names. Product lines ride the feed query as an
embedded `affected_products(name)` select (+~0.4 MB over the full load,
measured) — they carry the printed UPC/lot/batch/case codes and, where FSIS
states them, establishment numbers.

Rules: human text is normalized (case, diacritics, punctuation) and
substring-matched with AND across whitespace tokens; identifier-looking
queries (≥4 digits after stripping label prefixes like "UPC"/"lot"/"EST")
additionally match extracted code candidates with separators removed — exact
substring, **never fuzzy**: one wrong digit does not match. Raw announcement
HTML/prose is not searched; no external service is queried; empty search is a
strict no-op (same array instance).

## Category (C10B): shipped as an optional discovery filter

"Category" (produce/meat/dairy/bakery…) is a canonical projection field,
derived server-side in `projectCase` from the recalled product's own text and
never from the hazard, allergen, firm or retailer. C10B ships it as a filter
chip and backfills every historical case.

### The accuracy, stated plainly

The classifier **missed every research bar it was built against** and is
shipped anyway, under a narrower purpose:

| Phase   | Vocabulary | Natural holdout | Bar | Met? |
| ------- | ---------- | --------------- | --- | ---- |
| C5.3B-2 | 11         | 89.5%           | 95% | no   |
| C10A    | 12         | 91.5%           | 95% | no   |
| C10A.1  | 12         | 86.5%           | 90% | no   |
| C10A.2  | 12         | **87.5%**       | 90% | no   |

Final holdout (200 previously untouched cases, labelled blind, measured once):
**87.5% exact-set · 88.0% at-least-one-correct · 88.0% micro P · 87.1% micro
R**. Three independent fresh draws read 91.5% / 86.5% / 87.5% — the honest
summary is "high 80s", not any single figure.

The number the founder actually decided on is a different one: **1.0% (2/200)**
of the final holdout was placed somewhere no reasonable shopper would look.
The rest of the error is a near-miss between two adjacent aisles, and 20 of the
25 mismatches are a single boundary — Prepared foods vs Meat & poultry.

### Optional discovery is not authoritative availability

The decision rests entirely on what Category is allowed to do:

- it applies **only to All Recalls**, and only when the user selects a chip;
- **every recall stays reachable** with it cleared — the unfiltered feed,
  search, Affects Me, risk and notifications are the authoritative surfaces
  and none of them consults a category;
- a miscategorized card is a **discovery miss with the whole feed behind it**;
  a missed allergen match is a missed alert. The two paths hold deliberately
  different bars and share no input, which `category-invariance.test.ts` and
  `qa:product-categories` enforce structurally rather than by promise.

**No future accuracy claim may be made without new independent evidence** — a
newly drawn, blind-labelled holdout. This corpus has no untouched 200 left, so
that requires corpus growth, not re-scoring a spent split and never rewriting
an old label to improve an old number.

### Launch-visible categories

`domain/food-category-launch.ts` is the one canonical allowlist, separate from
the twelve-id internal vocabulary and derived from it, so the chip order is the
canonical display order by construction. Nine are offered:

| ID                  | Label               |
| ------------------- | ------------------- |
| `produce`           | Fruits & vegetables |
| `meat_poultry`      | Meat & poultry      |
| `seafood`           | Seafood             |
| `dairy_eggs`        | Dairy & eggs        |
| `bakery_grains`     | Bakery              |
| `snacks_sweets`     | Snacks & sweets     |
| `beverages`         | Beverages           |
| `pantry_condiments` | Pantry & staples    |
| `baby_food_formula` | Baby food & formula |

Three stay **valid internally but hidden from the filter**. Hidden is not
deleted: cases keep carrying them, the backfill keeps writing them, QA keeps
reporting them, and every one of those recalls stays in the unfiltered feed.

- `prepared_foods` — the known weakness. 64.8% recall (35/54) against 94.6%
  precision on the final holdout: about a third of genuine prepared-food
  recalls are filed elsewhere, nearly always under Meat & poultry. A chip that
  silently omits a third of its aisle is worse than no chip. High precision is
  why the id is still worth storing.
- `supplements` — the final holdout contains **zero** supplement rows, so there
  is no evidence at all about how the shipped classifier places them, and
  earlier phases recorded a supplement filed under Pantry & staples.
- `other` — an internal fallback, not an aisle. It exists so the derivation can
  be total; totality is a data property, and nobody browses for "Other".

Hiding these does not narrow the feed. It narrows the menu.

### Feed field and filter semantics

`FEED_SELECT` gains `product_categories:projection->productCategories` — the
derived ids only. No announcement text, no classifier input, no confidence, no
fixture; the app receives the answer and never the evidence, and an `expo
export` scan proves the classifier, gold set, holdouts, Node-only QA code and
`@napi-rs/canvas` are absent from both the iOS and web bundles.

Values are normalized by `domain/product-categories-stored.ts` — a leaf module
that imports only the frozen vocabulary, so the feed loader cannot drag the
classifier into the bundle, with a test pinning it equivalent to the
server-side reader. **Missing is not `['other']`**: an absent key, `null`, `[]`
and an all-invalid list all read as "no categories derived", which matches no
active selection and is never shown under a chip.

`FEED_CACHE_SCHEMA_VERSION` is bumped to 2, which is a correctness gate rather
than hygiene. A v1 cache holds rows written by a build whose SELECT never asked
for the column; if that build re-synced after the backfill it re-cached them
under current manifest tokens, and the new build would then find every token
matching, download nothing, and serve an un-enriched corpus that looks
enriched — an empty result under every chip, with no error anywhere.

Semantics (`feed-filters.ts`, tested): OR within the selected categories, AND
with Location and Risk, filtering picks the **set** and the existing comparator
orders it (so state-specific results still lead nationwide ones), and Category
never touches Affects Me membership or ranking. Selections are sanitized
against the launch allowlist at the state boundary, so a hidden, unknown,
duplicate or malformed id cannot enter the filter through any path. With no
category selected, All Recalls is byte-identical to its pre-C10B self.

## Sharing

Recall detail gains a native share sheet. The message is built by
`lib/share-message.ts` (pure, tested) from canonical facts only: product,
company/brand, the "What happened" sentence, the notice's own consumer
instruction (the app's substituted recommendation is deliberately not
quoted), and the official agency URL — always included, never a tracking
link. Nothing personal can enter (the input type has no such fields) and the
copy never claims the recipient is affected. Cancellation or a platform
without a share sheet rejects the promise; both are absorbed.

## Profile

`/profile` (header entry on Home, replacing the direct Alerts link) is
navigation only: Personalization and Notifications rows both open the
existing, unchanged Settings screen (route `/settings` preserved for deep
links), plus an About block (runtime app version via expo-constants). No
preference state, no duplication, no new fields — the serial save queue,
local-first persistence, and server mirror are untouched. Privacy, legal,
methodology, and support rows are deliberately absent until real screens
exist. Restyling or moving Profile later means touching only
`src/app/profile.tsx` and the header entry in `_layout.tsx`.
