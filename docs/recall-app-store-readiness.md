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

Re-checked against current official Apple documentation on 2026-10-10
(developer.apple.com/app-store/app-privacy-details/;
developer.apple.com/documentation/bundleresources/privacy-manifest-files;
…/describing-data-use-in-privacy-manifests; App Store Review Guidelines
5.1.1; Developer Program License Agreement Schedule 2 §3.8(b)), with Expo's
`ios.privacyManifests` docs for SDK 57 and RevenueCat's App Privacy guide.

### 1.1 Three different obligations — do not conflate them

| Obligation                                              | What it covers                                                                                                                                                                                                                                                                                                    | Where it lives                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **App-level privacy manifest** [REQUIRED]               | The data the app's **own code** collects, in Apple's fixed data-type vocabulary. Apple: "Your app's privacy manifest file doesn't need to cover data collected by third-party SDKs that your app links to" — each SDK ships its own (RevenueCat's declares Purchase History).                                     | `app.json` → `expo.ios.privacyManifests` (merged into the generated `PrivacyInfo.xcprivacy` at prebuild; `ios/` is not tracked). |
| **App Privacy answers** in App Store Connect [REQUIRED] | Everything "you **or your third-party partners**" collect, SDKs included. Not filled from the manifest; Xcode's privacy report (aggregated manifests) is only a reference. The developer is responsible for accuracy.                                                                                             | Entered by hand in App Store Connect.                                                                                            |
| **Privacy policy** (Guideline 5.1.1(i)) [REQUIRED]      | Prose, not a vocabulary: what is collected, how, **all** uses; that third parties give equal protection; retention/deletion policies; how to revoke consent or request deletion. Linked in metadata **and** in-app. Subscription apps must also link Privacy Policy and Terms of Use in-app (Schedule 2 §3.8(b)). | `recall-privacy-policy-draft.md` → a public URL; `src/lib/release-destinations.ts`.                                              |

Apple's definitions that decide the rows: **collect** = "transmitting data off
the device in a way that allows you and/or your third-party partners to
access it for a period longer than what is necessary to service the
transmitted request in real time" (an IP address used to serve a request and
not retained need not be disclosed); **linked** = tied to identity "via their
account, device, or other details" unless de-identified before collection;
**tracking** = combining with third-party data for advertising or sharing with
a data broker. The optional-disclosure exemption does not apply to anything
here: it requires infrequent, optional, user-initiated collection with the
user's name shown in the form, and the preference mirror is ongoing.

### 1.2 Determination per data element

