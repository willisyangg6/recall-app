# Official imagery: reliability and enrichment foundation (C9)

Audited and implemented 2026-08-29; corrected 2026-08-30; display
image-role allocation (P2c) added 2026-09-02 (§13). This document is
the imagery system's contract: where every image comes from, what counts as
card imagery versus detail evidence, how display roles are allocated, the
URL and fetch security rules, and why no third-party image provider is
integrated.

Two governing principles:

- **An honest branded fallback is better than the wrong product image.**
  Absence is never papered over with a guess.
- **Card imagery is professional imagery.** Commercial packshots — clean,
  centered packaging on white/transparent backgrounds — are appropriate
  card heroes. Documentary images (handheld photos, warehouse/pallet shots,
  sticker close-ups, ordinary regulatory label sheets) are valuable
  _evidence_ on the detail screen but do not automatically become Home card
  heroes. **C9.1** researched defining, classifying, and sourcing
  professional-quality heroes and **deferred** it — see §12.

## 1. Three coverage concepts — never conflated

- **Card hero coverage**: cases whose feed card has `projection.heroImageUrl`.
  Today exclusively official FDA photographs selected under the historical
  behavior. These are _not_ asserted to be professional packshots —
  professional-quality reclassification of existing FDA photos belongs to
  C9.1, and no existing production hero is changed or removed before then.
- **Detail visual coverage**: cases with any evidence imagery at all — a
  hero and/or rendered label pages in `product_visuals`.
- **Professional packshot coverage**: sampled by C9.1 research (§12) and
  **not tracked in production**. No classifier ships, so no case is
  asserted to have a professional hero.

## 2. Architecture

Two official image sources exist, and only two:

- **FDA announcement photographs** — extracted from the announcement's own
  preserved HTML by `src/lib/product-photos.ts` (roles, dedup, page-furniture
  rejection), referenced at their authoritative `www.fda.gov/files/…` URLs,
  never rehosted. `parseFdaAnnouncement` stores the primary photo as
  `normalized.heroImageUrl`; `projectCase` picks the newest record's photo.
  This is the ONLY path that produces a card hero, and it is byte-identical
  to the pre-C9 behavior (proven live: the backfill dry run re-parses every
  FDA record with zero eligible changes).
- **FSIS label-PDF renders** — official label PDFs rasterized server-side
  (`src/server/fsis/labels.ts`) into the public `product-visuals` storage
  bucket and recorded in `product_visuals` (content-addressed, deduplicated,
  ≤ 6 pages per document). The detail screen merges them into the Product
  Photos gallery. **They are never automatically promoted to
  `heroImageUrl`** — the frozen interim policy below.

### Frozen interim policy (unchanged by C9.1)

1. Existing FDA `heroImageUrl` behavior stays byte-identical.
2. FSIS rendered label pages remain in `product_visuals` and the detail
   gallery.
3. An FSIS label page is not automatically a card hero. No pipeline,
   job, or repair path promotes one; `src/server/imagery-guards.test.ts`
   keeps every such path removed, and `qa:imagery` gates on zero
   label-render heroes in production.
4. Documentary FDA photos already selected historically are not changed.
5. No existing production hero is removed.
6. No new hero backfill is planned.
7. No external catalog provider is integrated.
8. No title-based or fuzzy image matching exists anywhere.

### Hero provenance (`src/lib/hero-provenance.ts`)

`classifyHeroUrl` answers the audit question "where did this stored hero
URL come from": an official agency photo (canonical FDA hosts,
byte-stable), our label-render storage bucket (a frozen-policy violation if
ever seen as a hero), or unknown (a contradiction — this system never
writes anything else). Nothing in the module selects or writes imagery.

### Reserved write infrastructure (for C9.1)

