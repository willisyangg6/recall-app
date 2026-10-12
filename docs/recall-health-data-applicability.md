# Consumer health-data and privacy-law applicability review

**Prepared 2026-10-12 — research, not legal advice, and not a compliance
conclusion.**

- **Purpose.** Give a qualified lawyer the verified facts and the primary
  statutory text, so the open questions can be decided quickly.
- **Sources.** Every quote below comes from the official source named, read
  2026-10-12. Two exceptions:
  - CalOPPA text is from the official 2013 bill (leginfo blocked automated
    access).
  - GDPR text is from gdpr-info.eu.
- **Full research notes:** `~/Desktop/Lotly-Privacy-Correctness-Review/`.
- **Laws not reviewed:** Colorado, Oregon, Maryland, Montana, Minnesota,
  Rhode Island and other lower-threshold state laws. This review does not
  cover them.

> **Second pass, 2026-10-12 — read first.** Willis is not engaging counsel
> at this stage. The "lawyer" questions in §6 now stand as **residual
> uncertainties for the founder to accept or resolve**; none is a workflow
> gate. A wider primary-source pass found the following:
>
> - **Connecticut, from 2026-07-01:** the whole CTDPA applies to anyone
>   processing "sensitive data", with no volume threshold.
> - **Nevada:** "person" includes natural persons, so an individual operator
>   is covered.
> - **New York's Health Information Privacy Act:** vetoed on 2025-12-19. A
>   new bill, S9269, has passed both houses but is not signed.
> - **Texas SB 2420 (app-store age law):** in force for new Texas accounts
>   from 2026-06-04.
> - **Minors' laws:** Colorado, Connecticut and New York apply on actual
>   knowledge that a user is under 18.
> - **State thresholds and dates:** the full table is in the research notes;
>   the dates are verified in
>   [recall-privacy-program-proposal.md](recall-privacy-program-proposal.md)
>   §6.
> - **Entity form:** being an individual operator is **not** treated as an
>   exemption (proposal §5).
>
> The concrete design responding to all of this is that proposal.

## 1. The verified facts (in code)

| Fact                                                                                                                                                                                                                                      | Where it is verified                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| No accounts. Server rows are keyed by a random installation UUID. A separate random purchase UUID goes only to RevenueCat.                                                                                                                | `src/lib/installation-id.ts`; `src/lib/purchases/purchase-identity.ts` |
| The user picks any of 9 allergens: peanuts, tree nuts, milk, egg, wheat, soy, sesame, fish and crustacean shellfish. The app's explanation says "Select any that are relevant to you or anyone you shop or cook for".                     | `src/content/how-affects-me-works.ts:40`; `src/domain/preferences.ts`  |
| Allergens, states and stores are stored on the device **and** mirrored to Supabase on every save, alerts on or off. They are used to decide which push alerts to send. The founder decided to keep allergen matching and allergen alerts. | `src/lib/preferences-store.ts`                                         |
| No ads, no analytics, no sale, no tracking. Recipients are processors only: Supabase, RevenueCat, Expo, Apple.                                                                                                                            | `package.json`; the privacy-manifest audit                             |
| Deletion: the in-app reset is immediate (one transaction). An automatic purge runs after 12 months without use. **No email-based deletion tool exists.** Uninstalling is not a deletion request.                                          | `20261012000000`, `20261013000000` (prepared, not applied)             |
| Backups: Supabase Free keeps none; Pro keeps 7 days of daily backups. It is not stated whether deleted rows persist in a backup until it expires.                                                                                         | supabase.com/docs/guides/platform/backups                              |
| Operator: Willis Yang, personally (no entity). Distribution: US App Store, iPhone only. Small user count at launch.                                                                                                                       | Founder confirmation, 2026-10-12                                       |

## 2. Per-law map

