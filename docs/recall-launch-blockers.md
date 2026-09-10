# Founder inputs, counsel review, and publication blockers (C7)

Compiled 2026-08-28 from the C7 audit. Three lists with three owners: what
only the **founder** can supply, what only **qualified counsel** can resolve,
and the resulting **publication blockers** — the things that must be true
before the Privacy Policy is published, the trust center exposes it, or an
App Store submission is attempted. Nothing here is started automatically;
none of it is done by C7.

## 1. Founder-input checklist

Identity & destinations (currently none of these exist — none were invented):

- [ ] Legal developer/entity name (also decides guideline 5.1.1(ix): apps in
      highly regulated fields should be submitted by a legal entity).
- [ ] Privacy contact email (real, monitored).
- [ ] Support email / support destination (unlocks the App Store support
      URL, the Profile "Support" row, and the Corrections Policy's
      report-a-problem path).
- [ ] Public domain/URL to host the Privacy Policy (and later the trust
      documents' web versions).
- [ ] Privacy Policy effective date (set at publication).

Product decisions with policy consequences:

- [ ] Retention promises for what the C7.1 reset cannot reach: **the in-app
      "Reset app and delete my data" control now ships** (C7.1 — atomic
      `delete_installation_data` RPC + local reset; migration
      `20260902000000_installation_deletion.sql` was **verified applied in
      production on 2026-09-05** by the O2-A read-only audit — linked
      migration history matches the local file and the RPC is live on the
      Data API surface — so the policy may describe deletion as live), so
      self-service deletion of an installation's own rows is resolved in
      the app.
      Still open: how long rows persist for installations that never reset —
      disabled `token_reassigned` rows from pre-reinstall installs
      (unreachable by the reset RPC), abandoned installations, and delivery
      history — i.e. whether to ship an automatic retention/purge job (its
      own future migration). The consumer document states the current
      behavior honestly.
- [ ] Allergen-data architecture, after counsel input: keep the server
      mirror (and disclose as health data if so advised) or move allergen
      matching fully on-device and drop the column (changes push-eligibility
      capability).
- [ ] Final processor list confirmation (Supabase, Expo push, APNs/FCM) and
      whether data-processing terms with each are in place.
- [ ] Age-rating questionnaire answers (medical/treatment-information item).
- [ ] EULA decision: accept Apple's standard EULA (sufficient for the
      current free, accountless build unless counsel says otherwise) or
      commission custom Terms. Subscription language is explicitly deferred
      until subscriptions exist.
- [ ] Corrections-policy response-time commitments, if any are ever wanted
      (none are promised today).

Community shopper reports (P1C built the data foundation with the server
gate **disabled** — see [recall-shopper-reports.md](recall-shopper-reports.md)):

- [x] **Sybil/abuse posture — DECIDED 2026-09-10.** The founder accepts
      the residual multi-installation risk for the initial MVP: the
      bearer-installation model protects one installation's report from
      another, but does not prove one human has one installation, and the
      system is never described as Sybil-proof or verified-human. Accepted
      because the impact is bounded (a report can only move a count — it
      cannot introduce unofficial states, retailers, classifications, or
      notification behavior) and immediately containable (the kill
      switch). Hardening — device attestation, edge rate limiting, or
      accounts — is a recorded future option if abuse appears or usage
      materially scales; none was added, and no fingerprinting, IP
      storage, or invented quota exists.
- [x] **Shopper-report retention — DECIDED 2026-09-10.** Reports expire 12
      months after the most recent meaningful submission or edit
      (`expires_at`), stop counting the instant they expire, and are
      physically deleted by the daily `recall-shopper-report-expiry` cron
      within at most ~24 hours. (The separate C7-era question — stale
      push-registration rows of never-reset installations — remains open
      above and is not resolved by this.)
- [ ] **Enabling the feature** is still its own explicit production action
      (service-role update of `shopper_report_config`), separate from
      applying the migration, and stays off until P1D ships the
      point-of-submission notice + Privacy Policy link and the reviews
      below are done. Accepting the Sybil risk does not make the feature
      enabled or production-ready.

## 2. Counsel-review checklist

- [ ] **Apple Health data type**: whether server-synced allergen selections
      are "user-provided health or medical data" for the App Privacy label
      and the app-level privacy manifest (see
      `recall-app-store-readiness.md` §2 — framed there as a question, not a
      conclusion).
- [ ] **FTC Health Breach Notification Rule** (as amended, effective
      2024-07-29): applicability of "vendor of personal health records" /
      "PHR related entity" to Recall's installation-keyed preference mirror;
      if covered, breach-notification obligations and incident-response
      requirements.
