# Privacy program proposal: consent, age assurance, rights, breach (rev. 2, 2026-10-12)

**Status: PROPOSAL.** Nothing here is built, applied or published.

- **No consent data has been cleared, and no age flow implemented.**
- **Decisions** are Willis's. Counsel is not engaged; that is optional, not
  a gate.
- **Not a compliance claim.** This document maps primary-source
  requirements to a concrete design and names residual uncertainty. It
  never claims compliance.
- **An Apple privacy-label answer is not legal compliance.**

**Sources** (read 2026-10-12): `~/Desktop/Lotly-Privacy-Correctness-Review/RESEARCH-NOTES.md`
holds the quotes and URLs. "[secondary]" marks anything not confirmed on a
primary source.

**Separate from the three prepared changesets.** The reset correction
(`aa64b1c`), subscription continuity and inactivity retention are reviewed
and ready to commit on their own (`CHECKPOINTS.md`). Nothing below changes
them.

---

## 1. Allergen consent (server processing only with consent; on-device matching always)

### 1.1 Screens

**A. Allergens step (onboarding).** `src/app/onboarding/allergens.tsx`

- Selection works exactly as today, saved on the device as it is tapped.
- On **Continue**, if at least one allergen is selected and no consent
  decision is recorded, sheet B opens before the Stores step.
- With nothing selected, no sheet is shown.

**B. Consent sheet**, a new component. It is not part of the Terms, has no
pre-selected choice, and both buttons have equal size and weight.

- **Title:** "Use your allergens for recall alerts?"
- **Body:**
  - "Lotly can store the allergens you chose on its server so it can send
    you alerts for recalls that involve them."
  - "They're stored with a random identifier, never your name, on Lotly's
    server (Supabase, Northern California)."
  - "Alerts are delivered through Expo and Apple and contain only public
    recall details."
  - "Lotly never uses them for ads and never sells them."
  - "You can turn this off any time in Profile → Privacy & Data Controls."
- **Conditional line**, shown when the user has chosen no states and no
  stores: "Without this, Lotly won't be able to send you any alerts, because
  your allergens are your only alert choice." The push worker delivers
  nothing to a profile whose only signal is allergens it cannot see
  (`src/server/push/worker.ts` eligibility comment).
- **Links:** Consumer Health Data Policy and Privacy Policy.
- **Buttons:** "Use for alerts" and "Keep on this iPhone only".
  - For a user the age flow (§2) identified as under 18: the same two
    buttons, with "Keep on this iPhone only" listed first. This supports New
    York's informed-consent standard for minors.

**C. Personalization editor.** `src/components/settings/personalization-form.tsx`

- On save, if allergens go from none to some and no decision is recorded,
  sheet B is shown.
- If consent was declined earlier, a quiet row under the allergen grid
  reads "Allergens stay on this iPhone. Use them for alerts…" and opens
  sheet B. Lotly never re-asks on its own.

**D. Privacy & Data Controls.** `src/content/privacy-data-controls.ts` and
the document screen get a toggle: "Use my allergens for alerts". Off means
withdraw (§1.3); on opens sheet B.

**E. Notifications screen.** One line when consent is declined and
allergens exist: "Allergen-only matches don't send alerts while your
allergens stay on this iPhone."

**F. On-device behavior is unchanged in every case.** Affects Me, allergen
labels and the Ready board read local preferences (`preferences-store.ts`),
never the server.

### 1.2 Server behavior

This is a migration re-bodying `apply_installation_preferences` from its
latest definition (`20260921000000`). It needs both entry points, the
plural `set_installation_preferences` and the legacy singular one.

- **New columns** on `installation_preferences`: `allergen_consent_version
text` (null = none) and `allergen_consent_at timestamptz`.
- **New optional parameter** `p_allergen_consent text default null` on the
  plural RPC. The old signature is dropped and recreated with the default,
  so PostgREST keeps one candidate per name; this is the same pattern as
  `20261004000000`. The legacy singular RPC passes null.
