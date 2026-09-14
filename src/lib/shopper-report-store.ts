/**
 * Shopper-report client operations (P1C) — the thin layer the P1D
 * questionnaire will call. No screen, route, or copy here.
 *
 * Two rules this module exists to enforce:
 *
 * 1. MUTATIONS RIDE THE SHARED INSTALLATION QUEUE. Submitting or
 *    withdrawing a report serializes — via enqueueInstallationMutation —
 *    with preference saves, push registration writes, and "Reset app and
 *    delete my data", exactly like every other installation-scoped write
 *    (installation-lifecycle.ts). A submission queued before a reset
 *    completes first and is deleted by it; one queued after runs under the
 *    fresh installation identity. Unqueued, a submission in flight during a
 *    reset could recreate a row keyed to the just-deleted identity.
 *
 * 2. READS NEVER MINT AN IDENTITY. Checking for an existing report peeks
 *    the stored installation id and answers "none" when there isn't one —
 *    an installation that never submitted anything must not gain a server
 *    credential as a side effect of opening a screen (the same C7.1 rule
 *    peekInstallationId exists for). Only an actual submission creates the
 *    id, because submitting is precisely the choice to hold server state.
 *
 * Retry safety needs no bookkeeping here: the server upsert is strongly
 *    idempotent (an identical re-submission changes nothing; an edit
 *    updates in place), so a caller may simply call submitReport again
 *    after a failure — it can never double-count.
 *
 * Deletion: "Reset app and delete my data" needs no changes for shopper
 * reports — the server's delete_installation_data now removes them in the
 * same atomic transaction, and the app keeps no local shopper-report state
 * to clear.
 *
 * ## The one development-only diversion
 *
 * This module is also the single seam the DEVELOPMENT Design Preview harness
 * intercepts (lib/design-preview.ts, docs/recall-design-preview.md), because
 * it is the only thing both the Detail community block and the questionnaire
 * read shopper-report state through. Each function below asks the harness
 * first and falls through to the real server path whenever it answers
 * "not simulated" — which is every call outside an explicitly entered
 * preview session, every call about any other recall, and every call at all
 * in a release build, where the harness can hold no session.
 *
 * Two consequences are structural rather than promised. A simulated session
 * never reaches lib/report-api.ts, which owns every shopper-report `fetch`,
 * so no request — and in particular no mutation — is issued. And the
 * production gate is never read, copied, or overridden: the harness answers
 * the question the app would have asked the server, it does not switch
 * anything on, and outside a session it answers nothing.
 */

import type {
  MyShopperReport,
  ShopperReportDraft,
  ShopperReportSummary,
} from '@/domain/shopper-report';
import {
  previewShopperState,
  recordPreviewSubmission,
  recordPreviewWithdrawal,
} from './design-preview';
import { getOrCreateInstallationId, peekInstallationId } from './installation-id';
import { enqueueInstallationMutation } from './installation-lifecycle';
import {
  fetchMyShopperReport,
  fetchShopperReportSummary,
  submitShopperReport,
  withdrawShopperReport,
} from './report-api';

/** Submit (or edit) this installation's report for a case. Queued. */
export function submitReport(caseId: string, draft: ShopperReportDraft): Promise<MyShopperReport> {
  // Development Design Preview only: a simulated submission returns the
  // stored report from memory and never queues, never mints an installation
  // id, and never reaches report-api.
  const simulated = recordPreviewSubmission(caseId, draft, new Date().toISOString());
  if (simulated !== null) return Promise.resolve(simulated);
  return enqueueInstallationMutation(async () =>
    submitShopperReport({
      installationId: await getOrCreateInstallationId(),
      caseId,
      stateCode: draft.stateCode,
      retailerName: draft.retailerName,
      purchaseWindow: draft.purchaseWindow,
    }),
  );
}

/** Withdraw this installation's report for a case. Queued; never mints an id. */
export function withdrawReport(caseId: string): Promise<void> {
  // Development Design Preview only: a simulated removal clears the in-memory
  // report and contacts nothing.
  if (recordPreviewWithdrawal(caseId)) return Promise.resolve();
  return enqueueInstallationMutation(async () => {
    const installationId = await peekInstallationId();
    // No identity means no server rows exist to withdraw.
    if (installationId === null) return;
    await withdrawShopperReport(installationId, caseId);
  });
}

/** This installation's current report for a case, or null. Read-only. */
export async function loadMyReport(caseId: string): Promise<MyShopperReport | null> {
  // Development Design Preview only.
  const simulated = previewShopperState(caseId);
  if (simulated !== null) return simulated.report;
  const installationId = await peekInstallationId();
  if (installationId === null) return null;
  return fetchMyShopperReport(installationId, caseId);
}

/** The public thresholded community summary for a case. Read-only. */
export function loadReportSummary(caseId: string): Promise<ShopperReportSummary> {
  // Development Design Preview only. Outside a simulated session — which is
  // always, in a release build — this is the server's answer and nothing else,
  // so the production gate remains the only switch the app has.
  const simulated = previewShopperState(caseId);
  if (simulated !== null) return Promise.resolve(simulated.summary);
  return fetchShopperReportSummary(caseId);
}
