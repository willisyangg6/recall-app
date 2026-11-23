# Official imagery: reliability and enrichment foundation (C9)

Audited and implemented 2026-08-29; corrected 2026-08-30; display
image-role allocation (P2c) added 2026-09-02 (§13); on-screen presentation
of the allocated roles (P2B7C) added and corrected 2026-09-17 (§14). This document is
the imagery system's contract: where every image comes from, what counts as
card imagery versus detail evidence, how display roles are allocated, how
they are presented, the URL and fetch security rules, and why no third-party
image provider is integrated.

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

Two official image sources exist, and only two (the FSIS one has two forms
since 2026-11-22: page renders and the photographs cropped from them, §16):

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
  ≤ 6 pages per document). Each page carries its own printed **caption**
  (`product_visuals.caption`, read from the PDF's text layer — null for a
  scanned page). An uncaptioned page is retained evidence only and is
  rendered on no screen. A captioned page reaches exactly one place: the
  image of the affected-product row its caption names (§15). It is never a
  card hero and never enters the Detail header.

### Frozen interim policy (item 2 amended 2026-11-16, §15; items 3 and 8 amended 2026-11-22, §16)

1. Existing FDA `heroImageUrl` behavior stays byte-identical.
2. FSIS rendered label pages remain in `product_visuals`. An uncaptioned
   page stays unrendered on every consumer surface (§14); a captioned page
   appears only on the product row its caption names (§15).
3. A whole FSIS label PAGE is never a card hero. No pipeline, job, or
   repair path promotes one; `src/server/imagery-guards.test.ts` keeps every
   such path removed, and `qa:imagery` gates on zero label-render heroes in
   production. A product PHOTOGRAPH cropped from a label document is the
   card image of an FSIS case with no other hero (§16).
