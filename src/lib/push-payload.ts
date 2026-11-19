/**
 * Push payload validation — the ONLY gate between a tapped notification and
 * navigation. Pure and Expo-free so tests can prove it in Node.
 *
 * The app never navigates to a URL carried in a push. It validates the typed
 * payload (kind + canonical UUID) and constructs the internal route itself;
 * anything malformed, unexpected, or non-recall (e.g. the labeled test
 * notification, kind 'test') simply does not navigate.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecallPushPayload {
  /**
   * The Recall Details route id: an agency case's UUID, or `retailer:<uuid>`
   * for an approved retailer-only notice (lib/retailer-notice-presentation
   * `retailerRouteId`) — the same id the Feed card opens.
   */
  recallCaseId: string;
  notificationEventId: string | null;
}

/** null = do not navigate. Never throws — a bad payload must never crash. */
export function parseRecallPushPayload(data: unknown): RecallPushPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  let routeId: string;
  if (record.kind === 'recall') {
    const recallCaseId = record.recallCaseId;
    if (typeof recallCaseId !== 'string' || !UUID_PATTERN.test(recallCaseId)) return null;
    routeId = recallCaseId;
  } else if (record.kind === 'retailer_notice') {
    const noticeId = record.retailerNoticeId;
    if (typeof noticeId !== 'string' || !UUID_PATTERN.test(noticeId)) return null;
    routeId = `retailer:${noticeId}`;
  } else {
    return null;
  }
  const eventId = record.notificationEventId;
  return {
    recallCaseId: routeId,
    notificationEventId: typeof eventId === 'string' && UUID_PATTERN.test(eventId) ? eventId : null,
  };
}
