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
 */

import type {
  MyShopperReport,
  ShopperReportDraft,
  ShopperReportSummary,
} from '@/domain/shopper-report';
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
  return enqueueInstallationMutation(async () => {
    const installationId = await peekInstallationId();
    // No identity means no server rows exist to withdraw.
    if (installationId === null) return;
    await withdrawShopperReport(installationId, caseId);
  });
}

/** This installation's current report for a case, or null. Read-only. */
export async function loadMyReport(caseId: string): Promise<MyShopperReport | null> {
  const installationId = await peekInstallationId();
  if (installationId === null) return null;
  return fetchMyShopperReport(installationId, caseId);
}

/** The public thresholded community summary for a case. Read-only. */
export function loadReportSummary(caseId: string): Promise<ShopperReportSummary> {
  return fetchShopperReportSummary(caseId);
}