`RecallStore.updateCaseHeroImage` is a narrow compare-and-set on
`last_changed_at` that patches the one projection field (the
`updateCaseRetailerNames` pattern): timeline and `lastChangedAt` stay
byte-identical, no NotificationEvent or RecallCase can result, and the C8
manifest still detects the change because the sync token hashes projection
content at read time. `RecallStore.listCaseVisuals` is the matching read
seam. **Neither has a production caller under the frozen policy** — their
semantics are pinned by tests now so C9.1's professional hero sourcing
inherits them proven.

## 3. Baseline audit (live corpus, 2026-08-29)

- 1,914 cases, 897 active. Card heroes: 619 active (all FDA, all
  `www.fda.gov`, all provenance-classifiable; 30/30 live-probe sample
  healthy). Detail visual evidence additionally covers the 3,016 rendered
  label pages across 881 cases (124 of them active).
- FDA extraction is complete: the backfill dry run measures **618/618
  (100%) coverage among FDA cases whose source publishes any photo**; 87
  sources publish none; 0 undetermined, 0 parse failures. Whether those
  photographs are _professional packshots_ is not tracked in production;
  C9.1 sampled it as research only (§12).
- Rendered pages: 0 missing dimensions, 0 under 50k px², 4 extreme-aspect
  (wide print-proof strips). All 32 cross-case duplicate hashes are
  byte-identical label sheets re-uploaded under different filenames for
  related notices — legitimate reuse, not misattribution.
- **Zero hero writes are planned.** The interim expected state is ~619
  active heroes (subject to live corpus movement), FSIS detail imagery
  intact, and no blanket promotion of the 124 active label-render cases.

### The eight historical PDF failures

| Failure class                                 | Count | Root cause                                                                                                          | Disposition                                                                                                                                     |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicated host (`…gov//www.fsis.usda.gov/…`) | 2     | Protocol-relative hrefs (`//www.fsis.usda.gov/…`) in notice HTML were treated as root-relative by the old extractor | Repaired by the canonical resolver; both corrected URLs verified serving `%PDF`                                                                 |
| Over the 15 MB cap                            | 5     | Real scanned label sheets of 21–52 MB                                                                               | Cap raised to 64 MB (`MAX_PDF_BYTES`); all five verified serving `%PDF`; a 21 MB/25-page sample rendered locally in ~2 s to six 1024-wide pages |
| Plain HTTP 404                                | 1     | `Recall 047-2023_food label.pdf` no longer exists at FSIS — their own link is dead                                  | Honest permanent failure; retried on the weekly backoff floor                                                                                   |

Expected recovery: **7 of 8** documents on the next `--full` labels sweep —
as _detail evidence_ in `product_visuals`, not as card heroes.

## 4. URL normalization (`src/lib/official-urls.ts`)

One canonical resolver serves FSIS label extraction and FDA photo
extraction. WHATWG `new URL(href, base)` classification (absolute /
protocol-relative / root-relative / ordinary relative); approved-host
allowlist (exact names, `*.fda.gov` wildcard with dot-anchored matching —
`notfda.gov` and `fda.gov.evil.net` can never pass); http→https upgrade;
bounded duplicated-host repair only when the embedded host equals the URL's
own host; path-slash collapse only on approved hosts; query strings and
percent-encoding preserved; credentials, ports, and non-web schemes
rejected. **Byte-stability is load-bearing**: the label sync matches stored
`source_url` values by equality, so `qa:imagery` gates on zero normalization
drift across every stored hero and rendered-PDF URL (measured: 0 and 0).

## 5. Fetch security (`src/server/safe-fetch.ts`)

Every server-side PDF/image download flows through `safeFetchBinary`:
https-only, exact-host allowlist, every redirect target revalidated (host,
scheme, credentials) with a bounded hop count, size cap enforced while
streaming (and pre-checked against Content-Length), whole-exchange timeout,
Content-Type validation, and magic-byte verification (`%PDF-`, JPEG/PNG/
GIF/WebP) so an HTML error page can never masquerade as a document. Error
text carries origin + path only — never query strings. This is deliberately
not a general-purpose fetcher: localhost, private ranges, link-local, and
literal IPs are unreachable by construction.

