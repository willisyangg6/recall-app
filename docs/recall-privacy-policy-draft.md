# Privacy Policy — DRAFT (not published, not in effect, not legal advice)

> **STATUS: DRAFT, 2026-10-12.** Rewritten from the verified implementation
> for the app **and** the website. It is not in effect and must not be
> published, linked from App Store Connect, or shown in the app until:
>
> 1. every `⟦FOUNDER: …⟧` item below is decided by the founder;
> 2. every `⟦UNCERTAIN: …⟧` item has been read and accepted by the founder as a
>    stated residual uncertainty. Willis is not engaging counsel at this
>    stage (2026-10-12); counsel review is optional, not a gate. Nothing in
>    this draft claims, or may be read as claiming, guaranteed legal
>    compliance. The research behind each item is
>    [recall-health-data-applicability.md](recall-health-data-applicability.md)
>    and [recall-privacy-program-proposal.md](recall-privacy-program-proposal.md);
> 3. every `⟦PLANNED: …⟧` item has shipped; until then it must be removed
>    from the published text, never published as live (see the promise map in
>    [recall-privacy-program-proposal.md](recall-privacy-program-proposal.md)
>    §7);
> 4. the behavior it describes is live, in the order of the rollout sequence
>    in [recall-operations.md](recall-operations.md) (installation inactivity
>    retention):
>    - migrations `20261012000000` and `20261013000000` are applied;
>    - the cleanup is switched on with its grace date (step 3) **before**
>      this policy or any build carrying the retention text is published;
>    - the grace date is re-anchored to publication day + 12 months on
>      publication day (step 6);
>    - the distributed build carries the daily check-in
>      (`src/lib/installation-checkin.ts`) and the purchase identifier
>      (`src/lib/purchases/purchase-identity.ts`).
>
> The in-app "Privacy & Data Controls" document
> (`src/content/privacy-data-controls.ts`) is the consumer explanation of
> current behavior. The two must not contradict each other. Apple's App
> Privacy label and the privacy manifest are separate declarations; see
> [recall-app-store-readiness.md](recall-app-store-readiness.md) §1.
>
> Detail does not equal compliance. This text describes what the system
> does; whether that satisfies a given law is the counsel review's job.

---

# Lotly Privacy Policy

**Effective date:** ⟦FOUNDER: set at publication⟧

## Who we are

Lotly is an iPhone app and website that show United States food recall
information from official government sources. Lotly is operated personally by
**Willis Yang**, an individual developer ("we," "us"). ⟦UNCERTAIN: whether a
mailing address is required for an individual operator under the laws that
apply.⟧

Contact: **lotlysupport@gmail.com**

This policy covers the Lotly iPhone app and the Lotly website
⟦FOUNDER: domain, once purchased⟧.

## The short version

- Lotly has **no accounts**. We never ask for your name, email, phone
  number, or location, and the app never uses location services.
- The app keeps your choices — the states you shop in, the stores you shop
  at, and the food allergens you want to watch — on your iPhone. It sends the
  states and stores to our server so recall alerts can match them, and the
  allergens only if you agree. ⟦PLANNED: allergen consent⟧ The copy is
  labelled with a random identifier, not with anything about you.
- If you turn on recall alerts, we also store a push token so the alerts can
  reach your phone.
- Subscriptions are sold by **Apple**. We use **RevenueCat** to check that
  your subscription is active, under a purchase identifier that the app never
  sends to our server.
- We use **no analytics, advertising, or tracking**, we do not sell or share
  personal information for advertising, and the website sets no cookies.
- You can delete your data in the app at any time. If you stop using the app,
  we delete what our server holds automatically after 12 months.

## Information the app collects

### Random identifiers

- **Installation identifier.** A random code created on your iPhone the
  first time it is needed. It contains nothing about you or your device.
  Our server uses it to keep your records apart from other people's.
- **Purchase identifier.** Sent only to RevenueCat, to check your
  subscription. The app never sends it to our server.
  - On a new installation it is a second random code, so our server and
    RevenueCat hold no shared identifier.
  - If you subscribed with an earlier version of Lotly, it is the
    installation identifier you had then, so your subscription carries over
    without restoring. After you reset the app, the two no longer match.
