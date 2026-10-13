/**
 * Reading a stored age record back (pure, Node-testable). Anything that is
 * not exactly the shape lib/age-assurance.ts writes reads as "no record",
 * so a corrupted value can never stand in for an age.
 */

import type { AgeRecord } from './age-assurance';

function boundOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stringsOrNull(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;
}

export function sanitizeAgeRecord(raw: unknown): AgeRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || typeof value.checkedAt !== 'string') return null;
  if (!Number.isFinite(Date.parse(value.checkedAt))) return null;
  const eligible = value.eligible;
  if (eligible !== null && typeof eligible !== 'boolean') return null;
  const regulatoryFeatures = stringsOrNull(value.regulatoryFeatures);
  if (regulatoryFeatures === undefined) return null;

  const answer = value.answer as Record<string, unknown> | null | undefined;
  if (typeof answer !== 'object' || answer === null) return null;
  const base = { version: 1 as const, checkedAt: value.checkedAt, eligible, regulatoryFeatures };
  if (answer.kind === 'declined') return { ...base, answer: { kind: 'declined' } };
  if (answer.kind !== 'shared') return null;
  const lowerBound = boundOrNull(answer.lowerBound);
  const upperBound = boundOrNull(answer.upperBound);
  const parentalControls = stringsOrNull(answer.parentalControls);
  if (lowerBound === undefined || upperBound === undefined || !parentalControls) return null;
  const declaration = answer.declaration;
  if (declaration !== null && typeof declaration !== 'string') return null;
  return {
    ...base,
    answer: { kind: 'shared', lowerBound, upperBound, declaration, parentalControls },
  };
}