## 6. GTIN rules (`src/lib/gtin.ts`)

Matching-grade identifiers are distinct from display values
(`normalizeUpc`). A value is a GTIN only when it is digits (plus printed
separators), of length 8/12/13/14, with a valid GS1 mod-10 check digit.
Canonical key = zero-pad to 14 (the one equivalence GS1 defines); leading
zeros preserved; nothing is ever padded or truncated _into_ a match; 8-digit
codes are structurally ambiguous (GTIN-8 vs zero-suppressed UPC-E) and are
never used for exact matching. Lot codes, date codes, establishment
numbers, and package codes reject on charset/length/check digit.

Measured over active cases (display-layer derivation, `qa:imagery`):
322/897 active cases carry ≥ 1 valid GTIN (1,466 values, 1,423 unique);
99 candidate values were rejected by check digit; 12 were ambiguous
8-digit. This is the identifier foundation C9.1's professional sourcing
would match against — no lookup of any kind exists today.

## 7. Third-party provider research and decision

Full rubric research against primary terms/docs (all accessed 2026-08-29):

| Provider                           | Exact GTIN                        | Images                                                                                            | Image rights                                                                                                                    | Commercial use                           | Verdict                                                     |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| **Open Food Facts**                | Yes (`/api/v2/product/{barcode}`) | ~49% of 960k US products have a curated front photo                                               | User-contributed photos under CC BY-SA 3.0; packaging artwork rights remain third-party (their terms say so explicitly)         | Yes (ODbL/DbCL/CC-BY-SA; Yuka precedent) | **Closest qualifier — deferred** (see below)                |
| USDA FoodData Central              | Via search (`gtinUpc`)            | **None** (no image fields exist)                                                                  | n/a                                                                                                                             | CC0, public domain                       | Data-only; useful for GTIN→brand/name cross-checks          |
| GS1 / Verified by GS1 / Data Hub   | Yes                               | Brand-supplied image _URLs_ only; GS1 hosts nothing                                               | None granted; internal-use-only, third-party display prohibited without written authorization                                   | $500–$6,500 tiers                        | Fails                                                       |
| Barcode Lookup                     | Yes                               | Rehosted, aggregated                                                                              | Terms: images are "Third Party Content… do not grant you any rights" + indemnity + delete-on-termination                        | $99–$949/mo                              | Fails                                                       |
| UPCitemdb                          | Yes                               | Hotlinks to Walmart/Target CDNs                                                                   | None possible — images never transit their servers                                                                              | free/$99/$699                            | Fails                                                       |
| Go-UPC                             | Yes                               | Rehosted                                                                                          | Terms explicitly refuse Third Party Content rights                                                                              | $74.95–$795/mo                           | Fails                                                       |
| EAN-DB                             | Yes                               | 41% coverage                                                                                      | Same explicit Third-Party-Content refusal                                                                                       | €9–€249 prepaid                          | Fails                                                       |
| Chomp                              | Yes                               | `packaging_photos`                                                                                | Claims CC-BY-SA on photos but provenance unstated                                                                               | $25–$299/mo                              | Fails (provenance)                                          |
| 1WorldSync / Syndigo / Nutritionix | Yes                               | Brand-syndicated (the real licensed corpus — and the natural home of true professional packshots) | Contract-scoped; the Syndigo MCA **prohibits populating mobile applications** unless the Services Agreement expressly allows it | Enterprise contact-sales only            | Fails today (no self-serve path; founder contract required) |

