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
3. Under the `DEVELOPMENT` label, tap **Design Preview**.

The row does not exist in a release build — it is written behind the bare
`__DEV__` identifier, which Metro replaces at build time, so the branch and
everything inside it are eliminated from the bundle. There is no runtime flag,
no environment variable, and no setting that can bring it back.

The hub itself is the only screen carrying "development" labelling. Every
screen it opens is the untouched product screen, so screenshots are of the
product exactly as it is built — no preview banners, badges, or watermarks
appear in them.

## 3. What it provides

The hub lists nine scenarios. Each one arms a simulated session and pushes the
real Recall Detail or the real questionnaire.

| #   | Scenario                                               | What you should see                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Detail · below threshold, no personal report           | `Did you find this product here?` then `Add your report`. No count.                                                                                                                                           |
| 2   | Detail · twelve public reports, no personal report     | `12 shoppers reported finding it here` then `Add your report`.                                                                                                                                                |
| 3   | Detail · below threshold, personal report exists       | `Edit your report` alone — no count, no invitation.                                                                                                                                                           |
| 4   | Detail · twelve public reports, personal report exists | `12 shoppers reported finding it here` then `Edit your report`.                                                                                                                                               |
| 5   | Questionnaire · full new report                        | State first (single-state confirm, or the direct picker for multi-state/nationwide), the store question, purchase time, review with the one-line disclosure and `Learn more.`, Submit, then the success copy. |
| 6   | Questionnaire · edit and removal                       | Every answer pre-filled, `Update report`, `Remove my report`, and the native removal confirmation.                                                                                                            |
| 7   | Questionnaire · recall naming no retailer              | The store question is absent entirely.                                                                                                                                                                        |
| 8   | Detail · ineligible recall                             | No community block at all — no heading, no control, no spacing.                                                                                                                                               |
| 9   | Detail · the real production gate                      | An eligible recall, the real server answering, the gate off: nothing renders.                                                                                                                                 |

### Presentation states

Six further scenarios exercise the Detail disclosure controls. None of them
simulates anything: each is a real recall chosen because its **own shape**
exercises a control, and the hub proves that shape from the real Detail model
before offering it (see §4).

| #   | Scenario                                               | What you should see                                                                                                                                                                 |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Detail · five jurisdictions or fewer                   | The whole list. No control at all.                                                                                                                                                  |
| 11  | Detail · more than five jurisdictions                  | The first five in canonical order, then `See all (N)`; expanding grows the list in place and the action becomes `Show less`. The community block stays beneath the whole statement. |
| 12  | Detail · one affected product                          | The single row, with no control beside the Affected Products heading.                                                                                                               |
| 13  | Detail · several affected products                     | Exactly the first row in source order, `See all (N)` beside the heading, every row after expanding.                                                                                 |
| 14  | Detail · an UNPAIRED cell holding exactly two values   | Both values inline, no cell control.                                                                                                                                                |
| 15  | Detail · an UNPAIRED cell holding more than two values | The first two values plus that cell's own `See all (N)`; expanding affects only that field.                                                                                         |
| 16  | Detail · two identifier pairs                          | A code column and its date column aligned line for line, two complete pairs, and no control at all.                                                                                 |
| 17  | Detail · several identifier pairs                      | Two complete pairs aligned across both columns behind ONE `See all (N)`; tapping reveals every remaining pair on both sides together, still aligned. Neither column can move alone. |

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

Loading, empty and error states on the Feed itself remain reproducible the
ordinary way — launch, a search that matches nothing, and a backend that is
unreachable — and pull-to-refresh, scrolling and the sheets are inspected on
the Feed, not here.

### Detail scenarios (P2B2)

Twenty-two further scenarios open the **real** Recall Detail on a real
current recall chosen for the shape each needs. As with rows 10–17, none of
them simulates anything: the hub proves each shape from the real Detail model
(or, for nationwide and the risk tiers, from the same projection fields the
model reads) before offering it, and says "No suitable current recall" rather
than substituting one. The hub groups them under `Product header`,
`Where It Was Sold and Affected Products`, `Health Risk` and `Risk labels on
Detail`.

| #     | Scenario                                        | What you should see                                                                                                                                                               |
| ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18    | Detail · header with a product image            | Risk label, date and save control; name, brand and official link beside the hero tile.                                                                                            |
| 19    | Detail · header without a product image         | No tile and no placeholder: the identity takes the whole row.                                                                                                                     |
| 20    | Detail · a short product name (≤ 24 characters) | One line beside the hero.                                                                                                                                                         |
| 21    | Detail · a long product name (≥ 56 characters)  | Wraps across several lines beside the hero; never truncated.                                                                                                                      |
| 22    | Detail · nationwide distribution                | One sentence after the pin, no list, no control.                                                                                                                                  |
| 23–29 | Detail · Health Risk from each reviewed guide   | One row per guide (botulism, Listeria, E. coli/STEC, undeclared allergen, Salmonella, hepatitis A, Cyclospora): the risk statement, `COMMON SYMPTOMS`, and the `Learn more` link. |
| 30    | Detail · Health Risk with no reviewed guide     | The risk-only sentence alone.                                                                                                                                                     |
| 31    | Detail · no Health Risk section                 | Where It Was Sold followed directly by Affected Products.                                                                                                                         |
| 32    | Detail · a complete identifier/date group       | Every code dated; no blank line.                                                                                                                                                  |
| 33    | Detail · an incomplete identifier/date group    | An undated code keeps a blank line in the date column.                                                                                                                            |
| 34–40 | Detail · one recall per risk tier               | CRITICAL, VERY HIGH, HIGH, MODERATE, LOW, PENDING and UNKNOWN (a Public Health Alert, beside its notice label).                                                                   |

Whether a recall carries a guide is decided by the real guide pipeline
(`selectHazardGuidance` over `interpretReason`, on the fetched projection —
the same call `buildDetailModel` makes); the hub spends a few of its probes
on feed rows whose hazard text hints at each guide, and confirms every one.
The **saved and unsaved** header states are inspected by tapping the save
control on any of these; the **affects-you** callout renders on any recall
that matches this device's personalization.

A further gallery, **Detail states and callouts**, renders Recall Detail's
loading, not-found and load-failure messages with their real copy from
`src/lib/detail-copy.ts`, and the Information Callout in both tones on
labelled sample sentences.

Scenarios 8 and 9 are deliberately **not simulated**. They arm a session that
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

| Value                                   | How it is simulated                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The public report count                 | Either the server's indistinguishable below-threshold answer, or the disclosed count `12`. Never a sub-threshold number — the server discloses none, and neither may a preview of it.                                        |
| Whether this installation has a report  | A scenario-configured yes or no.                                                                                                                                                                                             |
| This installation's answers             | Built from the case's **own** allowed choices: the first jurisdiction the notice lists, the first retailer it names (or none), and one purchase-time bucket (`past_month`). Never a state or store the notice does not list. |
| Feature availability inside the session | The summary is answered locally instead of by the server. This does not switch anything on; see §6.                                                                                                                          |

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
a hero, and the shortest and longest titles.

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
   at the end of the content view and the paragraph describing it in the file
   header.
3. In `src/lib/shopper-report-store.ts`, delete the `./design-preview` import,
   the four guard blocks at the top of `submitReport`, `withdrawReport`,
   `loadMyReport` and `loadReportSummary`, and the
   "## The one development-only diversion" section of the file header.
4. Delete this document and its rows in [../AGENTS.md](../AGENTS.md) and
   [../README.md](../README.md).

No other file references it, no migration or configuration was involved, and
nothing needs to be undone on the server.