| Data (verified behavior)                                                                                      | Apple type (`NSPrivacyCollectedDataType…`)                                                      | Linked | Tracking | Purpose                                                 | In app manifest?                           | Confidence / decision                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | -------- | ------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation UUID — key of every Lotly server row (`installation-id.ts`)                                      | **User ID** (`UserID`) — "assigned user ID … or other user- or account-level ID"                | Yes    | No       | App Functionality                                       | Yes                                        | High. Supersedes the 2026-08-28 "Device ID" answer: Apple's Device ID is "advertising identifier, or other device-level ID"; RevenueCat's guide says a custom app user ID is "User ID". |
| Purchase UUID — RevenueCat `appUserID` only, kept across reset (`purchases/purchase-identity.ts`, 2026-10-12) | **User ID** (`UserID`) — "assigned user ID … or other user- or account-level ID"                | Yes    | No       | App Functionality                                       | Yes                                        | High. Supersedes the 2026-08-28 "Device ID" answer: Apple's Device ID is "advertising identifier, or other device-level ID"; RevenueCat's guide says a custom app user ID is "User ID". |
| Expo push token (alerts on only; `push_subscriptions`)                                                        | **Device ID** (`DeviceID`)                                                                      | Yes    | No       | App Functionality                                       | Yes                                        | Medium — Apple has no push-token type; [FOUNDER] may choose Other Data Types instead.                                                                                                   |
| Selected states — manual, any number (`installation_preferences.state_codes`)                                 | **Coarse Location** (`CoarseLocation`) — "lower resolution than … three or more decimal places" | Yes    | No       | App Functionality                                       | Yes                                        | Medium-high. Apple's definition needs no Location Services; a chosen state fits. [FOUNDER] confirm.                                                                                     |
| Allergen watchlist (`installation_preferences.allergens`)                                                     | **Health** (`Health`) — "any other user provided health or medical data" (conservative)         | Yes    | No       | App Functionality                                       | Yes, if declared                           | **[LEGAL]+[FOUNDER]** — §2. Alternative: Other Data Types. Do not enter either until decided.                                                                                           |
| Selected stores (`installation_preferences.retailer_ids`)                                                     | **Other Data Types** (`OtherDataTypes`)                                                         | Yes    | No       | App Functionality                                       | Yes                                        | Medium. [FOUNDER] confirm (not purchase history: no purchase is recorded).                                                                                                              |
| Subscription purchases (RevenueCat SDK)                                                                       | **Purchase History** (`PurchaseHistory`)                                                        | Yes    | No       | App Functionality; **Analytics** per RevenueCat's guide | No — RevenueCat's own manifest declares it | High for the type. The Analytics purpose follows RevenueCat's published guidance ("at the bare minimum … Analytics and App Functionality") [FOUNDER] confirm.                           |
| App version, platform, delivery records                                                                       | Arguably Other Diagnostic Data                                                                  | Yes    | No       | App Functionality                                       | Optional                                   | Low materiality; [FOUNDER] may fold into the rows above or declare.                                                                                                                     |
| Last-opened date (one UTC date, daily check-in; `installation_activity`, prepared 2026-10-12)                 | **Product Interaction** (`ProductInteraction`) — "app launches"                                 | Yes    | No       | App Functionality (inactivity deletion only)            | Yes, once the check-in ships               | Medium. A day-granular launch date is the narrowest reading of Apple's "app launches"; [FOUNDER] confirm when applying §1.3.                                                            |
| IP address at Supabase / RevenueCat (request serving)                                                         | Not declared unless retained and used                                                           | —      | —        | —                                                       | No                                         | [LEGAL] — depends on provider log retention (policy draft placeholder).                                                                                                                 |
| Search, saved recalls, onboarding progress, entitlement cache                                                 | Not collected (device only)                                                                     | —      | —        | —                                                       | No                                         | High.                                                                                                                                                                                   |
| Usage / Diagnostics / Contact Info / Browsing / Sensitive Info                                                | Not collected                                                                                   | —      | —        | —                                                       | No                                         | High — no analytics, crash or ad SDK (dependency-lock tests).                                                                                                                           |
| Shopper report (gate **off**)                                                                                 | Would add Coarse Location, Other Data Types, Purchase History                                   | Yes    | No       | App Functionality                                       | Only when enabled                          | Not optional-disclosure (no name shown). Revisit before the gate is ever enabled.                                                                                                       |

**Tracking: "No, we do not track."** No ad/analytics SDK, no data broker,
`NSPrivacyTracking = false` in the app and RevenueCat manifests, no tracking
domains.

### 1.3 The app-level manifest change, ready once §1.2 is decided