Citations (primary sources): OFF terms https://world.openfoodfacts.org/terms-of-use,
data https://world.openfoodfacts.org/data, API https://openfoodfacts.github.io/openfoodfacts-server/api/,
images-on-AWS https://registry.opendata.aws/openfoodfacts-images/;
FDC https://fdc.nal.usda.gov/api-guide/; GS1 ToU
https://www.gs1.org/docs/verified-by-gs1/public-verified-by-gs1-tou.pdf and
https://www.gs1us.org/tools/gs1-us-data-hub/gs1-us-apis; Barcode Lookup
https://www.barcodelookup.com/terms-and-conditions; UPCitemdb
https://www.upcitemdb.com/terms; Go-UPC https://go-upc.com/terms-and-conditions/;
EAN-DB https://ean-db.com/policy/terms; Chomp https://chompthis.com/api/terms.php;
Syndigo MCA https://syndigo.com/legal/syndigo-mca-online-version4/.

**Decision: no provider is integrated.** Open Food Facts, the only serious
candidate, misses on provenance strength (user-contributed photos of
uncontrolled quality and unverifiable package revision — most are
documentary, not packshots) and on attribution (CC BY-SA requires visible
per-image credit — consumer-facing UI work). Under the professional-imagery
objective the bar is higher still: the licensed brand-syndicated corpora
(Syndigo/1WorldSync) are where true packshots live, and reaching them is a
founder-level contract decision. All of this is C9.1 material; the
provenance schema (§8) is already prepared for whichever source clears it.

## 8. Provenance schema (migration `20260906000000_product_visual_provenance.sql` — applied)