- **Push token** (only if you turn on alerts). The address Apple issues so
  notifications can reach this app on your phone.

Lotly does not use Apple's advertising identifier, and it does not ask for
permission to track.

### Your choices

- **States you shop in.** Any number, picked by hand.
- **Food allergens you watch.** Any of nine: peanuts, tree nuts, milk, egg, wheat, soy, sesame, fish and crustacean shellfish. They may be your own, or those of
  anyone you shop or cook for. See "Allergen choices" below.
- **Stores you shop at.** Chosen from a list.

These are stored on your iPhone and copied to our server **every time you
change them, including during setup, whether or not alerts are on**. Once a
day, when you open the app, it sends them again so the server copy stays
complete. This is a no-op when nothing changed.
Allergens are the exception: they reach our server only if you agree (see
"Allergen choices"). ⟦PLANNED: until the consent sheet ships, allergens are
copied like the other choices.⟧

### Recall alerts (only if you turn them on)

- The push token, the platform (iOS), the app version, and when alerts were
  turned on and last refreshed.
- A counter that keeps "alerts on" and "alerts off" requests in the right
  order.
- **Delivery records:** which alert was sent to which registration, and
  whether the delivery service accepted it.

### Last-opened date

When you open the app, at most once a day, it sends the date: a calendar day
in UTC, with no time and no detail of what you did. We use it **only** to
delete inactive data (see "How long we keep data").

### Subscription status

See "Subscriptions."

### Community shopper reports — not available

⟦FOUNDER: this feature is built but switched off. Keep this paragraph out of
the published policy, or keep it marked "not available," until the feature
is enabled. Enabling it needs its own review (it would add a selected state,
an optional store, and a rough purchase-time range, kept 12 months after the
last edit).⟧

### What the app does not collect

- Your name, email, phone number, contacts, photos, or precise or
  approximate location.
- What you search for. Search runs on your iPhone over recalls already
  downloaded.
- Which recalls you open, save, or share. Saved recalls stay on your iPhone,
  and sharing goes through the iPhone share sheet.
- Your payment details. Apple handles payment.
- Any analytics, crash-reporting, or advertising data.

## Information stored only on your iPhone

Your choices, both random identifiers, whether alerts are on, your progress
through setup, your saved recalls, the last subscription status the app
confirmed (plan, when it was checked, when it renews), the date of the last
daily check-in, and a cache of public recall information.

Some of these live in the iPhone's secure storage (the Keychain). That
storage can survive deleting and reinstalling the app.

## Allergen choices

Allergen choices can say something about someone's health. Some laws treat
them as consumer health data. Our separate **Consumer Health Data Policy**
covers them in detail: ⟦FOUNDER: URL⟧. ⟦PLANNED: in-app link, proposal §7 item 12⟧

- **On your iPhone**, your allergens show which recalls may matter to you.
  This works whether or not you consent to anything below.
- **On our server, only with your consent.** The first time you choose an
  allergen, the app asks whether to use your allergens for recall alerts.
  - If you agree, they are stored on our server (Supabase) and used **only**
    to decide which alerts to send you.
  - If you choose "Keep on this iPhone only", our server receives none of
    them, and alerts are not based on allergens.

  ⟦PLANNED: consent sheet, proposal §1. Until it ships, the app sends
  allergens to the server with every save, as described above.⟧

- **Allergens stored before this choice existed** are not used for alerts
  unless you consent. ⟦PLANNED: proposal §1.4; deleting them is a later,
  separate step⟧
- **Withdraw any time:** Profile → Privacy & Data Controls → "Use my
  allergens for alerts", or clear your allergens. The server copy is removed
  immediately. ⟦PLANNED⟧
- **Never** for advertising, never sold, never shared beyond the service
  providers listed below.
- **Deleted** with the rest of your data when you reset the app, and
  automatically after 12 months without use.