| Law                                                     | Applies?                                       | Why                                                                                                                                                                           | Threshold                                                                      | If it applies, it requires                                                                                                                                                                                                                                                            | Confidence  |
| ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **WA My Health My Data Act**, RCW 19.373                | Plausibly                                      | No numeric threshold. The UUID is "personal information". An allergy is arguably a "health condition", or an inference about one.                                             | None ("small business" only delays the dates)                                  | Consent, or the "necessary" exception; separate consent to share; a separate CHD privacy policy linked from the "homepage" (App Store page plus in-app); deletion within 45 days, including backups (≤ 6 months), with processors notified; enforced by the AG **and private action** | Medium      |
| **NV SB 370**, NRS 603A.400+                            | Uncertain                                      | Narrower: data the entity "uses to identify" health status. Excludes shopping interests not used that way.                                                                    | None ("any person")                                                            | Consent, or "necessary"; a conspicuous policy link; deletion within 30 days; AG enforcement only                                                                                                                                                                                      | Medium-low  |
| **CT CTDPA**, consumer health data (CGS 42-515 et seq.) | Likely for the consumer-health-data provisions | 42-526(a)(2) applies them "to persons that conduct business in this state", regardless of thresholds. Since 2026-07-01, 42-516(2) reaches anyone processing "sensitive data". | None for consumer health data                                                  | **Consent** for sensitive data (cannot be bundled into terms); revocation "at least as easy" as giving consent, honored within 15 days; processor contracts; AG enforcement                                                                                                           | Medium      |
| **CCPA/CPRA**                                           | Likely no                                      | Covers a sole proprietorship only if it meets a threshold.                                                                                                                    | $25M (CPI-adjusted), 100k consumers, or 50% of revenue from selling or sharing | n/a                                                                                                                                                                                                                                                                                   | High        |
| **CalOPPA**, B&P 22575                                  | Uncertain; safest to treat as applying         | Its PII list names no UUID or IP.                                                                                                                                             | Any operator collecting PII from California residents                          | A conspicuous policy with categories, review process, change notice, effective date and a Do Not Track statement                                                                                                                                                                      | Medium      |
| **TX TDPSA / NE**, small-business carve-out             | Mostly no                                      | SBA small businesses are exempt except from the sensitive-data-sale rule.                                                                                                     | SBA size                                                                       | No **sale** of sensitive data without consent. Lotly sells nothing.                                                                                                                                                                                                                   | Medium-high |
| **VA CDPA**                                             | No                                             | Thresholds not met.                                                                                                                                                           | 100k consumers, or 25k + 50% revenue                                           | n/a                                                                                                                                                                                                                                                                                   | High        |
| **FTC Health Breach Notification Rule**, 16 CFR 318     | Uncertain                                      | Turns on whether Lotly is a "health-related … tool" and "more than tangentially" health-related, and on "multiple sources".                                                   | None                                                                           | Breach notices within 60 days (FTC as well if 500+ people); an unauthorized disclosure counts as a breach                                                                                                                                                                             | Low-medium  |
| **FTC Act §5**                                          | Yes                                            | Applies generally.                                                                                                                                                            | None                                                                           | Privacy promises must match practice                                                                                                                                                                                                                                                  | High        |
| **COPPA**, 16 CFR 312                                   | Likely no                                      | General-audience app; applies on actual knowledge of a child user.                                                                                                            | None                                                                           | Do not knowingly collect from under-13s                                                                                                                                                                                                                                               | Medium-high |
| **GDPR / UK GDPR**, Art. 3(2)                           | Likely no if US-only                           | Nothing indicates the app "envisages" EU users.                                                                                                                               | —                                                                              | n/a                                                                                                                                                                                                                                                                                   | Medium      |

## 3. Key statutory text

### Washington (app.leg.wa.gov, RCW 19.373)

- **Consumer health data:** "personal information that is linked or
  reasonably linkable to a consumer and that identifies the consumer's past,
  present, or future physical or mental health status". The list includes:
  - "(i) Individual health conditions…";
  - "(xiii) Any information … derived or extrapolated from nonhealth
    information (such as proxy, derivative, inferred, or emergent data…)".
- **Personal information** includes "data associated with a persistent
  unique identifier, such as … a device identifier".
- **Regulated entity:** "any legal entity that: (a) Conducts business in
  Washington, or produces or provides products or services that are
  targeted to consumers in Washington…"
- **Collection** (.030(1)(a)): "(i) With consent… for a specified purpose; or
  (ii) To the extent necessary to provide a product or service that the
  consumer … has requested".
- **Consent:** "a clear affirmative act … freely given, specific, informed,
  opt-in, voluntary, and unambiguous". It "may not be obtained by …
  acceptance of a general or broad terms of use agreement".
- **"Homepage"**, for an app: "the application's platform page or download
  page, and a link within the application".
- **Deletion** (.040): includes "archived or backup systems". Backup
  deletion may be delayed, but "may not exceed six months". Requests are
  answered within 45 days.

### Nevada (leg.state.nv.us, NRS 603A)

- **Consumer health data:** "personally identifiable information … that a
  regulated entity **uses to identify** the past, present or future health
  status".
- **Exclusion:** "Does not include information that is used to … (b)
  Identify the shopping habits or interests of a consumer, if that
  information is not used to identify the specific past, present or future
  health status".

### Connecticut (cga.ct.gov, 2026 Supplement)

- **42-526(a)(2):** the consumer-health-data provisions "apply to persons
  that conduct business in this state and persons that produce products or
  services that are targeted to residents of this state".
- **Consumer health data:** "any personal data that a controller uses to
  identify a consumer's physical or mental health condition, diagnosis or
  status".