- **Rule inside `apply_installation_preferences`:**
  - Consent null → store `allergens = '{}'`, and set the consent columns to
    null.
  - Consent equal to a known version (`'allergens-v1'`) → store the
    allergens. Set `allergen_consent_at = now()` when the version changes
    from null; otherwise keep it.
  - An unknown version → `raise exception`, a 4xx; the client treats it as
    a definite rejection.
  - Clearing allergens moves `updated_at`. That is the existing
    no-retroactive-blast horizon, and harmless.
- **Push matching** (`src/server/push/push-store.ts` reads `allergens`):
  the worker also reads `allergen_consent_version` and treats allergens as
  empty when it is null. This makes stored but unconsented allergens
  **inert at once without deleting anything** (§1.4). Add a test beside
  `worker.test.ts`.
- **Effective-definition test:** extend the
  `installation-deletion-effective.test.ts` style. A new test pins that the
  _latest_ `apply_installation_preferences` contains the consent rule, so a
  future re-body cannot drop it.

### 1.3 Withdrawal

- The toggle off, or clearing allergens, saves locally with consent
  `withdrawn`. The mirror sends `allergens = []` and consent null, and the
  server overwrites the row: **removed at once**.
  - That meets Connecticut's "as easy as" and 15-day rule.
  - It is Nevada's "cease collecting" plus deletion of that data.
- Local allergens stay on the device unless cleared.
- If the save fails (offline): the dirty flag and retry, as today. Until it
  lands the server still holds the old allergens, and the worker still
  honors the old consent. The withdrawal is persisted locally, and the
  status line shows "Not synced yet".

### 1.4 Existing stored allergens (not cleared now)

- **After deploy:** stored allergens with no consent version stay in the
  table but are **ignored** by the worker (§1.2). No production data is
  cleared.
- **Later:** a separate, explicitly authorized one-statement cleanup, with
  a dry-run count first: `update installation_preferences set allergens =
'{}' where allergen_consent_version is null and allergens <> '{}'`. It is
  proposed for after the consent build has been out long enough for active
  users to answer the sheet.
- **Until then:** the policy text must not say "only with consent" as an
  absolute. The drafts mark it `⟦PLANNED⟧`.

### 1.5 Older clients (builds without the consent sheet)

- Their saves send no consent parameter, so the server stores **no**
  allergens for them. Their allergen-only alerts stop.
- Their on-device matching is unaffected.
- Their saves still succeed: the new parameter has a default, and the old
  argument list resolves.
- **Who is affected:** today only TestFlight testers, since no public
  build exists. Record this in the release notes.

### 1.6 Device-local consent record

- Keychain key `recall.allergen-consent`:
  `{ decision: 'granted' | 'declined' | 'withdrawn', version, at }`.
- Cleared by "Reset app and delete my data". This is a new step in the
  reset orchestrator, so it will conflict textually with subscription's
  reset edit; it comes after that changeset merges.

---

## 2. Age assurance (Texas in force; Utah, Louisiana, California and Alabama dates in §6)

### 2.1 What Apple's current documentation says (verified)

**Texas.** Apple's news of 2026-06-03 says new Texas Apple Accounts are
subject to SB 2420 from 2026-06-04:

- "Developers can request age category data … through the Declared Age
  Range API."
- "For significant changes, developers should use the Significant Change
  API under the PermissionKit framework."
- "It's the developer's responsibility to determine when there's a
  significant change."
- An App Store **server notification** reports revoked consent.

**Age-assurance page:** "where legally required … you must check the age of
the people using your app." "Developers are responsible for their own age
restrictions."

**Expo SDK 57** ships `expo-age-range` (iOS 26.0+):

- `requestAgeRangeAsync`;
- `isEligibleForAgeFeaturesAsync` (iOS 26.2+);
- `getRequiredRegulatoryFeaturesAsync` (iOS 26.4+);
- `showSignificantUpdateAcknowledgmentAsync` (iOS 26.4+).

**Fail-open trap:** "When not supported (earlier than iOS 26 …), the call
returns `lowerBound: 18`, which is equivalent to the response of an adult
user."