⟦UNCERTAIN: whether these laws reach an allergen watchlist kept "for you or
anyone you shop or cook for", and whether Washington's law covers an
individual operator. See the applicability review. Consent is offered either
way.⟧

## How we use information

- Showing which recalls may affect you. This matching runs on your iPhone.
- Sending the recall alerts you turned on, matched by the same rules.
- Keeping alert delivery reliable and non-duplicated (delivery records, the
  ordering counter).
- Confirming and restoring your subscription.
- Deleting inactive data (the last-opened date).
- Answering messages you send us.

We do not use personal information for advertising or marketing, we do not
sell it or share it for cross-context advertising, we do not give it to data
brokers, and we do not track you across other companies' apps or websites.

## Notifications

Alerts are optional and off until you turn them on and allow notifications
in iOS. When an alert is sent, Expo's push service passes the push token and
the alert text to Apple's Push Notification service, which delivers it to
your iPhone.

The alert text contains only public recall facts: the product and the
reason for the recall. Expo states that it does not store notification
content. Apple may hold one undelivered notification for up to 30 days while
your phone is offline.

You can turn alerts off in the app or in iOS Settings at any time.

## Subscriptions

- **Apple** sells the subscription and processes payment through your Apple
  Account. We never see your payment details.
- **RevenueCat** checks whether your subscription is active, using the
  purchase identifier, the purchase record from the App Store, and your
  device type and iOS version. RevenueCat says it uses the IP address of a
  request only to work out the country, and does not keep it.
- **Our server stores no purchase records.**
- Resetting the app keeps the purchase identifier, so an active
  subscription continues. On a new device, use Restore Purchases.
- Cancel in iOS Settings → your name → Subscriptions. Refunds are handled by
  Apple at reportaproblem.apple.com.

## Who receives information

We share information only with the service providers that run Lotly for us,
and only for that purpose. ⟦UNCERTAIN: confirm the data-processing terms in
place with each provider (Supabase and RevenueCat include them in their
standard terms; Expo offers them on request; Apple's terms govern App Store
and APNs), and that each provides protection equal to this policy (App Store
Review Guideline 5.1.1(i)).⟧

| Provider                              | What it receives                                                                                               | Why                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Supabase (database and image hosting) | Installation identifier, choices, alert registration, delivery records, last-opened date, request logs (below) | Storing and serving Lotly's data       |
| RevenueCat                            | Purchase identifier, App Store purchase records, device type and iOS version                                   | Checking and restoring subscriptions   |
| Expo (push service)                   | Push token and alert text                                                                                      | Delivering alerts                      |
| Apple                                 | Payment (as seller), push token and alert text (as Push Notification service)                                  | App Store purchases; delivering alerts |
| Vercel (website hosting)              | Website request logs (below)                                                                                   | Serving the website                    |
| Google (Gmail)                        | Emails you send to lotlysupport@gmail.com                                                                      | Receiving and answering your messages  |

Lotly is iPhone-only. Google's Android push service is not used.

We may also disclose information if the law requires it, for example in
response to a valid legal order.

## Hosting logs

Like any internet service, our providers' servers record routine details of
each request they receive, such as the IP address, the time and the
requested address.

- **Supabase** (our database host, Pro plan) keeps its request logs for
  **7 days**. Individual log entries cannot be deleted by us. We do not copy
  these logs anywhere else; no log export ("log drain") is configured.
- **Vercel**, which hosts the website, records the IP address, browser type
  and requested page. Vercel's own retention period is not published. We can
  see these logs for ⟦FOUNDER: 1 day on Vercel Pro; Vercel's Hobby plan is
  limited to non-commercial use, so a site promoting a paid app needs Pro⟧.
- **Expo** does not publish a retention period for push tokens.

The in-app reset cannot reach any of these logs.

## The website

The website is a set of static pages. Our pages set **no cookies**, run no
analytics or advertising scripts, and load nothing from other companies.
⟦FOUNDER: after deploying, confirm in a browser that the hosting platform
adds no cookie either; Vercel does not document this for public sites.⟧
Its fonts are served from our own pages. The hosting provider's logs are
described above. If you email us, we receive what you choose to send.

