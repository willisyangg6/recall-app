/**
 * Source-agnostic ingestion pipeline (architecture Part 8):
 *
 *   fetch result → ingest run → parse/normalize (quarantine on failure)
 *   → applied-version gate → archive-and-pending → case linking
 *   → canonical projection → material-change detection
 *   → ONE atomic case transition (projection + timeline + products +
 *     notification events + applied markers) → consumer read model
 *
 * Adapters (FSIS, FDA) own all source quirks and hand this pipeline
 * already-normalized records; nothing here knows a source field name.
 *
 * Crash safety (O3-B1): "snapshot archived" and "snapshot APPLIED" are
 * separate durable facts. The unchanged gate skips an item only when the
 * incoming content equals the latest archived snapshot AND that snapshot is
 * marked applied (or the record predates the marker — legacy_unverified,
 * whose pre-O3 behavior is preserved so the historical corpus never
 * replays). Everything between archive and apply is pending and retried on
 * the next run; the consumer-visible transition (case + products + events +
 * markers) commits in one transaction, so a consumer can never observe a
 * torn state and a required notification can never be silently lost.
 */

import { createHash, randomUUID } from 'node:crypto';

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
import type {
  AppliedMarker,
  NotificationEventInput,
  RecallStore,
  SourceRecordGate,
  SourceRecordRow,
} from './store/types';

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
  classification_changed: 'classified',
  health_impact: 'source_updated',
  instructions_changed: 'source_updated',
  retraction: 'retracted',
};

/** Case CAS attempts before an item stays pending for the next run. */
const CASE_CAS_ATTEMPTS = 3;

export interface IngestSummary {
  runId: string;
  itemsSeen: number;
  itemsParsed: number;
  quarantined: { rawNativeId: string | null; reason: string }[];
  unchanged: number;
  newCases: number;
  changedCases: number;
  /** O3: adapter-deferred items (required evidence unavailable this run) — retried next tick. */
  deferred: number;
  /** O3: items skipped because a newer fetch is already archived (stale worker), plus monotonic-guard misses. */
  staleSkipped: number;
  /** O3: items left pending after the case CAS retry budget — retried next tick. */
  conflictsExhausted: number;
  /** O3: pending versions whose retry found everything already applied — marker completed only. */
  pendingCompleted: number;
  /** O3: new records founded with incomplete evidence (FDA listing-only) — completed by later runs. */
  degradedFounded: number;
  /** O3: per-item errors isolated so sibling items continue; the job layer downgrades the run. */
  itemFailures: { nativeId: string | null; reason: string }[];
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
  /**
   * Adapter-declared evidence completeness. 'degraded' = the record is
   * credible but its required evidence (an FDA detail page) could not be
   * fetched: the item still applies (coverage invariant) but its marker is
   * 'applied_degraded', so every later run retries the missing evidence even
   * while the content hash is unchanged. Defaults to 'complete'.
   */
  completeness?: 'complete' | 'degraded';
}