### 2.2 Requests and categories

- **Request:** `requestAgeRangeAsync({ threshold1: 13, threshold2: 16,
threshold3: 18 })`. That gives four ranges matching the statutes'
  categories: under 13, 13–15, 16–17, 18+. Apple allows up to three gates,
  each range at least two years.
- **Preserve every returned category.** "The system may return age ranges
  that override the age gates you specify." So the app stores the **whole
  response** on the device in Keychain key `recall.age-range`, never sent
  anywhere:
  - `lowerBound`, `upperBound`;
  - `ageRangeDeclaration` (`selfDeclared`, `guardianDeclared` or
    `confirmed`);
  - `activeParentalControls`;
  - the regulatory flags, and the time.
- **Collapse only for decisions.** It collapses to a decision class only at
  the point of decision, never in storage. Classes:
  - `under13` (`upperBound` ≤ 12);
  - `minor` (`upperBound` ≤ 17);
  - `adult` (`lowerBound` ≥ 18);
  - `unknown`.
- **What Lotly never does:** ask for a birth date, compute an age, or send
  the category to its server, RevenueCat or Expo.

### 2.3 Required consent versus optional sharing

These are separate mechanisms:

| Mechanism                                              | Who provides it                                                                                                                                         | Lotly's role                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Age category in a regulated region**                 | Apple supplies it; "they can't decline sharing". `isEligibleForAgeFeatures` = true, or `requiredRegulatoryFeatures` contains `declaredAgeRangeRequired` | Must read it and act on it                |
| **Parental consent for download and in-app purchases** | Apple enforces it in the store                                                                                                                          | Nothing to build; Apple blocks without it |
| **Parental consent for significant changes**           | PermissionKit `SignificantAppUpdateTopic`, `AskCenter.ask` (iOS 26.2)                                                                                   | Must ask and gate the change (§2.5)       |
| **Revoked consent**                                    | Apple "will prevent the app from launching", and sends `RESCIND_CONSENT`                                                                                | Must "immediately restrict" access (§2.6) |
| **Optional age sharing outside regulated regions**     | User's choice; `.declinedSharing` possible                                                                                                              | Lotly's 13+ rule rests on the Terms       |

### 2.4 Decision table (first launch, before any data leaves the device)

**Order matters.** The age check runs **before** onboarding, **before**
push upkeep registers anything, and **before** the launch entitlement read
configures RevenueCat. RevenueCat would otherwise receive a purchase
identifier for a possible under-13 user. Implementation: the access gate
(`src/lib/access-gate.ts`) gains an `age` phase ahead of `onboarding`.

| Situation                                                              | Detection                                                                                   | Behavior                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS below 26.0 (API absent)                                            | Platform version check, done **before** calling; never trust the fail-open `lowerBound: 18` | **Decision for Willis** (§8): (a) raise the deployment target to iOS 26.2 (recommended, so every device can be checked), or (b) treat as `unknown`, proceed under the Terms, and log the residual risk |
| iOS 26.0–26.1 (no eligibility API)                                     | `isEligibleForAgeFeaturesAsync` unavailable                                                 | Request the range anyway. A sharing result is used. Declined or error → regulated status unknown → treated as regulated: the retry screen                                                              |
| Eligibility check fails (`notAvailable`, network)                      | Throws                                                                                      | "Lotly couldn't confirm your age settings" with **Try again**. No onboarding and no server calls until resolved                                                                                        |
| Regulated region, range returned                                       | Eligible = true                                                                             | Classify (below)                                                                                                                                                                                       |
| Regulated region, request errors                                       | Eligible = true, request throws                                                             | The same retry screen. **Never** proceed under the Terms                                                                                                                                               |
| Not regulated, `.declinedSharing` (Expo `ERR_AGE_RANGE_USER_DECLINED`) | Eligible = false                                                                            | Proceed; the 13+ rule rests on the Terms. Store "declined, not regulated" with a time; ask again only on a significant change                                                                          |
| Not regulated, range returned                                          | Eligible = false                                                                            | Classify (below)                                                                                                                                                                                       |
| `under13`                                                              | `upperBound` ≤ 12                                                                           | "Lotly is for ages 13 and up." Stop. No onboarding, no RevenueCat, no push. Clear local state, except the stored age response, which is kept so the screen persists on relaunch                        |
| `minor` (13–17)                                                        | `upperBound` ≤ 17                                                                           | Proceed. Set a local "teen handling" flag: the consent sheet lists refusal first; push stays recall-only; the significant-change gate applies (§2.5)                                                   |
| `adult`                                                                | `lowerBound` ≥ 18                                                                           | Proceed                                                                                                                                                                                                |

