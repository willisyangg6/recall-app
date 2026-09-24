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
      URL, the Profile "Support" row, the Corrections Policy's
      report-a-problem path, and — since P2B7X.1 — the paywall's `Support`
      footer action, which reads `RELEASE_DESTINATIONS.support` in
      `src/lib/release-destinations.ts`).
- [ ] Public domain/URL to host the Privacy Policy (and later the trust
      documents' web versions). **This is also what blocks native sharing**
      — the shared URL must be a Lotly Universal Link on that domain (§6) —
      and, since P2B7X.1, the paywall's `Privacy` and `Terms` footer actions
      (`RELEASE_DESTINATIONS.privacy` / `.terms`). All three destinations are
      `null` in the repository; `npm run qa:launch-readiness` exits non-zero
      until each is a real HTTPS URL, and the paywall shows its
      unconfigured-link sentence for each in the meantime. Nothing was
      invented.
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
- [x] **Point-of-submission notice + privacy link — SHIPPED by P1D
      (2026-09-11).** The review step of the questionnaire states, above the
      Submit control, what a report saves, what it never includes, that only
      a total at three or more is ever shown, and that the report stays the
      shopper's to change or remove — beside a link to the in-app Privacy &
      Data Controls document, which now carries a full "Community shopper
      reports" section. The link deliberately does **not** open the formal
      Privacy Policy draft, which stays unpublished (§3 below).
- [ ] **Enabling the feature** is still its own explicit production action
      (service-role update of `shopper_report_config`), separate from the
      migration (applied 2026-09-11) and from the shipped UI. It stays off
      until the counsel review and App Privacy label answers below are
      done. Neither accepting the Sybil risk nor shipping the UI makes the
      feature enabled or production-ready.

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
- [ ] **Shopper-report disclosure** (the feature is fully built but
      disabled): review the community-report paragraph of the Privacy Policy
      draft, the shipped "Community shopper reports" section of the in-app
      Privacy & Data Controls document, the shipped point-of-submission
      notice, and the App Privacy label implications of collecting a
      selected state, optional retailer, and purchase-time range keyed to
      the installation identifier — all before the feature is enabled.

## 2b. Operational monitoring (P2B7S, 2026-09-19)

Ingestion freshness is **operations-only**: shoppers never see when recalls
were last checked, and are never told a refresh failed over recalls already
on screen. That is a deliberate product decision
([recall-production-runbook.md](recall-production-runbook.md) §18), so the
founder is the only audience for an ingestion problem — which makes the
dead-man alert the whole alerting story.

Already done by the founder:

- [x] Healthchecks check created.
- [x] Failure and recovery notifications test-delivered.
- [x] 1-hour period and 1-hour grace restored.
- [x] `HEARTBEAT_URL` added to GitHub Actions secrets.

Remaining, and it is the **P0**:

- [ ] **Unpause the Healthchecks check**, after the workflow that pings it
      is on `master`. Until then the check is paused and nothing is
      watching; the workflow step itself is harmless either way (it exits 0
      and prints `NOT CONFIGURED` when the secret is absent).
- [ ] Confirm branch protection on `master` (it is the deploy channel) and
      whether GitHub emails you when a **watchdog-dispatched** run fails.

No migration is required. The heartbeat reads `ingest_runs` with the
service role it already holds; the consumer-facing freshness view was
designed, reviewed and then deleted unused.

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
7. **Subscription launch (P2B7X.2, not started).** P2B7X.1 built the hard
   paywall, the access gate and the typed purchase boundary with a
   development-only adapter
   ([recall-onboarding-and-paywall.md](recall-onboarding-and-paywall.md)).
   Still needed before any purchase can occur: Apple enrollment (§6 of the
   release-readiness doc), the App Store subscription group with the annual
   and monthly products (expected US prices $29.99/year and $4.99/month),
   RevenueCat configured with one entitlement and one offering, the
   RevenueCat adapter behind `PurchaseProvider`, the SDK's public key as a
   recorded third `EXPO_PUBLIC_` variable, the Terms/Privacy/Support
   destinations above, subscription language in the EULA decision, and the
   App Privacy "Purchases" answer. Production without a configured provider
   fails closed: the paywall shows the could-not-confirm state and nothing
   grants access.
8. Expo display name: **applied by P3C1 (2026-09-16)** — `app.json` now
   names the app `Lotly`, with scheme `lotly` and bundle identifier
   `com.willisyang.lotly` (iPhone-only). What remains is the native release
   verification itself: the name under the icon, the
   notification-permission dialog, and `lotly://` deep links have not been
   seen on a device, because no signed build exists. See
   [recall-release-readiness.md](recall-release-readiness.md).
9. Shopper-report launch-state compliance: while `reports_enabled` is false
   the in-app explanations are phrased conditionally ("When community
   shopper reports are available for a recall…", P2B6C). Enabling the gate
   needs the counsel review and App Privacy answers in §1–2 and a re-check
   of that copy.
10. Legal review of the health (allergen), attribution (public-domain) and
    privacy claims the in-app documents make (§2).

## 5. Explicitly not blockers

- The seven in-app trust documents (Sources & Methodology, How Affects Me
  Works, Risk Levels Explained, Safety Disclaimer, Corrections Policy,
  Privacy & Data Controls, Attributions) describe verified current behavior,
  contain no placeholders or invented contacts (test-enforced), and are safe
  to ship now. P2B6C removed the two interim placeholder sentences (a
  promised formal privacy policy, a promised support contact) and the
  destinations themselves remain the open items in §1, §3 and §4.
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

## 6. Deferred product decision — native sharing and the shared recall URL

Recorded 2026-09-17 (P2B7C). **Nothing here is implemented, and none of it
was built in that milestone.** This is the founder's decision about what
sharing must be when it is built, written down so the cheap version is not
shipped by accident.

**Native sharing is intentionally deferred.** Recall Detail has no share
control today; the Figma frame's share glyph is unrendered
([../DESIGN.md](../DESIGN.md), conflict 9), and
`src/lib/share-message.ts` — a pure message builder from C6 — has no caller.

**Sharing only the official agency URL was considered and rejected.** It is
the version that could ship immediately, and it gives Lotly no acquisition
loop at all: the recipient lands on fda.gov or fsis.usda.gov, never learns
the app exists, and the sender gets no credit for the thing they actually
found useful. A share that cannot bring anyone back is not worth the control
it costs.

What sharing must be when it is built:

1. The shared URL is an **HTTPS Lotly Universal Link** on the final Lotly
   domain. A custom `lotly://` URL is never the externally shared URL — it
   dead-ends for everyone without the app installed, and messaging clients
   treat it as untrustworthy or unlinkable.
2. A recipient **with the app installed** lands on that exact Recall Detail
   screen.
3. A recipient **without it** lands on a small branded recall preview page:
   the recall's identity, an App Store call to action, and a link to the
   official agency notice. Official attribution is never dropped for
   branding — the preview cites the source, as every Lotly surface does.
4. The minimum set of public routes is therefore **recall preview, privacy,
   and support** — the same domain the Privacy Policy and support
   destination in §1 need, which is why one decision unblocks all three.

**Blocked on:** acquiring the final domain (§1). Until it exists there is no
Universal Link to share, no `apple-app-site-association` file to host, and no
preview page to land on. Sharing stays absent rather than shipping an
official-URL-only version in the meantime.
