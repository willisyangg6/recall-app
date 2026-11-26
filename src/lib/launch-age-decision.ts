/**
 * The launch age gate's decision for this launch, held in memory for code
 * that must know it without re-deriving it (product analytics,
 * lib/analytics). Set by components/age-gate.tsx the moment a decision
 * arrives, before anything beneath the gate mounts. Null until then — which
 * readers must treat as "not eligible yet". Never stored, never sent.
 *
 * A leaf: no imports beyond the decision type.
 */

import type { AgeDecision } from './age-assurance';

let decision: AgeDecision | null = null;

export function recordLaunchAgeDecision(next: AgeDecision): void {
  decision = next;
}

export function launchAgeDecision(): AgeDecision | null {
  return decision;
}
