/**
 * The one projection write an attachment enrichment may make: the product
 * fields `projectCase` derives from the enriched records, and nothing else.
 *
 * Pure, so the Supabase store and the in-memory test store share it. It
 * re-projects the case with the enriched record substituted, copies ONLY
 * the attachment-owned keys onto the stored projection, and refuses —
 * throws — if the result would be a material change, because this path has
 * no timeline, no event and no notification by design.
 */

import { detectChanges } from '../../domain/material-change';
import { projectCase } from '../../domain/projection';
import type { CaseProjection } from '../../domain/recall-types';
import {
  applyAttachmentEnrichment,
  withoutAttachmentEnrichment,
  type AttachmentEnrichment,
  type NormalizedSourceRecord,
} from '../../domain/source-record';

/** Projection keys an attachment enrichment owns. */
export const ATTACHMENT_OWNED_KEYS = ['productDescription', 'brands', 'attachmentTables'] as const;

export function enrichNormalized(
  normalized: NormalizedSourceRecord,
  enrichment: AttachmentEnrichment,
): NormalizedSourceRecord {
  return applyAttachmentEnrichment(withoutAttachmentEnrichment(normalized), enrichment);
}

export function enrichedProjection(
  stored: CaseProjection,
  records: { id: string; normalized: NormalizedSourceRecord }[],
  sourceRecordId: string,
  enrichedRecord: NormalizedSourceRecord,
): CaseProjection {
  const derived = projectCase(
    records.map((r) => (r.id === sourceRecordId ? enrichedRecord : r.normalized)),
  );
  const next: Record<string, unknown> = { ...stored };
  for (const key of ATTACHMENT_OWNED_KEYS) {
    const value = (derived as unknown as Record<string, unknown>)[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  const projection = next as unknown as CaseProjection;
  const changes = detectChanges(stored, projection);
  if (changes.material.length > 0) {
    throw new Error(
      `attachment enrichment would be material (${changes.material.map((c) => c.ruleId).join(', ')}) — refused`,
    );
  }
  return projection;
}