**Re-checks:** at each launch, a **cached** read. Apple returns the
previous range "until the anniversary", so this costs no prompt. Re-check
also after a significant change and after the app was blocked.

### 2.5 Significant updates

- **What counts.** A release checklist item (owner: Willis) decides whether
  a release changes any of:
  - the categories of personal data collected, stored or shared (for
    example turning on consent-gated allergen mirroring, or adding the
    age-range read itself for existing users);
  - monetization;
  - the age rating (`AppStore.ageRatingCode` changed);
  - material functionality.

  Each significant change gets a monotonically increasing
  `SIGNIFICANT_CHANGE_VERSION` constant.

- **On launch**, if the installed constant is greater than the last
  approved one:
  - **Minor, with `significantAppChangeRequiresParentalConsent`:** ask
    through PermissionKit (`AskCenter.shared.ask(PermissionQuestion(significantAppUpdateTopic:
SignificantAppUpdateTopic(description:)), in:)`). Gate the changed
    feature, or the app if the change is app-wide, until
    `responses(for:)` reports `.approval`. Apple: "Until the parent
    provides consent, the child must be prevented from accessing the
    significant update."
  - **Adult, with `significantAppChangeRequiresAdultNotification`:**
    `showSignificantUpdateAcknowledgmentAsync(description)`.
  - **Not regulated:** nothing.
- **Native work.** No Expo module wraps PermissionKit or
  `AppStore.ageRatingCode`. It needs a small **custom Expo module**
  (Swift, Expo Modules API) with:
  - `askSignificantChange(description)`;
  - an event stream from `AskCenter.shared.responses(for:)`;
  - `ageRatingCode()`.

  Each is guarded by `if #available(iOS 26.2, *)`.

### 2.6 Revoked consent

- **Apple's side:** Apple prevents the app from launching. The developer
  must also stop anything still flowing to the child, which for Lotly means
  **push alerts**.
- **Proposed path:**
  1. **Register the app transaction id.** At registration the app reads
     `AppTransaction.shared` and sends its `appTransactionId` with
     `register_push_subscription`. This is a new column, disclosed as a
     data element.
  2. **Receive notifications.** App Store Server Notifications V2 reach
     **RevenueCat**, which Apple allows as the single URL. RevenueCat's
     "Apple Server Notification Forwarding URL" forwards them to a
     **Supabase Edge Function**.
  3. **Act on revocation.** The function verifies the JWS signature chain
     and, on `RESCIND_CONSENT`, disables subscriptions whose
     `app_transaction_id` matches `signedAppTransactionInfo`.
- **Unverified:** whether RevenueCat forwards **non-subscription** types
  such as `RESCIND_CONSENT`. Its docs don't say; it must be tested in
  sandbox. Fallback: Apple's URL points to the Edge Function, which
  forwards everything else to RevenueCat. That is riskier for purchases.

### 2.7 Build requirements

- **Toolchain:** Xcode 26.2+ (iOS 26.2 SDK); Apple: "build … against the
  iOS 26.2 … SDKs, or later".
- **Entitlement:** `com.apple.developer.declared-age-range`, set through
  `app.json` → `expo.ios.entitlements`, and enabled as a capability on the
  App ID in the developer portal. The EAS build credentials must be
  regenerated so the provisioning profile carries it.
