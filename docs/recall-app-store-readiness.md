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

### 1.2 App Store Connect answers (founder-approved 2026-10-14)

Approved by the founder on 2026-10-14, from the evidence worksheet in the
device-build handoff (`APP-PRIVACY-WORKSHEET.md`, rechecked against Apple's
App Privacy pages and RevenueCat's App Privacy guide and customer-profile
docs). **Every collected type: Linked = Yes, Tracking = No.** Linked,
because each item is stored against a persistent random identifier that
Lotly can re-link (personal data, so "linked" by Apple's rule). The answers
cover Lotly **and** its third-party partners. Nothing is entered in App Store
Connect until the build is uploaded.

| Apple type            | Lotly data and flow                                                                                                                                                                                                                                                           | Purposes                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| User ID               | Installation UUID (keys every server row). Purchase UUID: RevenueCat `appUserID`, and since B10 also sent with the alert registration to Lotly's server, which asks RevenueCat about the subscription with it. Keyed hash of Apple's download id (regulated 13–17, alerts on) | App Functionality, Analytics                          |
| Device ID             | Expo push token (alerts on only)                                                                                                                                                                                                                                              | App Functionality                                     |
| Coarse Location       | Chosen states; RevenueCat's last-seen IP country; Supabase log geo fields                                                                                                                                                                                                     | App Functionality, Product Personalization            |
| Health                | Allergens, sent and stored only with consent                                                                                                                                                                                                                                  | App Functionality, Product Personalization            |
| Purchase History      | Subscription purchases (RevenueCat SDK); "Stores you shop at"; the alert gate's subscription status (B10)                                                                                                                                                                     | App Functionality, Analytics, Product Personalization |
| Product Interaction   | Last-opened date (daily check-in); RevenueCat's last-seen time                                                                                                                                                                                                                | App Functionality                                     |
| Other Diagnostic Data | IP in Supabase request logs (7 days); app version and platform; delivery error codes                                                                                                                                                                                          | App Functionality                                     |
| Customer Support      | Privacy request codes; the contents of support and request emails (kept up to 24 months)                                                                                                                                                                                      | App Functionality                                     |
| Other Data Types      | Allergen-consent record; the implied regulated-teen status                                                                                                                                                                                                                    | App Functionality                                     |
| Email Address, Name   | Sender of support or request emails (Mail sends them; kept up to 24 months)                                                                                                                                                                                                   | App Functionality                                     |
| Not collected         | Crash, performance, precise location, payment, search, browsing, contacts, Emails or Text Messages and Other User Content (no such app feature; support mail is Customer Support), advertising, fitness, financial                                                            | —                                                     |

**Analytics** is marked only where RevenueCat's dashboard uses the data:
Purchase History (RevenueCat requires it: "All RevenueCat users must select
these two options") and User ID (the key of that dashboard). Lotly's own code
does no analytics. It is **not** marked on Coarse Location or Product
Interaction: RevenueCat's App Privacy guide says it "does not collect precise
or coarse location data", and says nothing about the last-seen time.

**Tracking: "No, we do not track."** No ad or analytics SDK, no data broker,
`NSPrivacyTracking = false` in the app and RevenueCat manifests, no tracking
domains. RevenueCat's server-to-server tracking is off.

### 1.3 The app-level manifest (applied 2026-10-14)

`app.json` → `expo.ios.privacyManifests` declares the nine types Lotly's
**own code** collects, each `Linked: true`, `Tracking: false`:

- **App Functionality only:** UserID, DeviceID, ProductInteraction,
  OtherDiagnosticData, CustomerSupport, OtherDataTypes.
- **App Functionality and Product Personalization:** CoarseLocation, Health,
  PurchaseHistory (the stores).

It differs from §1.2 on purpose. RevenueCat's data and its Analytics
purposes belong to RevenueCat's own manifest. Email Address and Name are
sent by Mail, not by Lotly's code.

**Verifying a build:** two separate files, checked separately.

- **Lotly's own manifest,** `Lotly.app/PrivacyInfo.xcprivacy`. Expo's
  `mergePrivacyInfo` merges this block into the template at prebuild, so the
  existing required-reason entries (FileTimestamp, UserDefaults, DiskSpace,
  SystemBootTime) stay. Check that both the nine types and those entries
  are present.
- **SDK manifests,** in each SDK's own bundle inside `Lotly.app`. They are
  not merged into Lotly's file. Check that RevenueCat's still declares
  Purchase History, App Functionality, not linked.

Apple combines the two for its upload check. Xcode's Privacy Report needs a
local archive, which an EAS `.ipa` is not.

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

| Item                                                       | Class                    | Status                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privacy Policy URL (App Store Connect metadata)            | [REQUIRED]               | **Supplied**                                             | `https://lotly.pages.dev/privacy/` (founder-approved text, 2026-10-14). It serves a review edition marked "Draft, not yet in effect" until final publication, which must happen before App Review submission (device-build handoff `CLOSEOUT.md` C12).                                                                                                                                                                                                                                                                                                 |
| Privacy policy accessible in-app                           | [REQUIRED]               | **Done**                                                 | Privacy & Data Controls links the Privacy Policy, the Consumer Health Data Policy and the Terms of Use (`POLICY_LINKS`), and the paywall footer opens Terms and Privacy. The policies are website pages, never in-app documents (test-enforced).                                                                                                                                                                                                                                                                                                       |
| Support URL                                                | [REQUIRED]               | **Supplied**                                             | `https://lotly.pages.dev/support/` (`RELEASE_DESTINATIONS.support`); support email lotlysupport@gmail.com.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| App Privacy answers                                        | [REQUIRED]               | **Approved 2026-10-14** (§1.2)                           | Enter §1.2 by hand when the build is uploaded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Privacy manifests (SDK)                                    | [REQUIRED]               | **Done**                                                 | All bundled manifests present with approved reason codes; no Apple-listed SDK in the graph (audit §5).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Privacy manifest (app-level `NSPrivacyCollectedDataTypes`) | [REQUIRED]               | **Done** (§1.3)                                          | Nine types in `app.json`; verify the built app as §1.3 describes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Required-reason APIs                                       | [REQUIRED]               | **Done**                                                 | Only dependency-declared categories (file timestamp, user defaults, disk space) with approved codes; no first-party required-reason API use.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Account deletion (5.1.1(v))                                | [REQUIRED if applicable] | **Not applicable today**                                 | Requirement triggers only for apps supporting account creation; Recall has none. Revisit immediately if accounts ever ship.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Age rating questionnaire                                   | [REQUIRED]               | **Approved 2026-10-14**                                  | Result 13+. Medical or Treatment Information: **Infrequent** (founder-approved). Age Assurance: Yes. Parental Controls, Unrestricted Web Access, user-generated content, chat, ads and social: No. Alcohol or drug references: Infrequent. Health or wellness topics: None.                                                                                                                                                                                                                                                                            |
| Medical-device / regulated-app position (guideline 1.4)    | [LEGAL]+[FOUNDER]        | **Pending**                                              | Recall provides recall information and never measures, diagnoses, or doses; the safety disclaimer says so. Counsel should confirm no FDA device claim arises and review 5.1.1(ix) (apps in highly regulated fields should be submitted by a legal entity, not an individual — interacts with the entity decision).                                                                                                                                                                                                                                     |
| Export compliance                                          | [REQUIRED]               | **Set in `app.json`**                                    | App uses only OS/HTTPS (exempt) encryption. `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` is set in `app.json` (the resolved config reports `false`); with it, App Store Connect should not ask the per-build encryption question. No build carrying it has been uploaded yet; confirm at the first TestFlight upload that the question is not raised.                                                                                                                                                                                          |
| EULA / Terms                                               | [FOUNDER]+[LEGAL]        | **Decided**                                              | Apple's Standard EULA plus Lotly's Terms of Use at `https://lotly.pages.dev/terms/` (founder-approved 2026-10-14). The paywall footer and Privacy & Data Controls link the Terms; the App Store description links them too.                                                                                                                                                                                                                                                                                                                            |
| Subscriptions (3.1.x)                                      | [REQUIRED] when live     | **Built; sandbox-verified on device (founder-reported)** | P2B7X.1 shipped the hard paywall with the required elements — the renewal disclosure, Restore Purchases, Terms, Privacy and Support, store-supplied prices, no trial/lifetime/scarcity copy (`docs/recall-onboarding-and-paywall.md`). The Apple products, the RevenueCat entitlement and offering and the adapter exist (2026-10-04); founder-reported sandbox purchases, cancel, restore and expiry passed on a physical iPhone (2026-10-04/05); Terms/Privacy/Support destinations are supplied (2026-10-14; `npm run qa:launch-readiness` passes). |
| Government-source presentation                             | [RECOMMENDED]            | **Done**                                                 | The app states non-affiliation (Safety Disclaimer) and links every notice to its official source; avoids any implication of agency endorsement (4.1 impersonation risk).                                                                                                                                                                                                                                                                                                                                                                               |
| Push notifications (2.5.4 / 4.5.4)                         | [REQUIRED]               | **Done by design**                                       | Push is opt-in via an explicit control, safety-relevant only, no marketing; permission prompt only from the user's action.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Data collected matches label at review                     | [REQUIRED]               | **Pending**                                              | Re-verify §1 against the shipped build during submission prep; the dependency-lock test keeps the "no tracking" row honest.                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 4. Withheld on purpose

- No App Store Connect record was created or modified in C7.
- No privacy-label answers were entered anywhere.
- No claim of "App Store ready" is made: the blockers above (privacy policy,
  support URL, health-data decision, entity/legal review) are unresolved.
