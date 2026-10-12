# Privacy Policy — DRAFT / TEMPLATE (not published, not legal advice)

> **STATUS: DRAFT.** This document is a working template produced from the
> C7 code audit (`recall-data-flow-audit.md`) and reconciled on 2026-10-10
> with the website data-practices audit (RevenueCat, the always-on preference
> mirror, subscriptions, actual retention, and the limits of the reset). It
> contains unresolved placeholders in `⟦double brackets⟧`, it has not been
> reviewed by counsel, and it must not be published, linked from App Store
> Connect, or exposed in the app until every placeholder is resolved and the
> counsel-review checklist in `recall-launch-blockers.md` is complete. The
> in-app "Privacy & Data Controls" document
> (`src/content/privacy-data-controls.ts`) is the consumer explanation of
> current behavior and is deliberately not this policy; the two must not
> contradict each other.
>
> Apple's App Privacy label and the app's privacy manifest are separate
> declarations with their own definitions; see
> [recall-app-store-readiness.md](recall-app-store-readiness.md) §1. This
> policy is what App Store Review Guideline 5.1.1(i) requires: what is
> collected, how, every use, third-party protection, retention and deletion,
> and how to revoke consent or request deletion.

---

# Privacy Policy for Lotly

**Effective date:** ⟦FOUNDER: effective date — set when published⟧

**Who we are:** Lotly is operated personally by Willis Yang, an individual
developer ("we," "us"). ⟦LEGAL: whether a mailing address or jurisdiction
statement is needed for an individual operator.⟧
Lotly is an iPhone app that presents United States food recall information
from official government sources, available by subscription.

**Contact:** lotlysupport@gmail.com

## The short version

Lotly works without an account. The app stores your personalization choices
(the states you shop in, allergens to watch, and stores) on your device and
copies them to our server, keyed by a random installation identifier, every
time you change them. If you turn on recall alerts, we also store a push
delivery token and delivery records. Subscriptions are sold by Apple and
checked through RevenueCat, which receives the same random installation
identifier. We do not collect your name, contact details, or device
location; we include no analytics, advertising, or crash-reporting SDKs; and
we do not track you or sell or share personal information for advertising.

## Information we collect

- **A random installation identifier.** Created on your device; contains
  nothing about you or your device. Our server uses it to keep your
  installation's records separate from others, and our subscription provider
  uses it as an anonymous customer ID (see "Subscriptions").
- **Personalization choices.** The states you shop in (any number, chosen
  by hand — the app never uses location services), the allergens you choose
  to watch, and the stores you choose. Stored on your device first and copied
  to our server each time you change them, including during setup, whether
  or not you have turned alerts on, so alert delivery can apply the same
  relevance rules the app shows you.
- **Push registration (only if you enable alerts).** The push token issued
  for this installation, your platform (iOS or Android), the app version,
  timestamps for enabling, registering, and refreshing, and a counter that
  keeps alerts-on and alerts-off requests in order.
- **Alert delivery records.** Which alert was sent to which registration and
  whether the delivery service accepted it.
- **Subscription status.** See "Subscriptions."
- **Community shopper reports (only if you submit one — not yet available).**
  ⟦FOUNDER: the shopper-report experience shipped in P1D (2026-09-11) and
  its migration is applied, but the server-side gate is still off, so no
  one can submit one. This paragraph activates when the gate is enabled;
  it must not be published as live before then. The reset sentence at the
  end of this paragraph is true only once migration
  `20261012000000_installation_deletion_restore_shopper_reports.sql` is
  applied in production — the 2026-10-04 re-definition of the deletion
  function had dropped shopper reports.⟧ If you choose to report finding a
  recalled product, we store: the state you select, the store you select
  (only from the stores the official notice names — or nothing if you choose
  "Not sure"), a rough purchase-time range (e.g. "past week"), and the random
  installation identifier, so your report stays editable and deletable by
  you. These reports exist to show other shoppers an aggregate signal ("N
  shoppers reported finding it here"). Individual reports are private: only
  totals of three or more reports are ever shown, and no report ever changes
  the official recall information. A report contains no symptoms, illness or
  medical information, no name or contact details, no exact location or GPS,
  no receipt or photo, and no free text — the questionnaire cannot collect
  them. You can edit or withdraw your report at any time (withdrawal deletes
  it), and "Reset app and delete my data" deletes all of your reports along
  with your other installation data. **Retention:** a report is kept for up
  to 12 months after your most recent meaningful submission or edit of it —
  editing it restarts that 12-month period; retrying an unchanged submission
  does not. When a report reaches 12 months it stops counting toward the
  aggregate immediately, and a scheduled daily cleanup permanently deletes it
  within at most about a day. Withdrawing a report or using "Reset app and
  delete my data" deletes it immediately instead. Uninstalling the app alone
  does not send a deletion request (though an abandoned report still ages
  out under the 12-month rule). No hidden copy or marker of a deleted or
  expired report is kept.

We do **not** collect: names, email addresses, phone numbers, contacts,
photos, account credentials (no accounts exist), device location (your
states are a manual choice), advertising identifiers, search terms, or a
record of which recalls you view or save (saved recalls stay on your device).
We never receive your payment details. Outside a community shopper report
you choose to submit (described above, and not yet available), we collect no
information about what you buy.

Like every internet service, requests from the app to our infrastructure and
to our subscription provider carry standard connection details such as an IP
address, which those providers process to serve and secure the request.
Product images load directly from the issuing agency's website (for example
www.fda.gov) or our image storage. ⟦LEGAL: confirm the accurate statement of
infrastructure/log retention with Supabase's and RevenueCat's current terms
and settings.⟧