Not applied: the current generated manifest declares
`NSPrivacyCollectedDataTypes = []`, which is inaccurate. When the founder
settles the open rows, add to `app.json` under `expo.ios` (Expo's
`mergePrivacyInfo` merges this with the pods' required-reason APIs; React
Native's aggregation copies only required-reason APIs, never data types):

```json
{
  "privacyManifests": {
    "NSPrivacyTracking": false,
    "NSPrivacyCollectedDataTypes": [
      {
        "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeUserID",
        "NSPrivacyCollectedDataTypeLinked": true,
        "NSPrivacyCollectedDataTypeTracking": false,
        "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
      },
      {
        "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeDeviceID",
        "NSPrivacyCollectedDataTypeLinked": true,
        "NSPrivacyCollectedDataTypeTracking": false,
        "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
      },
      {
        "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeCoarseLocation",
        "NSPrivacyCollectedDataTypeLinked": true,
        "NSPrivacyCollectedDataTypeTracking": false,
        "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
      },
      {
        "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherDataTypes",
        "NSPrivacyCollectedDataTypeLinked": true,
        "NSPrivacyCollectedDataTypeTracking": false,
        "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
      }
    ]
  }
}
```

If §2 decides Health, add one more entry of the same shape with
`NSPrivacyCollectedDataTypeHealth`; if the founder answers the push token as
Other Data Types, drop the `DeviceID` entry.

Purchase History is not listed: RevenueCat's manifest carries it. App Store
Connect still needs it entered by hand. Confirm the merged result in a
prebuilt `ios/Lotly/PrivacyInfo.xcprivacy` (or Xcode's privacy report from an
archive) before the first TestFlight upload.

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

| Item                                                       | Class                    | Status                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy Policy URL (App Store Connect metadata)            | [REQUIRED]               | **Blocked**                                              | Guideline 5.1.1(i): required for all apps, in metadata and in-app. Draft exists (`recall-privacy-policy-draft.md`); blocked on founder inputs + counsel (`recall-launch-blockers.md`). No URL exists — do not invent one.                                                                                                                                                                                                                                                                                                                                |
| Privacy policy accessible in-app                           | [REQUIRED]               | **Blocked**                                              | Ships as a trust-center document only after the policy is finalized; unfinished policy is deliberately not exposed (test-enforced).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Support URL                                                | [REQUIRED]               | **Blocked**                                              | App Store Connect requires a support URL; guideline 1.5 requires an easy way to contact the developer. No real destination exists yet [FOUNDER].                                                                                                                                                                                                                                                                                                                                                                                                         |
| App Privacy answers                                        | [REQUIRED]               | **Draft** (§1)                                           | Health/coarse-location rows blocked on §2 decisions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Privacy manifests (SDK)                                    | [REQUIRED]               | **Done**                                                 | All bundled manifests present with approved reason codes; no Apple-listed SDK in the graph (audit §5).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Privacy manifest (app-level `NSPrivacyCollectedDataTypes`) | [REQUIRED]               | **Pending**                                              | Currently `[]` (inaccurate). Exact `app.json` block prepared in §1.3; apply once the §1.2 founder rows and §2 are decided.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Required-reason APIs                                       | [REQUIRED]               | **Done**                                                 | Only dependency-declared categories (file timestamp, user defaults, disk space) with approved codes; no first-party required-reason API use.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Account deletion (5.1.1(v))                                | [REQUIRED if applicable] | **Not applicable today**                                 | Requirement triggers only for apps supporting account creation; Recall has none. Revisit immediately if accounts ever ship.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Age rating questionnaire                                   | [REQUIRED]               | **Pending [FOUNDER]**                                    | Expect low rating; answer the medical/treatment-information item consistently with the informational-app position.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Medical-device / regulated-app position (guideline 1.4)    | [LEGAL]+[FOUNDER]        | **Pending**                                              | Recall provides recall information and never measures, diagnoses, or doses; the safety disclaimer says so. Counsel should confirm no FDA device claim arises and review 5.1.1(ix) (apps in highly regulated fields should be submitted by a legal entity, not an individual — interacts with the entity decision).                                                                                                                                                                                                                                       |
| Export compliance                                          | [REQUIRED]               | **Set in `app.json`**                                    | App uses only OS/HTTPS (exempt) encryption. `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` is set in `app.json` (the resolved config reports `false`); with it, App Store Connect should not ask the per-build encryption question. No build carrying it has been uploaded yet; confirm at the first TestFlight upload that the question is not raised.                                                                                                                                                                                            |
| EULA / Terms                                               | [FOUNDER]+[LEGAL]        | **Pending**                                              | The app is now a subscription: Schedule 2 §3.8(b) requires links to the Privacy Policy and Terms of Use inside the app (the paywall footer carries both, still unconfigured). Decide Apple's standard EULA vs. custom Terms (`recall-launch-blockers.md` §1). Never claim legal review that has not occurred.                                                                                                                                                                                                                                            |
| Subscriptions (3.1.x)                                      | [REQUIRED] when live     | **Built; sandbox-verified on device (founder-reported)** | P2B7X.1 shipped the hard paywall with the required elements — the renewal disclosure, Restore Purchases, Terms, Privacy and Support, store-supplied prices, no trial/lifetime/scarcity copy (`docs/recall-onboarding-and-paywall.md`). The Apple products, the RevenueCat entitlement and offering and the adapter exist (2026-10-04); founder-reported sandbox purchases, cancel, restore and expiry passed on a physical iPhone (2026-10-04/05); Terms/Privacy/Support destinations are still absent (`npm run qa:launch-readiness` fails on purpose). |
| Government-source presentation                             | [RECOMMENDED]            | **Done**                                                 | The app states non-affiliation (Safety Disclaimer) and links every notice to its official source; avoids any implication of agency endorsement (4.1 impersonation risk).                                                                                                                                                                                                                                                                                                                                                                                 |
| Push notifications (2.5.4 / 4.5.4)                         | [REQUIRED]               | **Done by design**                                       | Push is opt-in via an explicit control, safety-relevant only, no marketing; permission prompt only from the user's action.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Data collected matches label at review                     | [REQUIRED]               | **Pending**                                              | Re-verify §1 against the shipped build during submission prep; the dependency-lock test keeps the "no tracking" row honest.                                                                                                                                                                                                                                                                                                                                                                                                                              |

## 4. Withheld on purpose

- No App Store Connect record was created or modified in C7.
- No privacy-label answers were entered anywhere.
- No claim of "App Store ready" is made: the blockers above (privacy policy,
  support URL, health-data decision, entity/legal review) are unresolved.
