/**
 * Shopper-report backend calls (P1C): thin wrappers over the four narrowly
 * scoped SECURITY DEFINER RPCs in the shopper_reports migration. Same
 * security posture as push-api.ts — client-safe configuration only
 * (EXPO_PUBLIC_* + publishable key); raw report rows are not readable
 * through this key in any direction, and the only public aggregate is the
 * thresholded summary.
 *
 * Every response passes through the domain sanitizers before the app sees
 * it, so a malformed or unexpected server echo degrades to "no report" /
 * "unavailable" — never to garbage in a form or a fabricated count.
 *
 * Mutations here are RAW calls: ordering against preference saves, push
 * writes, and "Reset app and delete my data" is the caller's job via the
 * shared installation mutation queue (shopper-report-store.ts wires that).
 */

import {
  sanitizeMyShopperReport,
  sanitizeReportSummary,
  type MyShopperReport,
  type PurchaseWindow,
  type ShopperReportSummary,
} from '@/domain/shopper-report';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Recall backend is not configured.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`Shopper report request failed (HTTP ${response.status}).`);
  }
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}

/**
 * Submit (or re-submit) this installation's report for a case. The server
 * upserts on (installation, case): retrying after a network error can never
 * create a second report or move any public count — an identical
 * re-submission changes nothing at all, an edited one updates in place.
 * Returns the stored report as the server now holds it.
 */
export async function submitShopperReport(input: {
  installationId: string;
  caseId: string;
  stateCode: string;
  retailerName: string | null;
  purchaseWindow: PurchaseWindow;
}): Promise<MyShopperReport> {
  const raw = await rpc('submit_shopper_report', {
    p_installation_id: input.installationId,
    p_case_id: input.caseId,
    p_state_code: input.stateCode,
    p_retailer_name: input.retailerName,
    p_purchase_window: input.purchaseWindow,
  });
  const report = sanitizeMyShopperReport(raw);
  if (report === null) {
    throw new Error('Shopper report response was not understood.');
  }
  return report;
}

/** This installation's current report for a case, or null when none exists. */
export async function fetchMyShopperReport(
  installationId: string,
  caseId: string,
): Promise<MyShopperReport | null> {
  const raw = await rpc('get_my_shopper_report', {
    p_installation_id: installationId,
    p_case_id: caseId,
  });
  return sanitizeMyShopperReport(raw);
}

/**
 * Withdraw this installation's report for a case: physical server-side
 * deletion, reflected in the public aggregate immediately. Idempotent —
 * withdrawing an absent report succeeds identically and reveals nothing.
 */
export async function withdrawShopperReport(installationId: string, caseId: string): Promise<void> {
  await rpc('withdraw_shopper_report', {
    p_installation_id: installationId,
    p_case_id: caseId,
  });
}

/**
 * The public thresholded community summary for a case. Below the visibility
 * threshold the server answers with one indistinguishable state; at or
 * above it, the real exact total.
 */
export async function fetchShopperReportSummary(caseId: string): Promise<ShopperReportSummary> {
  const raw = await rpc('get_shopper_report_summary', { p_case_id: caseId });
  return sanitizeReportSummary(raw);
}