4. Documentary FDA photos already selected historically are not changed.
5. No existing production hero is removed.
6. No new hero backfill is planned.
7. No external catalog provider is integrated.
8. No title-based or fuzzy image matching exists anywhere. (§16's
   caption-word rule is exact: every product word of a printed caption must
   be one of the row's own words.)

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
migrations pending. Re-confirmed 2026-09-05 (O2-A read-only audit):
the linked production migration history contains
`20260906000000_product_visual_provenance.sql` matching the local file, and
the `provider`/`confidence` columns answered a read-only SELECT. The
columns are currently unwritten — they were prepared so a professional-imagery source could record where an image came
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
  attach to the first candidate case; the siblings show no label evidence on
  Detail. Bounded follow-up if evidence-coverage pressure warrants.
- 87+ FDA announcements publish no photo; most closed FSIS cases have no
  label PDF. These are honest gaps, not defects.
- FSIS's CDN 403s minimal client fingerprints from some networks; the
  production job's fingerprint is unchanged and continues to work. If the
  ledger ever fills with 403s, revisit fetch headers.

## 11. Manual QA (founder)

Run `npx expo start --go --ios` (never `npm run ios`):

1. Home: FDA cases show their photo thumbnails exactly as before; FSIS
   cases show no thumbnail (frozen policy — unchanged from pre-C9). Feed
   imagery is one tile per card and stays that way (§14).
2. Open an FSIS case with label renders: no gallery above the Affected
   Products table, no standalone section, nothing in the header. A label
   page appears inside a product row only when its printed caption names
   that row (§15 — PHA-11062026-01: Bami Rolls → page 3, Saté Kroketten →
   page 2, Bitterballen → page 1; PHA-11142026: its one row).

   _History._ Before P2B7C this step read "the detail gallery still shows the
   rendered label pages", which had been untrue since P2a — the allocated
   gallery was computed and nothing rendered it. P2B7C briefly rendered one,
   and the founder rejected it; unrendered is now the decided contract, not
   an oversight (§14).

3. Open an FDA case publishing several photos: the header tile pages by hand
   through ALL of them, with one position dot per image up to five, a sliding
   five-dot window beyond that, and the compact `current / total` counter
   beside the dots (§14, P2B7I) — no automatic movement, and no explanatory
   sentence anywhere.
4. Pull-to-refresh: feed behavior unchanged; no recall re-dating,
   reordering, or notification.
5. Broken/absent images render nothing — never a broken-image placeholder
   and never a grey square (P2B7I): a Feed or Saved card without a usable
   image has no media column, and in a paged set a failed image leaves the
   set while the rest still pages.
6. Web (`npx expo start --web`): same behavior.

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

- **hero** — zero or one image, rendered exactly once near the Detail title
  (from P2B7C, as the first page of the header's product set — §14).
  The allocator never selects a hero: it resolves the stored authoritative
  selection (`projection.heroImageUrl`, the frozen policy of §2) into the
  normalized image set. A hero URL not among the currently extracted photos
  (a merged multi-record case) still renders, with `classification: null`.
  No hero anywhere in the recorded corpus changed under P2c (test-pinned).
- **affected-row image** — at most one image per affected-product row, keyed
  by the stable P2b row identity, rendered left of the row's Product value.
  Absence renders nothing: no placeholder, no reserved space.
- **gallery** — the remaining unique suitable official images (recognizable
  announcement photos in source order, then FSIS label renders). Its FDA
  photographs follow the hero into the Detail header (§14); its label renders
  are retained and rendered nowhere.
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
  "10 oz" row can never claim a "10.5 oz" caption, and a "15 lb" row never a
  "1.5 lb" one — the size key keeps its decimal point. Equivalent spellings of
  one unit ("lbs", "pound", "lb"; "grams", "g") compare equal; units are never
  converted into one another.
  Only a row stating exactly ONE size can win this way (Correctness A,
  2026-10-07): its structured Package Size holds one value, and that value
  names one quantity per unit, decimal point kept ("10.5 oz and 105 oz" is
  two sizes). A "10 oz and 48 oz" row stating two sizes never wins a
  size-matched photo, however its sizes are punctuated — and neither does
  the projection's name-only attachment by elimination: for a row stating
  several sizes, only a caption's barcode can rule a same-named sibling out,
  never its size. Explicit source pairing (a table deferring to its photos,
  one per row) is unaffected.

Guards that apply to every mechanism:

- **Contradiction veto**: a caption stating a different barcode-length code
  or a package size the row does not state depicts a sibling package, and
  the match is dropped — even a source-established one (observed: 4Earth
  Farms' same-named medleys differing only by UPC; Conagra's 15 oz vs
  24 oz dressings). Caption silence never contradicts. The veto reads EVERY
  size a row states, so a multi-size row still rules out a caption naming a
  size outside its list, in every allocator pass, the name-only passes
  included. The policy is ONE
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

## 14. On-screen presentation of the allocated roles (P2B7C, P2B7I)

Implemented 2026-09-17; **corrected the same day** after founder inspection
(see "What the correction changed" below); the no-image card shape, the
coexisting indicators and the failure memory settled 2026-09-18 (P2B7I, "The
indicator, and why there is still no cap" and "Cards without imagery"
below). §13 decides which official images hold which role; this
section decides **where those images appear and how many of them**. It is
presentation only: no schema, ingestion, projection, storage, API, or
allocation behaviour changed, and no image is collected, ranked,
deduplicated, or described by any screen.

The contract lives in `src/lib/recall-presentation.ts` (`DetailImageSet`,
`detailImageSet`, `productImagery`, `IMAGE_DOTS_WINDOW`, `imagePageView`,
`imageDotWindow`, `imagePositionLabel`, `imageCounterText`,
`imageUnavailableLabel`) and is rendered by one component, `src/components/ui/official-image-set.tsx`, over
the shared tile `src/components/ui/media-tile.tsx` and the session failure
memory `src/lib/image-failures.ts`. The visual composition is recorded in
[../DESIGN.md](../DESIGN.md) ("Recall Card", "Recall Detail", conflict 30).

**A tile can never keep another recall's photo (2026-10-05).** React Native
(0.86, iOS) recycles image views, and a reused view accepts whatever answer
reaches it: an answer still in flight for the view's previous image can
replace the right one, with no error and no reload. It was seen on Ready's
illustrated board in a release build. The media tile therefore draws through
`src/components/ui/guarded-image.tsx`. No image event says which request it
answers (the `onLoad` payload's `uri` is the view's current source; `onError`
carries none), so the guard counts instead (`src/lib/image-answer-ledger.ts`):
a drawing gets one `onLoadStart` per request and one answer per start, the
first answer possibly just before its start; an answer, load or error, beyond
that is not passed on, and the image is drawn again as a new view, at most
three times per source. A source change starts a new drawing. A stale answer
that lands before the view's own answer is indistinguishable and passed on,
and is then corrected by the own answer's redraw — except a stale error,
which hides the photo for the session: it fails safe, never showing another
recall's photo. Nothing else about the tile changes; the design icons draw
through the same guard.

### Where official imagery appears — the complete list

| Surface                         | What renders                                                                |
| ------------------------------- | --------------------------------------------------------------------------- |
| Feed / Saved card               | the stored hero, one image (an FSIS label photograph since 2026-11-22, §16) |
| Detail header                   | the FDA product-photo set, hero first, then FSIS label photographs (§16)    |
| Affected Products, inside a row | the image the allocator matched to that exact row (§13; label photos §16)   |
| anywhere else                   | **nothing**                                                                 |

Since 2026-11-16 (§15) a label page whose printed caption names a product
row is that row's image. **Every other FSIS label render is rendered
nowhere** — the paragraph below still describes them. They stay in `product_visuals`,
they stay in the allocation's gallery, and the evidence pipeline keeps them —
but no screen shows them. The header takes the `fda_announcement` partition
only (by SOURCE, not by position, so even a stored hero pointing at a label
render could not lead it), and Affected Products shows only row-matched
images.

### What the correction changed

P2B7C first shipped a general gallery of a notice's label pages — above the
Affected Products table, and as a standalone `Official product labels`
section for a notice without that table. **The founder rejected both.** An
image that cannot be tied to a specific affected-product row is not evidence
about any row on screen, and a section must never be fabricated to hold
imagery. Both placements, the model fields behind them
(`AffectedProductsSection.labelPages`, `DetailSections.officialLabels`) and
their preview scenarios are removed. What survives is the Outshine shape: a
per-row thumbnail, matched through §13's evidence gates.

The same correction retired the six-image presentation cap and the sentence
that disclosed it (`Showing 6 of N official images.`). Both stay retired.
P2B7I briefly reintroduced a six-page bound and the founder rejected it: see
the next heading.

### The indicator, and why there is still no cap

**Every usable official photo is navigable.** A cap would make any count the
screen showed a lie about what a shopper can reach, so the set carries
everything the allocation produced and the pager virtualizes instead
(`FlatList`, one page mounted and fetched at a time). A 74-photo notice
pages from `1 / 74` to `74 / 74`. `imagePageView(set, failed)` removes what
failed and nothing else; there is no `.slice`, no maximum page count, and no
promotion logic to fill one.

What **is** bounded is the indicator. Two marks say two different things,
and above the threshold they **coexist** (`ImagePageView.indicator`):

| Usable images | Pages | Indicator                                                              |
| ------------- | ----- | ---------------------------------------------------------------------- |
| 0             | —     | nothing at all (the no-image header; the set is `null`)                |
| 1             | 1     | `none` — the static tile, nothing to swipe                             |
| 2             | 2     | `dots` — one position dot per image                                    |
| 3–5           | 3–5   | `dots-and-counter` — one dot per image, and `2 / 3` beside them        |
| 6 or more     | all   | `dots-and-counter` — a five-dot sliding window, and `2 / 74` beside it |

(Recall Detail kit, 2026-10-07: the counter starts at three usable images,
`IMAGE_COUNTER_MIN`; the header photo is a contained 112×144.)

- The **dots** communicate swipe position within the rendered carousel: a
  window of at most `IMAGE_DOTS_WINDOW` (5) marks, computed by
  `imageDotWindow(current, pageCount)` — the first pages at the beginning,
  centred on the current page through the middle, the final pages at the
  end, always containing the active position. **The number of dots never
  determines the number of accessible images.**
- The **counter** (`imageCounterText`) communicates the current position
  against the total that can be shown — the agency's official total whenever
  nothing has failed. It is added beside the dots, never replaces them, and
  both follow the shopper as they swipe.

There is no prose: no `Showing`, no "official images" sentence, no
truncation sentence.

**Denominator semantics.** With no failures, `current / official total` is
exact and every denominator is reachable. With failures the denominator
becomes the **usable** count (`2 / 72` of 74 published), because a number a
shopper cannot swipe to is the defect this section exists to prevent; the
published total is then stated separately, once, to assistive technology.

**Accessibility.** Each image announces its position as its value
(`imagePositionLabel`): `Image 2 of 74` — no qualifier, because every
counted page is reachable. The dots are decoration and hidden. The counter
is hidden too while nothing has failed (the pages already announce those
numbers, and a second element would duplicate them); when something has
failed it becomes the one spoken element, labelled
`imageUnavailableLabel` — `72 of 74 official images can be shown; the rest
could not be loaded` — so the slash is never read aloud and a failed image
is never implied to be viewable.

**Performance.** The uncapped pager is affordable because it is virtualized,
not because it is short: `initialNumToRender={1}`, `maxToRenderPerBatch={2}`,
`windowSize={3}`, `removeClippedSubviews` and a constant-height
`getItemLayout`. Only the visible page and its immediate neighbours are
mounted, and a page's image is requested when its page mounts — so the
87-photo outlier costs what a two-photo notice costs until it is swiped, and
swiping to page 74 has mounted a bounded number of tiles, not 74. This is
the configuration that shipped uncapped in P2B7C and was inspected then; it
is unchanged.

### Usable, not merely candidate

A candidate whose image fails to load **leaves the set** — only that page.
Every healthy image after it stays reachable: an early failure in a 74-photo
notice leaves 73 pages and the last official photo is still swipeable. The
indicator therefore describes pages that actually rendered, not URLs that
were attempted:

- all candidates fail → the header's no-image shape (never a blank tile with
  dots over it);
- one left → the static tile, no indicator;
- two left → two dots and no number; when that is fewer than were
  published, the dots carry the one spoken sentence saying how many of the
  published photos could not be loaded;
- three or more left → the dots (a five-dot window from six) and the counter
  of the survivors, which carries that sentence when something failed.

The visible page is tracked by image identity, so a late failure on an
offscreen page never moves the page the shopper is looking at; when the
visible page is the one that failed, the pager settles once on whatever now
sits at that position (the index is clamped to the surviving pages) with no
animation, no second programmatic scroll, and no retry.

A failure is remembered for the session in `src/lib/image-failures.ts` — a
URL-keyed, in-memory, never-persisted set with no imports. The tile records a
failure the moment the platform reports it, and every later mount of that URL
(a Feed card scrolled back into view, the Saved list, the pager's page for
it) reads the verdict and renders nothing immediately: no second request, no
square that reserves space and then collapses, and the pager is seeded so a
previously failed page is out before its first render. The next cold launch
retries. The stored imagery is untouched by any of this and stays traceable
to its official source.

### Cards without imagery (P2B7I)

The Feed and Saved card (`src/components/recall-card.tsx`, one component)
has **no media column** when the recall has no usable image — no stored
hero, or a hero that failed. The tile itself renders nothing for those states
(`MediaTile` returns `null`; the card holds no media rule and reserves no
width), so the title, brand, category tag and summary take the card's full
width, the three-line title clamp, the risk/date row and the location/save
footer are unchanged, and Feed and Saved cannot drift. A remote image that
is still loading holds its square on the placeholder colour only while the
request is active. Nothing stands in for an absent image: no stock or
generated photo, no mascot, no "image unavailable" illustration, no pressable
placeholder. Detail's no-image header was already text-led and is unchanged;
an affected-product row whose matched thumbnail fails now shows the plain
text cell rather than a grey square.

Through P2B7H the card kept the tile in every state and the tile drew the
bare `background/media-placeholder` square for "no image" and "failed" alike
— the persistent grey rectangle the founder rejected. On 2026-09-18 the live
feed held 896 active cases, 265 of them (30%) without a hero — every one of
those cards showed the rectangle by design.

This closes the reported acceptance defect: an FDA recall (A&P Creations /
biQ-FEL) whose Feed card showed its photo opened to a grey Detail tile with
two dots over it. Traced end to end, the data was correct — Feed and Detail
resolved the byte-identical stored hero, and both official URLs answered
HTTP 200 — so the defect was presentation: failed renders stayed in the pager
and stayed counted. The hero-first rule is now pinned on the model
(`recall-presentation.test.ts`), and the removal-on-failure rule on the
component (`detail-design.test.ts`).

### Founder rules this encodes

1. Zero photos: the existing no-image header, unchanged.
2. One photo: the existing static tile, unchanged.
3. Two or more: the same tile, manually swiped. Never auto-advancing, never
   with arrow controls, never pressable (there is no full-screen
   destination).
4. `contain` everywhere — an unusually tall or wide official image is
   letterboxed, never cropped.
5. The Feed hero is Detail's first page: one authoritative hero identity
   (`projection.heroImageUrl`), never independently selected or transformed.
6. Label renders are stored, allocated, and rendered nowhere.
7. Affected Products shows only row-matched imagery.
8. Feed imagery is unchanged and stays single-image.

### Accessibility

Each image keeps the factual label the model already had — the product name,
never a source caption or anything inferred from the pixels (§13's row-image
rule, applied to the set). Position is announced as the element's value over
the pages that can be reached (`Image 2 of 74`) — every counted page is
reachable, so the count needs no qualifier. The dots are decoration and are
hidden from assistive technology; the counter is silent unless something
failed, in which case it carries the one sentence that keeps the usable and
the published totals apart. The tile is an image element or it is absent —
there is no hidden placeholder.

### Pins

`src/lib/recall-presentation.test.ts` pins the set contract (completeness,
order, wording, the source filter, the hero-first/biQ-FEL regression, that
no label gallery exists in the model, and — P2B7I as corrected — the page
view: the 0/1/2/5/6/7/74 indicator matrix, that `pages` always equals the
usable count, that pages 7 and 74 are reachable, the sliding dot window at
beginning/middle/end, an early failure leaving later images reachable, and
every-failure → nothing). `src/server/fda/presentation-regressions.test.ts` proves the
shapes on recorded official announcements — 0, 1, 2, 6, 7 and 51 official
photos, each fully navigable with a bounded dot window — and audits the whole
recorded corpus for completeness, uniqueness, https URLs, role exclusivity,
and the absence of any label placement.
`src/components/imagery-presentation-design.test.ts` (P2B7I) pins the
no-image card shape, Feed/Saved parity, the failure memory and the absence
of any retry loop, dots-and-counter coexistence, the five-dot window
following beginning/middle/end while bounding no pages, the counter updating
through the final page, decorative dots and the honest spoken wording,
failed-page index correction, and the preserved interaction and imagery
roles.
`src/components/detail-design.test.ts` and
`src/lib/recall-presentation-wiring.test.ts` pin the component and the
screen: one imagery component, the contract's complete set, virtualized, no
cap, no prose, failure removes a page, no auto-advance, no arrows, no press target,
`contain` only, and no screen-side collection or ranking.
`src/components/feed-design.test.ts` pins that Feed imagery stays
single-image and that the card draws no placeholder of its own.
`src/components/ui/design-foundation.test.ts` pins that every declared icon
name resolves to a real, non-empty asset at 1x, 2x and 3x.

## 15. FSIS attachment evidence: captioned label pages (2026-11-16)

**Why.** Two live notices showed the gap. PHA-11142026 named its product
only in two PDFs: a product list and a label document. Lotly showed the
agency headline ("…Containing Biscuits Recalled") and no photo. For
PHA-11062026-01 (Betterballen), the three label pages were already rendered,
but nothing could show them: no rule tied a page to a product. The pages
are also printed in the REVERSE of the notice's own list, so any
position-based pairing would have given each product another product's
label.

**The evidence rule.** A label page belongs to a product only when its own
printed caption (the PDF text layer: "Bami Rolls (Pork)") contains that
product's name and no other product's name. Two pages naming one product
are ambiguous, and neither is used. A page with no text layer has no
caption and is never matched. No OCR or model reads an image. Page order is
never evidence.

- **Rows.** Captioned label renders join the allocator's row pool (§13) and
  go through its existing caption passes and contradiction veto. Those
  passes still run only for tables with two or more rows, with ONE
  exception: in a one-row table with no stored hero, a captioned label page
  may back that row when its caption names it (PHA-11142026). Announcement
  photos never use the exception.
- **Never the card, never the header** (superseded 2026-11-22 for the
  photographs inside the page — §16; a whole page still never is). Checked on 2026-11-16 at the card's
  112 pt tile: a full letter-size label page shrinks the package photo to
  about a third of the tile, so it cannot identify a product. Ingestion
  never writes a label page as `heroImageUrl`, and the header stays
  FDA-only (`productImagery`, unchanged). Card imagery for FSIS would need a
  crop of the photo embedded in the PDF — not built.
- **Doubt is flagged.** A page with no match, an ambiguous page, or a
  product no page names marks the label attachment `needs_review` in
  `fsis_attachments`, with its reasons. It contributes nothing.

Pinned by `src/server/fsis/attachments.test.ts` against the recorded PDFs.
Source behavior and the product-list side are in
[recall-source-contract.md](recall-source-contract.md) §4.3.

## 16. FSIS label photographs: Feed, Details carousel and product rows (2026-11-22)

**Founder decision (2026-11-22).** FSIS product images appear on the Feed, in
the Details carousel, and beside the matching affected product, through
shared rules for every announcement. The §15 finding still holds — a whole
label page is too small on a 112 pt card — so the images are the product
PHOTOGRAPHS placed on the label documents, not the pages.

**Sources** (`discoverLabelPhotoSources`, src/server/fsis/label-photos.ts).
A link is a picture source when its own words say so ("view labels",
"Labels", "Product Labels", "Photos", "Product label photos", "Larger
images", "Pictures"), when its file name does, or when it sits in FSIS's
`food_label_pdf/` folder; an `<img>` in the announcement is one too.
Targets may be PDFs, image files or linked pages (a page's own `<img>`,
furniture skipped). Distribution and store lists never qualify; a product
list in the label folder is read but yields nothing unless it carries
photographs. Only approved FSIS hosts, through the canonical resolver.
Corpus (2026-11-22): 946 announcements, every one the old PDF rule found.

**Photographs** (`extractLabelPhotos`). Each image drawn on a page is
located from the page's own drawing operations, cropped from a
high-resolution render (every encoding pdfjs draws, including JPEG2000 and
JBIG2 scans), and trimmed of paper margins. Dropped, by rule and counted:

- a **panel**: the text inside the image (an OCR layer) reads as
  nutrition-facts or ingredient copy — two distinct panel terms;
- a sliver: under 2% of the page or 140 px on its short side;
- a **duplicate**: the same photograph, exact or re-encoded (64-bit
  difference hash within 6 bits), in any of the case's documents.

A strip or sliver (aspect beyond 2.4:1) is kept as a **detail** image —
carousel only, after the products, never a card or row image.

**Naming.** A photo's caption is the printed text beside it (text outside
every image, nearest to it), else the page title printed above every image,
else null. Text inside an image is evidence for classifying it, never a
caption. Page position is never evidence.

**Card image** (`selectCardPhoto`). The largest product photograph on the
earliest page that has one — the agency's lead label. The label-photo sync
(labels job, every tick) writes it through `updateCaseHeroImage`: a
compare-and-set that changes no timeline, date or alert, only on FSIS cases,
only over an empty hero or its own earlier crop. It re-asserts every run, so
a re-projection that clears it is repaired the same tick. `classifyHeroUrl`
calls it `label_photo`; `qa:imagery` counts it and still gates on zero whole
pages.

**Details carousel.** Hero first, then the FDA gallery, then the label
photographs: products in document order, then details, at most 12
(`MAX_HEADER_LABEL_PHOTOS`; Kayem's sheet holds 40). Unlike announcement
photos, a label photo that backs its row stays in the carousel: the
carousel shows the recall's products, the row shows which one is which.
No photo repeats in the carousel.

**Rows.** When a case has label photos they replace page renders as row
imagery. One photo per printed caption joins the row pool — the largest
product photo of that caption (a can shot from four sides is one product).
It then goes through the §13 passes and their contradiction veto, plus one
pass for label photos only:

- **caption_words** — every product word of the caption (recall numbers,
  "Product Labels", weights, UPC/SKU, "Best by"-style boilerplate and the
  firm's own name set aside) is one of the row's own words, for exactly one
  unclaimed row. Captions with more product words claim first (Ukrop's
  "Chicken Cobbler – Bulk" before "Chicken Cobbler"); a tie assigns nothing.
  A row's words are its name and field values; a ONE-row model also reads
  the notice's own product text, since that row is the only product (Brett
  Anthony's row is titled "Chinese-Style BBQ Pork", and its notice quotes
  the box: "WOW BAO CHEESEBURGER BAO BUNS").
- In a one-row model a label photo may back the row even when it is also
  the hero — the row shows the product beside its facts.

**Verified against production data (2026-11-22, read-only, photos from the
current documents):** Betterballen (each of three rows its own page, in the
reverse of print order); Biscuit & Sausage Gravy after the 2026-11-19
revision (five rows, each its own label, including the two Granna's 400
meals the captions tell apart); Brett Anthony (the Wow Bao box); Grace (plain
and Hot & Spicy cans); Ukrop's (four rows by "Bulk" and size).

**Storage.** `fsis_label_photos` (public read, like `product_visuals`;
shipped builds before this change never read it, so nothing they show
changes except the card image) and the private `fsis_label_photo_sources`
ledger (a document is read once per revision; an empty one is remembered;
failures back off like label renders). Migration `20261122000000`.

Pinned by `src/server/fsis/label-photos.test.ts` (recorded documents),
`label-photo-sync.test.ts`, `src/lib/recall-images.test.ts` and the
amended `src/server/imagery-guards.test.ts`.