## How long we keep data

Two different things decide how long data lasts: **Lotly's own retention
rule**, which we control, and **our providers' logs and backups**, which
follow the providers' settings and are not covered by Lotly's rule.

### Lotly's retention rule (what we control)

| Data                                                                                                  | Kept until                                                                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Server copy of your choices, alert registration, delivery records, ordering counter, last-opened date | You reset the app, **or** 12 months pass without you using the app, whichever comes first |
| Data on your iPhone                                                                                   | You reset the app or delete it (secure-storage items can survive deletion; see above)     |
| Emails to us                                                                                          | ⟦FOUNDER: how long you keep support email; Gmail keeps messages until they are deleted⟧   |

**What counts as using the app:** opening it, or changing a choice in it.
Receiving a notification is not use; opening the app from one is.

After 12 months without use, our server deletes that installation's records
automatically. Nothing on your iPhone is deleted. If you come back, the app
sends your choices again and, if alerts are on, registers for them again.

Nothing is deleted this way before ⟦FOUNDER: the grace date — 12 months
after this policy is first published (rollout step 6)⟧, so anyone already
using Lotly when this policy takes effect has at least 12 months.

### Provider logs and backups (outside Lotly's 12-month rule)

| Where                     | What                                                                                             | How long                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase request logs     | IP address, time and requested address of each request to our database                           | 7 days (Supabase Pro). Cannot be deleted early by us                                                                                                                                                   |
| Supabase database backups | A copy of the whole database, including records later deleted by a reset or by the 12-month rule | Daily backups kept 7 days (Supabase Pro), so a deleted record can survive in a backup for up to 7 days ⟦FOUNDER: confirm the point-in-time-recovery add-on is not enabled; if it is, state its window⟧ |
| Vercel website logs       | IP address, browser type and requested page                                                      | Visible to us for 1 day on Vercel Pro; Vercel does not publish its own internal retention ⟦FOUNDER: Vercel plan — Hobby is non-commercial only⟧                                                        |
| RevenueCat                | Purchase identifier, App Store purchase records                                                  | Under RevenueCat's policy. RevenueCat says it drops the IP address after working out the country. Not affected by reset or the 12-month rule                                                           |
| Apple                     | Purchases (as seller); one undelivered notification for up to 30 days                            | Under Apple's policies                                                                                                                                                                                 |
| Expo                      | Push tokens                                                                                      | No published retention period. Expo says it does not store notification content                                                                                                                        |

## Your choices and controls

- **Change or clear your choices:** Profile → Personalization. The cleared
  value is copied to our server.
- **Turn alerts off:** Profile → Notifications, or iOS Settings. Delivery
  stops. The disabled registration is kept until you reset the app or 12
  months of inactivity pass.
- **Reset app and delete my data** (Profile → Privacy & Data Controls):
  - Deletes everything our server holds for this installation, in one step:
    the copy of your choices, the alert registration and its delivery
    records, the ordering counter and the last-opened date.
  - Clears your choices, alert setting, setup progress and saved recalls
    from the iPhone, and creates a new installation identifier.
  - Keeps your subscription.
  - If the server can't be reached, nothing changes and you can try again.
- **Deleting the app is not a deletion request.** The app can't contact our
  server when it is deleted. Use the reset first. If you delete the app
  without resetting, our server's records are deleted automatically 12
  months after you last used it.

## Requests about your data

You can see, correct, and delete your data in the app. The request then
comes from your own installation, so nothing more is needed to confirm it:

- **See and export:** "Show what Lotly's server holds" lists everything our
  server stores for your installation and the service providers that
  receive it. You can also share it as a file. ⟦PLANNED: proposal §3.1⟧
- **Correct:** change your choices in the app.
- **Delete:** "Reset app and delete my data".
- **Withdraw allergen consent:** see "Allergen choices". ⟦PLANNED⟧

**By email.**

- **Get a code.** In the app, tap "Get a request code" (Privacy & Data
  Controls) and choose what you want: a copy of your data, or deletion. Then
  email the code to lotlysupport@gmail.com. ⟦PLANNED: proposal §3.2⟧