export interface SourceIngestInput {
  sourceSystem: SourceSystem;
  items: ParsedSourceItem[];
  /** Items that failed adapter parsing — reported, never silently dropped. */
  quarantined: { rawNativeId: string | null; reason: string }[];
  /**
   * Items the adapter deferred whole (an existing record's changed version
   * whose required evidence failed to fetch): nothing archived, nothing
   * applied, retried next run. Counted so the run cannot read as complete.
   */
  deferred?: number;
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
    deferred: input.deferred ?? 0,
    staleSkipped: 0,
    conflictsExhausted: 0,
    pendingCompleted: 0,
    degradedFounded: 0,
    itemFailures: [],
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
      // Per-item isolation (O3): one poison item must not abort the feed —
      // its failure is recorded and every other item still applies. The job
      // layer downgrades the run (partial) and fails it on a failure spike.
      try {
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
      } catch (error) {
        summary.itemFailures.push({
          nativeId: item.normalized.nativeId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
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
  const { normalized } = item;
  const sourceSystem = input.sourceSystem;
  // Two passes at most: a founding attempt that loses the identity race
  // ('record_exists') re-enters the existing-record path against the winner.
  for (let pass = 0; pass < 2; pass++) {
    // The gate slice (C8 + O3): identity, case link, and applied marker —
    // never the normalized payload. One narrow read per feed item.
    const gate = await store.getSourceRecordGateByNativeId(sourceSystem, normalized.nativeId);
    if (gate) {
      await ingestExisting(store, item, input, gate, summary, now, backfillHorizonDays);
      return;
    }
    const founded = await ingestNew(
      store,
      item,
      input,
      summary,
      now,
      backfillHorizonDays,
      expansionGuard,
      expansionReferenceGuard,
    );
    if (founded) return;
    // record_exists: loop once more through the existing path.
  }
  throw new Error(`record ${normalized.nativeId} raced founding twice — giving up this run`);
}

/** An already-known record: unchanged, pending re-apply, degraded completion, or changed. */
async function ingestExisting(
  store: RecallStore,
  item: ParsedSourceItem,
  input: SourceIngestInput,
  gate: SourceRecordGate,
  summary: IngestSummary,
  now: () => Date,
  backfillHorizonDays: number,
): Promise<void> {
  const { raw, normalized } = item;
  const nowIso = now().toISOString();
  const hash = contentHash(item.contentKey ?? raw);
  const completeness = item.completeness ?? 'complete';
  const meta = await store.getLatestSnapshotMeta(gate.id);

  const sameAsLatest = meta !== null && meta.contentHash === hash;
  // legacy_unverified (NULL marker): the row predates O3. Its application
  // state is unknown — never assumed applied, but ALSO never treated as
  // fresh pending work, or the whole historical corpus would replay through
  // notification paths. Unchanged content keeps exactly the pre-O3 behavior;
  // the record graduates to a verified marker on its next real change (here)
  // or through the O3-B2 reconciliation.
  const isLegacy = gate.applyState == null;
  const fullyApplied =
    sameAsLatest &&
    gate.applyState === 'applied' &&
    gate.appliedSnapshotSeq === meta?.seq &&
    gate.appliedContentHash === hash;

  if (sameAsLatest && (isLegacy || fullyApplied)) {
    await store.updateSourceRecord(gate.id, { lastSeenAt: nowIso });
    summary.unchanged += 1;
    return;
  }

  // A degraded record whose required evidence has now been fetched: the
  // content hash is unchanged, but the richer payload is honestly
  // re-archived (provenance: getLatestSnapshotPayload must see the detail
  // page a later backfill would re-derive from).
  const degradedCompletion =
    sameAsLatest && gate.applyState === 'applied_degraded' && completeness === 'complete';

  let snapshotId: string;
  let snapshotSeq: number;
  if (meta !== null && sameAsLatest && !degradedCompletion) {
    // Pending re-apply of the already-archived current version (a prior run
    // crashed between archive and apply) — never a duplicate snapshot.
    snapshotId = meta.id;
    snapshotSeq = meta.seq;
  } else {
    const archived = await store.archiveSnapshot({
      sourceRecordId: gate.id,
      fetchedAt: input.fetchedAt,
      contentHash: hash,
      rawPayload: raw,
      sourceUrl: normalized.officialUrl,
      allowSameHash: degradedCompletion,
    });
    if (archived.status === 'stale') {
      // A newer fetch is already archived: this worker is stale and stops
      // BEFORE any write — it must not regress normalized, case, product,
      // marker, timeline, or event state.
      summary.staleSkipped += 1;
      return;
    }
    snapshotId = archived.snapshotId;
    snapshotSeq = archived.snapshotSeq;
  }

  // Monotonic conditional normalized write: derived from THIS snapshot, and
  // refused once a newer version has been applied (stale worker).
  const wrote = await store.updateSourceRecordNormalized(gate.id, normalized, nowIso, snapshotSeq);
  if (!wrote) {
    summary.staleSkipped += 1;
    return;
  }

  const marker: AppliedMarker = {
    sourceRecordId: gate.id,
    contentHash: hash,
    snapshotSeq,
    state: completeness === 'degraded' ? 'applied_degraded' : 'applied',
    appliedAt: nowIso,
  };
  const outcome = await applyCaseChange(
    store,
    gate.recallCaseId,
    [snapshotId],
    [marker],
    summary,
    now,
    backfillHorizonDays,
    normalized,
  );
  if (outcome === 'conflict_exhausted') summary.conflictsExhausted += 1;
}

/**
 * A record the store has never seen: resolve which case it belongs to
 * (architecture Part 8.2) — a retraction notice attaches to the case it
 * retracts; an expansion record attaches to its parent's case; anything
 * unresolvable founds its own case atomically (the coverage invariant means
 * no credible record is ever dropped). Returns false when the founding lost
 * the identity race and the caller must re-enter the existing path.
 */
async function ingestNew(
  store: RecallStore,
  item: ParsedSourceItem,
  input: SourceIngestInput,
  summary: IngestSummary,
  now: () => Date,
  backfillHorizonDays: number,
  expansionGuard?: IngestOptions['expansionGuard'],
  expansionReferenceGuard?: IngestOptions['expansionReferenceGuard'],
): Promise<boolean> {
  const { raw, normalized } = item;
  const sourceSystem = input.sourceSystem;
  const nowIso = now().toISOString();
  const hash = contentHash(item.contentKey ?? raw);
  const completeness = item.completeness ?? 'complete';

  let targetCase: { id: string } | null = null;
  let linkMethod: SourceRecordRow['linkMethod'] = 'self';

  if (normalized.isRetractionNotice) {
    for (const retractedId of normalized.retractsNativeIds) {
      // Only the case link is needed to attach a retraction — the same
      // narrow gate slice as the per-item lookup.
      const target = await store.getSourceRecordGateByNativeId(sourceSystem, retractedId);
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
    // Atomic founding (O3): case + record + snapshot + products + initial
    // event + applied marker commit together — a crash leaves nothing, never
    // an orphan case, and the initial notification can never be lost after
    // the case exists. The snapshot id is app-generated so the founding
    // timeline can reference it inside the same transaction.
    const projection = projectCase([normalized]);
    const agencyLabel = normalized.sourceAgency === 'FSIS' ? 'FSIS' : normalized.sourceAgency;
    const snapshotId = randomUUID();
    const timeline: TimelineEntry[] = [
      {
        occurredAt: normalized.publishedAt,
        kind: 'published',
        summary: `${normalized.noticeType === 'public_health_alert' ? 'Public health alert' : 'Recall'} published by ${agencyLabel}.`,
        causedBySnapshotIds: [snapshotId],
        material: false,
      },
    ];
    // Exactly-one-initial invariant: dedupKey = the case id (anchored inside
    // the founding transaction). Old records discovered late (first live run
    // imports 12 years of history) are ledgered but suppressed as backfill —
    // auditable, never delivered.
    const ageMs = now().getTime() - new Date(normalized.publishedAt).getTime();
    const isBackfill = ageMs > backfillHorizonDays * 24 * 60 * 60 * 1000;
    const founded = await store.foundCase({
      caseRow: { projection, timeline, createdAt: nowIso, lastChangedAt: nowIso },
      record: {
        sourceSystem,
        nativeId: normalized.nativeId,
        linkMethod: 'self',
        normalized,
        sourceUrl: normalized.officialUrl,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        applyState: completeness === 'degraded' ? 'applied_degraded' : 'applied',
        appliedContentHash: hash,
        appliedAt: nowIso,
      },
      snapshot: {
        id: snapshotId,
        fetchedAt: input.fetchedAt,
        contentHash: hash,
        rawPayload: raw,
        sourceUrl: normalized.officialUrl,
      },
      products: projection.affectedProducts,
      initialEvent: {
        triggerRuleId: 'new_case',
        payloadSummary: projection.title,
        suppressed: isBackfill ? 'backfill' : null,
        createdAt: nowIso,
      },
    });
    if (founded.status === 'record_exists') return false;
    summary.newCases += 1;
    if (completeness === 'degraded') summary.degradedFounded += 1;
    if (founded.initialInserted) {
      if (isBackfill) summary.notifications.suppressed += 1;
      else summary.notifications.initial += 1;
    }
    return true;
  }

  // Record joins an existing case: record (pending) → archive → one atomic
  // case transition. A crash between these steps leaves the version pending
  // and the next run converges through the existing-record path.
  let record: SourceRecordRow;
  try {
    record = await store.insertSourceRecord({
      sourceSystem,
      nativeId: normalized.nativeId,
      recallCaseId: targetCase.id,
      linkMethod,
      normalized,
      sourceUrl: normalized.officialUrl,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      applyState: 'pending',
    });
  } catch (error) {
    // A concurrent worker inserted the identity first: re-enter the
    // existing path (pass 2) rather than failing the item.
    const raced = await store.getSourceRecordGateByNativeId(sourceSystem, normalized.nativeId);
    if (raced) return false;
    throw error;
  }
  const archived = await store.archiveSnapshot({
    sourceRecordId: record.id,
    fetchedAt: input.fetchedAt,
    contentHash: hash,
    rawPayload: raw,
    sourceUrl: normalized.officialUrl,
  });
  if (archived.status === 'stale') {
    summary.staleSkipped += 1;
    return true;
  }
  const marker: AppliedMarker = {
    sourceRecordId: record.id,
    contentHash: hash,
    snapshotSeq: archived.snapshotSeq,
    state: completeness === 'degraded' ? 'applied_degraded' : 'applied',
    appliedAt: nowIso,
  };
  const outcome = await applyCaseChange(
    store,
    targetCase.id,
    [archived.snapshotId],
    [marker],
    summary,
    now,
    backfillHorizonDays,
    normalized,
  );
  if (outcome === 'conflict_exhausted') summary.conflictsExhausted += 1;
  return true;
}

/**
 * Re-project a case from all its linked records, detect consumer-relevant
 * changes (Layer 2), and commit ONE atomic transition: projection, timeline,
 * affected products, eligible notification events, and the applied markers
 * of every source version this transition carries. A changed payload hash
 * alone never produces a notification.
 *
 * The case CAS (`expectedLastChangedAt`) serializes concurrent writers: a
 * conflict re-reads the case and every contributing record, recomputes
 * deterministically (projectCase is order-independent), and retries — the
 * loser's retry includes the winner's facts. After the retry budget the
 * version stays pending, visibly, for the next run; it is never declared
 * applied.
 *
 * `heroImageUrl` is exactly what `projectCase` derives from the records —
 * an official agency photograph or nothing. FSIS label renders in
 * product_visuals are detail-screen evidence and are deliberately NOT
 * promoted to the feed hero here (C9 frozen policy).
 */
async function applyCaseChange(
  store: RecallStore,
  recallCaseId: string,
  causedBySnapshotIds: string[],
  markers: AppliedMarker[],
  summary: IngestSummary,
  now: () => Date,
  backfillHorizonDays: number,
  applyingRecord: NormalizedSourceRecord,
): Promise<'applied' | 'completed' | 'conflict_exhausted'> {
  for (let attempt = 0; attempt < CASE_CAS_ATTEMPTS; attempt++) {
    const nowIso = now().toISOString();
    const recallCase = await store.getCase(recallCaseId);
    if (!recallCase) throw new Error(`case ${recallCaseId} missing during re-projection`);
    const records = await store.getSourceRecordsForCase(recallCaseId);
    const next = projectCase(records.map((r) => r.normalized));

    const projectionChanged = canonicalJson(next) !== canonicalJson(recallCase.projection);
    const { material, nonMaterial } = projectionChanged
      ? detectChanges(recallCase.projection, next)
      : { material: [] as MaterialChange[], nonMaterial: [] as string[] };

    // An FSIS expansion is published as a new record; the expanded product
    // list is often only in an attached PDF (verified: 005-2026-EXP), so the
    // projection diff alone can miss it. The expansion notice itself is
    // material (architecture Part 9) unless the diff already reported the
    // expansion. Derived from the applying record + the stored projection —
    // "this apply is the one that introduces the record to the case" — so an
    // interrupted join's RETRY reproduces it (same retry-stable fingerprint,
    // deduped by the ledger), while a later in-place edit of the expansion
    // record does not repeat it.
    const introducesRecord = !(recallCase.projection.sourceIdentifiers ?? []).some(
      (identifier) => identifier.id === applyingRecord.nativeId,
    );
    if (
      applyingRecord.expansionOfNativeId &&
      introducesRecord &&
      !material.some((m) => m.ruleId === 'expansion_products' || m.ruleId === 'expansion_geography')
    ) {
      material.push({
        ruleId: 'expansion_products',
        summary: `The agency expanded this recall (notice ${applyingRecord.nativeId}).`,
        fingerprint: fingerprint(`expansion-record:${applyingRecord.nativeId}`),
      });
    }

    if (!projectionChanged && material.length === 0) {
      // Everything durable already matches the recomputed projection: an
      // interrupted prior attempt completed the transition (under this
      // contract, projection-current ⇒ products- and events-current, because
      // they only ever commit together). Finish the marker alone.
      for (const marker of markers) await store.markSourceRecordApplied(marker);
      summary.pendingCompleted += 1;
      return 'completed';
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

    // Notification eligibility (architecture Part 10): one push per distinct
    // material change, coalesced to one per case per 24h — except
    // retractions, which always fire. A change whose source-published
    // activity is older than the backfill horizon (e.g. a years-old
    // expansion seen on the first import) is ledgered but suppressed:
    // auditable, never delivered as news. The recent count is read once and
    // advanced locally per deliverable event, reproducing the sequential
    // pre-O3 semantics inside one batch.
    const activityAgeMs = now().getTime() - new Date(next.lastPublicActivityAt).getTime();
    const isBackfill = activityAgeMs > backfillHorizonDays * 24 * 60 * 60 * 1000;
    const since = new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    let recentDeliverable =
      material.length > 0 ? await store.countRecentMaterialUpdates(recallCaseId, since) : 0;
    const events: NotificationEventInput[] = [];
    for (const change of material) {
      const coalesce = !isBackfill && change.ruleId !== 'retraction' && recentDeliverable > 0;
      const suppressed = isBackfill
        ? ('backfill' as const)
        : coalesce
          ? ('coalesced' as const)
          : null;
      if (suppressed === null) recentDeliverable += 1;
      events.push({
        recallCaseId,
        kind: 'material_update',
        triggerRuleId: change.ruleId,
        dedupKey: `mu:${recallCaseId}:${change.ruleId}:${change.fingerprint}`,
        materialChangeRef: change.fingerprint,
        payloadSummary: change.summary,
        suppressed,
        sourceSnapshotIds: causedBySnapshotIds,
        createdAt: nowIso,
      });
    }

    const result = await store.applyCaseTransition({
      recallCaseId,
      expectedLastChangedAt: recallCase.lastChangedAt,
      projection: next,
      timeline,
      lastChangedAt: nowIso,
      products: next.affectedProducts,
      events,
      markers,
    });
    if (result.status === 'applied') {
      summary.changedCases += 1;
      for (const key of result.insertedDedupKeys) {
        const event = events.find((e) => e.dedupKey === key);
        if (!event) continue;
        if (event.suppressed) summary.notifications.suppressed += 1;
        else summary.notifications.materialUpdate += 1;
      }
      return 'applied';
    }
    // 'conflict': a concurrent writer moved the case — loop, re-read,
    // recompute. The stale computation above is discarded whole.
  }
  return 'conflict_exhausted';
}
