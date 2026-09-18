# Design Preview (development-only harness)

_Authoritative home for the local Design Preview harness: how to open it, what
it simulates, what stays real, and how to remove it._

_Status: development tooling only. It exists so the founder can capture
holistic screenshots of the shipped shopper-report experience for the
designer. It is **not** product enablement: the production feature gate
`shopper_report_config.reports_enabled` is untouched and still **false**, and
turning it on remains a separate, explicit founder action with its own
preconditions ([recall-shopper-reports.md](recall-shopper-reports.md) §8,
[recall-launch-blockers.md](recall-launch-blockers.md))._

## 1. Why it exists

The whole shopper-report consumer experience shipped in P1D, and none of it is
visible to anyone: the server gate is off, so every public summary reads
`unavailable` and the Detail community block renders nothing at all. That is
the correct production behaviour, and it also means a designer cannot see the
feature they are being asked to design.

Design Preview closes that gap without touching the gate. It simulates the
four values the app would otherwise ask the server for, and then opens the
**real** screens.

## 2. How to open it

1. Run a development build (`npm run ios`, or `npm start` and open the
   simulator). The harness is gated on `__DEV__`.
2. Go to the **Profile** tab and scroll to the bottom.
3. Under the `DEVELOPMENT BUILDS ONLY` heading, tap **Design Preview**.

The row does not exist in a release build — it is written behind the bare
`__DEV__` identifier, which Metro replaces at build time, so the branch and
everything inside it are eliminated from the bundle. There is no runtime flag,
no environment variable, and no setting that can bring it back.

The hub itself is the only screen carrying "development" labelling. Every
screen it opens is the untouched product screen, so screenshots are of the
product exactly as it is built — no preview banners, badges, or watermarks
appear in them.

## 3. What it provides

The hub’s first fourteen scenarios cover the community block and the
questionnaire. Each one arms a simulated session and pushes the real Recall
Detail or the real questionnaire.

| #   | Scenario                                                 | What you should see                                                                                                                                                                                           |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Detail · below threshold, no personal report             | `Did you find this product here?` then `Add your report`. No count.                                                                                                                                           |
| 2   | Detail · twelve public reports, no personal report       | `12 shoppers reported finding it here` then `Add your report`.                                                                                                                                                |
| 3   | Detail · below threshold, personal report exists         | `Edit your report` alone — no count, no invitation.                                                                                                                                                           |
| 4   | Detail · twelve public reports, personal report exists   | `12 shoppers reported finding it here` then `Edit your report`.                                                                                                                                               |
| 5   | Questionnaire · full new report                          | State first (single-state confirm, or the direct picker for multi-state/nationwide), the store question, purchase time, review with the one-line disclosure and `Learn more.`, Submit, then the success copy. |
| 6   | Questionnaire · single-state confirmation (P2B3)         | The first question is the yes/no confirm for the one official state; `No` ends the flow with nothing stored.                                                                                                  |
| 7   | Questionnaire · multi-state picker (P2B3)                | The direct state question over exactly the notice’s own jurisdictions, one radio row each, no search field.                                                                                                   |
| 8   | Questionnaire · nationwide, searchable list (P2B3)       | Every supported jurisdiction behind the search field; typing filters the rows, an empty match says so, and the field is never an answer.                                                                      |
| 9   | Questionnaire · recall naming no retailer                | The store question is absent entirely.                                                                                                                                                                        |
| 10  | Questionnaire · edit and removal                         | Every answer pre-filled, `Update report`, `Remove my report` beneath it, and the native removal confirmation; Cancel changes nothing.                                                                         |
| 11  | Questionnaire · recoverable submission error (P2B3)      | Submitting is refused the way the server refuses before writing: the failure renders beneath the action, every answer stays, Back still works.                                                                |
| 12  | Questionnaire · reporting paused, existing report (P2B3) | The summary answers `unavailable` while this device holds a report: no form, no submit — the paused message and the removal control alone.                                                                    |
| 13  | Detail · ineligible recall                               | No community block at all — no heading, no control, no spacing.                                                                                                                                               |
| 14  | Detail · the real production gate                        | An eligible recall, the real server answering, the gate off: nothing renders.                                                                                                                                 |

