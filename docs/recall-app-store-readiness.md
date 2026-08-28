# App Store privacy worksheet & readiness checklist (C7 — DRAFT)

Status: **draft prepared 2026-08-28 from the C7 code audit
(`recall-data-flow-audit.md`). Nothing here has been entered into App Store
Connect, and several answers are explicitly marked as requiring a founder or
legal decision. This worksheet maps verified behavior to Apple's current
questionnaire; it is not a submission.**

Requirement classes used below:

- **[REQUIRED]** — a formal Apple platform requirement.
- **[RECOMMENDED]** — strong Apple or industry recommendation, not a hard gate.
- **[LEGAL]** — a question for qualified counsel, not decidable here.
- **[FOUNDER]** — a missing founder input or decision.

## 1. Apple privacy questionnaire mapping (App Privacy "nutrition label")

Apple's definitions (developer.apple.com/app-store/app-privacy-details/,
checked 2026-08-28): "collect" = transmitted off-device and retained beyond
servicing the request; "linked" = connected to identity via account, device,
or other identifying details; "tracking" = linking with third-party data for
advertising/measurement or sharing with data brokers.

| Apple data type                  | Collected?                                                                                                                  | Linked to identity?                                         | Tracking? | Purpose                                                               | Evidence                                                      | Confidence / open decision                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health (Health & Fitness)        | **Undecided — likely "yes" under a conservative reading** for allergen selections (server-synced, keyed by installation id) | If disclosed: linked (keyed to the installation identifier) | No        | App functionality (personalized recall relevance + alert eligibility) | `installation_preferences.allergens`; `preferences-store.ts`  | **[LEGAL]+[FOUNDER]** — see §2. Apple's Health type includes "any other user-provided health or medical data"; an allergen watchlist that may cover household members is a boundary case. Do not answer in App Store Connect until resolved. |
| Identifiers → Device ID          | Yes (installation UUID; push token when alerts enabled)                                                                     | Yes (it is the key)                                         | No        | App functionality (own-row bearer capability; alert delivery)         | `installation-id.ts`, `push_subscriptions`                    | High. A random per-install UUID is best disclosed as a device-level identifier; confirm final wording at submission.                                                                                                                         |
| Location → Coarse Location       | **Undecided.** The user manually picks a home state; no location services are used                                          | If disclosed: linked (stored with installation id)          | No        | App functionality (geographic relevance)                              | `installation_preferences.state_code`                         | **[FOUNDER]** with counsel input: Apple's coarse-location definition does not require GPS; many reviewers treat a user-typed region as location data. Conservative answer: disclose.                                                         |
| Usage Data → Product Interaction | No                                                                                                                          | —                                                           | —         | —                                                                     | No analytics SDK; no interaction events stored (audit §1, §2) | High — pinned by tests (dependency-lock scan).                                                                                                                                                                                               |
| Diagnostics → Crash/Performance  | No                                                                                                                          | —                                                           | —         | —                                                                     | No crash/perf SDK in dependency lock                          | High — pinned by tests.                                                                                                                                                                                                                      |
| Contact Info (all)               | No                                                                                                                          | —                                                           | —         | —                                                                     | No fields exist                                               | High. Note: a future support email flow would change this.                                                                                                                                                                                   |
| User Content                     | No                                                                                                                          | —                                                           | —         | —                                                                     | Search runs on-device; share sheet is OS-mediated             | High.                                                                                                                                                                                                                                        |
| Browsing/Search History          | No                                                                                                                          | —                                                           | —         | —                                                                     | `feed-search.ts` never queries a service                      | High.                                                                                                                                                                                                                                        |
| Purchases / Financial            | No                                                                                                                          | —                                                           | —         | —                                                                     | No purchase surface                                           | High.                                                                                                                                                                                                                                        |
| Sensitive Info                   | No direct collection                                                                                                        | —                                                           | —         | —                                                                     | —                                                             | See §2: allergen data may be _health_; it is not Apple's "Sensitive Info" category (race, orientation, etc.).                                                                                                                                |
| Surroundings / Body / Other      | No                                                                                                                          | —                                                           | —         | —                                                                     | —                                                             | High.                                                                                                                                                                                                                                        |

**Tracking section: "No, we do not track."** Supported by: no third-party
ad/analytics SDK, no data broker sharing, all manifests `NSPrivacyTracking =
false`, zero tracking domains in the exported bundles.

## 2. Health-data analysis — a legal-review question, not a conclusion

Facts (verified): allergen selections are user-chosen tokens from a closed
nine-item list, labeled "Select any allergens relevant to you or anyone you
shop or cook for"; they are stored on-device and mirrored server-side keyed
by a random installation id; they gate which safety notices are surfaced and
delivered. No symptom, severity, medical-record, or per-person data exists;
there are no accounts or household member profiles.

Questions for counsel **[LEGAL]**:

1. **Apple Health type.** Does a shopping-oriented allergen watchlist
   constitute "user-provided health or medical data" for the App Privacy
   label and privacy manifest, given the household framing (a selection does
   not assert that the _user_ has an allergy)? Conservative path: disclose as
   Health, linked, not tracking.