- **What the code can do.** It works once, expires after 14 days, and only
  lets us find your installation for the request you chose. It cannot
  change anything by itself.
- **What we never ask for.** Your installation identifier. Never send it.
- **If you no longer have the app.** Reinstall Lotly on the same iPhone.
  Your installation usually comes back, because iOS keeps it in secure
  storage, and then you can use the in-app options or get a code.
- **If that isn't possible** (for example, a new or erased phone), we cannot
  confirm which records are yours: Lotly has no accounts, and many people
  make the same choices. We will reply in writing, explain why, and tell you
  how to appeal.

**Timing and appeals.**

- We respond within 45 days, extendable once by 45 days with notice.
- Deletions confirmed with a code are completed immediately; backups expire
  within 7 days.
- If we decline a request, reply "Appeal". We answer within 45 days and, if
  we deny it, tell you how to contact your state attorney general.
- We keep a short record of each request (date, type, outcome) for
  ⟦FOUNDER: 24 months proposed⟧. It never includes the code or your
  installation identifier.

## Children and teens

Lotly is intended for adults, and we market it to adults. You may use Lotly
if you are **13 or older**. If you are under 18, you may use it only with
the permission of a parent or guardian, who should review this policy with
you. Lotly is offered only in the United States.

- **We never ask for your date of birth.** ⟦PLANNED: before setup, the app
  asks Apple for your age range (for example "13 to 15" or "18 or older")
  through Apple's age-range feature.
  - Where state law requires it, Apple provides the range and you cannot
    decline.
  - Elsewhere, sharing it is your choice.
  - The range stays on your iPhone and is used only to apply these rules:
    under 13, the app stops; for 13 to 17, the app follows the protections
    below and asks a parent through Apple when a law requires their
    approval for a significant update. It is never sent to Lotly's server
    or to anyone else.

  Until this ships, the rules above rest only on our Terms of Use, which you
  agree to by using Lotly.⟧

- **Children under 13.** Lotly is not directed to children under 13, and we
  do not knowingly collect personal information from them. If you believe a
  child under 13 is using Lotly, email lotlysupport@gmail.com. "Reset app and
  delete my data" deletes the server records immediately.
- **Teens get the same protections as everyone.** Lotly has no ads, no
  profiling, no sale of data, no location tracking, no social features and
  no way to contact other users. Allergen choices are processed on our
  server only with the explicit consent described in "Allergen choices".
- **What a parent's permission does not do.** A parent's or guardian's
  permission to use Lotly is not a substitute for any consent a law
  requires: for example, the allergen consent in this policy, or a consent
  the law requires from a parent. If such a requirement applies, it is met
  separately.

## Where information is processed

Lotly is offered only in the United States; the App Store distributes it
only in the United States.

- **Our database** is hosted by Supabase in Northern California, USA (AWS
  `us-west-1`).
- **Our providers** may process information in other countries under their
  own terms.
- ⟦UNCERTAIN: if the app is offered outside the United States, review GDPR and
  UK GDPR applicability.⟧

## Security

- Communication between the app and our servers is encrypted in transit.
- Our database lets the app reach only its own installation's records,
  through narrow functions. The app holds no server secrets.
- Identifiers and choices on the iPhone are kept in the iOS Keychain.

No system is perfectly secure, and we cannot guarantee that information will
never be accessed without authorization. If a breach affects your
information, we will give notice as the applicable laws require.

- **How.** Lotly holds no email or postal address for you, so notice would
  generally be a notice on our website together with notice in major media.
  Where a law requires it, we would also provide a toll-free phone number.
- **In-app and push messages** may add to that notice; they do not replace
  it.

⟦UNCERTAIN: which notification laws apply, including the FTC Health Breach
Notification Rule; the procedure is in the proposal, §4.⟧

## Changes to this policy

If we change this policy, we will update the effective date. For material
changes, we will give notice in the app before the change takes effect.
⟦FOUNDER: confirm the notice mechanism.⟧

## Contact

Willis Yang — **lotlysupport@gmail.com**
