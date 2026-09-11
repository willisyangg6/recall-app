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
- **Community shopper reports (only if you submit one — not yet available).**
  ⟦FOUNDER: the shopper-report experience shipped in P1D (2026-09-11) and
  its migration is applied, but the server-side gate is still off, so no
  one can submit one. This paragraph activates when the gate is enabled;
  it must not be published as live before then. Note that the app's own
  consumer privacy surface for this feature is the in-app "Privacy & Data
  Controls" document (which P1D extended, and which the questionnaire links
  to) — this policy draft stays unpublished until its placeholders and
  counsel review are resolved.⟧ If you choose to report finding a recalled product, we
  store: the state you select, the store you select (only from the stores
  the official notice names — or nothing if you choose "Not sure"), a rough
  purchase-time range (e.g. "past week"), and the random installation
  identifier, so your report stays editable and deletable by you. These
  reports exist to show other shoppers an aggregate signal ("N shoppers
  reported finding it here"). Individual reports are private: only totals
  of three or more reports are ever shown, and no report ever changes the
  official recall information. A report contains no symptoms, illness or
  medical information, no name or contact details, no exact location or
  GPS, no receipt or photo, and no free text — the questionnaire cannot
  collect them. You can edit or withdraw your report at any time
  (withdrawal deletes it), and "Reset app and delete my data" deletes all
  of your reports along with your other installation data.
  **Retention:** a report is kept for up to 12 months after your most
  recent meaningful submission or edit of it — editing it restarts that
  12-month period; retrying an unchanged submission does not. When a
  report reaches 12 months it stops counting toward the aggregate
  immediately, and a scheduled daily cleanup permanently deletes it within
  at most about a day. Withdrawing a report or using "Reset app and delete
  my data" deletes it immediately instead. Uninstalling the app alone
  does not send a deletion request (though an abandoned report still ages
  out under the 12-month rule). No hidden copy or marker of a deleted or
  expired report is kept.

We do **not** collect: names, email addresses, phone numbers, contacts,
photos, account credentials (no accounts exist), device location (your state
is a manual choice), advertising identifiers, search terms, or a record of
which recalls you view. Outside a community shopper report you choose to
submit (described above, and not yet available), we collect no
purchase-related information — and even a shopper report records only a
selected state, an optionally selected store, and a rough time range, never
a receipt, price, or purchase history.

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
delivery records, and (once shopper reporting ships) all of the
installation's community shopper reports, in one atomic operation — then
resets the device to a fresh installation identity.
Its migration must be applied to production before this policy describes it
as live; the shopper-report clause additionally requires the P1C migration
and launch. Shopper-report retention is DECIDED (2026-09-10): 12 months
after the most recent meaningful submission or edit, with a daily scheduled
physical cleanup — see `recall-shopper-reports.md` §7. The retention gap
that remains open is the C7 one above (stale push-registration rows of
never-reset installations), which this decision does not cover. Rows for installations that never use the reset (including
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
