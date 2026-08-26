/**
 * FDA hero-image backfill — an explicit maintenance operation, deliberately
 * outside normal ingestion.
 *
 * Why it is needed: `heroImageUrl` is derived at PARSE time, and incremental
 * ingestion re-parses a record only when the source page's content hash moves
 * (pipeline.ts hash gate). Records ingested before the parser learned to
 * extract product photos are therefore correct-but-imageless, and no amount
 * of routine ingestion will revisit them — by design, because re-fetching
 * unchanged pages is exactly what the hash gate exists to prevent.
 *
 * Why it needs no network: every snapshot preserves the raw payload the
 * record was parsed from, including the announcement's detail HTML
 * (architecture Part 12, raw-source preservation). The backfill re-runs the
 * CANONICAL parser over those archived bytes — the same
 * `parseFdaAnnouncement` → `extractProductPhotos` → `primaryPhoto` chain
 * normal ingestion uses, never a second image parser — so the result is
 * byte-identical to what ingestion would have produced at the time, and the
 * agency is not re-crawled for pages it already served.
 *
 * What it touches: `normalized.heroImageUrl` / `normalized.imageUrls` on
 * source records, and `projection.heroImageUrl` on their cases. Nothing else.
 * It never creates a case, never writes a notification event, never runs
 * material-change detection, never moves a date, never touches lineage or
 * FSIS. Case-level precedence comes from `projectCase` itself (newest record
 * with an image wins), so a merged multi-record case resolves exactly as it
 * would through a real re-projection — only the one field is written.
 *
 * The record's normalized payload is updated alongside the projection on
 * purpose: the projection must stay a pure function of its records, or the
 * next legitimate re-projection (an ingest change, a duplicate merge) would
 * silently erase the backfilled image.
 */

import { projectCase } from '../../domain/projection';
import type { NormalizedSourceRecord } from '../../domain/source-record';
import type { RecallStore, SourceRecordRow } from '../store/types';
import { FdaParseError, parseFdaAnnouncement, type FdaAnnouncementSource } from './parse';

/** Why one record did or did not yield an image. */
export type BackfillOutcome =
  'derived' | 'no-image-in-source' | 'no-snapshot-html' | 'parse-failed';

export interface RecordPlan {
  recordId: string;
  nativeId: string;
  recallCaseId: string;
  outcome: BackfillOutcome;
  /** The image the canonical parser derives from preserved source bytes. */
  derivedHeroImageUrl: string | null;
  derivedImageUrls: string[];
  /** Already stored on the record's normalized payload. */
  storedHeroImageUrl: string | null;
  /** True when the record's stored image state already matches the source. */
  recordUpToDate: boolean;
  failureReason?: string;
}

export interface CasePlan {
  recallCaseId: string;
  records: RecordPlan[];
  /** Case-level hero after backfill, by `projectCase` precedence. */
  nextHeroImageUrl: string | null;
  currentHeroImageUrl: string | null;
  /** Records whose normalized payload needs the image fields written. */
  recordWrites: RecordPlan[];
  /** True when `projection.heroImageUrl` itself must change. */
  caseWriteNeeded: boolean;
}

export interface BackfillReport {
  casesExamined: number;
  recordsExamined: number;
  /** Cases that already carried the correct hero image. */
  alreadyPopulated: number;
  /** Cases whose projection gains (or corrects) a hero image. */
  eligible: number;
  /** Records whose preserved snapshot yielded an image. */
  recordsWithSourceImage: number;
  /** Records whose source genuinely publishes no usable product photo. */
  recordsWithoutSourceImage: number;
  /** Records whose snapshot preserved no detail HTML to read. */
  recordsMissingSnapshotHtml: number;
  /** Records whose preserved payload failed the canonical parser. */
  parseFailures: { nativeId: string; reason: string }[];
  /** Cases whose source genuinely publishes no usable product photo. */
  casesWithoutSourceImage: number;
  /**
   * Cases left without a hero whose source could NOT be checked — a snapshot
   * with no detail HTML, or a payload the parser rejected. These are the only
   * honest "unknown"s: absence of evidence, not evidence of absence.
   */
  casesUndetermined: number;
  /** Network requests this operation performs. Zero by construction. */
  networkRequests: number;
  sourceRecordWrites: number;
  caseWrites: number;
  notificationEvents: number;
  newCases: number;
  /** Sample of the changes, for the dry-run report. */
  examples: { nativeId: string; heroImageUrl: string }[];
}

