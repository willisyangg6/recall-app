/**
 * In-memory mirror of the shopper-report RPCs for deterministic tests.
 * Behavior mirrors the SQL in the 20260910 shopper_reports migration — the
 * eligibility and validation rules, the (installation, case) unique upsert
 * with strong idempotency, the 12-month retention contract (expiry set on
 * insert, reset only by a meaningful edit, `expiresAt <= now` IS expired,
 * an expired row is invisible everywhere and never blocks a fresh
 * submission), withdrawal, the thresholded summary shape, the kill
 * switch's exact scope, the physical expiry cleanup, and the
 * delete_installation_data extension — so tests prove the same invariants
 * production relies on (the same split as MemoryPushStore /
 * installation-deletion.test.ts; the live PostgREST proof runs on the
 * disposable stack).
 */

import {
  SHOPPER_REPORT_RETENTION_MONTHS,
  SHOPPER_REPORT_VISIBILITY_THRESHOLD,
  type MyShopperReport,
  type ShopperReportSummary,
} from '../../domain/shopper-report';
import { POSTAL_TO_STATE } from '../../domain/us-geography';

/** The case facts the RPCs read from recall_cases.projection. */
export interface ShopperCaseFacts {
  id: string;
  state: 'active' | 'closed' | 'retracted';
  mergedInto: string | null;
  geographyScope: 'states' | 'nationwide' | 'unknown';
  /** Full state names, as projection geography stores them. */
  geographyStates: string[];
  /** undefined mirrors a projection persisted before the field existed. */
  retailerNames: string[] | undefined;
}