## Information stored only on your device

Your personalization choices, the installation identifier, whether alerts
are on, your progress through setup, your saved recalls, the last
subscription status the device confirmed with the App Store, and a cache of
public recall information. Searching runs on your device; what you type is
never stored or sent.

## Subscriptions

Lotly is available by auto-renewing subscription. Apple processes payment
through your Apple Account; we never see your payment details. We use
**RevenueCat** to confirm whether your subscription is active. The app
identifies this installation to RevenueCat with the random installation
identifier, and RevenueCat records the App Store purchases and subscription
status associated with it so they can be verified and restored. Our own
server stores no purchase records. Your device keeps the last subscription
status it verified (plan, verification time, renewal date) so access
continues through a brief store outage. You can cancel or manage a
subscription in your Apple Account settings, and refunds are handled by
Apple. ⟦LEGAL: confirm RevenueCat's processor terms and how its own privacy
policy should be referenced.⟧

## How we use information

- To show which recalls may affect you (on-device evaluation of your
  choices against what official notices state).
- To deliver the recall alerts you asked for, applying the same relevance
  rules.
- To keep delivery honest and non-duplicative (delivery records and the
  ordering counter).
- To confirm and restore your subscription.

We do not use personal information for advertising or marketing, we do not
sell it, and we do not share it with data brokers. We do not use it to track
you across apps or websites.

## Service providers

We use service providers to operate Lotly; they process the data above only
to provide their services to us: ⟦LEGAL: confirm final processor list, that
each provides protection equal to this policy (Guideline 5.1.1(i)), and
whether data-processing terms are in place⟧

- **Supabase** — database and image-storage hosting (installation
  identifier, personalization mirror, push registration, delivery records).
- **RevenueCat** — subscription verification (installation identifier,
  App Store purchase and subscription status).
- **Apple** — App Store purchases, and the Apple Push Notification service
  when alerts are on.
- **Expo (Expo Application Services)** — push notification delivery service
  (push token and alert content — the alert text carries public recall
  facts only), when alerts are on. Recall alerts are intended to be live at
  launch; delivery records begin accumulating once delivery is switched on.
- **Google Firebase Cloud Messaging** — only if an Android version is ever
  released. ⟦FOUNDER: remove if the launch is iPhone-only.⟧

Lotly's source-data processing (collecting official FDA/USDA notices) runs
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

What the system does today (verified 2026-10-10):

- **No automatic expiry for installation records.** The personalization
  mirror, push registration (including a disabled one), the ordering
  counter, and delivery records are kept until you use "Reset app and delete
  my data." Community shopper reports, if ever available, expire after 12
  months (above).
- **Clearing a choice** in the app syncs the cleared value to our server.
- **Turning alerts off** stops delivery and marks the registration disabled;
  the record itself is kept until a reset.
- **"Reset app and delete my data"** (Profile → Privacy & Data Controls)
  deletes this installation's server records — personalization mirror, push
  registration, ordering counter, delivery records ⟦and community shopper
  reports, once migration 20261012000000 is applied⟧ — in one transaction,
  then clears your choices, alert setting, setup progress, saved recalls, and
  installation identifier from the device and creates a new identifier. If
  the server cannot be reached, nothing is changed and you can retry.
- **What the reset does not reach:** subscription records held by Apple and
  RevenueCat and the subscription status saved on your device (so a
  subscription you paid for keeps working); routine infrastructure logs at
  our providers; and a disabled registration left by an earlier installation
  of the app under a different identifier.
- **Deleting the app** removes it from your device but is not a deletion
  request we can act on; use the in-app reset first. Secure-storage entries
  can persist in the operating system keychain and come back on reinstall.

⟦FOUNDER+LEGAL: decide, before publication, (a) whether to ship an automatic
retention window for never-reset installations or publish the "kept until
reset" statement above as the policy; (b) whether to offer a manual deletion
path through lotlysupport@gmail.com — the address exists, but there is no
account, so a way to identify an installation's rows from an email request
must be decided before the policy offers it; (c) how a RevenueCat
customer record is deleted on request (confirm RevenueCat's
customer-deletion mechanism; no Lotly code does this today).⟧

## Children

Lotly is not directed to children. ⟦LEGAL: confirm COPPA position and the
final age-rating answer; no child-specific features or profiles exist.⟧

## Your rights

⟦LEGAL: jurisdiction-dependent (e.g., California, Virginia, Washington
MHMD if allergen choices are consumer health data). Note that with no account
and no collected contact information, identity verification for rights
requests is inherently limited to installation-level actions.⟧

## Changes to this policy

We will update the effective date and, for material changes, provide notice
in the app. ⟦FOUNDER: confirm the notice mechanism.⟧

## Contact us

Questions about this policy or your data: lotlysupport@gmail.com.