2. **FTC Health Breach Notification Rule (as amended eff. 2024-07-29).** The
   amended rule covers vendors of "personal health records" — products with
   the _technical capacity to draw PHR identifiable health information from
   multiple sources_ — and PHR-related entities, explicitly including many
   consumer health apps. Is Recall a vendor of a PHR because it holds
   installation-keyed allergen preferences alongside other inputs (state,
   retailers)? If covered, an unauthorized disclosure of the preference
   mirror could be a reportable "breach of security." This requires a formal
   applicability determination and, if covered, an incident-response plan.
3. **State privacy laws.** Consumer-health-data statutes (e.g. Washington My
   Health My Data, and similar laws) may treat allergen data as consumer
   health data with consent and deletion-right obligations regardless of the
   federal analysis.
4. **Data minimization alternative.** If counsel advises avoiding the health
   classification entirely, the technical alternative is keeping allergen
   matching purely on-device and removing allergens from the server mirror —
   a product/architecture decision with a delivery-eligibility cost (server
   push filtering by allergen would end); the founder would need to choose.

## 3. App Store readiness checklist

| Item                                                       | Class                    | Status                   | Notes                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privacy Policy URL (App Store Connect metadata)            | [REQUIRED]               | **Blocked**              | Guideline 5.1.1(i): required for all apps, in metadata and in-app. Draft exists (`recall-privacy-policy-draft.md`); blocked on founder inputs + counsel (`recall-launch-blockers.md`). No URL exists — do not invent one.                                                                                          |
| Privacy policy accessible in-app                           | [REQUIRED]               | **Blocked**              | Ships as a trust-center document only after the policy is finalized; unfinished policy is deliberately not exposed (test-enforced).                                                                                                                                                                                |
| Support URL                                                | [REQUIRED]               | **Blocked**              | App Store Connect requires a support URL; guideline 1.5 requires an easy way to contact the developer. No real destination exists yet [FOUNDER].                                                                                                                                                                   |
| App Privacy answers                                        | [REQUIRED]               | **Draft** (§1)           | Health/coarse-location rows blocked on §2 decisions.                                                                                                                                                                                                                                                               |
| Privacy manifests (SDK)                                    | [REQUIRED]               | **Done**                 | All bundled manifests present with approved reason codes; no Apple-listed SDK in the graph (audit §5).                                                                                                                                                                                                             |
| Privacy manifest (app-level `NSPrivacyCollectedDataTypes`) | [REQUIRED]               | **Pending**              | Must be populated to match the final §1 answers at build time (Expo config plugin / EAS). Do after §2 resolves.                                                                                                                                                                                                    |
| Required-reason APIs                                       | [REQUIRED]               | **Done**                 | Only dependency-declared categories (file timestamp, user defaults, disk space) with approved codes; no first-party required-reason API use.                                                                                                                                                                       |
| Account deletion (5.1.1(v))                                | [REQUIRED if applicable] | **Not applicable today** | Requirement triggers only for apps supporting account creation; Recall has none. Revisit immediately if accounts ever ship.                                                                                                                                                                                        |
| Age rating questionnaire                                   | [REQUIRED]               | **Pending [FOUNDER]**    | Expect low rating; answer the medical/treatment-information item consistently with the informational-app position.                                                                                                                                                                                                 |
| Medical-device / regulated-app position (guideline 1.4)    | [LEGAL]+[FOUNDER]        | **Pending**              | Recall provides recall information and never measures, diagnoses, or doses; the safety disclaimer says so. Counsel should confirm no FDA device claim arises and review 5.1.1(ix) (apps in highly regulated fields should be submitted by a legal entity, not an individual — interacts with the entity decision). |
| Export compliance                                          | [REQUIRED]               | **Pending (mechanical)** | App uses only OS/HTTPS (exempt) encryption. Set `ITSAppUsesNonExemptEncryption=false` in `app.json` → `ios.infoPlist` at release prep (deliberately not added in C7).                                                                                                                                              |
| EULA / Terms                                               | [FOUNDER]+[LEGAL]        | **Pending**              | Apple's standard EULA is generally sufficient for a free, accountless app; custom Terms drafting deferred (see `recall-launch-blockers.md` §4). Never claim legal review that has not occurred.                                                                                                                    |
| Subscriptions                                              | Future-only              | **N/A**                  | No purchases/subscriptions exist; all related requirements (3.1.x) are explicitly future-scope.                                                                                                                                                                                                                    |
| Government-source presentation                             | [RECOMMENDED]            | **Done**                 | The app states non-affiliation (Safety Disclaimer) and links every notice to its official source; avoids any implication of agency endorsement (4.1 impersonation risk).                                                                                                                                           |
| Push notifications (2.5.4 / 4.5.4)                         | [REQUIRED]               | **Done by design**       | Push is opt-in via an explicit control, safety-relevant only, no marketing; permission prompt only from the user's action.                                                                                                                                                                                         |
| Data collected matches label at review                     | [REQUIRED]               | **Pending**              | Re-verify §1 against the shipped build during submission prep; the dependency-lock test keeps the "no tracking" row honest.                                                                                                                                                                                        |

## 4. Withheld on purpose

- No App Store Connect record was created or modified in C7.
- No privacy-label answers were entered anywhere.
- No claim of "App Store ready" is made: the blockers above (privacy policy,
  support URL, health-data decision, entity/legal review) are unresolved.
