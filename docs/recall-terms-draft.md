# Terms of Use — DRAFT (not published, not in effect, not legal advice)

> **STATUS: DRAFT, 2026-10-12.** It is not in effect and must not be
> published or linked until:
>
> - the founder has decided every `⟦FOUNDER: …⟧` item and accepted every
>   `⟦UNCERTAIN: …⟧` item as a stated residual uncertainty (Willis is not
>   engaging counsel at this stage; counsel review is optional, not a gate,
>   and this text claims no guaranteed legal compliance);
> - it matches the published Privacy Policy
>   ([recall-privacy-policy-draft.md](recall-privacy-policy-draft.md)).
>
> Sources for every Apple requirement below:
> `~/Desktop/Lotly-Privacy-Correctness-Review/` (research notes, 2026-10-12).

## Part 1 — Evaluation: which licence structure

**Requirement.** Lotly sells auto-renewing subscriptions. Apple's Developer
Program License Agreement, Schedule 2 §3.8(b), requires: "Links to Your
Privacy Policy and Terms of Use must be accessible within Your Licensed
Application." App Store Review Guideline 3.1.2(c) requires communicating
those Schedule 2 terms. Apple's subscription page says the app **and** its
App Store metadata must link both.

**Option A (recommended): Apple's Standard EULA plus "Lotly Terms of Use".**
The Standard EULA
(<https://www.apple.com/legal/internet-services/itunes/dev/stdeula/>)
applies automatically when no custom EULA is uploaded. It already provides:

- the licence scope and Usage Rules, and termination on breach;
- "Data displayed by any Licensed Application … including … medical …
  information, is for general informational purposes only";
- an "AS IS" disclaimer of warranties, including accuracy;
- a $50.00 cap on the licensor's total liability, where the law allows it;
- export and U.S. Government terms;
- a California governing-law clause, phrased about the user and **Apple**.

The Standard EULA contains **no arbitration clause and no class-action
waiver**. Lotly's own Terms (Part 2) add only what is specific to Lotly:

- the recall-source limitations and how to check a package;
- the notification limits;
- the subscription disclosures;
- acceptable use, and contact details.

Open points:

- The EULA says nothing about whether a developer may supplement it. ⟦UNCERTAIN:
  confirm that publishing supplemental Terms alongside the Standard EULA is
  effective, and how any conflict is resolved.⟧
- Where the Terms link goes in App Store metadata: Apple's official pages say
  only "metadata"; App Review practice cites the App Description or the EULA
  field. ⟦FOUNDER at submission: put the link in the App Description.⟧

**Option B: a custom EULA.** Apple's DPLA Exhibit D sets minimum terms. A
custom EULA must:

- acknowledge it is between the developer and the user, "not with Apple";
- state that the developer alone handles maintenance and support;
- state that for a failure to conform to a warranty, the user "may notify
  Apple, and Apple will refund the purchase price";
- not limit the developer's liability to the user "beyond what is permitted
  by applicable law";
- make Apple a third-party beneficiary;
- include the developer's name and address and contact information
  (telephone number and email address).

For an individual operator, that last requirement means publishing a
postal address and phone number. **Not recommended now**: it adds drafting
and legal cost and gains nothing Lotly needs.

**Deliberately not included anywhere in this draft:** arbitration,
class-action or jury-trial waivers, a liability cap other than the Standard
EULA's, a chosen governing law or venue, and unilateral-change clauses that
bind users without notice. Each is a decision for the founder with a lawyer,
not a default.

---

## Part 2 — Draft text: Lotly Terms of Use

**Effective date:** ⟦FOUNDER: set at publication⟧

### 1. These terms

Lotly is provided by **Willis Yang**, an individual ("we," "us"). Contact:
**lotlysupport@gmail.com**.

Your use of the Lotly iPhone app is governed by Apple's Licensed Application
End User License Agreement (the "Standard EULA") and by these Terms. These
Terms add details specific to Lotly. ⟦UNCERTAIN: the order of precedence if they
ever conflict.⟧ Our [Privacy Policy](⟦URL⟧) explains how we handle
information. These Terms also cover the Lotly website.

### 2. Who may use Lotly

- You must be **13 or older**.
- If you are **under 18**, you may use Lotly only with the permission of a
  parent or guardian. They should review these Terms and the Privacy Policy
  with you. If you buy a subscription, the purchase is made through an
  Apple Account and is subject to Apple's rules for that account, including
  any Family Sharing or Ask to Buy settings.
- Lotly is offered only in the United States.
- Lotly is intended and marketed for adults.

We do not ask for your age, and we do not verify these requirements. A
parent's or guardian's permission under this section is permission to use
the service. It is not a substitute for any separate consent that a law or
this service requires, such as the allergen consent described in the Privacy
Policy.

### 3. What Lotly is

Lotly is an **informational** service. It shows food recall notices
published by the U.S. Food and Drug Administration (FDA) and the U.S.
Department of Agriculture's Food Safety and Inspection Service (FSIS), with a
link to each official notice.

- Lotly is independent. It is **not affiliated with, sponsored by, or
  endorsed by** the FDA, the USDA, or any government agency.
- Lotly is not a safety certification, and it makes no judgment of its own
  about any product.

### 4. Limits of recall information

- **The official notice controls.** If anything in Lotly differs from the
  official notice, follow the official notice.
- **Lotly can be late or incomplete.** Notices reach Lotly after the agency
  publishes them, and agencies update notices over time. Lotly may miss a
  notice, show it late, or show details that have since changed.
- **Matching is a shortlist, not a guarantee.** "Affects me" and alerts
  compare your chosen states, allergens and stores with what notices state.
  Notices do not always list every state, store, ingredient or package
  detail, so a recall that affects you may not be matched, and a matched
  recall may not affect you.
- **Absence is not safety.** A product that does not appear in Lotly, or in
  your matches, is not therefore safe. Agencies do not recall every hazardous
  product.

### 5. Checking a product you have

If a recall may involve something you bought:

1. Open the official notice from the recall in Lotly.
2. Compare your package with the notice. Look at the brand, product name,
   package size, UPC, lot or batch codes, and dates such as "best by" or
   "use by". For USDA-inspected meat, poultry and egg products, also look at
   the establishment number (shown as "EST.") inside the USDA mark of
   inspection.
3. If it matches, follow the notice's instructions. Typically: do not eat
   it; throw it away or return it to the place of purchase.
4. If you are unsure, follow the official notice or contact the company it
   names.
5. **Not medical advice.** If you or someone you care for may have eaten a
   recalled product, or feels unwell, contact a healthcare professional. In
   an emergency, call 911.

### 6. Notifications

Recall alerts are optional.

- **Delivery depends on others.** It depends on Expo's push service, Apple's
  Push Notification service, your iPhone's settings and connectivity, and
  the timing of agency publication.
- **We don't guarantee any alert.** We do not guarantee that an alert will be
  sent, that it will arrive, or when.
- **Not every match triggers an alert.** Some matching recalls, and some
  updates to recalls, are not sent as alerts.
- **Check the app.** An alert is a prompt to look, not a complete safety
  notice. Check the app and the official notice regularly whether or not you
  receive alerts.

### 7. Subscriptions

- **What you pay for.** Lotly requires a paid, auto-renewing subscription
  (monthly or annual). The price, length and renewal terms are shown in the
  app before you buy, and on the App Store. Prices come from the App Store
  and may vary by region and taxes.
- **Who sells it.** Apple sells and bills the subscription through your
  Apple Account. Apple's payment terms apply.
- **Auto-renewal.** The subscription renews automatically at the end of each
  period until you cancel. ⟦UNCERTAIN: confirm the renewal and cancellation
  disclosures required by the California Automatic Renewal Law (as amended
  effective July 1, 2025) and the federal ROSCA. Decide whether Apple's
  purchase flow and notices satisfy them, or whether Lotly must add its own,
  for example an annual reminder. Verify Apple's current wording on when
  cancellation must happen before renewal.⟧
- **Cancelling.** iOS Settings → your name → Subscriptions → Lotly → Cancel
  Subscription. Cancelling stops future renewals. ⟦verify against Apple's
  current terms: access continuing to the end of the period already paid⟧
- **Refunds.** Apple handles them. Request one at reportaproblem.apple.com.
  We cannot issue refunds for App Store purchases ourselves. We do not send
  Apple information about your use of the app for refund decisions.
  ⟦FOUNDER: keep that last sentence only if you will not use Apple's
  consumption-information feature, which requires your consent.⟧
- **Restoring.** Use Restore Purchases in the app, for example on a new
  device. Resetting the app's data does not end your subscription.
- **When a subscription ends.** You lose access to the app's recall
  features. Your choices stay on your iPhone. Server data follows the
  Privacy Policy's retention rules.
- **Price changes** are communicated through Apple under its rules.

### 8. Acceptable use

Do not:

- use Lotly to break the law;
- try to access other people's data, or Lotly's systems beyond what the app
  does;
- disrupt or overload Lotly's services, or use automated means to extract
  data from Lotly's servers;
- present Lotly, or its content, as coming from or endorsed by a government
  agency.

Government recall notices themselves are public information, and nothing
here limits your use of them from their official sources.

### 9. Ownership

Lotly's app, website, design and original text are owned by us. Recall
information from the FDA and FSIS comes from public government sources.
Brand names and product images in notices belong to their owners and appear
only to identify recalled products. Open-source software in Lotly is listed
in the app's Attributions.

### 10. Disclaimers and liability

The Standard EULA's "No Warranty" and "Limitation of Liability" sections
apply to Lotly. ⟦UNCERTAIN: whether to keep the Standard EULA's $50 cap as the
only limitation; how consumer-protection law and personal-injury claims
interact with it for a safety-information service; whether anything further
is appropriate.⟧

### 11. Your legal rights

Nothing in these Terms limits any right you have under laws that cannot be
waived or limited by contract.

### 12. Changes and ending

- **Changes to these Terms.** We may update them. For material changes, we
  will give notice in the app before they take effect. ⟦UNCERTAIN: the effect of
  continued use.⟧
- **Ending service.** We may suspend or discontinue Lotly. ⟦FOUNDER:
  what subscribers are told, and how refunds work, if the service ends
  during a paid period.⟧
- **Leaving.** You can stop using Lotly at any time. Cancel the subscription
  in iOS Settings, and use "Reset app and delete my data" before deleting
  the app (see the Privacy Policy).

### 13. Governing law and disputes

⟦FOUNDER: not chosen. No arbitration, class-action waiver or venue
clause is included. The Standard EULA's California clause is written about
Apple. Decide whether to name a governing law at all.⟧

### 14. Contact

Willis Yang — **lotlysupport@gmail.com**