- **Revocation** must be "at least as easy as the mechanism by which the
  consumer provided the consumer's consent", honored "not later than fifteen
  days" after a request.

### FTC Health Breach Notification Rule (eCFR 16 CFR 318.2; 89 FR 47028)

- **Personal health record:** "an electronic record of PHR identifiable
  health information … that has the technical capacity to draw information
  from multiple sources".
- **Covered services** include "any online service such as a … mobile
  application … that provides … other health-related services or tools".
- **Limiting principle:** an offering must relate "more than tangentially to
  health". A general food retailer's app is "only tangentially related to
  health."

### FTC business guidance

- "anything that conveys information or enables an inference about a
  consumer's health" is health information.

## 4. Where the allergen watchlist is genuinely uncertain

1. **Whose status?** The picker covers "anyone you shop or cook for". WA
   requires data identifying "**the consumer's**" health status. A selection
   does not assert that the user has an allergy, but WA (xiii), NV and the
   FTC also reach inferences.
2. **"Uses to identify"** (NV, CT). Lotly matches allergens to recalls.
   Whether that is using them "to identify" health status is open.
3. **The "necessary" exception** (WA, NV). Allergen alerts are a feature
   the user requested, so collection plausibly fits. CT's sensitive-data
   rule has **no** such exception: it requires consent.
4. **Supabase as processor.** WA's "share" excludes disclosure "to a
   processor … consistent with the purpose". Processor terms need
   confirming: Supabase's DPA is in its terms.

## 5. How the current implementation lines up (facts, not conclusions)

| Requirement, if it applies                                                            | Today                                                                                                                      | Gap                                              |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Consent before collection, separate from terms (CT; WA/NV unless "necessary")         | Choosing allergens is an explicit, optional act in onboarding and settings, but there is **no separate consent statement** | Possible gap; see product options below          |
| Withdrawal "as easy as" giving it (CT), stopping within 15 days                       | Clearing allergens syncs the empty list at once. The reset deletes all server data at once.                                | Plausibly met, mechanically; counsel to confirm  |
| Separate CHD policy linked from the App Store page and in-app (WA)                    | None; one general Privacy Policy                                                                                           | Gap, if WA applies                               |
| Deletion on request in 45 days (WA) or 30 days (NV), including processors and backups | The in-app reset is immediate (backups expire in ≤ 7 days on Pro). **No way to act on an emailed request.**                | Gap for requests from users who have uninstalled |
| No sale of sensitive data without consent (TX, NE)                                    | No sale                                                                                                                    | Met                                              |
| Breach response (HBNR, if covered; state breach laws)                                 | No written plan                                                                                                            | Gap                                              |

**Product options if counsel says consent is required.** Each is a founder
decision; none is built.

- **(a) An explicit opt-in** on the Allergens step, stating purpose,
  recipients and how to withdraw, before any allergen is mirrored to the
  server. Allergens stay usable on-device without it, but allergen alerts
  need it.
- **(b) Show the installation identifier** in Privacy & Data Controls, so an
  emailed deletion request can be matched. This needs a small ops tool to
  run `delete_installation_data` for a quoted id.
- **(c) Keep allergens on-device only.** This **ends allergen-based alerts**,
  which the founder rejected on 2026-10-12. Listed only for completeness.

## 6. Residual uncertainties (counsel optional; founder accepts or resolves)

1. Is an allergen watchlist framed "for you or anyone you shop or cook for"
   consumer health data under WA, NV and CT, or sensitive data under CT and
   TX?
2. Is an individual operating personally a WA "regulated entity" ("any
   legal entity")?
3. Can Lotly rely on WA/NV's "necessary to provide a requested service"
   exception? Does CT nonetheless require separate consent, and in what
   form?
4. What does CT 42-516(2) reach, given the 2026-07-01 amendments, for an
   out-of-state individual?
5. Does a separate WA Consumer Health Data Privacy Policy have to exist?
   (The WA AG says it "may not contain additional information not required"
   by the Act.)
6. Is Lotly a "vendor of personal health records" under the HBNR?
7. Does CalOPPA apply (is a UUID or push token PII)? Confirm the current
   CPI-adjusted CCPA threshold.
8. What is the COPPA posture and minimum-age wording for a general-audience
   app?
9. Does limiting distribution to the US App Store keep GDPR/UK GDPR out of
   scope?
10. Do the immediate in-app reset, the 12-month purge and 7-day backups
    satisfy WA's 45-day and NV's 30-day deletion duties? Is an email-request
    path (option b) required?
11. What breach-response plan is needed, and under which laws?
12. Applicability of the state laws this review did not fetch (§ intro).

This review does not conclude that Lotly complies with any law. Detailed
policy text is not evidence of compliance.
