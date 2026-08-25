/**
 * Source-agnostic ingestion pipeline (architecture Part 8):
 *
 *   fetch result → ingest run → parse/normalize (quarantine on failure)
 *   → identity upsert → snapshot (hash-gated) → case linking
 *   → canonical projection → material-change detection
 *   → notification eligibility → consumer read model
 *
 * Adapters (FSIS, FDA) own all source quirks and hand this pipeline
 * already-normalized records; nothing here knows a source field name.
 * Idempotent by construction: re-running on identical input performs no
 * writes beyond ingest-run bookkeeping.
 */

import { createHash } from 'node:crypto';

import { detectChanges, fingerprint } from '../domain/material-change';
import { projectCase } from '../domain/projection';
import type {
  MaterialChange,
  SourceSystem,
  TimelineEntry,
  TimelineKind,
} from '../domain/recall-types';
import type { NormalizedSourceRecord } from '../domain/source-record';
import { FsisParseError, parseFsisRecord, type FsisRawRecord } from './fsis/parse';
import type { RecallStore, SourceRecordRow } from './store/types';

/** Stable stringify (recursively sorted keys) so content hashes are canonical. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const RULE_TO_TIMELINE_KIND: Record<MaterialChange['ruleId'], TimelineKind> = {
  expansion_products: 'expanded',
  expansion_geography: 'expanded',
  correction_broadened: 'corrected',
  classification_assigned: 'classified',
  classification_upgraded: 'classified',
  classification_downgraded: 'classified',
  health_impact: 'source_updated',
  instructions_changed: 'source_updated',
  retraction: 'retracted',
};

export interface IngestSummary {
  runId: string;
  itemsSeen: number;
  itemsParsed: number;
  quarantined: { rawNativeId: string | null; reason: string }[];
  unchanged: number;
  newCases: number;
  changedCases: number;
  notifications: { initial: number; materialUpdate: number; suppressed: number };
  /** Newest source-published date seen — input to stale-source alarms. */
  newestPublishedAt: string | null;
}

export interface IngestOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Cases older than this at discovery get their initial notification suppressed as backfill. */
  backfillHorizonDays?: number;
  /**
   * Evidence gate for linking a record to its `expansionOfNativeId` parent's
   * case. FSIS recall numbers are agency-assigned, so FSIS passes none; FDA's
   * candidate parents come from URL-slug collisions and must corroborate
   * (same firm, same hazard, related titles) before one consumer case absorbs
   * both. A rejected candidate founds its own case — a false merge is worse
   * than a temporary duplicate.
   */
  expansionGuard?: (child: NormalizedSourceRecord, parent: NormalizedSourceRecord) => boolean;
  /**
   * Evidence gate for a record that DECLARES itself an expansion ("Lidl US
   * Expands Recall of…") or a revision ("…updated their press release to…")
   * without naming a linkable parent id. The pipeline searches recent
   * records of the same source for a parent this gate accepts; the record
   * links only when exactly ONE existing case qualifies, and founds its own
   * case otherwise. FDA passes `isExpansionOfSameEvent` OR
   * `isRevisionOfSameEvent`; FSIS passes none (its expansions carry the
   * parent's recall number).
   */
  expansionReferenceGuard?: (
    child: NormalizedSourceRecord,
    parent: NormalizedSourceRecord,
  ) => boolean;
}

/** How far back a declared expansion searches for its parent announcement. */
const EXPANSION_SEARCH_WINDOW_DAYS = 120;

/** One already-normalized record plus the raw payload to preserve. */
export interface ParsedSourceItem {
  /** The raw payload stored in the snapshot (audit trail to source bytes). */
  raw: unknown;
  normalized: NormalizedSourceRecord;
  /**
   * Value hashed for change detection. Defaults to `raw`. FDA passes the
   * listing item alone: its `changed` timestamp moves on any page edit, while
   * the stored payload also carries the (re)fetched detail HTML.
   */
  contentKey?: unknown;
}

export interface SourceIngestInput {
  sourceSystem: SourceSystem;
  items: ParsedSourceItem[];
  /** Items that failed adapter parsing — reported, never silently dropped. */
  quarantined: { rawNativeId: string | null; reason: string }[];
  /** Raw items seen before parsing/filtering, for run bookkeeping. */
  itemsSeen: number;
  fetchedAt: string;
}

