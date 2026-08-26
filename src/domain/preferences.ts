/**
 * User recall preferences (Phase C3): the three personalization dimensions —
 * home state, allergens, retailers — as closed, validated vocabularies.
 *
 * Everything here is a closed set:
 * - State: the same 52 jurisdictions the geography layer normalizes to
 *   (50 states + DC + Puerto Rico), stored as postal codes.
 * - Allergens: the nine major US food allergens (FASTER Act framework),
 *   expressed as the canonical tokens `normalizedAllergenTokens` already
 *   produces from authoritative notice text. Preferences never introduce a
 *   vocabulary the data layer cannot produce.
 * - Retailers: canonical catalog ids from domain/retailer-catalog.
 *
 * Preferences are personal input, never medical or purchase inference; they
 * only ever ADD relevance signals. Their absence proves nothing about safety.
 */

import { POSTAL_TO_STATE } from './us-geography';
import { retailerById } from './retailer-catalog';

/** Two-letter code for a supported state/territory ('CA', 'DC', 'PR'). */
export type USStateCode = string;

export const SUPPORTED_STATE_CODES: string[] = Object.keys(POSTAL_TO_STATE);

export function isSupportedStateCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(POSTAL_TO_STATE, code);
}

/** Full state name for a supported code; null for anything else. */
export function stateNameForCode(code: string | null): string | null {
  if (code === null) return null;
  return POSTAL_TO_STATE[code] ?? null;
}

export interface AllergenOption {
  /** Canonical matching token (domain/hazard `normalizedAllergenTokens`). */
  token: string;
  /** Consumer display label. */
  label: string;
}

/**
 * The nine major US food allergens, in display order. Tokens match what the
 * hazard layer derives from source text — e.g. a notice naming cashews or
 * walnuts yields the `tree nuts` token, so a "Tree nuts" preference matches
 * specific-nut recalls without any extra inference. Known non-major tokens
 * the data layer can produce (`gluten`, `sulfites`) are deliberately not
 * selectable here.
 */
export const CONSUMER_ALLERGENS: AllergenOption[] = [
  { token: 'peanut', label: 'Peanuts' },
  { token: 'tree nuts', label: 'Tree nuts' },
  { token: 'milk', label: 'Milk' },
  { token: 'egg', label: 'Egg' },
  { token: 'wheat', label: 'Wheat' },
  { token: 'soy', label: 'Soy' },
  { token: 'sesame', label: 'Sesame' },
  { token: 'fish', label: 'Fish' },
  { token: 'shellfish', label: 'Crustacean shellfish' },
];

const ALLERGEN_TOKEN_SET = new Set(CONSUMER_ALLERGENS.map((a) => a.token));

export function allergenLabelForToken(token: string): string {
  return CONSUMER_ALLERGENS.find((a) => a.token === token)?.label ?? token;
}

/** One installation's recall preferences. Every field is optional to hold. */
export interface UserRecallPreferences {
  /** Home state/territory postal code, or null when not chosen. */
  state: USStateCode | null;
  /** Selected allergen tokens (subset of CONSUMER_ALLERGENS tokens). */
  allergens: string[];
  /** Selected canonical retailer ids (subset of the retailer catalog). */
  retailers: string[];
}

export const EMPTY_PREFERENCES: UserRecallPreferences = {
  state: null,
  allergens: [],
  retailers: [],
};

/** True when the user has expressed anything at all. */
export function hasAnyPreference(prefs: UserRecallPreferences): boolean {
  return prefs.state !== null || prefs.allergens.length > 0 || prefs.retailers.length > 0;
}

/**
 * Validate an untrusted value (stored JSON, server echo) into a well-formed
 * preference object. Unknown states, tokens, and retailer ids are dropped —
 * never passed through — so a stale stored value from a future or corrupted
 * version degrades to fewer preferences, not to garbage in the matcher.
 */
export function sanitizePreferences(raw: unknown): UserRecallPreferences {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_PREFERENCES };
  const value = raw as Record<string, unknown>;
  const state =
    typeof value.state === 'string' && isSupportedStateCode(value.state) ? value.state : null;
  const allergens = Array.isArray(value.allergens)
    ? [
        ...new Set(
          value.allergens.filter(
            (t): t is string => typeof t === 'string' && ALLERGEN_TOKEN_SET.has(t),
          ),
        ),
      ]
    : [];
  const retailers = Array.isArray(value.retailers)
    ? [
        ...new Set(
          value.retailers.filter(
            (r): r is string => typeof r === 'string' && retailerById(r) !== null,
          ),
        ),
      ]
    : [];
  return { state, allergens, retailers };
}
