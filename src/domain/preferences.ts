/**
 * User recall preferences (Phase C3): the three personalization dimensions —
 * jurisdictions, allergens, retailers — as closed, validated vocabularies.
 *
 * Everything here is a closed set:
 * - Jurisdictions: the same 52 the geography layer normalizes to (50 states
 *   + DC + Puerto Rico), stored as postal codes. Since P2B7U a user may hold
 *   SEVERAL of them — people live near a border, shop across one, and keep a
 *   second home — so the field is a list. An empty list is "no location
 *   preference", which is a real answer and never a match.
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

/**
 * THE order jurisdictions are listed in, everywhere: by full name, so
 * District of Columbia sits between Delaware and Florida rather than after
 * Wyoming (which is where the postal map's own key order puts it).
 *
 * One definition, because three surfaces have to agree: the selector's rows,
 * the stored array, and the Settings summary's "first two names, then +N".
 * If the summary ordered differently from the list the shopper just tapped,
 * the two would disagree about which two names are "first".
 */
export const STATE_CODES_IN_ORDER: string[] = [...SUPPORTED_STATE_CODES].sort((a, b) =>
  (POSTAL_TO_STATE[a] as string).localeCompare(POSTAL_TO_STATE[b] as string),
);

const STATE_ORDER = new Map(STATE_CODES_IN_ORDER.map((code, index) => [code, index]));

/**
 * Supported codes only, de-duplicated, in the canonical order — never the
 * order they were tapped in. Tap order would make the same three
 * jurisdictions render two different summaries depending on how they were
 * chosen, and would reorder the Settings row under the shopper after an
 * edit. (Allergens and stores keep their chosen order; those lists are short
 * and the shopper composed them. A 52-row jurisdiction list is not composed,
 * it is picked from.)
 */
export function orderStateCodes(codes: Iterable<string>): string[] {
  return [...new Set(codes)]
    .filter(isSupportedStateCode)
    .sort((a, b) => (STATE_ORDER.get(a) as number) - (STATE_ORDER.get(b) as number));
}

/** The full names of the given codes, in the canonical order. */
export function stateNamesForCodes(codes: Iterable<string>): string[] {
  return orderStateCodes(codes).map((code) => POSTAL_TO_STATE[code] as string);
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
  /**
   * Chosen state/territory postal codes, de-duplicated and in
   * `STATE_CODES_IN_ORDER`. Empty = no location preference, which is a real
   * answer: location is simply not assessed, exactly as it was for a user
   * who had chosen no state before P2B7U.
   */
  states: USStateCode[];
  /** Selected allergen tokens (subset of CONSUMER_ALLERGENS tokens). */
  allergens: string[];
  /** Selected canonical retailer ids (subset of the retailer catalog). */
  retailers: string[];
}

export const EMPTY_PREFERENCES: UserRecallPreferences = {
  states: [],
  allergens: [],
  retailers: [],
};

/** True when the user has expressed anything at all. */
export function hasAnyPreference(prefs: UserRecallPreferences): boolean {
  return prefs.states.length > 0 || prefs.allergens.length > 0 || prefs.retailers.length > 0;
}

/**
 * Validate an untrusted value (stored JSON, server echo) into a well-formed
 * preference object. Unknown states, tokens, and retailer ids are dropped —
 * never passed through — so a stale stored value from a future or corrupted
 * version degrades to fewer preferences, not to garbage in the matcher.
 *
 * ## The one migration (P2B7U)
 *
 * This is also where the pre-P2B7U singular `state` becomes a one-item
 * `states` list. It happens HERE, in the one function every read already
 * passes through (`loadPreferences` sanitizes the parsed blob), rather than
 * in a versioned upgrade step, because a sanitizer is by definition the
 * thing that reads shapes it did not write.
 *
 * Both keys are read and UNIONED, never one-or-the-other: a blob is the
 * union of what it says, so nothing a stored value asserts is dropped. The
 * output carries `states` and no `state` at all, so the migration is
 * idempotent by construction — sanitizing the result again finds only the
 * plural key, and there is never a singular field left for a second
 * authority to grow out of.
 */
export function sanitizePreferences(raw: unknown): UserRecallPreferences {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_PREFERENCES };
  const value = raw as Record<string, unknown>;
  const claimed = Array.isArray(value.states)
    ? value.states.filter((code): code is string => typeof code === 'string')
    : [];
  // The legacy singular field. `orderStateCodes` drops it if it is not a
  // supported code, so a corrupt legacy value cannot corrupt the list.
  if (typeof value.state === 'string') claimed.push(value.state);
  const states = orderStateCodes(claimed);
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
  return { states, allergens, retailers };
}