/** Only FDA announcements carry parseable detail HTML in this shape. */
const FDA_SOURCE_SYSTEM = 'fda_announcement';

/** The archived payload FDA ingestion stores for every snapshot. */
function asAnnouncementInput(payload: unknown): FdaAnnouncementSource | null {
  if (payload === null || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.path !== 'string') return null;
  const detailMainHtml = typeof raw.detailMainHtml === 'string' ? raw.detailMainHtml : null;
  // Without the detail region there is no body HTML, and product photos live
  // only there — the listing row alone can never yield an image.
  if (detailMainHtml === null) return null;
  return {
    listing: (raw.listing ?? null) as FdaAnnouncementSource['listing'],
    detailMainHtml,
    path: raw.path,
    rssTitle: (raw.rssTitle ?? null) as string | null,
  };
}

/** Re-derive one record's images from its preserved snapshot. */
async function planRecord(store: RecallStore, record: SourceRecordRow): Promise<RecordPlan> {
  const stored = record.normalized.heroImageUrl ?? null;
  const base: RecordPlan = {
    recordId: record.id,
    nativeId: record.nativeId,
    recallCaseId: record.recallCaseId,
    outcome: 'no-snapshot-html',
    derivedHeroImageUrl: null,
    derivedImageUrls: [],
    storedHeroImageUrl: stored,
    recordUpToDate: true,
  };

  const payload = await store.getLatestSnapshotPayload(record.id);
  const input = asAnnouncementInput(payload);
  if (input === null) return base;

  let parsed: NormalizedSourceRecord;
  try {
    parsed = parseFdaAnnouncement(input);
  } catch (error) {
    return {
      ...base,
      outcome: 'parse-failed',
      failureReason: error instanceof FdaParseError ? error.message : String(error),
    };
  }

  const derived = parsed.heroImageUrl ?? null;
  const derivedImages = parsed.imageUrls ?? [];
  if (derived === null) {
    return { ...base, outcome: 'no-image-in-source', derivedImageUrls: derivedImages };
  }
  return {
    ...base,
    outcome: 'derived',
    derivedHeroImageUrl: derived,
    derivedImageUrls: derivedImages,
    recordUpToDate: stored === derived,
  };
}

/** The record as it will read after backfill — image fields only. */
function withDerivedImages(record: SourceRecordRow, plan: RecordPlan): NormalizedSourceRecord {
  if (plan.outcome !== 'derived') return record.normalized;
  return {
    ...record.normalized,
    heroImageUrl: plan.derivedHeroImageUrl,
    imageUrls: plan.derivedImageUrls,
  };
}

/**
 * Plan the backfill for one case. Case-level precedence is delegated to
 * `projectCase` so a multi-record case (a merged expansion or correction)
 * resolves its hero exactly as a real re-projection would.
 */
export async function planCase(
  store: RecallStore,
  recallCaseId: string,
  records: SourceRecordRow[],
): Promise<CasePlan | null> {
  const recallCase = await store.getCase(recallCaseId);
  if (!recallCase) return null;

  const plans: RecordPlan[] = [];
  for (const record of records) plans.push(await planRecord(store, record));

  const projected = projectCase(
    records.map((record, index) => withDerivedImages(record, plans[index])),
  );
  const currentHeroImageUrl = recallCase.projection.heroImageUrl ?? null;
  const nextHeroImageUrl = projected.heroImageUrl ?? null;

  return {
    recallCaseId,
    records: plans,
    nextHeroImageUrl,
    currentHeroImageUrl,
    recordWrites: plans.filter((plan) => plan.outcome === 'derived' && !plan.recordUpToDate),
    // An image is never REMOVED by a backfill: absence of a derived image is
    // "the source has none", not evidence that a stored one is wrong.
    caseWriteNeeded: nextHeroImageUrl !== null && nextHeroImageUrl !== currentHeroImageUrl,
  };
}