- **Packages:** `npx expo install expo-age-range`, plus the custom module
  (§2.5).
- **Server:** a Supabase Edge Function with Apple JWS verification, a secret
  for its URL token, and the RevenueCat forwarding setting.

---

## 3. Privacy-rights requests

**Principle.** The installation id is a bearer credential. It is never
shown, typed, emailed, or used as proof. The 12-month cleanup is a
retention rule, **not** a substitute for answering a request.

### 3.1 In-app routes (the request comes from the installation itself)

| Right                         | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Access / export**           | "Show what Lotly's server holds", via a new RPC `export_installation_data(p_installation_id)`. It returns this installation's rows: preferences with the consent record, push registration with the token masked, the delivery list (event dates and recall ids), the activity date, any shopper report. It also returns the fixed processor list (WA requires naming them with contact routes). **Share as file** writes JSON through the iOS share sheet | Planned                                               |
| **Correct**                   | Edit choices: Personalization and the toggle                                                                                                                                                                                                                                                                                                                                                                                                               | Built                                                 |
| **Delete**                    | "Reset app and delete my data"                                                                                                                                                                                                                                                                                                                                                                                                                             | Built (shopper reports via prepared `20261012000000`) |
| **Withdraw allergen consent** | Toggle (§1.3)                                                                                                                                                                                                                                                                                                                                                                                                                                              | Planned                                               |

### 3.2 The request code (for email requests, appeals, or help)

