/**
 * Layer-2 material-change detection (architecture Part 9): a deterministic
 * diff of the consumer-facing projection, classified against a fixed rule
 * table. Layer-1 ("the source payload changed") lives in the pipeline and is
 * never, by itself, material.
 */

import type { CaseProjection, MaterialChange } from './recall-types';
import { classificationSeverityRank } from './projection';
import { classSetKey, officialClassesOf, officialClassListText } from './risk-tier';

/** Small deterministic string hash (FNV-1a) — fingerprints, not security. */
export function fingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function normalizeText(text: string | null): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productKeys(projection: CaseProjection): Set<string> {
  return new Set(
    projection.affectedProducts.map((p) => `${p.sourceNativeId}|${normalizeText(p.rawText)}`),
  );
}

export interface ChangeDetectionResult {
  material: MaterialChange[];
  /** Consumer-visible but not notification-worthy (timeline only). */
  nonMaterial: string[];
}

export function detectChanges(prev: CaseProjection, next: CaseProjection): ChangeDetectionResult {
  const material: MaterialChange[] = [];
  const nonMaterial: string[] = [];

  // Retraction — always material, fires immediately (founder rule).
  if (prev.state !== 'retracted' && next.state === 'retracted') {
    material.push({
      ruleId: 'retraction',
      summary: 'The agency retracted this notice.',
      fingerprint: fingerprint(`retraction`),
    });
  }

  // Closure — dashboard-visible, never a push (founder rule).
  if (prev.state !== 'closed' && next.state === 'closed') {
    nonMaterial.push('Recall closed by the agency.');
  }

  // Affected products grew.
  const prevProducts = productKeys(prev);
  const newProducts = [...productKeys(next)].filter((k) => !prevProducts.has(k)).sort();
  if (newProducts.length > 0) {
    // A list growing from empty is the source broadening product identification
    // (e.g. a PHA whose products were previously only in a PDF), not an expansion.
    const ruleId = prevProducts.size === 0 ? 'correction_broadened' : 'expansion_products';
    material.push({
      ruleId,
      summary:
        ruleId === 'expansion_products'
          ? `Affected products expanded (${newProducts.length} product line${newProducts.length === 1 ? '' : 's'} added).`
          : 'The notice now identifies specific affected products.',
      fingerprint: fingerprint(`products:${newProducts.join(';')}`),
    });
  }
  const removedProducts = [...prevProducts].filter((k) => !productKeys(next).has(k));
  if (removedProducts.length > 0) {
    nonMaterial.push('Scope corrected by the agency: product lines removed.');
  }

  // Geography widened (states added, → nationwide, or unknown → known).
  const widened =
    (next.geography.scope === 'nationwide' && prev.geography.scope !== 'nationwide') ||
    (next.geography.scope === 'states' &&
      (prev.geography.scope === 'unknown' ||
        (prev.geography.scope === 'states' &&
          next.geography.states.some((s) => !prev.geography.states.includes(s)))));
  if (widened) {
    material.push({
      ruleId: 'expansion_geography',
      summary: `Affected area widened (${next.geography.scope === 'nationwide' ? 'now nationwide' : next.geography.states.join(', ')}).`,
      fingerprint: fingerprint(
        `geography:${next.geography.scope}:${[...next.geography.states].sort().join(',')}`,
      ),
    });
  } else if (prev.geography.scope === 'nationwide' && next.geography.scope !== 'nationwide') {
    nonMaterial.push('Scope corrected by the agency: distribution narrowed.');
  }

  // Classification assigned or changed (founder rule, corrected 2026-08-21:
  // ANY authoritative classification assignment or change — upgrades AND
  // downgrades — is consumer-relevant and notification-eligible).
  //
  // The comparison is between authoritative class SETS, because that is the
  // authoritative fact. {I, III} → {I, II} leaves the consumer tier at High
  // and is still a real regulatory change; {II} → {II} arrived at by a
  // different route is not. The consumer tier is derived from this transition
  // and never generates an event of its own, so one classification change is
  // always exactly one notification.
  const prevClasses = officialClassesOf(prev.classification);
  const nextClasses = officialClassesOf(next.classification);
  const prevKey = classSetKey(prevClasses);
  const nextKey = classSetKey(nextClasses);
  if (prevKey !== nextKey) {
    const label = officialClassListText(nextClasses);
    if (nextClasses.length === 0) {
      // Losing a class (e.g. a data regression to unclassified) is not an
      // authoritative classification statement — timeline only.
      nonMaterial.push(
        `Classification changed (${prev.classification.value} → ${next.classification.value}).`,
      );
    } else if (prevClasses.length === 0) {
      material.push({
        ruleId: 'classification_assigned',
        summary: `The agency classified this recall (${label}).`,
        fingerprint: fingerprint(`classified:${nextKey}`),
      });
    } else if (prevClasses.length === 1 && nextClasses.length === 1) {
      const moreSevere =
        classificationSeverityRank(nextClasses[0]) < classificationSeverityRank(prevClasses[0]);
      material.push({
        ruleId: moreSevere ? 'classification_upgraded' : 'classification_downgraded',
        summary: `Classification changed to ${label} (${moreSevere ? 'more' : 'less'} severe than before).`,
        fingerprint: fingerprint(
          `${moreSevere ? 'upgraded' : 'downgraded'}:${prevKey}->${nextKey}`,
        ),
      });
    } else {
      // A set changed. "Upgrade"/"downgrade" would claim a direction that is
      // not defined between sets, so neither is asserted.
      material.push({
        ruleId: 'classification_changed',
        summary: `The agency's classification of this recall changed (now ${label}).`,
        fingerprint: fingerprint(`classes:${prevKey}->${nextKey}`),
      });
    }
  }

  // Illness reports appearing.
  if (!prev.reportsIllness && next.reportsIllness) {
    material.push({
      ruleId: 'health_impact',
      summary: 'The notice now reports illnesses or adverse reactions.',
      fingerprint: fingerprint(`illness:${normalizeText(next.illnessStatement)}`),
    });
  }

  // Consumer instructions changed in substance.
  if (
    next.consumerAction !== null &&
    prev.consumerAction !== null &&
    normalizeText(next.consumerAction) !== normalizeText(prev.consumerAction)
  ) {
    material.push({
      ruleId: 'instructions_changed',
      summary: 'What consumers should do has changed — check the notice.',
      fingerprint: fingerprint(`action:${normalizeText(next.consumerAction)}`),
    });
  }

  // Everything else (title/summary wording, contact, quantity, dates) is
  // Layer-1 churn: timeline-visible via the pipeline, never material.
  return { material, nonMaterial };
}