interface ReportRow {
  installationId: string;
  caseId: string;
  stateCode: string;
  retailerName: string | null;
  purchaseWindow: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const INSTALLATION_ID = /^[A-Za-z0-9-]{16,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURCHASE_WINDOWS = new Set([
  'past_week',
  'past_month',
  'past_three_months',
  'longer_ago',
  'not_sure',
]);

function rowKey(installationId: string, caseId: string): string {
  return `${installationId}|${caseId}`;
}

/**
 * `now + interval '12 months'` in Postgres calendar semantics, UTC: the
 * same day-of-month twelve months on, with the day clamped to the target
 * month's length (Feb 29 + 12 months = Feb 28, as Postgres computes it).
 */
export function retentionExpiry(nowIso: string): string {
  const now = new Date(nowIso);
  const targetYear = now.getUTCFullYear() + Math.floor(SHOPPER_REPORT_RETENTION_MONTHS / 12);
  const targetMonth = now.getUTCMonth() + (SHOPPER_REPORT_RETENTION_MONTHS % 12);
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(now);
  result.setUTCFullYear(targetYear, targetMonth, Math.min(now.getUTCDate(), lastDay));
  return result.toISOString();
}

/** The retention boundary: an expiry instant that has ARRIVED is expired. */
function isExpired(row: ReportRow, nowIso: string): boolean {
  return row.expiresAt <= nowIso;
}

function toReport(row: ReportRow): MyShopperReport {
  return {
    stateCode: row.stateCode,
    retailerName: row.retailerName,
    purchaseWindow: row.purchaseWindow as MyShopperReport['purchaseWindow'],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class MemoryShopperStore {
  /** Mirrors the seeded shopper_report_config row: OFF by default. */
  reportsEnabled = false;
  cases = new Map<string, ShopperCaseFacts>();
  private rows = new Map<string, ReportRow>();

  addCase(facts: ShopperCaseFacts): void {
    this.cases.set(facts.id, facts);
  }

  /** ALL physical rows for one case (live and expired) — invariance hook. */
  rowsForCase(caseId: string): ReportRow[] {
    return [...this.rows.values()].filter((row) => row.caseId === caseId);
  }

  /** A row's raw expiry instant, expired or not — test inspection hook. */
  expiryOf(installationId: string, caseId: string): string | null {
    return this.rows.get(rowKey(installationId, caseId))?.expiresAt ?? null;
  }

  /** submit_shopper_report semantics, mirrored. */
  submit(
    installationId: string,
    caseId: string,
    stateCode: string,
    retailerName: string | null,
    purchaseWindow: string,
    nowIso: string,
  ): MyShopperReport {
    if (!INSTALLATION_ID.test(installationId ?? '')) throw new Error('invalid installation id');
    if (!UUID.test(caseId ?? '')) throw new Error('invalid case id');
    if (!PURCHASE_WINDOWS.has(purchaseWindow)) throw new Error('invalid purchase window');
    if (retailerName !== null && (retailerName.length < 1 || retailerName.length > 120)) {
      throw new Error('invalid retailer');
    }
    if (!this.reportsEnabled) throw new Error('shopper reports are not available');

    const facts = this.cases.get(caseId);
    if (!facts || facts.mergedInto !== null || facts.state !== 'active') {
      throw new Error('reporting is not available for this recall');
    }

    const stateName = POSTAL_TO_STATE[stateCode] ?? null;
    if (stateName === null) throw new Error('invalid state code');
    if (facts.geographyScope === 'states') {
      if (facts.geographyStates.length === 0 || !facts.geographyStates.includes(stateName)) {
        throw new Error('invalid state for this recall');
      }
    } else if (facts.geographyScope !== 'nationwide') {
      throw new Error('reporting is not available for this recall');
    }

    const choices = facts.retailerNames ?? [];
    if (retailerName !== null && !choices.includes(retailerName)) {
      throw new Error('invalid retailer for this recall');
    }

    const key = rowKey(installationId, caseId);
    // The caller's own EXPIRED row is dead metadata: remove it first so a
    // new valid submission starts fresh (version 1, fresh created_at)
    // instead of reviving it — the SQL pre-delete, mirrored.
    const standing = this.rows.get(key);
    if (standing && isExpired(standing, nowIso)) this.rows.delete(key);

    const existing = this.rows.get(key);
    if (existing) {
      const identical =
        existing.stateCode === stateCode &&
        existing.retailerName === retailerName &&
        existing.purchaseWindow === purchaseWindow;
      if (identical) return toReport(existing); // nothing moves — not even expiry.
      const updated: ReportRow = {
        ...existing,
        stateCode,
        retailerName,
        purchaseWindow,
        version: existing.version + 1,
        updatedAt: nowIso,
        // A meaningful edit restarts the retention clock.
        expiresAt: retentionExpiry(nowIso),
      };
      this.rows.set(key, updated);
      return toReport(updated);
    }
    const inserted: ReportRow = {
      installationId,
      caseId,
      stateCode,
      retailerName,
      purchaseWindow,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: retentionExpiry(nowIso),
    };
    this.rows.set(key, inserted);
    return toReport(inserted);
  }

  /** get_my_shopper_report semantics: own LIVE row or null; never gated. */
  getMine(installationId: string, caseId: string, nowIso: string): MyShopperReport | null {
    if (!INSTALLATION_ID.test(installationId ?? '')) throw new Error('invalid installation id');
    if (!UUID.test(caseId ?? '')) throw new Error('invalid case id');
    const row = this.rows.get(rowKey(installationId, caseId));
    if (!row || isExpired(row, nowIso)) return null;
    return toReport(row);
  }

  /** withdraw_shopper_report semantics: idempotent own-row delete; never gated. */
  withdraw(installationId: string, caseId: string): void {
    if (!INSTALLATION_ID.test(installationId ?? '')) throw new Error('invalid installation id');
    if (!UUID.test(caseId ?? '')) throw new Error('invalid case id');
    this.rows.delete(rowKey(installationId, caseId));
  }

  /** get_shopper_report_summary semantics, mirrored byte-for-byte in shape. */
  summary(caseId: string, nowIso: string): ShopperReportSummary {
    if (!UUID.test(caseId ?? '')) throw new Error('invalid case id');
    if (!this.reportsEnabled) return { status: 'unavailable' };
    const facts = this.cases.get(caseId);
    if (!facts || facts.mergedInto !== null || facts.state !== 'active') {
      return { status: 'unavailable' };
    }
    const usable =
      facts.geographyScope === 'nationwide' ||
      (facts.geographyScope === 'states' && facts.geographyStates.length > 0);
    if (!usable) return { status: 'unavailable' };

    // Live rows only — an expired report stops counting the instant its
    // expiry passes, whether or not the physical cleanup has run.
    const count = this.rowsForCase(caseId).filter((row) => !isExpired(row, nowIso)).length;
    if (count < SHOPPER_REPORT_VISIBILITY_THRESHOLD) return { status: 'below_threshold' };
    return { status: 'reported', count };
  }

  /** cleanup_expired_shopper_reports semantics: physical, expired-only. */
  cleanup(nowIso: string): number {
    let deleted = 0;
    for (const [key, row] of this.rows) {
      if (isExpired(row, nowIso)) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  /** The delete_installation_data extension: every owned report goes. */
  deleteInstallationData(installationId: string): void {
    if (!INSTALLATION_ID.test(installationId ?? '')) throw new Error('invalid installation id');
    for (const [key, row] of this.rows) {
      if (row.installationId === installationId) this.rows.delete(key);
    }
  }
}
