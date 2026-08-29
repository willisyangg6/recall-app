# Privacy Policy — DRAFT / TEMPLATE (not published, not legal advice)

> **STATUS: DRAFT.** This document is a working template produced from the
> C7 code audit (`recall-data-flow-audit.md`). It contains unresolved
> placeholders in `⟦double brackets⟧`, it has not been reviewed by counsel,
> and it must not be published, linked from App Store Connect, or exposed in
> the app until every placeholder is resolved and the counsel-review
> checklist in `recall-launch-blockers.md` is complete. The in-app
> "Privacy & Data Controls" document is the consumer explanation of current
> behavior and is deliberately not this policy.

---

# Privacy Policy for Recall

**Effective date:** ⟦FOUNDER: effective date — set when published⟧

**Who we are:** ⟦FOUNDER+LEGAL: legal developer/entity name and, if counsel
determines it is needed, a mailing address and jurisdiction⟧ ("we," "us").
Recall is a mobile app that presents United States food recall information
from official government sources.

**Contact:** ⟦FOUNDER: privacy contact email — must be a real, monitored
address⟧

## The short version

Recall works without an account. The app stores your personalization choices
(state, allergens to watch, stores) on your device and mirrors them to our
server keyed by a random installation identifier. If you turn on recall
alerts, we also store a push delivery token and delivery records. We do not
collect your name, contact details, or device location; we run no analytics,
advertising, or crash-reporting SDKs; and we do not track you or sell or
share personal information for advertising.

## Information we collect

- **A random installation identifier.** Created on your device; contains
  nothing about you or your device. It exists so our server can keep your
  installation's records separate from others.
- **Personalization choices.** Your selected state, allergens to watch, and
  stores. Stored on your device first and synced to our server so alert
  delivery can apply the same relevance rules the app shows you.
- **Push registration (only if you enable alerts).** The push token issued
  for this installation, your platform (iOS or Android), the app version,
  and timestamps for enabling, registering, and refreshing.
- **Alert delivery records.** Which alert was sent to which registration and
  whether the delivery service accepted it.

We do **not** collect: names, email addresses, phone numbers, contacts,
photos, account credentials (no accounts exist), device location (your state
is a manual choice), advertising identifiers, purchase information, search
terms, or a record of which recalls you view.

Like every internet service, requests from the app to our infrastructure
carry standard connection details such as an IP address, which our hosting
provider processes to serve and secure the request.
⟦LEGAL: confirm the accurate statement of infrastructure/log retention with
the hosting provider's current terms and settings.⟧

## How we use information

- To show which recalls may affect you (on-device evaluation of your
  choices against what official notices state).
- To deliver the recall alerts you asked for, applying the same relevance
  rules.
- To keep delivery honest and non-duplicative (delivery records).

We do not use personal information for advertising or marketing, we do not
sell it, and we do not share it with data brokers. We do not use it to track
you across apps or websites.

## Service providers

We use service providers to operate Recall; they process the data above only
to provide their services to us: ⟦LEGAL: confirm final processor list and
whether data-processing terms are in place⟧

- **Supabase** — database and image-storage hosting.
- **Expo (Expo Application Services)** — push notification delivery service.
- **Apple Push Notification service / Google Firebase Cloud Messaging** —
  platform push infrastructure for your device, when alerts are on.

Recall's source-data processing (collecting official FDA/USDA notices) runs
on ⟦LEGAL: confirm whether GitHub-hosted job infrastructure needs listing —
it processes recall source data, not user personal data⟧.

## Health-related information

⟦LEGAL: resolve before publication — see the counsel checklist. If allergen
preferences are treated as health-related data, this section must say so
plainly, state the purposes and protections, and reflect the FTC Health
Breach Notification Rule position and any state consumer-health-data law
obligations (including any required consent and deletion rights). If the
architecture changes to keep allergen data on-device only, this section
changes accordingly.⟧

## Retention and deletion

⟦FOUNDER+LEGAL: this section may not promise anything the system does not
do. As audited (2026-08-28, revised C7.1): an in-app "Reset app and delete
my data" control now exists (Profile → Privacy & Data Controls) and deletes
the installation's server records — preference mirror, push registration,
delivery records — then resets the device to a fresh installation identity.
Its migration must be applied to production before this policy describes it
as live. Rows for installations that never use the reset (including
registrations left by pre-reinstall installations under old identifiers)
persist with no automatic purge; either ship a retention window first or
disclose the absence honestly. Do not publish aspirational promises.⟧

- You can clear each personalization choice in the app; the cleared state
  syncs to our server.
- You can turn alerts off at any time in the app or in system settings;
  delivery stops.
- You can delete this installation's data entirely with "Reset app and
  delete my data" in the app (Profile → Privacy & Data Controls).
- Deleting the app alone removes it from your device but is not a deletion
  request we can act on; use the in-app reset first. Secure-storage entries
  can persist in the operating system keychain per platform behavior.
  ⟦FOUNDER: decide whether to also offer a manual deletion path — e.g.
  "email us" — only once a real contact address exists.⟧

## Children

Recall is not directed to children. ⟦LEGAL: confirm COPPA position and the
final age-rating answer; no child-specific features or profiles exist.⟧

## Your rights

⟦LEGAL: jurisdiction-dependent (e.g., California, Virginia, EU/UK if ever
distributed there). Note that with no account and no collected contact
information, identity verification for rights requests is inherently limited
to installation-level actions.⟧

## Changes to this policy

We will update the effective date and, for material changes, provide notice
in the app. ⟦FOUNDER: confirm the notice mechanism.⟧

## Contact us

⟦FOUNDER: real privacy/support contact, once it exists.⟧