export interface BackfillOptions {
  apply: boolean;
  /** Progress reporting; the script prints, tests stay silent. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Visit every FDA case that has source records, re-derive its hero image from
 * preserved snapshots, and (in apply mode) write only the image fields.
 *
 * Idempotent and resumable: work is decided per case from current state, so a
 * re-run skips everything already correct and an interrupted run simply
 * resumes where the data still needs it.
 */
export async function backfillFdaHeroImages(
  store: RecallStore,
  options: BackfillOptions,
): Promise<BackfillReport> {
  const records = await store.listSourceRecords(FDA_SOURCE_SYSTEM);
  const byCase = new Map<string, SourceRecordRow[]>();
  for (const record of records) {
    byCase.set(record.recallCaseId, [...(byCase.get(record.recallCaseId) ?? []), record]);
  }

  const report: BackfillReport = {
    casesExamined: 0,
    recordsExamined: 0,
    alreadyPopulated: 0,
    eligible: 0,
    recordsWithSourceImage: 0,
    recordsWithoutSourceImage: 0,
    recordsMissingSnapshotHtml: 0,
    parseFailures: [],
    casesWithoutSourceImage: 0,
    casesUndetermined: 0,
    networkRequests: 0,
    sourceRecordWrites: 0,
    caseWrites: 0,
    notificationEvents: 0,
    newCases: 0,
    examples: [],
  };

  let done = 0;
  for (const [recallCaseId, caseRecords] of byCase) {
    const plan = await planCase(store, recallCaseId, caseRecords);
    done += 1;
    options.onProgress?.(done, byCase.size);
    if (!plan) continue; // a case row that no longer exists is not created here

    report.casesExamined += 1;
    report.recordsExamined += plan.records.length;
    for (const record of plan.records) {
      if (record.outcome === 'derived') report.recordsWithSourceImage += 1;
      else if (record.outcome === 'no-image-in-source') report.recordsWithoutSourceImage += 1;
      else if (record.outcome === 'no-snapshot-html') report.recordsMissingSnapshotHtml += 1;
      else
        report.parseFailures.push({
          nativeId: record.nativeId,
          reason: record.failureReason ?? 'unknown',
        });
    }

    const uncheckable = plan.records.some(
      (record) => record.outcome === 'no-snapshot-html' || record.outcome === 'parse-failed',
    );
    if (!plan.caseWriteNeeded) {
      if (plan.currentHeroImageUrl !== null) report.alreadyPopulated += 1;
      else if (uncheckable) report.casesUndetermined += 1;
      else report.casesWithoutSourceImage += 1;
      // Even with no case write pending, a record's own payload may still be
      // stale (its image is not the case's winning one) — keep it consistent.
      if (plan.recordWrites.length > 0 && options.apply) {
        for (const record of plan.recordWrites) {
          const row = caseRecords.find((candidate) => candidate.id === record.recordId)!;
          await store.updateSourceRecord(record.recordId, {
            normalized: withDerivedImages(row, record),
          });
          report.sourceRecordWrites += 1;
        }
      } else if (plan.recordWrites.length > 0) {
        report.sourceRecordWrites += plan.recordWrites.length;
      }
      continue;
    }

    report.eligible += 1;
    if (report.examples.length < 5) {
      report.examples.push({
        nativeId: plan.records[0].nativeId,
        heroImageUrl: plan.nextHeroImageUrl!,
      });
    }

    if (!options.apply) {
      report.sourceRecordWrites += plan.recordWrites.length;
      report.caseWrites += 1;
      continue;
    }

    for (const record of plan.recordWrites) {
      const row = caseRecords.find((candidate) => candidate.id === record.recordId)!;
      await store.updateSourceRecord(record.recordId, {
        normalized: withDerivedImages(row, record),
      });
      report.sourceRecordWrites += 1;
    }

    // Minimum required projection state: one field. The timeline and
    // lastChangedAt are carried through untouched — a maintenance backfill is
    // not public activity and must not reorder or re-date anything.
    const recallCase = (await store.getCase(recallCaseId))!;
    await store.updateCase(recallCaseId, {
      projection: { ...recallCase.projection, heroImageUrl: plan.nextHeroImageUrl },
      timeline: recallCase.timeline,
      lastChangedAt: recallCase.lastChangedAt,
    });
    report.caseWrites += 1;
  }

  return report;
}