- **What it proves.** The code can be created only **from inside the
  installation**: the RPC requires the installation credential held in the
  device keychain. Presenting it shows that the requester controlled that
  installation's device when it was issued. This is the account-less
  pattern CCPA 11 CCR §7062 Example 2 describes ("information that only the
  person who used the mobile application may know"). WA, NV and CT require
  "commercially reasonable" authentication and say nothing about codes.
  That is a residual uncertainty.
- **What it authorizes.** By itself, nothing. It is a **reference** that
  lets the operator locate one installation for **one stated purpose**:
  `access` or `delete`, chosen in the app when the code is created. It
  cannot call any client RPC and grants no write ability. Correction is
  done in the app; by email the operator offers deletion or an export plus
  in-app correction.
- **How it is made.**
  - 12 characters from a 32-character alphabet (about 60 bits), generated
    by `gen_random_bytes` on the server.
  - The server stores only `sha256(code)`, the `installation_id`, the
    purpose, `created_at`, `expires_at` (created + 14 days) and `used_at`.
  - At most 3 live codes per installation; a new one revokes the oldest.
  - The plain code is shown once in the app, with a copy button.
- **Reuse prevention.** The operator CLI redeems with
  `update … set used_at = now() where code_hash = $1 and used_at is null
and expires_at > now() returning …`. That is atomic and single use; a
  second redemption finds nothing. Codes are deleted 30 days after use or
  expiry, and immediately by the reset or the inactivity purge. The table
  is installation-keyed, so the effective-deletion test forces
  `delete_installation_data` to cover it.
- **Safe operator handling.** `npm run privacy:request`:
  - Service role; `--dry-run` is the default. It prints the purpose, a
    masked installation id (first 4 characters) and row counts.
  - `--apply` runs the export or `delete_installation_data`.
  - The export is written to a local file, emailed in reply, and the file
    is deleted.
  - Codes never appear in logs or shell history: the code is read from a
    prompt, not an argument.
  - Each run appends to the request log: date, purpose, outcome, response
    date. It never includes the code or the installation id. Kept
    ⟦FOUNDER: 24 months proposed⟧.
- **Without a code.**
  1. **Reinstall first.** The installation id and choices live in the
     keychain, which survives deleting the app. Reinstalling Lotly on the
     same iPhone usually restores the same installation, and then every
     in-app route works. Say so in the reply.
  2. **If that fails** (new device, erased phone), no record can be tied to
     the requester with reasonable certainty: many installations share the
     same choices. Lotly answers in writing within the deadline, explains
     why it cannot authenticate, and names the appeal route. WA, NV and CT
     each allow declining when authentication by commercially reasonable
     means is not possible. The automatic deletion is mentioned as a fact,
     **not** offered as the answer.
- **Clocks.**
  - Respond within 45 days of receipt (WA, CT; NV counts from
    authentication); one 45-day extension with notice inside the first 45.
  - NV deletion within 30 days of authentication. The design deletes
    immediately; backups expire in 7 days, inside WA's 6 months and NV's 2
    years.
- **Appeals.** Reply "Appeal"; written answer within 45 days. A denial
  names the attorney-general contact routes (WA, NV, CT).
- **Processors on deletion.**
  - Supabase: it is our database, so deletion is direct.
  - Expo: it holds push tokens, and no deletion API was found. Disclosed.
  - RevenueCat: the purchase id is not health data; on a deletion request
    covering it, the operator deletes the customer through RevenueCat's
    `DELETE /v1/subscribers/{app_user_id}` ("Permanently deletes a
    customer").

---

## 4. Breach response (corrected)

**What changed from rev. 1.** Website and in-app posting are **not**
sufficient on their own.

- Under the FTC HBNR, substitute notice is **either** a 90-day home-page
  posting **or** major print or broadcast media. **Both** alternatives
  require "a toll-free phone number, which shall remain active for at least
  90 days." In-app messaging counts only "in combination with" email.
- State substitute notice (WA, NY, CA, CO, CT) generally requires **all**
  of: email if held, a website posting, and major statewide media.
  Exceptions:
  - Texas's list is disjunctive;
  - Florida requires a website plus print and broadcast media;
  - California's posting must stay up at least 30 days.
- Push and in-app messages are a supplement under every text reviewed,
  never a substitute.

| Regime                | Direct notice                                                | Lotly can give direct notice? | Substitute trigger                                | Substitute components                                  | Toll-free             |
| --------------------- | ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------- | ------------------------------------------------------ | --------------------- |
| FTC HBNR (if covered) | Written to last known address; email if specified as primary | No (no addresses)             | Contact information insufficient for 10 or more   | 90-day home-page posting **or** major media            | **Required, 90 days** |
| Texas 521.053         | Written; E-SIGN electronic                                   | No                            | Insufficient contact information                  | Email if held; website posting; **or** statewide media | No                    |
| New York 899-aa       | Written; electronic with consent; telephone                  | No                            | Shown to the AG: insufficient contact information | Email; website posting; statewide media (all)          | No                    |
| Washington 19.255     | Written; E-SIGN                                              | No                            | Insufficient contact information                  | Email if held; website posting; statewide media        | No                    |
| California 1798.82    | Written; E-SIGN                                              | No                            | Insufficient contact information                  | Email; website posting ≥ 30 days; statewide media      | No                    |
| Florida 501.171       | Mail or email on file                                        | No                            | No email or mailing address                       | Website **and** print and broadcast media              | No                    |
| Colorado, Connecticut | Written, telephone, electronic                               | No                            | Insufficient contact information                  | Email if held; website; statewide media                | No                    |

**Most state statutes need a name to be triggered at all.** Texas and New
York can be triggered by an identifier plus health information.

**When a toll-free line is needed.** Only if the FTC HBNR applies, which
turns on whether Lotly is a "vendor of personal health records" (§6), and
substitute notice is used. Substitute notice is effectively certain for
Lotly. Pre-arranging a number is a decision for Willis (§8); otherwise
procure it on day 1 of an HBNR-covered incident.

### Procedure

1. **Hour 0.** Record the discovery date ("known or reasonably should have
   been known"). Contain: rotate the Supabase secret key, revoke tokens,
   close access. **Export logs at once**: Supabase keeps 7 days.
2. **Day 1–5: scope.** Which tables, how many installations, which states
   are likely (from chosen states), and what links installations to people
   (IP logs, Gmail threads). Decide HBNR coverage and each state's trigger,
   in writing. Florida "no harm" determinations are kept 5 years.
3. **Notices.** Calendar every clock:
   - Washington, New York, Florida, Colorado: 30 days. California: 30 days
     [secondary].
   - Connecticut, Texas, HBNR: 60 days.
   - Texas AG: 30 days if 250 or more residents.
   - FTC: at the same time if 500 or more; otherwise the annual log.
   - Media: 500 or more in one state (HBNR).

   Substitute notice: the website posting (≥ 90 days to cover HBNR; ≥ 30 for
   California) **plus** statewide media where required, **plus** the
   toll-free number if HBNR applies. Add an in-app banner and a push as a
   supplement only.

4. **Content** (HBNR §318.6 and the state lists): what happened, with dates;
   the data involved; steps people can take (reset the app, withdraw
   allergen consent); what Lotly is doing; two or more contact channels.
5. **After.** Fix the cause, write a post-incident note, keep records.

---

## 5. Individual operator and LLC: not an exemption

- **Implementation requirements do not depend on the entity form.**
  - Nevada's "regulated entity" is "any **person**", and Nevada's definition
    includes natural persons.
  - Connecticut's consumer-health-data rules (§42-526) apply to "persons",
    and its "person" includes "an individual".
  - Texas's app-store law applies to "developers" and the HBNR to
    "entities", neither excluding individuals.
  - Washington's "any legal entity" is the only open reading. This plan
    **does not assume** it excludes an individual; it builds as if covered.
- **Separate entity and liability considerations** (Willis's choice; not
  part of the launch plan):
  - **Liability shielding.** An LLC's protection, and its formation costs.
  - **Publishing a custom EULA.** It would need a postal address and phone
    number (Exhibit D).
  - **Washington's "legal entity".** An LLC is plainly one.

---

## 6. Dates (verified on primary sources unless marked)

| Law                                                            | Date                                                                                                         | Status                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Texas SB 2420 (app store)                                      | Act 2026-01-01; in force for new Texas Apple Accounts from 2026-06-04 (Apple)                                | Enforceable; SCOTUS denied vacatur of the stay 2026-07-06 (25A1390); Fifth Circuit merits appeal pending                                  |
| Utah 13-76 (app store), as amended by HB 498 (2026)            | Developer duties **2027-05-06**                                                                              | Enacted. Apple's February 2026 news still showed 2026-05-06 for new Utah accounts: the store side may start earlier than developer duties |
| Louisiana Act 185 (HB 977, 2026), replacing Act 481            | **2027-07-01**; Act 481 "shall not become effective"                                                         | Enacted; signed 2026-05-15                                                                                                                |
| California Civ. Code §1798.500 et seq. (AB 1043, Ch. 675/2025) | **2027-01-01**; apps downloaded earlier must request a signal before 2027-07-01 [secondary: leginfo blocked] | Enacted; amended by AB 1856 [secondary]                                                                                                   |
| Alabama HB 161 (app store, 2026)                               | **2027-01-01**                                                                                               | Enacted; signing date [secondary]                                                                                                         |
| COPPA amendments                                               | Effective 2025-06-23; compliance 2026-04-22                                                                  | In force                                                                                                                                  |
| Connecticut CTDPA amendments (PA 25-113)                       | 2026-07-01 (sensitive-data trigger, minors)                                                                  | In force                                                                                                                                  |
| Delaware threshold change (HB 380)                             | 2027-01-01: 10,000 consumers, or 5,000 plus >20% of revenue from sales                                       | Enacted                                                                                                                                   |
| Oklahoma SB 546                                                | 2027-01-01                                                                                                   | Enacted                                                                                                                                   |
| Louisiana Act 502 (privacy)                                    | 2027-01-01                                                                                                   | Enacted                                                                                                                                   |
| Alabama HB 351 (privacy)                                       | 2027-05-01                                                                                                   | Enacted                                                                                                                                   |
| Vermont Act 145                                                | 2028-01-01                                                                                                   | Enacted                                                                                                                                   |
| Indiana, Kentucky, Rhode Island                                | 2026-01-01                                                                                                   | In force (thresholds not met)                                                                                                             |
| New York S9269 (health information)                            | Passed both houses; not delivered or signed                                                                  | Watch                                                                                                                                     |

---

## 7. Ordered launch plan

### Already implemented

1. **No accounts and no bearer exposure.** A random installation id is held
   only in the keychain.
2. **On-device matching** (Affects Me, allergen labels); search stays on the
   device.
3. **Correction and deletion in the app:** edit choices; "Reset app and
   delete my data".
4. **No ads, analytics, tracking or sale.** Pinned by tests.
5. **A static website** with no cookies or scripts. Re-check after deploy.

### Prepared and reviewed (commit, then apply in the stated order)

6. **The reset correction** (`aa64b1c`): apply `20261012000000`.
7. **Subscription continuity** (separate purchase id, upgrade adoption):
   ship in the next build. Device sandbox test (§5.2 of the paywall doc).
8. **Inactivity retention:** apply `20261013000000`, then dry run, then
   switch on with the grace date, then the build, then publish, then
   re-anchor the grace date (`docs/recall-operations.md`).

### Necessary remaining implementation before launch

9. **Age assurance (Texas, in force):**
   - `expo-age-range` with the §2.4 decision table, ordered before
     RevenueCat and push;
   - the deployment-target decision;
   - the significant-change gate, with a custom module for PermissionKit
     and `ageRatingCode`;
   - revocation handling: app transaction id at registration, RevenueCat
     forwarding, an Edge Function;
   - the entitlement and a provisioning-profile refresh.
10. **Allergen consent** (§1): screens A–E, the consent columns, the RPC
    re-body with the default parameter, worker gating, and the local
    record cleared on reset. Required **before** any text says "only with
    consent".
11. **Rights requests** (§3): the in-app export view and RPC, the request
    code (RPC, table, single-use redemption) and the operator CLI. Needed
    for the 45-day clocks from the first request.
12. **Links to the Consumer Health Data Policy:** in the app (trust center
    and consent sheet), the App Store description, and a website page.
13. **Documents:** this breach procedure, and a Connecticut/Colorado data
    protection assessment (teens permitted).

### Optional safeguards

14. **A pre-arranged toll-free number**, only if HBNR coverage is accepted.
15. **The later cleanup of unconsented allergens** (§1.4), as a separate
    authorized step.
16. **An advisory lock in the app's writer RPCs**, closing the inactivity
    purge's insert race.
17. **A quarterly watch-list review.**

### Unresolved interpretations (accepted as residual uncertainty, not gates)

18. Whether an allergen watchlist "for you or anyone you shop or cook for"
    is health data at all. NV excludes "shopping habits or interests".
19. Whether Washington's "legal entity" reaches an individual. Built as if
    it does.
20. Whether Nevada treats hosting processors as "sharing". There is no
    processor carve-out; consent covers them.
21. Whether Lotly is an HBNR "vendor of personal health records". The FTC's
    food examples cut against coverage.
22. Whether in-app request codes are "commercially reasonable"
    authentication. CCPA Example 2 is the closest support.
23. Whether choosing not to query age outside regulated regions is
    "willful disregard" (Colorado, Connecticut). The plan queries
    everyone.
24. Whether RevenueCat forwards `RESCIND_CONSENT`. Test in sandbox.
25. The outcome of the Texas SB 2420 merits appeal. California AB 1043 and
    AB 1856 text are unverified on the primary source.

## 8. Decisions for Willis

1. **Allergen consent:** approve §1, the copy and the later cleanup policy.
2. **Deployment target:** iOS 26.2 (recommended), or allow older iOS
   versions with a documented residual risk.
3. **Significant changes:** the owner of the significant-change checklist,
   and whether first adding the age read is itself a significant change
   for existing installs.
4. **Request handling:** the request-code parameters (14-day expiry, single
   use, purposes) and the retention of the request log and support email.
5. **Toll-free number:** pre-arranged, or procured at incident time.
6. **Entity form:** LLC or not, as a liability decision, separate from
   implementation.