Additive columns on `product_visuals`: `provider` (closed set:
`fsis_label_pdf` | `fda_announcement` | `catalog_exact_gtin`; default states
what every existing row is), `resolved_url`, `gtin` (CHECK: structurally a
GTIN), `confidence` (`official_source` | `exact_gtin_match`), `attribution`
(the exact text a source's license requires; NULL for official works). A
catalog row without its GTIN is unrepresentable by CHECK. No RLS, policy,
or grant changes in any direction (pinned by
`src/server/visual-provenance-migration.test.ts`). Production code does not
reference the new columns, so the migration applied with zero coordination.

**Applied to the live project.** Verified 2026-08-30: the columns exist on
`product_visuals`, and `npx supabase db push --dry-run` reports
`{"upToDate":true,…,"message":"Remote database is up to date."}` with no
migrations pending. The columns are currently unwritten — they were
prepared so a professional-imagery source could record where an image came
from and what attribution it owes, and that sourcing is deferred (§12).

## 9. QA operations

`npm run qa:imagery` — read-only gates: **zero label renders promoted to
card hero (the frozen-policy gate)**, zero unknown-provenance heroes,
https-only, zero URL-normalization drift, render quality, duplicate-hash
census, FDA extraction sanity, ledger dispositions, bounded live probes (a
fixed hero sample, never the corpus), and GTIN coverage. Exits non-zero on
any gate.

There is deliberately **no imagery repair command**: the only historical
repair C9 contemplated was blanket hero promotion of label renders, which
the corrected policy forbids. Professional hero repair — if C9.1's
classifier finds work to do — will be built there, on the reserved
compare-and-set infrastructure, with its own dry run.

## 10. Known limitations

- No automatic professional-quality classifier exists. C9.1 measured that a
  bounded one could not reach production-grade precision, and external
  sourcing is deferred (§12).
- One FSIS document (047-2023) is gone at the source; that case keeps its
  PDF link but can have no render until FSIS restores the file.
- When several _distinct_ cases link one identical PDF, the visuals rows
  attach to the first candidate case; the siblings show no render in the
  detail gallery. Bounded follow-up if evidence-coverage pressure warrants.
- 87+ FDA announcements publish no photo; most closed FSIS cases have no
  label PDF. These are honest gaps, not defects.
- FSIS's CDN 403s minimal client fingerprints from some networks; the
  production job's fingerprint is unchanged and continues to work. If the
  ledger ever fills with 403s, revisit fetch headers.

## 11. Manual QA (founder)

Run `npx expo start --go --ios` (never `npm run ios`):

1. Home: FDA cases show their photo thumbnails exactly as before; FSIS
   cases show no thumbnail (frozen policy — unchanged from pre-C9).
2. Open an FSIS case with label renders: the detail gallery still shows
   the rendered label pages.
3. Pull-to-refresh: feed behavior unchanged; no recall re-dating,
   reordering, or notification.
4. Broken/absent images render nothing — never a broken-image placeholder.
5. Web (`npx expo start --web`): same behavior.

## 12. Professional card imagery: research findings and deferral (C9.1)

Researched 2026-08-30. C9 established _where images come from_. C9.1 asked
whether a better class of image — commercial packshots — could be sourced
and identified reliably enough to lead a card. **The answer was no, so
external professional-image sourcing is deferred indefinitely and no
runtime, schema, or review machinery ships.** Card imagery behavior is
exactly as committed in C9.

The numbers below are a **dated research sample from 2026-08-30**, not a
live production guarantee and not a corpus census. Scheduled ingestion
moves the totals; the sampled visual classifications were model judgments
(94.3% inter-rater agreement on the professional/non-professional split
over a 35-image overlap). They are recorded to justify the decision, not to
be quoted as facts about the current corpus.

### What "professional" meant

Deliberate commercial presentation, clear product recognition, controlled
composition — **not** merely "white background". A flat label scan on pure
white is regulatory evidence; a phone photo of a package on white paper is
documentary. Hero-worthy: isolated retail packshots and marketing
composites. Detail-only: documentary photos (pallets, shelves, handheld,
sticker macros, lot-code crops) and regulatory label sheets.

The trap that shaped everything: in the live corpus, a professional jar
packshot and a produce-sticker macro **both** carry "label" in their FDA alt
text and both extract with the `package_label` role. Role and caption do not
separate professional from documentary.

### Findings

- **Existing card heroes are unchanged and continue to come from the
  committed official FDA imagery path** (§2). Nothing in C9.1 altered hero
  selection, ingestion, projection, or label sync.
- **FSIS label renders remain detail evidence and never become card
  heroes** — the frozen policy from C9, pinned by the committed guards in
  `src/server/imagery-guards.test.ts`.
- **Existing heroes are a mix.** In a 124-hero reviewed sample: ~53%
  documentary, ~27% professional packshot, ~18% regulatory label, ~1%
  commercial composite, ~1% logo/generic. Roughly a quarter to a third of
  existing heroes appear genuinely professional.
- **Same-notice alternatives are too sparse to matter.** Only 3 of 124
  sampled hero cases had a clearly professional alternative already
  published in the same official notice while showing a non-professional
  hero. 95 of 136 sampled cases had no professional candidate at all.
  Rebuilding hero selection for a ~2% improvement is not worth the risk to
  a working path.
- **An automatic quality classifier can reject, but cannot select.**
  Deterministic metadata and pixel screens (border uniformity/luminance/
  transparency, subject fill, centering, circle-likeness, saturation,
  aspect, role and caption vocabulary) reliably rule images _out_. The best
  bounded conjunction of nine signals reached only **52.1% precision at 24%
  recall** for identifying professional positives, against a ≥95% precision
  bar. Flat label artwork on white is geometrically indistinguishable from a
  packshot. Professional quality is a semantic judgment, not a pixel one.
- **Open Food Facts exact-GTIN matching is not precise enough.** Over 59
  sampled GTIN cases (59 API requests within OFF's 15 req/min limit): 62.7%
  returned a product, but **27% of hits contradicted the notice** — an
  exact, check-digit-valid GTIN returned Trader Joe's waffles for a
  TreeHouse recall, Aunt Jemima french toast for an FSIS pork alert,
  Tillamook for a Fresh & Ready burrito. Of 21 available front images,
  **1 was a professional packshot**; the rest were user phone photos on
  counters, in hands, in refrigerators. For the 26 sampled cases with no
  imagery at all — the cases that would benefit most — it yielded **zero**
  professional images. Exact GTIN equality is necessary but not sufficient,
  and OFF photos are CC BY-SA, requiring consumer-facing attribution.
- **Manufacturer sites are not a viable automated source.** Across six
  recall subjects: **0 of 6 publish a GTIN** on the product page and **0 of
  6 grant third-party image reuse rights** (3 explicitly prohibit, 3 are
  silent, which is refusal under default copyright; one disallows our
  crawler by name in robots.txt, honored). Without a published GTIN any
  match would be fuzzy title matching. Worse, recalls skew toward
  discontinued SKUs: one recalled product had no page at all, and no page
  carried a lot code or packaging revision.
- **Scalable professional packshots require a licensed provider** — NIQ
  Brandbank, Syndigo, or 1WorldSync. These are the only sources with a real
  professional ceiling, and each needs an enterprise contract.

### Decision

**No paid provider will be pursued now**, and no free source qualifies. The
product launches on existing official imagery plus designed fallbacks where
appropriate, once the design system and food-category taxonomy exist.

This is a deferral, not a dead end. It can be revisited later — with a
licensed catalog, or with a classifier that clears the precision bar — and
**revisiting it changes nothing about current hero behavior**, because
nothing was built against it.

## 13. Display image-role allocation (P2c)

Implemented 2026-09-02. Everything above governs where images come from and
which one is the stored card hero; this section governs how a recall's
official imagery is split into **display roles** on the Detail screen. The
implementation is `src/lib/recall-images.ts` (`allocateRecallImages`), one
pure deterministic layer consumed only by the shared presentation contract
(`buildDetailModel` → `DetailModel.images`). Screens render the allocation's
verdicts and never rank, match, clean, or deduplicate images themselves —
`src/lib/recall-presentation-wiring.test.ts` pins the wiring.

### Roles

- **hero** — zero or one image, rendered exactly once near the Detail title.
  The allocator never selects a hero: it resolves the stored authoritative
  selection (`projection.heroImageUrl`, the frozen policy of §2) into the
  normalized image set. A hero URL not among the currently extracted photos
  (a merged multi-record case) still renders, with `classification: null`.
  No hero anywhere in the recorded corpus changed under P2c (test-pinned).
- **affected-row image** — at most one image per affected-product row, keyed
  by the stable P2b row identity, rendered left of the row's Product value.
  Absence renders nothing: no placeholder, no reserved space.
- **gallery** — the remaining unique suitable official images (recognizable
  announcement photos in source order, then FSIS label renders), preserved
  for the future top carousel. Not rendered yet.
- **supporting** — retained non-visible assets (barcode/date-code close-ups
  and other supplementary images), preserved for the package-comparison
  surface. Never product imagery.

Deduplication precedes role assignment (one normalized image per official
URL; the byte-stability rule of §4 makes URL equality the asset identity).
**An asset cannot occupy multiple visible roles except for one
evidence-proven hero-to-row reuse in a multi-version table** (integration
correction, 2026-09-02): case hero and exact-version table thumbnail are two
different contexts, so the hero may also render as the thumbnail of exactly
the one row it provably depicts — through the same name/size/UPC evidence
gates and contradiction vetoes as any other image, never by array position,
never to fill the first row, and never when the exact row is ambiguous. In
a single-row table the hero stays hero-only (repeating the same image
immediately below adds nothing). Every other pairing stays exclusive: the
hero never enters the gallery or supporting set, no image backs two rows,
and no gallery entry repeats. This retires the audited duplication shape
`hero == primaryPhoto == checkerPhotos[0]` (Sun Hong, Jaime's Jalapeno
Ranch): those model fields still exist internally, but only the allocation
renders.

### Affected-row matching evidence

An image reaches a row only through official evidence connecting it to that
exact version. Closed evidence set:

- `source_row` — the projection's own evidence-gated attachment: the
  source's table deferred its rows to the images ("See Image Below", exact
  count match, caption-derived identity — Outshine), or a caption named the
  version (Prince Bakery). Established in `src/lib/consumer-projection.ts`
  and consumed here. Corrected 2026-09-02: the caption-name attachment is
  identity-keyed (a name-keyed map could not represent same-named sibling
  rows), applies the same contradiction policy as this allocator, and
  refuses a photo that several identical-named siblings could equally own —
  a caption proves a sibling pairing only by discriminating (contradicting
  every sibling it does not depict, as 4Earth Farms' per-row UPC captions
  do). An unproven photo stays an unassigned official image, available to
  the gallery.
- `caption_name` — an official caption contains the row's exact product
  identity, the row's name is unique among rows, the most specific version
  claims first, the shortest matching caption wins, and any tie is treated
  as ambiguity (Great One Trading's brand-prefixed labels).
- `caption_name_size` — the caption contains the row's identity **and**
  states the row's exact package size, for sibling rows that share a name
  and differ by size (Crystal Temptations). Exact size-token equality: a
  "10 oz" row can never claim a "10.5 oz" caption.

Guards that apply to every mechanism:

- **Contradiction veto**: a caption stating a different barcode-length code
  or a package size the row does not state depicts a sibling package, and
  the match is dropped — even a source-established one (observed: 4Earth
  Farms' same-named medleys differing only by UPC; Conagra's 15 oz vs
  24 oz dressings). Caption silence never contradicts. The policy is ONE
  shared pure function (`captionContradictsPackage`,
  `src/lib/variant-identity.ts`), enforced at BOTH layers — the
  projection's photo attachment refuses to store a contradicted
  association, and this allocator independently refuses to render one — so
  the two layers cannot disagree about what a caption rules out.
- The pairing must be unambiguous. Two rows a caption fits equally, or two
  captions a row fits equally, assign nothing (Conagra's two 15 oz rows).
- Only recognizable announcement photos are row-assignable: identifier
  close-ups, supplementary shots, and label renders never decorate a row.
- The hero enters the row pool only in a multi-version table (the
  controlled reuse above); in a single-row table it is excluded up front.
- Caption matching runs only when the model has two or more rows: row
  images exist to tell versions apart; a single row's product is already
  identified by the hero.
- Array position alone is never evidence, anywhere.
- Accessibility text derives only from the row's own supported identity
  (name, plus its size when stated) — never from caption prose.

### Pins and audit

`src/lib/recall-images.test.ts` pins the allocator contract.
`src/server/fda/presentation-regressions.test.ts` pins the recorded shapes
(Jalapeno Ranch, Outshine, Crystal Temptations, Sun Hong, Great One, a
no-image notice) and runs two corpus-wide audits: the visible-allocation
audit (hero unchanged everywhere, role exclusivity everywhere, the complete
row-image census pinned entry-by-entry, each manually reviewed against its
official caption; 53 assignments across 13 corpus cases as re-recorded after the
integration correction, including the evidence-proven hero reuses —
Outshine Strawberry, Great One Mushroom Fish Ball, 4Earth's 711…733 medley,
Conagra Chunky Blue Cheese, Prince Pan de Manjeca, Russ Davis Crazy Fresh,
Enjoy Life Snickerdoodle; Crystal's 10 oz hero reuse is pinned by its own
recorded fixture) and the stored-association
audit (no stored variant photo
contradicts its own caption, and no origin/net-weight pseudo-product row
exists anywhere — the Tony's Chocolonely shape, where one product photo
cannot be pinned to one of four sibling lot rows, stays honestly
unassigned). A changed census entry fails the suite and must be
re-reviewed, not re-pinned blindly.

Nothing in this section touches ingestion, projection, storage, or the
frozen policies above: allocation is display-time, derived, and reversible.
