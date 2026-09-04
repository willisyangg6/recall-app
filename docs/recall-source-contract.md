# Recall Source Contract: FDA + USDA FSIS

**Purpose.** This document records what the authoritative US food-recall data sources actually are, what they contain, how fresh they are, and how recalls move through them — precisely enough to design our canonical recall model and ingestion architecture next. It is a research/specification document only; nothing here is implemented.

**Research date.** All sources were fetched live on **2026-08-21**. Every factual claim below was verified against fetched content on that date unless explicitly marked otherwise.

**Evidence labels used throughout:**

- **[VERIFIED]** — seen directly in content fetched from the official source on 2026-08-21.
- **[INFERENCE]** — our reasoning from verified facts; could be wrong.
- **[UNRESOLVED]** — could not be verified; do not build on it without resolving.
- **[RECOMMENDATION]** — our proposed decision for the app.

---

## 1. The two-agency landscape

Food recalls in the US come from two separate federal systems that share **no data infrastructure, no identifiers, and no vocabulary**:

- **FDA** regulates most of the food supply (packaged foods, produce, seafood, dairy, dietary supplements, etc.).
- **USDA FSIS** regulates meat, poultry, and processed egg products.

A consumer app must ingest both. Do not treat them as one system: their classifications are worded differently, their lifecycles are represented differently, and their update semantics are different (detailed below).

**Future non-food note (to avoid a dead end):** CPSC (consumer products) and NHTSA (vehicles) are additional, again completely separate, recall systems reachable via recalls.gov. Nothing in this contract should assume "recall" implies "food"; the canonical model should carry a source-agency dimension from day one. No further CPSC/NHTSA research was done (out of scope).

---

## 2. Conceptual distinctions (official definitions)

These are legally distinct concepts. The app must not silently collapse them.