- [ ] **State consumer-health-data laws** (e.g. Washington MHMD and
      analogues): whether allergen preferences are covered consumer health
      data; consent, disclosure, and deletion-right obligations.
- [ ] **General state privacy statutes** (CCPA/CPRA thresholds etc.):
      applicability at launch scale and required disclosures.
- [ ] **COPPA / children**: confirm the not-child-directed position.
- [ ] **Medical-device / FDA position**: confirm the informational app makes
      no device/diagnostic claim (guideline 1.4 posture and safety
      disclaimer wording).
- [ ] **Government-data presentation**: confirm the non-affiliation
      disclaimer and agency naming avoid endorsement/impersonation issues.
- [ ] **Privacy Policy draft** (`recall-privacy-policy-draft.md`): full
      review once founder inputs land, including the infrastructure-log
      statement, retention section, and rights section.
- [ ] **Terms/EULA**: whether Apple's standard EULA suffices for the current
      build; liability/disclaimer language for safety-information services.
- [ ] **Attributions**: confirm public-domain treatment of FDA/USDA content
      and the trademark note for label imagery is adequate.
- [ ] **Shopper-report disclosure** (added by P1C, prospective — the feature
      is built but disabled): review the community-report paragraph of the
      Privacy Policy draft and the App Privacy label implications of
      collecting a selected state, optional retailer, and purchase-time
      range keyed to the installation identifier, before the feature is
      enabled or the P1D point-of-submission notice ships.

## 3. Publication blockers — Privacy Policy (and its Profile row)

The policy may not be published, and no Profile row may link it, until ALL of
the following hold (the trust-center tests enforce the app-side half):

1. Every `⟦…⟧` placeholder in `recall-privacy-policy-draft.md` is resolved
   with real values — no invented entity, email, address, domain, or date.
2. The retention/deletion section describes behavior the system actually has.
   C7.1 shipped the in-app "Reset app and delete my data" control (and its
   RPC must be applied to production before the policy describes it as
   live); automatic retention windows for never-reset installations remain a
   founder decision to make — or to disclose as absent — before publication.
3. The health-data section reflects counsel's determinations (Apple type,
   HBNR, state laws).
4. Counsel review of the full text is complete (and is never described as
   "approved by Apple" or similar).
5. A public URL hosts the final text, and the same text ships in the trust
   center — one source, no drift.

## 4. Publication blockers — App Store submission

Everything in §3, plus (tracked in `recall-app-store-readiness.md`):

1. Support URL with a real destination.
2. App Privacy answers finalized (health + coarse-location rows) and the
   app-level privacy manifest populated to match.
3. Export-compliance declaration added to the build config.
4. Age rating completed.
5. Push-notification production credentials/build path (out of C7's scope;
   push delivery itself remains not activated).
6. Final review that the shipped build's behavior still matches the label
   (the C7 tests keep the no-tracking and no-analytics claims pinned).

## 5. Explicitly not blockers

- The seven in-app trust documents (Sources & Methodology, How Affects Me
  Works, Risk Levels Explained, Safety Disclaimer, Corrections Policy,
  Privacy & Data Controls, Attributions) describe verified current behavior,
  contain no placeholders or invented contacts (test-enforced), and are safe
  to ship now.
- The data-flow and SDK audits were verified at HEAD `5cef70d` (2026-08-28)
  and revised for C7.1 deletion and the C8 feed manifest/cache; data flows
  HAVE changed since that checkpoint, so the audits are **not** blanket
  "current at HEAD". Changed paths since `5cef70d`: the C8 incremental feed
  sync and on-device cache (`d92cb01`), the C7.1 deletion RPC (`ef78de7`),
  the C10B category filter (a derived projection field on the feed SELECT;
  session-only filter state), imagery-pipeline hardening (`10b6139`), the
  applied historical repairs (data corrections only), and the P1–P3E
  display-time presentation work (no network or storage changes). A bounded
  offline spot re-verification on 2026-09-05 confirmed: the feed cache
  carries a tested no-identity pin (`src/lib/feed-cache.test.ts`), no read
  path sends the installation id, and the only dependency-lock delta is
  `expo-file-system` moving from transitive to direct (its privacy manifest
  was already in the §5 inventory); an analytics/tracker sweep of the lock
  still returns zero. **Not re-run**: the exported-bundle secret scans and
  the privacy-manifest re-read (both dated 2026-08-28) — re-run them during
  submission prep, per §4.6.