/** Run the shared pipeline over one adapter's parsed output. */
export async function runSourceIngest(
  store: RecallStore,
  input: SourceIngestInput,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const now = options.now ?? (() => new Date());
  const backfillHorizonDays = options.backfillHorizonDays ?? 30;
  const startedAt = now().toISOString();
  const runId = await store.createIngestRun(input.sourceSystem, startedAt);

  const summary: IngestSummary = {
    runId,
    itemsSeen: input.itemsSeen,
    itemsParsed: input.items.length,
    quarantined: [...input.quarantined],
    unchanged: 0,
    newCases: 0,
    changedCases: 0,
    notifications: { initial: 0, materialUpdate: 0, suppressed: 0 },
    newestPublishedAt: null,
  };

  try {
    summary.newestPublishedAt =
      input.items
        .map((p) => p.normalized.publishedAt)
        .sort()
        .at(-1) ?? null;

    // Feed order: parents before expansions before retractions, so links can
    // resolve within a single run; oldest first for stable timelines.
    const orderRank = (r: NormalizedSourceRecord) =>
      r.isRetractionNotice ? 2 : r.expansionOfNativeId !== null ? 1 : 0;
    const parsed = [...input.items].sort(
      (a, b) =>
        orderRank(a.normalized) - orderRank(b.normalized) ||
        a.normalized.publishedAt.localeCompare(b.normalized.publishedAt) ||
        a.normalized.nativeId.localeCompare(b.normalized.nativeId),
    );

    // The feed occasionally repeats an identity; last occurrence wins.
    const byNativeId = new Map<string, ParsedSourceItem>();
    for (const item of parsed) byNativeId.set(item.normalized.nativeId, item);

    for (const item of byNativeId.values()) {
      await ingestOne(
        store,
        item,
        input,
        summary,
        now,
        backfillHorizonDays,
        options.expansionGuard,
        options.expansionReferenceGuard,
      );
    }

    await store.finishIngestRun(runId, {
      finishedAt: now().toISOString(),
      outcome: 'succeeded',
      itemsSeen: summary.itemsSeen,
      itemsChanged: summary.newCases + summary.changedCases,
      quarantined: summary.quarantined,
      error: null,
    });
    return summary;
  } catch (error) {
    await store.finishIngestRun(runId, {
      finishedAt: now().toISOString(),
      outcome: 'failed',
      itemsSeen: summary.itemsSeen,
      itemsChanged: summary.newCases + summary.changedCases,
      quarantined: summary.quarantined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

interface FetchInput {
  records: FsisRawRecord[];
  fetchedAt: string;
  sourceUrl: string;
}

/** FSIS adapter entry point: parse + quarantine, then the shared pipeline. */
export async function runFsisIngest(
  store: RecallStore,
  input: FetchInput,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  // Parse everything first; failures are quarantined with their raw payload
  // retained in the run record — a parse bug must never hide a recall silently.
  const items: ParsedSourceItem[] = [];
  const quarantined: SourceIngestInput['quarantined'] = [];
  for (const raw of input.records) {
    if (typeof raw?.langcode === 'string' && raw.langcode !== '' && raw.langcode !== 'English') {
      continue; // English-only in this milestone; Spanish records attach later.
    }
    try {
      items.push({ raw, normalized: parseFsisRecord(raw) });
    } catch (error) {
      quarantined.push({
        rawNativeId: typeof raw?.field_recall_number === 'string' ? raw.field_recall_number : null,
        reason: error instanceof FsisParseError ? error.message : String(error),
      });
    }
  }
  return runSourceIngest(
    store,
    {
      sourceSystem: 'fsis_api',
      items,
      quarantined,
      itemsSeen: input.records.length,
      fetchedAt: input.fetchedAt,
    },
    options,
  );
}

async function ingestOne(
  store: RecallStore,
  item: ParsedSourceItem,
  input: SourceIngestInput,
  summary: IngestSummary,
  now: () => Date,
  backfillHorizonDays: number,
  expansionGuard?: IngestOptions['expansionGuard'],
  expansionReferenceGuard?: IngestOptions['expansionReferenceGuard'],
): Promise<void> {
  const { raw, normalized } = item;
  const sourceSystem = input.sourceSystem;
  const nowIso = now().toISOString();
  const existing = await store.getSourceRecordByNativeId(sourceSystem, normalized.nativeId);
  const hash = contentHash(item.contentKey ?? raw);

  if (existing) {
    const latestHash = await store.getLatestSnapshotHash(existing.id);
    if (latestHash === hash) {
      await store.updateSourceRecord(existing.id, { lastSeenAt: nowIso });
      summary.unchanged += 1;
      return;
    }
    // Layer 1: the source changed. Snapshot first, then re-project.
    const snapshotId = await store.insertSnapshot({
      sourceRecordId: existing.id,
      fetchedAt: input.fetchedAt,
      contentHash: hash,
      rawPayload: raw,
      sourceUrl: normalized.officialUrl,
    });
    await store.updateSourceRecord(existing.id, { normalized, lastSeenAt: nowIso });
    await reprojectCase(
      store,
      existing.recallCaseId,
      [snapshotId],
      summary,
      now,
      backfillHorizonDays,
    );
    return;
  }

  // New source record. Resolve which case it belongs to (architecture Part 8.2):
  // a retraction notice attaches to the case it retracts; an expansion record
  // attaches to its parent's case; anything unresolvable founds its own case —
  // the coverage invariant means no credible record is ever dropped.
  let targetCase: { id: string } | null = null;
  let linkMethod: SourceRecordRow['linkMethod'] = 'self';

  if (normalized.isRetractionNotice) {
    for (const retractedId of normalized.retractsNativeIds) {
      const target = await store.getSourceRecordByNativeId(sourceSystem, retractedId);
      if (target) {
        targetCase = { id: target.recallCaseId };
        linkMethod = 'retraction_reference';
        break;
      }
    }
  }
  if (!targetCase && normalized.expansionOfNativeId) {
    const parent = await store.getSourceRecordByNativeId(
      sourceSystem,
      normalized.expansionOfNativeId,
    );
    // The guard decides whether a candidate parent is the same real-world
    // recall. Without corroboration the record founds its own case; nothing
    // is ever merged on identity shape alone.
    if (parent && (!expansionGuard || expansionGuard(normalized, parent.normalized))) {
      targetCase = { id: parent.recallCaseId };
      linkMethod = 'expansion_prefix';
    }
  }
  // A record that declares itself an expansion ("…Expands Recall of…") or a
  // revision (FDA's "updated their press release" note) without naming a
  // parent id searches recent records of this source for one. The link
  // happens only when the evidence gate accepts a parent AND every accepted
  // parent belongs to the SAME case — two qualifying cases mean the lineage
  // is ambiguous, and ambiguity founds a separate case for a human to
  // reconcile rather than guessing which recall was extended.
  if (
    !targetCase &&
    (normalized.declaresExpansion || normalized.declaresRevision) &&
    expansionReferenceGuard
  ) {
    const windowStart = new Date(
      Date.parse(normalized.publishedAt) - EXPANSION_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const candidates = await store.listSourceRecordsSince(sourceSystem, windowStart);
    const parents = candidates.filter(
      (candidate) =>
        candidate.nativeId !== normalized.nativeId &&
        expansionReferenceGuard(normalized, candidate.normalized),
    );
    const caseIds = new Set(parents.map((parent) => parent.recallCaseId));
    if (caseIds.size === 1) {
      targetCase = { id: parents[0].recallCaseId };
      linkMethod = 'expansion_prefix';
    }
  }

  if (!targetCase) {
    const projection = projectCase([normalized]);
    const agencyLabel = normalized.sourceAgency === 'FSIS' ? 'FSIS' : normalized.sourceAgency;
    const timeline: TimelineEntry[] = [
      {
        occurredAt: normalized.publishedAt,
        kind: 'published',
        summary: `${normalized.noticeType === 'public_health_alert' ? 'Public health alert' : 'Recall'} published by ${agencyLabel}.`,
        causedBySnapshotIds: [],
        material: false,
      },
    ];
    const recallCase = await store.insertCase({
      projection,
      timeline,
      createdAt: nowIso,
      lastChangedAt: nowIso,
    });
    const record = await store.insertSourceRecord({
      sourceSystem,
      nativeId: normalized.nativeId,
      recallCaseId: recallCase.id,
      linkMethod: 'self',
      normalized,
      sourceUrl: normalized.officialUrl,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    });
    const snapshotId = await store.insertSnapshot({
      sourceRecordId: record.id,
      fetchedAt: input.fetchedAt,
      contentHash: hash,
      rawPayload: raw,
      sourceUrl: normalized.officialUrl,
    });
    timeline[0].causedBySnapshotIds.push(snapshotId);
    await store.updateCase(recallCase.id, {
      projection,
      timeline,
      lastChangedAt: nowIso,
    });
    await store.replaceProducts(recallCase.id, projection.affectedProducts);
    summary.newCases += 1;

    // Exactly-one-initial invariant: dedupKey = the case id. Old records
    // discovered late (first live run imports 12 years of history) are
    // ledgered but suppressed as backfill — auditable, never delivered.
    const ageMs = now().getTime() - new Date(normalized.publishedAt).getTime();
    const isBackfill = ageMs > backfillHorizonDays * 24 * 60 * 60 * 1000;
    const inserted = await store.insertNotificationIfAbsent({
      recallCaseId: recallCase.id,
      kind: 'initial',
      triggerRuleId: 'new_case',
      dedupKey: `initial:${recallCase.id}`,
      materialChangeRef: null,
      payloadSummary: projection.title,
      suppressed: isBackfill ? 'backfill' : null,
      sourceSnapshotIds: [snapshotId],
      createdAt: nowIso,
    });
    if (inserted) {
      if (isBackfill) summary.notifications.suppressed += 1;
      else summary.notifications.initial += 1;
    }
    return;
  }

  // Record joins an existing case.
  const record = await store.insertSourceRecord({
    sourceSystem,
    nativeId: normalized.nativeId,
    recallCaseId: targetCase.id,
    linkMethod,
    normalized,
    sourceUrl: normalized.officialUrl,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
  });
  const snapshotId = await store.insertSnapshot({
    sourceRecordId: record.id,
    fetchedAt: input.fetchedAt,
    contentHash: hash,
    rawPayload: raw,
    sourceUrl: normalized.officialUrl,
  });
  await reprojectCase(
    store,
    targetCase.id,
    [snapshotId],
    summary,
    now,
    backfillHorizonDays,
    normalized,
  );
}

/**
 * Re-project a case from all its linked records, detect consumer-relevant
 * changes (Layer 2), append timeline entries, and write eligible notification
 * events. A changed payload hash alone never produces a notification.
 */
async function reprojectCase(
  store: RecallStore,
  recallCaseId: string,
  causedBySnapshotIds: string[],
  summary: IngestSummary,
  now: () => Date,
  backfillHorizonDays: number,
  joinedRecord?: NormalizedSourceRecord,
): Promise<void> {
  const nowIso = now().toISOString();
  const recallCase = await store.getCase(recallCaseId);
  if (!recallCase) throw new Error(`case ${recallCaseId} missing during re-projection`);
  const records = await store.getSourceRecordsForCase(recallCaseId);
  const next = projectCase(records.map((r) => r.normalized));

  if (canonicalJson(next) === canonicalJson(recallCase.projection)) {
    return; // snapshot recorded; projection identical — nothing consumer-visible.
  }

  const { material, nonMaterial } = detectChanges(recallCase.projection, next);

  // An FSIS expansion is published as a new record; the expanded product list
  // is often only in an attached PDF (verified: 005-2026-EXP), so the
  // projection diff alone can miss it. The expansion notice itself is material
  // (architecture Part 9) unless the diff already reported the expansion.
  if (
    joinedRecord?.expansionOfNativeId &&
    !material.some((m) => m.ruleId === 'expansion_products' || m.ruleId === 'expansion_geography')
  ) {
    material.push({
      ruleId: 'expansion_products',
      summary: `The agency expanded this recall (notice ${joinedRecord.nativeId}).`,
      fingerprint: fingerprint(`expansion-record:${joinedRecord.nativeId}`),
    });
  }

  const timeline = [...recallCase.timeline];
  const activityDate = next.lastPublicActivityAt;

  for (const change of material) {
    timeline.push({
      occurredAt: activityDate,
      kind: RULE_TO_TIMELINE_KIND[change.ruleId],
      summary: change.summary,
      causedBySnapshotIds,
      material: true,
      ruleId: change.ruleId,
    });
  }
  for (const note of nonMaterial) {
    timeline.push({
      occurredAt: activityDate,
      kind: note.startsWith('Recall closed') ? 'closed' : 'source_updated',
      summary: note,
      causedBySnapshotIds,
      material: false,
    });
  }
  if (material.length === 0 && nonMaterial.length === 0) {
    timeline.push({
      occurredAt: activityDate,
      kind: 'source_updated',
      summary: 'Source record updated (no consumer-relevant change).',
      causedBySnapshotIds,
      material: false,
    });
  }

  await store.updateCase(recallCaseId, {
    projection: next,
    timeline,
    lastChangedAt: nowIso,
  });
  await store.replaceProducts(recallCaseId, next.affectedProducts);
  summary.changedCases += 1;

  // Notification eligibility (architecture Part 10): one push per distinct
  // material change, coalesced to one per case per 24h — except retractions,
  // which always fire. A change whose source-published activity is older than
  // the backfill horizon (e.g. a years-old expansion seen on the first import)
  // is ledgered but suppressed: auditable, never delivered as news.
  const activityAgeMs = now().getTime() - new Date(next.lastPublicActivityAt).getTime();
  const isBackfill = activityAgeMs > backfillHorizonDays * 24 * 60 * 60 * 1000;
  for (const change of material) {
    const dedupKey = `mu:${recallCaseId}:${change.ruleId}:${change.fingerprint}`;
    const since = new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    const coalesce =
      !isBackfill &&
      change.ruleId !== 'retraction' &&
      (await store.countRecentMaterialUpdates(recallCaseId, since)) > 0;
    const inserted = await store.insertNotificationIfAbsent({
      recallCaseId,
      kind: 'material_update',
      triggerRuleId: change.ruleId,
      dedupKey,
      materialChangeRef: change.fingerprint,
      payloadSummary: change.summary,
      suppressed: isBackfill ? 'backfill' : coalesce ? 'coalesced' : null,
      sourceSnapshotIds: causedBySnapshotIds,
      createdAt: nowIso,
    });
    if (inserted) {
      if (isBackfill || coalesce) summary.notifications.suppressed += 1;
      else summary.notifications.materialUpdate += 1;
    }
  }
}