| Concept                                 | Official meaning                                                                                                                                                                                                                                                                                                                                               | Source                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recall (FDA)**                        | "A firm's removal or correction of a marketed product that the FDA considers to be in violation of the laws it administers and against which the agency would initiate legal action, e.g., seizure. Recall does not include a market withdrawal or a stock recovery." **[VERIFIED]**                                                                           | 21 CFR 7.3(g), via eCFR API (`ecfr.gov`, title 21 part 7, current as of 2026-08-19)                                                                                                                                                                |
| **Market withdrawal (FDA)**             | "Occurs when a product has a minor violation that would not be subject to FDA legal action. The firm removes the product from the market or corrects the violation." **[VERIFIED]**                                                                                                                                                                            | [Recalls Background and Definitions](https://www.fda.gov/safety/industry-guidance-recalls/recalls-background-and-definitions) (content current as of 03/20/2026)                                                                                   |
| **Safety alert (FDA)**                  | "Issued in situations where a medical device may present an unreasonable risk of substantial harm." Primarily a device concept; the consumer page title bundles it with recalls. **[VERIFIED]**                                                                                                                                                                | Same page                                                                                                                                                                                                                                          |
| **Outbreak / investigation (FDA CORE)** | "When two or more people get the same illness from the same contaminated food or drink." Tracked separately from recalls; **illness counts live here, not in recall records**. FDA: "Not all recalls, alerts, and advisories result in an outbreak of foodborne illness." **[VERIFIED]**                                                                       | [Outbreaks of Foodborne Illness](https://www.fda.gov/food/recalls-outbreaks-emergencies/outbreaks-foodborne-illness) + [CORE investigation table](https://www.fda.gov/food/outbreaks-foodborne-illness/investigations-foodborne-illness-outbreaks) |
| **FDA Enforcement Report**              | FDA's weekly regulatory record of **all** recalls it monitors (Class I/II/III or "not yet classified" per 21 CFR 7.50) — not a consumer alerting channel. **[VERIFIED]**                                                                                                                                                                                       | [Enforcement Reports](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports)                                                                                                                                     |
| **Recall (FSIS)**                       | "A voluntary action by a company to remove adulterated or misbranded product from commerce. … All recalls are voluntary," backed by FSIS detention/seizure authority. **[VERIFIED]**                                                                                                                                                                           | [Understanding FSIS Food Recalls](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/understanding-fsis-food-recalls) (last updated 03/13/2026)                                                           |
| **Public Health Alert (FSIS)**          | Issued "instead of or in addition to recommending a recall" — when there is no recall, when product is already out of commerce but may be in homes, when the responsible party or scope can't be identified, when a product contains an ingredient under FDA recall, or **"when firms decline to initiate a recall upon FSIS recommendation."** **[VERIFIED]** | [FSIS Directive 8080.1 Rev. 8](https://www.fsis.usda.gov/sites/default/files/media_file/2020-07/8080.1.pdf), Ch. IV                                                                                                                                |

**Consumer-model implication [RECOMMENDATION]:** Recalls and FSIS Public Health Alerts are both "stop eating this" consumer safety notices and can share one notification pipeline and card UI — but the **type must be preserved and displayed** ("Recall" vs "Public Health Alert"), because a PHA may mean the firm _refused_ to recall, and PHAs have different identifiers, no classification, and can be _retracted_ (observed: `PHA-04012026-01` retracting an earlier PHA). Market withdrawals and outbreak investigations should **not** be modeled as recalls; outbreak data is a future enrichment layer (illness counts, "do not eat" advisories), not an MVP source.

---

## 3. FDA source landscape

Four distinct FDA-side artifacts exist for the same underlying recall activity. They differ in speed, coverage, and structure.

### 3.1 Consumer announcements — "Recalls, Market Withdrawals, & Safety Alerts"

**Page:** <https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts> (fetched 2026-08-21)

- **What it is [VERIFIED]:** Firm-authored press releases that FDA republishes: "When a company announces a recall, market withdrawal, or safety alert, the FDA posts the company's announcement as a public service. FDA does not endorse either the product or the company." Coverage is **partial by design**: "Not all recalls have press releases or are posted on this page" — FDA publicizes recalls "that may potentially present a significant or serious risk."
- **Separation from classification [VERIFIED]:** "The posting of information on this page is separate from FDA's recall classification process." Announcements routinely appear weeks before classification (see §5, §7).
- **Speed [VERIFIED]:** FDA's public-warning guidance ([21 CFR Part 7 Subpart C guidance PDF](https://www.fda.gov/media/110457/download)) says firms "should generally issue a public warning within 24 hours of the FDA notifying the firm" and that FDA "may issue a public warning or notification before formally classifying a recall." The listing was current to the previous day at access time.
- **Retention [VERIFIED]:** Announcements stay on the page "for three years before being archived."
- **Detail-page anatomy [VERIFIED]** (checked on multiple live announcements): summary block with **Company Announcement Date**, **FDA Publish Date**, Product Type, Reason for Announcement, Company Name, Brand Name(s), Product Description; firm press-release body (free prose, sometimes with product tables containing batch codes / best-by dates / UPCs); company contact info; **product photos** (image alt text sometimes encodes UPCs); "Content current as of" footer date.
- **Update patterns [VERIFIED]:** two coexisting mechanisms — (a) the same announcement is retitled with an inconsistent prefix (`Updated –`, `UPDATED:`, `UPDATE -`) and re-published (observed URL slug also changed to `updated-…`, with the old slug 404ing — see §9 unresolved); (b) an **expansion is a brand-new announcement page** and listing row (verified: Albertsons tuna salad, initial 07/21/2025 + expansion 07/28/2025).

**Machine-readable access (all live-verified 2026-08-21):**

| Channel              | URL                                                                                                     | Verified behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing JSON backend | `https://www.fda.gov/datatables-json/recalls-market-withdrawals.json`                                   | 200, no auth. 1,026 items (744 food-tagged), dates 2017-10-19 → **2026-08-20** (fresh to previous day). Fields: `path` (announcement URL = de facto ID), `field_change_date_2` (listing date), `field_brand_name` (HTML), `field_product_description`, `field_recall_reason_description`, `field_recall_reason` (category), `field_company_name`, `field_regulated_product_field`, `changed` (last-edit timestamp in HTML). **Array is NOT sorted by date** — first element observed was from 2018; consumers must sort. Undocumented site internal; may change without notice. |
| XLSX export          | `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/datatables-data?page&_format=xlsx` | 200, no auth, same table (~1,025 rows). `_format=json` on this endpoint is rejected ("Supported formats: xlsx").                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| All-recalls RSS      | `https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml`                     | 200. ~20-item rolling window (~12 days at observed volume), all product types. Items ≤2 days old at access. Item = title, link, truncated description, pubDate (with time of day), guid.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Food-only RSS**    | `https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-safety-recalls/rss.xml`         | 200. Food announcements only, includes retitled "Updated –" items as new entries. Newest item 2 days old at access.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Email subscription   | GovDelivery signup on the listing page                                                                  | Offered; not evaluated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Category under-statement [VERIFIED on recorded fixtures, 2026-09-02]:** the listing's `field_recall_reason` category tokens can name fewer allergens than the announcement's own reason statement — Lee K of NY is categorized "Crustacean Shellfish" while its `field_recall_reason_description` and body say "undeclared milk and shrimp"; Troemner is categorized "Milk" against a stated "undeclared milk, wheat, and soy"; Natural Organics is categorized "Wheat" with the description "Undeclared Gluten". The category is structured but not complete; the reason description/body must be consulted for the full allergen list.

**Reason-category ambiguity [VERIFIED on production snapshots, 2026-09-03]:** some `field_recall_reason` values are **disjunctive** — one taxonomy heading covering more than one kind of hazard. `Potential Metal or Chemical Contaminant` is the governing case: it covers a physical fragment hazard AND a chemical/radiological one, and the heading names two possibilities, so it states neither. The category alone can therefore never establish a contaminant; only the announcement's own wording can, and it must be read as evidence (does the source state a physical contaminant?) rather than scanned for material words. A read-only comparison over all 721 archived FDA production snapshots found three active notices whose only material word described the **package** ("packaged in plastic bottles", "in a clear plastic tray", "in clear plastic bag") while the announcement stated chemical or radiological contamination — plastic packaging had decided the hazard. FDA's taxonomy also has **no radiological category**: a Cesium-137 (Cs-137) contamination arrives under this same chemical heading. See [recall-domain-architecture.md](recall-domain-architecture.md), "Canonical hazard-category precedence", for the evidence rule, and [recall-operations.md](recall-operations.md), "FDA contaminant category: a historical correction (P3B)", for the correction.

**Critical access constraint [VERIFIED]:** `www.fda.gov` returns **404 to non-browser user agents**. All fda.gov polling must send a browser-like User-Agent. (api.fda.gov and open.fda.gov have no such restriction.)

> **Re-verification addendum (2026-08-21, FDA Phase A implementation).** All
> §3.1 discovery channels re-verified live before coding: listing JSON 200 with
> 1,026 items (744 food-tagged), still unsorted, fresh to the previous day;
> food RSS fresh (newest item 2 days old, 20-item window); detail pages
> byte-stable across repeated fetches (content hashing is meaningful). Two
> deltas from the original research: (a) the **non-browser-UA 404 was not
> enforced** at re-verification (curl's default UA got 200) — browser-like
> headers are still sent since the gate has been observed before; (b) URL churn
> on updates has **two coexisting patterns**: a retitled re-publish can
> _replace_ the original listing row (`updated-…` slug, old slug gone —
> Dreyer's Outshine) or _coexist_ with it (`update-…` and `updated-release-…`
> rows alongside the originals — Albertsons bowtie pasta, Southwind shrimp).
> Stripping those prefixes from the slug yields a stable announcement identity
> for every observed case. Also verified: the listing's `changed` timestamp
> (Drupal node edit time) moves on any page edit, making the listing row a
> reliable change-detection key for the detail page; the listing exposes **no
> closure/terminated flag** in its JSON fields.
>
> **(c) Slug-collision suffixes [VERIFIED 2026-08-22]:** a revised
> re-publication whose title slugifies identically gets a Drupal alias
> collision suffix — `…-health-risk` + `…-health-risk-0` (Primavera Nueva
> tamales: the `-0` page is the same recall revised to add a seasonal item;
> Hans Kissle's `-0` body even opens "A previous version of this press release
> was issued on 8/5/2025"). The suffix is only a **candidate** same-event
> signal: the same collision also occurs when a firm recalls the same product
> twice with the identical headline (JFE Franchising cucumbers, Dec 2024 vs
> May 2025 — two distinct events). The pipeline therefore links a `-N` slug to
> its base **only** through an evidence gate (same firm + same hazard +
> ≤180 days + ≥0.6 body overlap); title similarity alone never merges.
>
> **(d) Declared expansions under fresh slugs [VERIFIED 2026-08-24]:** FDA
> also re-publishes one recall as a NEW announcement whose own words declare
> the lineage — "Lidl US **Expands Recall of** Eridanous Shortbread
> Cookies…", "…is expanding its July 24, 2026 recall…" (verified live:
> Eridanous/Lidl, OLA-OLA Pounded Yam/Fayus, Glutinous Rice Balls/Khong
> Guan, Savencia, Sprout Organics, Kalo Foods, Infinite Herbs basil). The
> URL differs entirely, so slug analysis cannot see these. The pipeline
> links a declared expansion by SEARCHING recent records of the same source
> under a stricter gate: expansion wording in the record's own title/body +
> same firm + same hazard + ≤120 days + **product identity** (an overlapping
> UPC, or the expansion title naming the parent's product) + body overlap
> ≥0.45 — and only when exactly ONE existing case qualifies. FDA only; FSIS
> expansions carry the parent's recall number and never need wording. One
> more Drupal quirk feeds this: FDA re-dates a BASE page when it edits it
> (Khong Guan's base was edited one day AFTER its expansion published), so
> a case's consumer voice prefers an expansion-titled record within a
> 30-day window of the newest record.
>
> **(e) Retitled corrections under fresh slugs [VERIFIED 2026-08-25]:** the
> slug is derived from the title, so when a CORRECTION changes the title,
> the announcement moves to a new URL — verified live on Momchipz (Exotique
> Foods): "…Due to Undeclared **Gluten**" (published 08/19) was republished
> as "…Due to Undeclared **Wheat**" (08/24) after the firm corrected the
> allergen identification. Three authoritative signals mark the move: the
> new body OPENS with an FDA editorial note ("On 8/24/2026, the recalling
> firm updated their press release to correctly identify wheat, rather than
> gluten, as the allergen."), the old slug leaves the listing JSON entirely,
> and the old URL 301-redirects to the new one. The same opening-note shape
> appears corpus-wide ("This press release was updated on…", "…is an update
> to the company's press release…", verified on Hartford Bakery, ByHeart,
> Tropicale, H-E-B, and others); the old page, while it still exists,
> carries a trailing "Link to Updated Press Release" navigation link. The
> pipeline links a declared revision through the same one-qualifying-case
> search as (d), under its own gate: revision note in the body opening +
> same firm + same hazard + ≤120 days + an overlapping UPC + body overlap
> ≥0.8 (a revision is a near-copy re-publication; 0.6-level overlap is
> reachable by two distinct events sharing firm boilerplate). FDA only.

**Identifier situation [VERIFIED]:** Announcements carry **no recall number and no event ID**. The only stable-ish key is the announcement URL path. There is no machine-readable link from an announcement to its later enforcement record; even firm names differ across the two ("Albertsons" vs "Albertsons Companies LLC"). iRES (§3.3) holds a "Press Release URL(s)" field internally, but behind an auth-gated API. **Joining announcements to enforcement records must be fuzzy** (firm + product text + dates) **[INFERENCE from verified absence of any shared key]**.

### 3.2 openFDA Food Enforcement endpoint

**Endpoint:** `https://api.fda.gov/food/enforcement.json` · **Docs:** <https://open.fda.gov/apis/food/enforcement/> · **Fields YAML:** <https://open.fda.gov/fields/foodenforcement.yaml> (all fetched 2026-08-21)

- **Source & cadence [VERIFIED]:** "returns data from the FDA Recall Enterprise System (RES) … this data covers publicly releasable records from 2004-present. The data is updated weekly." Observed: `meta.last_updated = 2026-08-12` (9 days stale at access), newest `report_date` also 2026-08-12.
- **FDA's own disclaimer — load-bearing [VERIFIED, verbatim]:** _"This data should not be used as a method to collect data to issue alerts to the public, nor should it be used to track the lifecycle of a recall. … FDA does not update the status of a recall after the recall has been classified according to its level of hazard. As such, the status of a recall (open, completed, or terminated) will remain unchanged after published in the Enforcement Reports."_ — This confirms (from FDA itself) that **openFDA is unsuitable as the sole real-time discovery mechanism**, which we set out to verify rather than assume. It is also internally contradicted by the data (see §9 contradictions): statuses demonstrably do transition to Terminated with fresh termination dates. Treat status as informational, never as a lifecycle truth source.
- **Actual coverage [VERIFIED]:** 29,310 records total; earliest `report_date` in the food endpoint is **2012-06-20** despite the "2004-present" claim (contradiction logged in §9).
- **Update-in-place [VERIFIED]:** openFDA docs: "the FDA will make corrections or changes to recall information previously disclosed in a past Enforcement Report … the firm may discover that the initial recall should be expanded." The Enforcement Report "History" feature tracks changes to Classification, Reason for Recall, Code Information, and Product Description for recalls posted/updated since **2018-07-24**. Records are mutable; weekly snapshots differ.
- **Event grouping [VERIFIED]:** one recall event fans out to **one record per product**, grouped by `event_id` (observed: event 99211 → 18 records; Albertsons event 97306 → 5 records). `recall_number` is per-product (e.g. `H-0473-2025`); `event_id` is the event key.
- **Classification timing [VERIFIED]:** records effectively appear only once classified. Status enum includes "Pending" but **zero** live records have it; classification counts were Class II 14,703 / Class I 12,863 / Class III 1,743 / "Not Yet Classified" **1**. The lone unclassified record had an **empty `recall_number`** and no `center_classification_date`. So: unclassified recalls are _possible_ but vanishingly rare in this feed, and `recall_number` can be empty pre-classification.
- **Key fields (official YAML descriptions) [VERIFIED]:**
  - `recall_number` — FDA tracking number for the (classified) recalled product.
  - `event_id` — FDA number for the recall event (groups products).
  - `status` — `Ongoing` ("On-Going" in the YAML enum; live data says "Ongoing") / `Completed` (firm retrieved what it could) / `Terminated` (FDA closed the recall) / `Pending` (defined but unobserved). Live distribution: Terminated 27,817 / Ongoing 1,058 / Completed 435.
  - `classification` — Class I/II/III (see definitions §2 note below).
  - `recall_initiation_date` — "Date that the firm first began notifying the public or their consignees of the recall."
  - `center_classification_date` — date FDA classified (per iRES definitions; the YAML description is empty).
  - `report_date` — date of the weekly enforcement report containing it.
  - `termination_date` — date FDA terminated (populated on 27,816 records; newest observed 2026-08-14, so this _does_ keep advancing).
  - `product_description`, `reason_for_recall`, `product_quantity` — prose.
  - `code_info` — "lot and/or serial numbers, product numbers, … sell or use by dates" — **prose, not structured**.
  - `distribution_pattern` — prose ("nationwide" = "the fifty states or a significant portion"; consignee re-distribution may be excluded).
  - `recalling_firm`, address fields, `voluntary_mandated`, `initial_firm_notification`.
  - **`openfda` harmonization object (with `upc`, `brand_name`) is empty on every record** — `_exists_:openfda.upc` matches zero records. **There is no structured UPC or brand field in FDA enforcement data.**
- **Access [VERIFIED]:** free API key; with key **240 requests/min, 120,000/day**; keyless "240/min, 1,000/day" limits still published and keyless calls worked, though the auth page now says a key "is required". Bulk download: single ~5.5 MB zip via `https://api.fda.gov/download.json` manifest (export dated 2026-08-19).
- **License [VERIFIED]:** CC0 1.0 Universal public-domain dedication ("copy, modify, distribute … even for commercial purposes, all without asking permission"); attribution requested but not required; no endorsement implication allowed. Per-response disclaimer: "assume all results are unvalidated."

> **Phase B re-verification [VERIFIED 2026-08-25]:** dataset re-checked at
> implementation time: `meta.last_updated` 2026-08-19 (weekly cadence
> holding), 29,317 records. `recall_number` is **globally unique**
> (29,317/29,317) — the stable record identity; `event_id` groups one
> recall event's per-product records (7,837 events; 2,761 multi-record;
> max 409 records). **175 events carry MIXED classifications** (128× I+II,
> 34× II+III, 10× I+II+III, 3× I+III) — per-product risk differences are
> real, so case-level classification aggregation is a policy decision, not
> a passthrough. recall_initiation→report lag: p50 46d, p90 127d, p99 449d
> — enforcement is an ENRICHMENT source, arriving weeks after our
> announcements, exactly as designed. Announcement↔enforcement firm strings
> drift ("Danone U.S." vs "DANONE US LLC"; "Kroger" vs "The Kroger Co";
> "Meijer" vs "Meijer, Inc #816 - Grand River Packaging…"), and UPC digits
> appear only as prose inside product_description/code_info (10,970/29,316
> records carry UPC-like digit runs). Exactly one record lacks a
> recall_number (the lone "Not Yet Classified" one) — quarantined. One
> record carries an impossible initiation date (year 0212) — source typo,
> harmlessly outside every matching window. CRITICAL trap, measured: staple
> products keep their UPC across DISTINCT recalls years apart (Gold Medal
> flour 2016 and 2023, Green Sprouts alfalfa 2016 and 2024 — identical
> UPCs), so firm+UPC alone must never match without a date window.

**FDA classification definitions [VERIFIED]** ([Recalls Background and Definitions](https://www.fda.gov/safety/industry-guidance-recalls/recalls-background-and-definitions)): Class I — "reasonable probability that … use … will cause serious adverse health consequences or death"; Class II — "may cause temporary or medically reversible adverse health consequences or where the probability of serious adverse health consequences is remote"; Class III — "not likely to cause adverse health consequences."

### 3.3 FDA Enforcement Reports / iRES (Recall Enterprise System)

**Pages:** [Enforcement Reports](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports) · [Definitions](https://www.fda.gov/safety/enforcement-reports/enforcement-report-information-and-definitions) · iRES app: `https://www.accessdata.fda.gov/scripts/ires/index.cfm` (fetched 2026-08-21)

- **[VERIFIED]** The weekly Enforcement Report "includes all recalls monitored by FDA to include Class I, II, III, or 'not yet classified'", and since **2017-06-15** lists recalls **pending classification** "to alert the public sooner." "Firms often initiate voluntary recalls and provide public statements … well before the FDA completes its classification process."
- **[VERIFIED]** iRES exposes: weekly reports, search, CSV export, an **email subscription** ("new and updated FDA recalls," filterable by commodity or keyword — e.g. 'dog food', 'peanut' — daily or weekly), and an API requiring `Authorization-User`/`Authorization-Key` headers obtained via FDA's OII Unified Logon; endpoint list is only visible post-auth. iRES records carry "Press Release URL(s)" — the missing announcement↔enforcement link.
- **[VERIFIED]** `accessdata.fda.gov` served curl a 302 to an "abuse detection" apology page on an RSS URL probe; scriptability is doubtful without the authorized API.
- **[INFERENCE]** iRES is the earliest _enforcement-side_ signal (pre-classification listings), but its auth gate and bot detection make it a phase-2 integration, not MVP. Its keyword email subscription is a good manual monitoring/QA channel for the founder in the meantime.

### 3.4 FDA Data Dashboard — rejected

**[VERIFIED]** <https://datadashboard.fda.gov/oii/cd/recalls.htm> states its recall dataset "is updated weekly and only includes recalls that have been classified." Its API documentation (fetched in full) documents only four endpoints — none for recalls; a live probe of `POST /v1/recalls` returned `{"statuscode":404,"message":"Invalid request endpoint."}`; bulk export is JavaScript-only. **[RECOMMENDATION]** Not useful for this app; ignore.

---

## 4. USDA FSIS source landscape

### 4.1 FSIS Recall API

**Docs:** <https://www.fsis.usda.gov/science-data/developer-resources/recall-api> (page last updated Sep 07, 2023) + official PDF "Recall API — Roadmap for Operation and Functionalities" (June 2026): <https://www.fsis.usda.gov/sites/default/files/media_file/documents/Recall-API-documentation.pdf>
**Endpoint:** `https://www.fsis.usda.gov/fsis/api/recall/v/1` — GET only, JSON, **no API key, no auth** (all fetched/tested 2026-08-21)

- **Freshness [VERIFIED observation; no official claim]:** The docs make **no** update-frequency or real-time claim. Observed: the newest recall (017-2026, `field_recall_date` 2026-08-17) was present in the API on 2026-08-21 and matches the site's current alert banner. **[INFERENCE]** The API serves the website's live Drupal content store and is effectively same-day fresh; exact publish→API latency is [UNRESOLVED].
- **Shape [VERIFIED]:** Returns the **entire filtered result set as one JSON array — no pagination, no sort parameter** (~1.66 MB / 2,022 records unfiltered: 1,233 English + 789 Spanish translation records sharing the same recall numbers). Every value is a string or array of strings; empty is `""`/`[]`.
- **Coverage [VERIFIED]:** Earliest `field_recall_date` is **2014-01-10**. Year-taxonomy IDs exist back to 1970 but return zero records before 2014.
- **Query parameters [VERIFIED, from the official PDF, live-tested]:** `field_year_id`, `field_closed_year_id`, `field_states_id`, `field_risk_level_id`, `field_recall_classification_id`, `field_recall_reason_id`, `field_recall_type_id`, `field_processing_id`, `field_related_to_outbreak`, `field_archive_recall`, `field_recall_number`, `field_summary_value`, `field_product_items_value`, `field_closed_date_value`, `field_translation_language` (en/es). Selection values are **Drupal taxonomy IDs enumerated in the PDF's Appendix A** (e.g. 2026 = 685, Nationwide = 557, Class I = 10); IDs are non-monotonic and must be looked up, never computed. Filters AND together. Quirks observed: `field_recall_number=005-2026` did **not** return `005-2026-EXP` (docs claim substring matching — contradiction, §9); `field_closed_date_value` filter matched nothing testable.
- **Response fields [VERIFIED against all 2,022 records]:** stable 29-key schema. Highlights:
  - `field_recall_number` — `DDD-YYYY` for recalls (yearly restart); **`PHA-MMDDYYYY-NN` for Public Health Alerts**; expansions get suffixed variants (`005-2026-EXP`; historical chaos: `EXP1`, ` expansion`, ` EXP-2`, `(Original)`). Dirty data observed: trailing/leading spaces, one bare `"008"`, one non-padded `"36-2021"`, one typo'd PHA date. `field_recall_number_export` is identical in all records.
  - `field_recall_type` — observed values: **`Active Recall` / `Closed Recall` / `Public Health Alert`** (documented `Outbreak` value: zero records). **This is the reliable lifecycle field.**
  - `field_active_notice` — **unreliable**: `False` on 6 of 11 then-active recalls and on _every_ PHA including one issued two weeks prior. Meaning undocumented [UNRESOLVED]. Do not use for status.
  - `field_recall_classification` / `field_risk_level` — 1:1 in all live data: Class I ↔ "High - Class I" (1,442), Class II ↔ "Low - Class II" (327), Class III ↔ "Marginal - Class III" (83), and the literal value `Public Health Alert` for PHAs (170). "Medium - Class I" is documented but unobserved.
  - `field_recall_date` (issuance, YYYY-MM-DD), `field_last_modified_date` (changes on edits — the change-detection hook), `field_year`, `field_closed_year` (**year only — no closure date exists in the API**; `field_closed_date` does not exist in output despite the filter parameter).
  - `field_recall_reason` — structured multi-valued enum (9 values: Product Contamination, Unreported Allergens, Misbranding, Mislabeling, Insanitary Conditions, Processing Defect, Import Violation, Produced Without Benefit of Inspection, Unfit for Human Consumption).
    **Allergen under-reporting [VERIFIED against archived production snapshots, 2026-09-02]:** the enum is structured but **not complete for allergens**. 20 notices whose summary states the standard "contains X, a known allergen, which is not declared on the product label" carry only `Misbranding`/`Mislabeling` — and 5 of those carry an **empty** `field_recall_reason` array — because misbranding is how an undeclared allergen is reported, not a second hazard. Titles usually still say "…Due to Misbranding and Undeclared Allergen(s)". One further notice (115-2017, an undeclared-anchovy recall) carries `Product Contamination`. The enum therefore cannot be the sole category authority: canonical derivation consults the notice's own allergen evidence when the enum states no hazard of its own (see [recall-domain-architecture.md](recall-domain-architecture.md), "Canonical hazard-category precedence").
    **Foreign-material vs packaging wording [VERIFIED against the recorded corpus, 2026-09-02]:** `Product Contamination` notices state a genuine foreign-material hazard in a consistent family — the title "…Due to Possible Foreign Matter Contamination" plus "may be contaminated with foreign material, specifically glass" / "extraneous materials, specifically clear flexible and hard plastic", "pieces of glass in product", "glass found in product", "may contain hard plastic". Material words also appear pervasively in **packaging** prose in every reason family ("9.75-oz. plastic bowls", "plastic wrapped tray packages", "1-lb. plastic vacuum-packed packages", "plastic liners", "cardboard box cases containing a plastic bag"), including on notices whose real contaminant is a different material. Packaging wording must never be read as contamination evidence.
  - `field_states` — structured state names or `Nationwide`. `field_processing` — structured category enum. `field_related_to_outbreak` — "True"/"False"/"".
  - `field_establishment` — array of establishment names (sometimes empty, sometimes duplicated). Establishment _numbers_ (e.g. "EST. 1234") appear only in summary prose.
  - `field_product_items` — free-text product lines (often empty on PHAs where the list is a PDF).
  - `field_summary` — the **full press release as HTML** (contains Editor's Notes, establishment number, links to label/product-list PDFs).
    **Allergen reason wording [VERIFIED against the recorded corpus, 2026-09-02]:** titles of allergen notices usually say only "…Due to Misbranding and Undeclared Allergen(s)" without naming it; the standard statement naming the allergen is a summary sentence of the form "The product contains **egg**, a known allergen, which is not declared on the product label" (variants observed: plural "contains eggs", "may contain sesame", multiple "contains egg and milk, known allergens", parenthetical species "contains fish (anchovies)", component "produced using an egg wash, which contains egg", and "an undeclared allergen, specifically peanut residue"). 13 of 15 allergen records in the recorded set use this apposition family rather than "undeclared <allergen>". One further variant is **[VERIFIED against the archived production snapshot for 111-2015, 2026-09-02]** rather than the recorded corpus: an allergen-governed "including" list — "contained undeclared allergens, including eggs, milk, and wheat". Older notices can also state the same allergen twice in different grammatical number across two constructions ("undeclared peanut" in one sentence, "may contain peanuts, known allergens" in another).
  - `field_labels` / `field_distro_list` — **bare PDF filenames without paths** (sometimes with trailing spaces). Real URLs follow `https://www.fsis.usda.gov/sites/default/files/food_label_pdf/{YYYY-MM}/{file}` where YYYY-MM is the _upload_ month — recoverable reliably only from the summary/detail-page HTML **[VERIFIED on live pages]**. Labels are PDFs; no image files.
  - `field_qty_recovered` — free text, dirty ("6,037,289 lbs", "0 (zero) pounds ", "0 Ibs" sic). Not parseable without normalization.
  - `field_company_media_contact` (free text with embedded newlines), `field_media_contact` (FSIS press officer), `langcode` ("English"/"Spanish"), `field_has_spanish`, `field_archive_recall`, `field_recall_url` (canonical detail-page link, **served as `http://`**, redirects to https; Spanish pages under `/es/retirada/`), `field_press_release`/`field_en_press_release` (always empty [UNRESOLVED]).
- **Update semantics [VERIFIED]:** three mechanisms coexist —
  1. **In-place edits**: Editor's Notes prepended to `field_summary`; `field_last_modified_date` advances; `field_qty_recovered` and label/product-list links updated in place.
  2. **Expansions as new records** with suffixed recall numbers, own dates/URLs/PDFs; parent summary cross-links to them.
  3. **PHA retractions as new PHA records** (observed live).
     Closure is an in-place transition: `field_recall_type` → `Closed Recall`, `field_closed_year` set, `field_archive_recall` → "True". **No closure announcement record and no precise closure date.**
- **Official closure meaning [VERIFIED]:** FSIS Directive 8080.1: after effectiveness checks, FSIS closes the case, notifies the firm in writing, and has the website "identify the recall as closed." Consumer FAQ: closure means the firm "has been successful in contacting its consignees and has made all reasonable efforts to retrieve and control products."
- **FSIS classification definitions [VERIFIED]** ([Understanding FSIS Food Recalls](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/understanding-fsis-food-recalls)): Class I — "reasonable probability that use of the product will cause serious, adverse health consequences or death"; Class II — "remote probability of adverse health consequences"; Class III — "will not cause adverse health consequences, or the risk is negligible." The [Annual Recall Summaries page](https://www.fsis.usda.gov/food-safety/recalls-public-health-alerts/annual-recall-summaries) maps these to risk levels: "Class I - High or Medium Risk; Class II - Low Risk; Class III - Marginal Risk." Classification is assigned at issuance by FSIS's Event Assessment Committee (unlike FDA, where classification arrives weeks later).
- **Access constraint [VERIFIED first-hand]:** fsis.usda.gov sits behind Akamai bot filtering. A bare or minimal browser User-Agent gets **403**; a fuller Chrome-like header fingerprint gets 200. The exact accepted fingerprint varied even across our own attempts on the same day — an ingestion job needs robust browser-like headers, retry logic, and monitoring for fingerprint-rule changes. No rate limits are documented anywhere [UNRESOLVED].
- **Attribution [VERIFIED]:** USDA ([Policies and Links](https://www.usda.gov/about-usda/policies-and-links)): "Most information presented on the USDA Web site is considered public domain information. Public domain information may be freely distributed or copied, but use of appropriate byline/photo/image credits is requested. Attribution may be cited as follows: 'U.S. Department of Agriculture.'" **[INFERENCE]** Recall records are agency work product within that public-domain bucket; credit USDA in the app.

### 4.2 FSIS website and annual summaries

- **[VERIFIED]** <https://www.fsis.usda.gov/recalls> is a faceted listing driven by the **same Drupal taxonomy IDs as the API** (facet counts matched API counts within one). Detail pages (`field_recall_url`) show the release, a "Closed" status marker, Editor's Notes, and the real PDF hrefs.
- **[VERIFIED]** Annual "Summary of Recall and PHA Cases" pages (2012–2025) publish hand-curated XLSX totals (e.g. 2025: 42 recalls, 71,420,721 lbs, 24 PHAs) with more granular reason vocabulary than the API. Useful for QA cross-checks, not ingestion.

---

## 5. Source matrix

| Source                                             | Purpose                                                                    | Machine readable                                                   | Freshness (observed 2026-08-21)                                             | Stable ID                                                  | Classification                                | Status                                                 | Product detail                                                                     | MVP role                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| FDA announcements (listing JSON / XLSX / food RSS) | Consumer warning for significant-risk recalls (firm-authored)              | Yes (undocumented JSON backend + XLSX + RSS; browser UA required)  | Same/next day; RSS items ≤2 days old                                        | Announcement URL path only (no recall/event number)        | None (pre-classification by design)           | "Terminated Recall" flag only                          | Brand ✓, description ✓, reason category ✓; UPC/lots/photos in prose/images         | **FDA fast discovery + notification trigger**                                             |
| openFDA food enforcement (`api.fda.gov`)           | Regulatory record of all classified FDA recalls                            | Yes (documented JSON API + bulk zip, CC0)                          | Weekly; 9 days stale at access; records trail initiation by ~3–10 weeks     | `recall_number` (per product) + `event_id` (per event)     | Class I/II/III (+rare "Not Yet Classified")   | Ongoing/Completed/Terminated (FDA says don't trust it) | Description/lots/distribution as prose; **no structured UPC/brand**                | **FDA structured normalization, classification enrichment, reconciliation; NOT alerting** |
| FDA iRES / Enforcement Report                      | Earliest enforcement-side listing incl. pre-classification; update history | Partially (auth-gated API, CSV, email subscriptions; bot-filtered) | Weekly publication                                                          | recall_number + event_id + press-release URL link          | Incl. "Not Yet Classified"                    | Full RES status                                        | Same as openFDA                                                                    | Phase-2 candidate; founder email subscription now                                         |
| FDA Data Dashboard                                 | Analytics dashboard over RES                                               | Effectively no (no recalls API endpoint; JS-only export)           | Weekly, classified-only                                                     | —                                                          | classified only                               | —                                                      | —                                                                                  | **None (rejected)**                                                                       |
| FDA CORE outbreak table                            | Outbreak/illness investigation tracking                                    | Scrapeable HTML table                                              | Updated as investigations progress                                          | Reference #                                                | n/a                                           | Active/Ongoing etc.                                    | Product category (often withheld)                                                  | Future enrichment only                                                                    |
| **FSIS Recall API**                                | Complete recall + PHA record, consumer-facing content                      | Yes (documented JSON API, no auth; Akamai fingerprint required)    | Effectively real-time (newest recall 4 days old present; no official claim) | `field_recall_number` (dirty string; PHAs separate scheme) | Class I/II/III at issuance; PHAs unclassified | Active Recall / Closed Recall (reliable)               | Products/lots free-text lines; reason/states/processing structured; labels as PDFs | **FSIS everything: discovery + normalization + lifecycle**                                |
| FSIS website + annual XLSX summaries               | Human reference; curated yearly stats                                      | XLSX (summaries)                                                   | Live / yearly                                                               | recall number                                              | yes                                           | yes                                                    | prose                                                                              | QA cross-check only                                                                       |

**Reading of the matrix [RECOMMENDATION]:** fast discovery = FDA announcements + FSIS API; structured normalization = openFDA + FSIS API; reconciliation/enrichment = openFDA (classification, event grouping, termination) joined fuzzily to announcements; lifecycle tracking = FSIS API (reliable) and openFDA status/termination_date (best-effort only, per FDA's own disclaimer).

---

## 6. Field matrix (consumer-relevant fields)

Legend: **S** = reliably structured · **s** = sometimes structured · **P** = usually prose-only · **✗** = unavailable

| Field                                 | FDA announcements                                                    | openFDA enforcement                                               | FSIS API                                                             |
| ------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Brand                                 | **S** (`field_brand_name`, HTML-wrapped)                             | P (inside `product_description`; `openfda.brand_name` empty)      | P (inside title / product items)                                     |
| Product name/description              | **S** (short) + P (detail)                                           | **S** (`product_description`, terse regulatory phrasing)          | s (`field_product_items` free-text lines; title)                     |
| UPC                                   | P (press-release body / photo alt text)                              | P (`code_info` / description; `openfda.upc` empty on all records) | P (summary/labels PDFs)                                              |
| Lot codes / codes                     | P (body tables)                                                      | P (`code_info` is explicitly a prose dump of lots/dates)          | P (product items / summary / PDFs)                                   |
| Best-by / use-by dates                | P                                                                    | P (`code_info`)                                                   | P                                                                    |
| Package sizes                         | P                                                                    | P (in description)                                                | P (in product item lines)                                            |
| Geographic distribution               | P (body; "nationwide" common)                                        | P (`distribution_pattern`, semi-conventional prose)               | **S** (`field_states` incl. `Nationwide`)                            |
| Retailers                             | P (body; often absent)                                               | P (sometimes in `distribution_pattern`)                           | s (retail consignee **PDF** for Class I; names sometimes in summary) |
| Reason / hazard                       | **S** (category) + P (description)                                   | P (`reason_for_recall`) + **S** (classification as proxy)         | **S** (`field_recall_reason` enum) + P (summary)                     |
| Classification (I/II/III)             | ✗ (pre-classification)                                               | **S**                                                             | **S** (at issuance; ✗ for PHAs)                                      |
| Status / closure                      | s (Terminated flag, no date)                                         | **S**-shaped but unreliable per FDA; `termination_date` populated | **S** (`field_recall_type`; closure **year** only)                   |
| Illnesses / hospitalizations / deaths | P (body boilerplate, "no illnesses reported")                        | ✗                                                                 | P (summary; PHAs/outbreak-related only)                              |
| Consumer action ("what to do")        | P (body)                                                             | ✗                                                                 | P (summary boilerplate)                                              |
| Company contact                       | P (dedicated section)                                                | ✗ (firm address only)                                             | s (`field_company_media_contact`, messy text)                        |
| Official source URL                   | **S** (the page itself / `path`)                                     | ✗ (no press-release link exposed)                                 | **S** (`field_recall_url`)                                           |
| Product images                        | s (photos w/ occasionally UPC-bearing alt text; not in JSON backend) | ✗                                                                 | ✗ (label **PDFs** only, filenames need URL recovery)                 |
| Amount of product                     | P (body, sometimes)                                                  | P (`product_quantity`)                                            | P (`field_qty_recovered`, dirty)                                     |
| Establishment number                  | ✗                                                                    | ✗                                                                 | P (summary prose; names structured in `field_establishment`)         |
| Dates (initiation/publication)        | **S** (Company Announcement Date + FDA Publish Date)                 | **S** (initiation / classification / report / termination)        | **S** (`field_recall_date`, `field_last_modified_date`)              |

**Consequence [RECOMMENDATION]:** The canonical model must treat UPCs, lot codes, and best-by dates as **extracted, best-effort annotations over preserved source prose**, never as guaranteed structured data. The consumer card can always render: title, brand/product, reason, agency, date, action, and official link — those are reliable everywhere.

---

## 7. Lifecycle examples (verified end-to-end)

### 7.1 FDA — Albertsons tuna salad (Listeria), July 2025, openFDA event 97306

All dates from fetched artifacts (2026-08-21):

| Milestone                                                               | Date                                                  | Evidence                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firm initiates; Company Announcement Date                               | 2025-07-17                                            | Announcement summary block; equals `recall_initiation_date`                                                                                                                                                          |
| Initial announcement on fda.gov (FDA Publish Date)                      | 2025-07-21 (+4d)                                      | [Announcement](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/albertsons-companies-stores-arkansas-louisiana-oklahoma-and-texas-voluntarily-recalls-select-items)                               |
| **Expansion as separate announcement** ("…Voluntarily Expands Recall…") | 2025-07-28 (+11d; company date 07-26)                 | [Expansion](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/albertsons-companies-stores-arkansas-louisiana-oklahoma-and-texas-voluntarily-expands-recall-select); separate row in listing export |
| FDA classifies **Class I** (`center_classification_date`)               | 2025-08-13 (+27d; **+23d after public announcement**) | openFDA records H-0473→0482-2025                                                                                                                                                                                     |
| Appears in weekly Enforcement Report (`report_date`)                    | 2025-08-20 (+34d)                                     | same                                                                                                                                                                                                                 |
| Status at 2026-08-21                                                    | Terminated                                            | same                                                                                                                                                                                                                 |

One event → 2 announcements (initial + expansion) → **5 openFDA records** (one per product: H-0473, H-0474, H-0479, H-0480, H-0482-2025) sharing `event_id` 97306, all with identical dates. Firm name differs across sources ("Albertsons" vs "Albertsons Companies LLC").

**Negative control, same day [VERIFIED]:** Dreyer's Outshine fruit-bar recall announced on fda.gov 2026-08-18 ("Updated –" version live 2026-08-21) had **no openFDA record at all** three days later (`recalling_firm:"Dreyer"` → NOT_FOUND; endpoint last updated 2026-08-12). Corroborating gaps in the fresh top-of-feed: initiation→report_date of 25 and 69 days on the two newest records.

### 7.2 FSIS — Ajinomoto chicken fried rice (foreign matter), recall 005-2026

All values from the live API + live detail page (2026-08-21):

| Milestone                                                                                                                                               | Date                                                                 | Evidence                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial recall issued: `005-2026`, Class I / "High - Class I" at issuance, Nationwide, reason "Product Contamination"                                   | 2026-02-19                                                           | API record + [detail page](https://www.fsis.usda.gov/recalls-alerts/ajinomoto-foods-north-america-inc--recalls-chicken-fried-rice-products-due-0) |
| **Expansion as new record** `005-2026-EXP` ("…Expands Recall…", +33.6M lbs to 36,987,575 lbs total per Editor's Note)                                   | 2026-03-03                                                           | separate API record, own URL/labels                                                                                                               |
| **Correction in place**: Editor's Note of 2026-03-09 prepended to both summaries (lot numbers now controlling regardless of best-by date; updated PDFs) | 2026-03-09 (note date); `field_last_modified_date` 2026-04-15 on EXP | `field_summary` of both records                                                                                                                   |
| Closure (in place, both records): `field_recall_type` → `Closed Recall`, `field_closed_year` "2026", archived, `field_qty_recovered` "6,037,289 lbs"    | year 2026 only — **no precise closure date exposed**                 | API records; website shows "Closed"                                                                                                               |

Classification existed **from day one** (FSIS classifies at issuance) — the mirror image of FDA, where classification trailed the announcement by ~3+ weeks.

---

## 8. Rate limits, terms, and attribution summary

| System                              | Auth                                                 | Limits                                                               | License/attribution                                                                                            | Access quirk                                                                     |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| api.fda.gov (openFDA)               | free API key (docs now say required; keyless worked) | 240/min + 120k/day with key; 240/min + 1k/day keyless **[VERIFIED]** | **CC0 public domain**; attribution requested, not required; no implied endorsement **[VERIFIED]**              | none                                                                             |
| www.fda.gov (listing JSON/XLSX/RSS) | none                                                 | none documented **[UNRESOLVED]**                                     | US Gov work; feeds are undocumented internals **[INFERENCE: safe to consume, unsafe to depend on blindly]**    | **404 to non-browser User-Agents [VERIFIED]**                                    |
| fsis.usda.gov Recall API            | none                                                 | none documented **[UNRESOLVED]**                                     | USDA: "Most information … is considered public domain"; credit "U.S. Department of Agriculture" **[VERIFIED]** | **Akamai 403 unless full browser-like header fingerprint [VERIFIED first-hand]** |
| accessdata.fda.gov (iRES)           | API needs FDA-issued credentials                     | unknown                                                              | US Gov work                                                                                                    | active bot/abuse detection **[VERIFIED]**                                        |

For a small consumer app, none of the verified limits are constraining (our polling needs are orders of magnitude below 240/min). The real operational risks are the **UA/fingerprint gates** and the **undocumented status** of the fda.gov listing endpoints.

---

## 9. Contradictions and unresolved questions

These were found during research and must be respected (not silently resolved) by the architecture. Per our stop-conditions, the contradictions below are _reported_ here rather than guessed away; none of them blocks the recommended architecture because the recommendation never depends on the contradicted semantics.

**Official-vs-official / official-vs-observed contradictions [VERIFIED both sides]:**

1. **openFDA freshness-of-status:** FDA's disclaimer says recall status "will remain unchanged after published in the Enforcement Reports," yet 27,817/29,310 records are Terminated with `termination_date`s advancing to 2026-08-14. → Treat status/termination as _eventually updated, never timely_; never message users based on it.
2. **openFDA coverage claim:** docs say "2004-present"; earliest food `report_date` present is 2012-06-20. → Historical backfill floor is mid-2012, not 2004.
3. **Pre-classification visibility:** the Enforcement Report page says recalls "may be listed prior to classification" (policy since 2017-06-15), and openFDA's docs say records post "once the products are classified." Live openFDA had exactly **1** "Not Yet Classified" record. → Assume openFDA is classified-only in practice; pre-classification visibility requires iRES.
4. **openFDA key requirement:** auth docs state a key "is required" while publishing keyless limits, and keyless calls succeed. → Use a key; don't depend on keyless access.
5. **FSIS `field_recall_number` filter:** documented as substring match, observed as exact match (`005-2026` did not return `005-2026-EXP`). → Filter client-side.
6. **FSIS `field_active_notice`:** contradicts `field_recall_type` on 6 of 11 active recalls and all PHAs. → Use `field_recall_type` only.

**Unresolved questions (carried forward to the architecture task):**

- Exact FSIS publish→API propagation latency, and any FSIS rate limits/ToS.
- Stability/policy of the fda.gov browser-UA requirement, the undocumented listing JSON endpoint, and the FSIS Akamai fingerprint rules (our own fetches saw fingerprint sensitivity vary same-day).
- Whether FDA "Updated –" announcements reuse or replace the original URL (observed one case where the original slug 404s — announcement-path-as-ID must tolerate URL churn).
- iRES API schema/limits (auth-gated) and whether its keyword email subscription is reliable enough to be worth automating around.
- Whether the ~1,025-row fda.gov listing export is capped or complete for its 3-year window.
- Meaning of FSIS's always-empty `field_press_release`/`field_en_press_release`, the `field_closed_date_value` filter, and the one-record PHA facet/API count discrepancy.
- No official SLA exists anywhere for FDA classification timing (observed 2–9+ weeks).

---

## 10. Architectural conclusions

1. **FDA MVP ingestion [RECOMMENDATION]:** two feeds. (a) _Discovery:_ poll the fda.gov announcements listing JSON (`/datatables-json/recalls-market-withdrawals.json`, filtered to food product types, sorted by us — it arrives unsorted) with the food-only RSS as a redundant cross-check; browser-like UA mandatory. (b) _Enrichment/completeness:_ poll openFDA food enforcement (with an API key) for classification, event grouping, lot prose, distribution, and the enforcement-only recalls that never get announcements. Do not use openFDA for alert timing — FDA explicitly prohibits that use and the data confirms it. Defer iRES API integration; suggest the founder personally subscribe to the iRES keyword emails as a QA channel.
2. **FSIS MVP ingestion [RECOMMENDATION]:** the FSIS Recall API alone, filtered `field_translation_language=en` (keep `field_has_spanish` for future localization), fetched with a robust browser fingerprint. It is simultaneously the fast channel, the structured channel, and the lifecycle channel. Label-PDF URLs, establishment numbers, and retailer lists require parsing `field_summary` HTML or the detail page — defer past MVP.
3. **Polling cadence [RECOMMENDATION]:** FDA listing JSON + RSS and the FSIS API: every **30–60 minutes** (each is one cheap request; recalls publish at business-hours pace, and both sources were observed fresh to the current/previous day). openFDA: **once daily** (upstream updates weekly; daily polling catches the refresh day promptly at trivial cost). All cadences are far below any verified limit.
4. **"New recall" [RECOMMENDATION]:** FSIS — an English record whose _trimmed_ `field_recall_number` is unseen (expansion-suffixed numbers are new records linked to their parent by prefix). FDA — a listing item whose `path` is unseen _and_ whose (company, brand, product, date) tuple doesn't fuzzy-match a recently seen item (guards against URL churn on retitles); openFDA — an unseen `event_id` that doesn't fuzzy-match an existing FDA announcement-derived recall (these are late-arriving, often unannounced recalls).
5. **"Materially changed" [RECOMMENDATION]:** FSIS — `field_last_modified_date` advanced **and** a diff in title, summary, product items, states, reason, classification, or type; or a new expansion/retraction record referencing it. FDA — retitled announcement ("Updated"-prefixed / changed `changed` timestamp / changed reason or product fields), a new expansion announcement fuzzy-linked to it, or openFDA classification appearing or changing for the linked event.
6. **Changes that may re-notify [RECOMMENDATION]:** expansion (more products/lots/states); correction that broadens affected product identification (e.g. FSIS 2026-03-09 "regardless of best-by date" note); FDA classification arriving as **Class I** on a recall we already alerted (frame as "FDA has now classified this as highest risk"); PHA retraction (tell users the warning was withdrawn).
7. **Never auto-notify on [RECOMMENDATION]:** status transitions to Completed/Closed/Terminated (dashboard-only); `field_last_modified_date` churn with no material diff; openFDA weekly re-exports or record edits that only touch regulatory bookkeeping (report_date, termination_date, quantity recovered); appearance of a Spanish translation record; our own fuzzy-link of an announcement to its enforcement record. Notification fan-out must be keyed to our canonical event, not to source records — one event with 18 per-product enforcement rows is one notification, not 18.
8. **Preserve raw [RECOMMENDATION]:** append-only archive of every fetched payload that produced or changed a canonical record: the FSIS JSON record, the FDA listing JSON item, the RSS item XML, the openFDA record, each stamped with fetch time and source URL — plus the announcement/detail-page HTML for anything we alerted on (pages churn and archive off after ~3 years). This is the audit trail proving what the government source said at alert time.
9. **Identifiers to retain (never as our canonical ID) [RECOMMENDATION]:** FSIS `field_recall_number` (raw + trimmed) and `field_recall_url`; FDA announcement `path`/URL + both its dates; openFDA `event_id` and every per-product `recall_number`; `field_recall_number_export` if it ever diverges. Our canonical ID must be internal, because every external ID is dirty, mutable, or absent for part of a recall's life (openFDA `recall_number` can be empty pre-classification; FDA announcements have no number at all; FSIS numbers carry whitespace and suffix chaos).
10. **Impossible or unreliable to infer automatically [VERIFIED limitations]:** guaranteed announcement↔enforcement linkage (no shared key; fuzzy only — must be reviewable, not blindly trusted); FDA recall closure timing (FDA disclaims its own status field); structured UPC/lot/best-by extraction (prose-only in every source; `openfda.upc` is empty on all 29,310 records); FSIS closure date (year granularity only); illness counts tied to a recall (live in separate outbreak systems); completeness of fast-channel coverage (FDA announcements are by design only the significant-risk subset — the app must be honest that "no alert" ≠ "no recall" until the weekly openFDA sweep lands); FSIS `field_active_notice` semantics.

**Single most important design consequence:** _discovery_ and _truth_ are different channels on the FDA side. The app alerts from firm announcements (fast, unclassified, prose-heavy, no ID) and later reconciles against enforcement data (slow, classified, structured-ish, ID-bearing) — and the canonical model must represent a recall whose classification, identifiers, and even record linkage arrive weeks after the alert, without ever re-notifying users by accident during reconciliation.

---

## Appendix: source register

All accessed 2026-08-21.

| #   | Source                                                       | URL                                                                                                                                                                                  |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | FDA Recalls, Market Withdrawals, & Safety Alerts (listing)   | https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts                                                                                                                  |
| 2   | FDA listing JSON backend (undocumented)                      | https://www.fda.gov/datatables-json/recalls-market-withdrawals.json                                                                                                                  |
| 3   | FDA listing XLSX export                                      | https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/datatables-data?page&_format=xlsx                                                                                |
| 4   | FDA Recalls RSS (all commodities)                            | https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml                                                                                                    |
| 5   | FDA Food Safety Recalls RSS (food-only)                      | https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/food-safety-recalls/rss.xml                                                                                        |
| 6   | FDA feeds directory ("Subscribe to Podcasts and News Feeds") | https://www.fda.gov/about-fda/contact-fda/subscribe-podcasts-and-news-feeds                                                                                                          |
| 7   | Additional Information about Recalls                         | https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/additional-information-about-recalls                                                                             |
| 8   | openFDA Food Enforcement docs                                | https://open.fda.gov/apis/food/enforcement/                                                                                                                                          |
| 9   | openFDA endpoint                                             | https://api.fda.gov/food/enforcement.json                                                                                                                                            |
| 10  | openFDA fields YAML                                          | https://open.fda.gov/fields/foodenforcement.yaml                                                                                                                                     |
| 11  | openFDA authentication & limits                              | https://open.fda.gov/apis/authentication/                                                                                                                                            |
| 12  | openFDA license (CC0) / terms                                | https://open.fda.gov/license/ · https://open.fda.gov/terms/                                                                                                                          |
| 13  | openFDA bulk download manifest                               | https://api.fda.gov/download.json                                                                                                                                                    |
| 14  | FDA Enforcement Reports                                      | https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/enforcement-reports                                                                                              |
| 15  | Enforcement Report information & definitions                 | https://www.fda.gov/safety/enforcement-reports/enforcement-report-information-and-definitions                                                                                        |
| 16  | iRES application / API docs                                  | https://www.accessdata.fda.gov/scripts/ires/index.cfm · …/ires/apidocs/                                                                                                              |
| 17  | Recalls Background and Definitions                           | https://www.fda.gov/safety/industry-guidance-recalls/recalls-background-and-definitions                                                                                              |
| 18  | 21 CFR 7.3 via eCFR API                                      | https://www.ecfr.gov (title 21, part 7, subpart A, §7.3)                                                                                                                             |
| 19  | Public Warning and Notification of Recalls guidance (PDF)    | https://www.fda.gov/media/110457/download                                                                                                                                            |
| 20  | FDA 101: Product Recalls                                     | https://www.fda.gov/consumers/consumer-updates/fda-101-product-recalls                                                                                                               |
| 21  | FDA outbreaks (CORE)                                         | https://www.fda.gov/food/recalls-outbreaks-emergencies/outbreaks-foodborne-illness · https://www.fda.gov/food/outbreaks-foodborne-illness/investigations-foodborne-illness-outbreaks |
| 22  | FDA Data Dashboard recalls + API docs                        | https://datadashboard.fda.gov/oii/cd/recalls.htm · https://datadashboard.fda.gov/oii/api/index.htm                                                                                   |
| 23  | FSIS Recall API docs                                         | https://www.fsis.usda.gov/science-data/developer-resources/recall-api                                                                                                                |
| 24  | FSIS Recall API documentation PDF (June 2026)                | https://www.fsis.usda.gov/sites/default/files/media_file/documents/Recall-API-documentation.pdf                                                                                      |
| 25  | FSIS Recall API endpoint                                     | https://www.fsis.usda.gov/fsis/api/recall/v/1                                                                                                                                        |
| 26  | FSIS recalls listing                                         | https://www.fsis.usda.gov/recalls                                                                                                                                                    |
| 27  | Understanding FSIS Food Recalls                              | https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/understanding-fsis-food-recalls                                                          |
| 28  | FSIS Directive 8080.1 Rev. 8 (PDF)                           | https://www.fsis.usda.gov/sites/default/files/media_file/2020-07/8080.1.pdf                                                                                                          |
| 29  | FSIS Annual Recall Summaries                                 | https://www.fsis.usda.gov/food-safety/recalls-public-health-alerts/annual-recall-summaries                                                                                           |
| 30  | USDA Policies and Links (public domain statement)            | https://www.usda.gov/about-usda/policies-and-links                                                                                                                                   |