### Presentation states

Six further scenarios exercise the Detail disclosure controls. None of them
simulates anything: each is a real recall chosen because its **own shape**
exercises a control, and the hub proves that shape from the real Detail model
before offering it (see §4).

| #   | Scenario                                               | What you should see                                                                                                                                                                 |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | Detail · five jurisdictions or fewer                   | The whole list. No control at all.                                                                                                                                                  |
| 16  | Detail · more than five jurisdictions                  | The first five in canonical order, then `See all (N)`; expanding grows the list in place and the action becomes `Show less`. The community block stays beneath the whole statement. |
| 17  | Detail · one affected product                          | The single row, with no control beside the Affected Products heading.                                                                                                               |
| 18  | Detail · several affected products                     | Exactly the first row in source order, `See all (N)` beside the heading, every row after expanding.                                                                                 |
| 19  | Detail · an UNPAIRED cell holding exactly two values   | Both values inline, no cell control.                                                                                                                                                |
| 20  | Detail · an UNPAIRED cell holding more than two values | The first two values plus that cell's own `See all (N)`; expanding affects only that field.                                                                                         |
| 21  | Detail · two identifier pairs                          | A code column and its date column aligned line for line, two complete pairs, and no control at all.                                                                                 |
| 22  | Detail · several identifier pairs                      | Two complete pairs aligned across both columns behind ONE `See all (N)`; tapping reveals every remaining pair on both sides together, still aligned. Neither column can move alone. |

The hub also renders a **design foundation gallery** (P2B0): the type scale,
three surfaces, and the shared disclosure control, all drawn from the tokens
in `src/constants/design-tokens.ts` and the primitives in
`src/components/ui/` (see [../DESIGN.md](../DESIGN.md)), followed by the
**risk-label gallery**: all seven consumer labels (Critical, Very High, High,
Moderate, Low, Pending, Unknown) drawn through the real `riskView` pipeline
from one classification per tier by the product's own `RiskLabel`, so the
words, casing, label colours and spoken labels are the product's own — a
wrong mapping shows up as a wrong label.

### Feed galleries (P2B1)

Two further sections make the restyled Feed inspectable without hunting for
the right recall in the live feed:

- **Feed card matrix** — the product's own `RecallCard` on the page colour,
  over real current recalls chosen from the live feed session for the shape
  each case needs: Affects you + image, Affects you + no image, does not
  affect you + image, does not affect you + no image, the longest product
  name and the longest summary in the live corpus, a nationwide recall, a
  multi-state recall (two codes, then `+N`), and a Public Health Alert with
  its notice label, when the corpus holds one. Exactly two values are ever
  simulated, and each caption names them: the Affects-you flag, and — only if
  every live recall happens to carry an image — the missing image on the
  "no image" cards. Tapping a card opens the real Recall Detail; tapping
  Save writes this device's own bookmark list and nothing else, which is how
  the saved and unsaved states are inspected.
- **Feed controls and states** — the search bar, the `All` / `Affects me`
  pair, a filter chip in both states, the relevance label, the icon set, and
  the Feed's state messages (loading, no results, load failure) with their
  real copy from `src/lib/feed-copy.ts`, plus the personalize invitation. The
  controls are live but wired to nothing: they narrow no feed and open no
  sheet, and the loading sample does not announce itself.

### Saved gallery (P2B4)

A **Saved states and list** section makes the restyled Saved tab inspectable
without arranging a particular bookmark list on the device:

- Its whole-screen states with their real copy from `src/lib/saved-recalls.ts`
  — loading, empty (with the bookmark glyph), and a load failure — followed by
  its two information notices: the stale-feed sentence the Feed also uses, and
  the missing-from-feed sentence on a **simulated count of two**, because that
  notice appears only once a saved recall leaves the active corpus. The caption
  says so.
- Its list, drawn by the same shared `RecallCard` the Feed uses, at the same
  rhythm, over real current recalls from the live feed session: one saved
  recall, several, the longest product name in the live corpus, a card with no
  image, a nationwide recall, a multi-state recall, a Public Health Alert, and
  one card per risk label the live corpus holds (any tier the corpus does not
  carry is named, and every label is rendered on its own in the risk-label
  gallery).

The gallery neither reads nor writes this device's saved list — it composes
cards from feed items directly — so nothing it shows reflects what is actually
saved. The cards are live: tapping one opens the real Recall Detail, and its
own Save control writes this device's bookmark list exactly as it does on the
Feed.

### Profile components and states (P2B5)

A **Profile components and states** gallery renders the live Profile tab's
own components (`src/components/profile/` — imported from production, never
copied) in the states the shipped screen can reach, so each can be
screenshotted without arranging this device's preferences:

- the featured **Personalization card** while a read is pending (`Loading…`
  on every line), with empty preferences (`Not chosen` / `None selected`),
  populated (California, Peanuts and Milk, Costco and Trader Joe's), long
  (District of Columbia, four allergens and three stores, summarized to two
  names and `+N`), and after a read failure (`Unavailable`);
- a grouped **section** with two chevron navigation rows, a value row and a
  footnote caption;
- the **development entry**, which renders only in a development build.

Every state is **simulated** and its caption says so: the gallery hands each
card the answer its caption names and neither reads nor writes this device's
preferences (the live Profile reads them, read-only, on focus — see
[recall-personalization.md](recall-personalization.md)). The cards and rows
are live — a card opens the real Personalization screen, a row the real
document — and the caption is the only labelling; the components themselves
carry none.

### Personalization and Notification states (P2B6A)

Two further galleries render the restyled settings screens' own components
(`src/components/settings/` — imported from production, never copied) in
every state each screen can reach:

- **Personalization states** — the form loading (`Loading your
preferences…`), with empty selections, populated (California, Peanuts and
  Milk, Costco and Trader Joe's), and after a read failure (`Your
preferences could not be read`); the **state row** with no selection and
  with California, and the **state selector's contents** inline: searched
  (`new` typed), cleared while open (California checked; `Clear selection`
  empties it and the list stays), and replacing a selection (Nevada checked;
  choosing another row replaces it); the **store row** with none selected
  (`Add stores`), several (`Edit stores`) and five long names wrapping; and
  the **store selector's contents** inline with its count line: no query
  (the whole catalog in order), filtered (`co`), several checked rows that
  stay in place when more are checked, and no results. Each sample's
  preferences live in the gallery's memory: choosing a state, an allergen
  or a store changes that sample and nothing else — the gallery imports no
  store, so nothing can be saved or synced, and no sample contacts a
  backend. A row sample opens its real sheet over the gallery.
- **Notification states** — the panel loading (`Checking status…`), not
  determined (the explicit enable), enabled (`Recall alerts are on for this
device.` and `Turn off alerts`), denied-but-askable (which the status model
  shows as not enabled — the same screen, the caption says why), requiring
  system settings (`Open system settings`), unavailable / unsupported (the
  web's message), and after a failed operation (the generic failure beneath
  the action). The views are handed in and the three actions are wired to
  nothing: no sample can request permission, register a push token or open
  system settings.

Every sample is **simulated** and its caption says so. The real screens are
walked on the device — Profile → Personalization / Notifications — where
opening Notifications only reads the status and never prompts (see
[recall-push-delivery.md](recall-push-delivery.md)).

### Document renderer and states (P2B6B)

A **Document renderer and states** gallery renders the trust documents'
shared renderer and blocks (`src/components/document/` — imported from
production, never copied) over the registry's **own** content, so every
block kind can be screenshotted without opening seven documents, and the
reset panel in states the real screen reaches only by deleting data:

- the **shortest** and the **longest** registered document in full (chosen
  by block count from the registry, so the captions name them); one real
  section of How Affects Me Works (paragraphs under a section heading); the
  first bulleted list in Privacy & Data Controls; How Affects Me Works'
  **internal link** to Privacy & Data Controls (tapping opens the real
  document); Sources & Methodology's first **external link** (tapping opens
  its exact official URL in the browser); the Safety Disclaimer's
  medical-advice **note** as the information callout; the **warning
  callout** primitive on a labelled sample sentence, for comparison only —
  no document block can use the lime tone; and Risk Levels Explained's
  **label rows** — the five levels and the two states drawn by the
  production `RiskLabel` — which are also the registry's only dense
  comparison (there is no table block, and nothing on a document scrolls
  sideways);
- the **reset panel** idle, confirming (the platform dialog's own words
  rendered as text, because the dialog itself opens only from the real
  screen), busy (`Deleting…`, the button inert), succeeded and failed.

The document samples are real content and say so; the reset states are
**simulated** and say so. The panel is handed each state with its press wired
to nothing: the gallery imports neither the reset runner nor the section that
calls it, so no sample can open the confirmation or start a deletion —
pinned by `src/components/document-design.test.ts`. Accessibility-large text
is a device setting the gallery cannot simulate; set the simulator's text
size and inspect the samples and the real documents. The real documents are
walked from Profile, and the real reset — Cancel only, against an isolated
local configuration — from the bottom of Privacy & Data Controls.

### Questionnaire steps and states (P2B3)

A **questionnaire gallery** renders the questionnaire's steps and states one
under another, drawn by the real step components
(`src/components/report-questionnaire.tsx` — imported, never copied) so a
screenshot is of the product's own composition without walking a flow: the
single-state confirmation, the multi-state picker, the nationwide list behind
its search field, the unavailable state an unknown-geography recall shows
(it is ineligible for reports outright, so it has no questionnaire — see
[recall-shopper-reports.md](recall-shopper-reports.md) §10), the store
question, the
timeframe with one bucket chosen, review with the disclosure as a first
submission and as an update with the removal control, the recoverable
submission error, success, and the paused state with and without a refused
removal. The choices are a real eligible recall's own jurisdictions and the
retailers its notice names, narrowed or widened only to give each step its
shape (one state for the confirm, the supported-jurisdiction registry for the
searchable list); each caption
says which, and no retailer is ever invented — with no eligible recall naming
one, the store sample says so instead. Rows are live so the chosen state can
be inspected; Next, Back, Submit and Done are wired to nothing, and the
gallery reads and writes no shopper-report state. The flows themselves —
submit, edit, remove, refuse, pause — are walked on the real screen through
scenarios 5–12.

Loading, empty and error states on the Feed itself remain reproducible the
ordinary way — launch, a search that matches nothing, and a backend that is
unreachable — and pull-to-refresh, scrolling and the sheets are inspected on
the Feed, not here.

### Detail scenarios (P2B2)

Twenty-two further scenarios open the **real** Recall Detail on a real
current recall chosen for the shape each needs. As with rows 15–22, none of
them simulates anything: the hub proves each shape from the real Detail model
(or, for nationwide and the risk tiers, from the same projection fields the
model reads) before offering it, and says "No suitable current recall" rather
than substituting one. The hub groups them under `Product header`,
`Where It Was Sold and Affected Products`, `Health Risk` and `Risk labels on
Detail`.

| #     | Scenario                                        | What you should see                                                                                                                                                               |
| ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23    | Detail · header with a product image            | Risk label, date and save control; name, brand and official link beside the hero tile.                                                                                            |
| 24    | Detail · header without a product image         | No tile and no placeholder: the identity takes the whole row.                                                                                                                     |
| 25    | Detail · a short product name (≤ 24 characters) | One line beside the hero.                                                                                                                                                         |
| 26    | Detail · a long product name (≥ 56 characters)  | Wraps across several lines beside the hero; never truncated.                                                                                                                      |
| 27    | Detail · nationwide distribution                | One sentence after the pin, no list, no control.                                                                                                                                  |
| 28–34 | Detail · Health Risk from each reviewed guide   | One row per guide (botulism, Listeria, E. coli/STEC, undeclared allergen, Salmonella, hepatitis A, Cyclospora): the risk statement, `COMMON SYMPTOMS`, and the `Learn more` link. |
| 35    | Detail · Health Risk with no reviewed guide     | The risk-only sentence alone.                                                                                                                                                     |
| 36    | Detail · no Health Risk section                 | Where It Was Sold followed directly by Affected Products.                                                                                                                         |
| 37    | Detail · a complete identifier/date group       | Every code dated; no blank line.                                                                                                                                                  |
| 38    | Detail · an incomplete identifier/date group    | An undated code keeps a blank line in the date column.                                                                                                                            |
| 39–45 | Detail · one recall per risk tier               | CRITICAL, VERY HIGH, HIGH, MODERATE, LOW, PENDING and UNKNOWN (a Public Health Alert, beside its notice label).                                                                   |

Whether a recall carries a guide is decided by the real guide pipeline
(`selectHazardGuidance` over `interpretReason`, on the fetched projection —
the same call `buildDetailModel` makes); the hub spends a few of its probes
on feed rows whose hazard text hints at each guide, and confirms every one.
The **saved and unsaved** header states are inspected by tapping the save
control on any of these; the **affects-you** callout renders on any recall
that matches this device's personalization.

### Official imagery scenarios (P2B7C)

Twelve further scenarios open the real Recall Detail on a recall whose own
**official imagery** exercises one shape. As with every presentation
scenario, nothing is simulated: the hub reads the real Detail model and
offers a row only once that model proves the shape (see §4). Set sizes exist
nowhere on a feed row — only in the model — so the hub probes more recalls
that carry a hero, and the FSIS notices whose label PDFs prove that nothing
renders them. The group is `Official imagery on Detail`.

| #     | Scenario                                      | What you should see                                                                                                                  |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 46    | Detail · one official product photo           | The static header tile: no dots, no counter, nothing to swipe.                                                                       |
| 47    | Detail · two official product photos          | The same tile, swipeable, with two dots. Nothing advances on its own; a vertical drag over the tile still scrolls the page.          |
| 48    | Detail · five official product photos         | Five dots — the largest set that still uses them.                                                                                    |
| 49    | Detail · six official product photos          | The dots are replaced by the compact counter `1 / 6`, updating as you page. Never both.                                              |
| 50    | Detail · fifteen or more photos               | `1 / N` over the whole set; paging to the last page proves every one is reachable. No truncation sentence anywhere.                  |
| 51    | Detail · the largest set in the live corpus   | The outlier (51 photos in the recorded corpus). It opens as fast as any other recall: the pager is virtualized.                      |
| 52    | Detail · an unusually tall official photo     | The whole photo contained in the tile, letterboxed on the placeholder colour; never cropped.                                         |
| 53    | Detail · an unusually wide official photo     | The same on the other axis.                                                                                                          |
| 54    | Detail · long product name beside a paged set | The name wraps beside the tile, never truncated; at an accessibility text size the header stacks and stays stacked.                  |
| 55    | Detail · an image matched to an exact row     | Inside Affected Products: a thumbnail beside that row's Product value (the Outshine shape) — the only imagery that section may show. |
| 56    | Detail · a notice whose label pages exist     | **Nothing** renders them: no gallery above the table, no standalone section, nothing in the header (founder decision).               |
| 57–58 | Detail · paged imagery at accessibility sizes | Set the text size first (see below). The indicator and the header stack grow with the text; no page is left half-shown.              |

Text size is a **device setting the harness cannot simulate** (the same is
true of the document gallery). The accessibility rows open an ordinary
two-photo recall; set the simulator's size first — Settings › Accessibility ›
Display & Text Size › Larger Text — and revisit rows 50, 54 and 56 at that
size too. The **no-image** header is row 24, which already covers a recall
whose model resolved no photography at all.

### Official imagery and failure (P2B7C)

A gallery renders the product's own `OfficialImageSet` over the **real**
header sets the probed recalls produced — one sample per indicator shape (no
indicator, dots, counter) and the largest set those probes found — so the
three shapes can be compared side by side without hunting for three recalls.

Its last sample is the one state the live corpus cannot supply on demand and
the only **simulated** thing in the section: a real set's own photographs
plus one deliberately unreachable candidate. It demonstrates the rule that
closed the reported acceptance defect — a page whose image cannot load leaves
the set, so the dots and the counter always describe pages that actually
rendered, and a grey square can never sit under an indicator. The caption
says so on screen.

### Icon set (P2B7C)

A gallery renders **every** glyph the icon primitive declares, each at 24 and
16 with its name beneath, tinted the way the product tints them. A blank cell
here is a missing or wrongly-mapped asset — visible in one place instead of
screen by screen. `src/components/ui/design-foundation.test.ts` pins the same
mapping offline (every declared name resolves to a real, non-empty 1x/2x/3x
asset), so a broken icon fails the suite before it reaches a screenshot.

A further gallery, **Detail states and callouts**, renders Recall Detail's
loading, not-found and load-failure messages with their real copy from
`src/lib/detail-copy.ts`, and the Information Callout in both tones on
labelled sample sentences.

Scenarios 13 and 14 are deliberately **not simulated**. They arm a session that
diverts nothing, so those screens read the live server exactly as they do
outside the preview — which is the only way they can prove anything.

## 4. What is real, and what is simulated

**Real, always — the recall itself.** Every recall shown is a current recall
from the app's normal read-only feed session (no extra feed request is made
for it). Its title, brand, firm, geography, retailers, reason, Health Risk
section, Affected Products table, photos, quantity, timeline and official
source link are the live production data, rendered by the production
components. The harness holds no recall content and cannot fabricate any: it
stores a case id and nothing else about the notice.

**Simulated — only these four, and only inside an entered session:**

| Value                                   | How it is simulated                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The public report count                 | Either the server's indistinguishable below-threshold answer, or the disclosed count `12`. Never a sub-threshold number — the server discloses none, and neither may a preview of it.                                                                                                       |
| Whether this installation has a report  | A scenario-configured yes or no.                                                                                                                                                                                                                                                            |
| This installation's answers             | Built from the case's **own** allowed choices: the first jurisdiction the notice lists, the first retailer it names (or none), and one purchase-time bucket (`past_month`). Never a state or store the notice does not list.                                                                |
| Feature availability inside the session | The summary is answered locally instead of by the server — as available, or (P2B3, one scenario) as `unavailable`, the server's answer while the gate is off, so the paused state can be inspected. This can only switch the simulated feature off; it does not switch anything on; see §6. |
| Whether a submission is accepted        | Accepted, or (P2B3, one scenario) refused the way the server refuses before writing — synchronously, changing nothing — so the recoverable failure can be inspected.                                                                                                                        |

The presentation scenarios simulate **nothing at all** — jurisdiction lists,
product rows and cell values are the live notice's own, and the disclosure
behaviour on screen is the shipped behaviour.

The disclosed count deliberately does **not** move when you submit or remove a
simulated report. A scenario's count is the exact state being photographed,
and a submission that silently turned twelve into thirteen would make the
frozen copy unphotographable.

### Choosing the recall

The hub picks the best-fitting current recall automatically, preferring — in
this order — known state geography, at least one canonical retailer,
affected-product lines, and stated (not inferred) geography. For the primary
bucket it confirms the top candidates against the real Detail model, so the
recall you land on genuinely carries Health Risk and Affected Products
content rather than merely looking like it should. Up to sixty recalls are
probed on open (read-only detail requests, the same the Detail screen makes):
the longest product tables, single-line notices, the widest jurisdiction
lists, and from P2B2 a few rows per hazard-guide hint, rows with and without
a hero, and the shortest and longest titles. P2B7C raised the probe budget to
eighty and added two imagery buckets — more hero-carrying recalls (a notice
with several photos always has one) and the FSIS notices whose label PDFs are
the only source of label pages.

Tap **Choose another** on any bucket to pick a different real recall. Each
option shows its real attributes. If the live corpus contains nothing that
fits a scenario, the hub says so and disables the row rather than substituting
an unsuitable recall.

## 5. Preview reports are ephemeral

Everything a simulated session holds is module state in memory and nothing
else — no SecureStore, no AsyncStorage, no cache, no file, no server row.

- Simulated submission advances to the real success presentation, and
  returning to Detail then shows `Edit your report`.
- Simulated removal returns the case to the no-personal-report state.
- **Reset simulated state** restores the scenario's opening state.
- **Leave preview** discards everything.
- Reloading the app, or backgrounding it long enough for the JS context to go
  away, discards everything.

Nothing survives to the next session, and nothing is ever written to Supabase.

## 6. What it cannot do

The harness intercepts exactly one seam: `src/lib/shopper-report-store.ts`,
the only module both the Detail community block and the questionnaire read
shopper-report state through. Each of its four functions asks the harness
first and falls through to the real server path whenever it answers "not
simulated".

Four containments follow, each pinned by test in
`src/lib/design-preview.test.ts`:

1. **It cannot exist in a release build.** Entry is refused unless the runtime
   is a development build, and the guard is re-checked on every read — a
   session armed in development goes inert the instant the build is not.
2. **It cannot write anywhere.** A simulated session never reaches
   `src/lib/report-api.ts`, which owns every shopper-report `fetch`, so no
   request is issued — and the harness itself imports only `@/domain` types
   and pure logic, so it has no I/O available to it at all. The full simulated
   lifecycle is asserted to make zero network calls.
3. **It cannot reach any other recall or moment.** A session names exactly one
   case id; every other recall in the same app session, and every moment
   outside an entered session, keeps the real server answers.
4. **It adds no production-visible surface.** No tab, no badge, no product
   copy, and no link to it from any product screen.

It also never reads, copies, or overrides the production gate. The app still
holds no local copy of `reports_enabled` — the harness answers the question
the app would have asked the server, it does not switch anything on, and
outside a session it answers nothing. Nothing here is a step toward
enablement.

## 7. Removing the harness later

It is deliberately self-contained. To remove it completely:

1. Delete `src/lib/design-preview.ts`, `src/lib/design-preview.test.ts`, and
   `src/app/design-preview/`.
2. In `src/app/(tabs)/profile.tsx`, delete the `{__DEV__ ? (…) : null}` block
   at the end of the content view, its `DevelopmentEntry` import and the
   paragraph describing it in the file header; then delete
   `src/components/profile/development-entry.tsx` (the entry's only purpose is
   this row) and the `DEVELOPMENT_*` copy in `src/lib/profile-hub.ts`.
3. In `src/lib/shopper-report-store.ts`, delete the `./design-preview` import,
   the four guard blocks at the top of `submitReport`, `withdrawReport`,
   `loadMyReport` and `loadReportSummary`, and the
   "## The one development-only diversion" section of the file header.
4. Delete this document and its rows in [../AGENTS.md](../AGENTS.md) and
   [../README.md](../README.md).

No other file references it, no migration or configuration was involved, and
nothing needs to be undone on the server.
