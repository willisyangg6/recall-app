/**
 * FSIS contact-field rendering equivalence (2026-10-27).
 *
 * From 19:45 UTC on 2026-10-27 the FSIS API alternated, fetch to fetch, between
 * two renderings of `field_company_media_contact`. Until then every stored
 * payload carried a standalone "Company Contact" heading line above each
 * contact block; the other rendering drops those heading lines and re-flows
 * the whitespace. Names, titles, phone numbers and emails are byte-identical
 * after whitespace collapse. Because the raw payload is the change-detection
 * key, ~700 records hashed as changed on every fetch and were re-archived and
 * re-applied each run.
 *
 * Verified across all 700 alternating snapshot pairs: dropping lines whose
 * entire trimmed text is exactly "Company Contact" and collapsing whitespace
 * makes every pair identical, and nothing else in the payload differed.
 * Other headings ("Consumer Contact", "Media Contact") appear in both
 * renderings and stay significant. Every other field is compared exactly.
 *
 * This key is used only to recognize an already-applied record as unchanged.
 * It is never stored, never hashed into `content_hash`, and never replaces the
 * archived raw payload.
 */

export const FSIS_CONTACT_FIELD = 'field_company_media_contact';

const COMPANY_CONTACT_HEADING = 'Company Contact';

/** One contact entry with the heading-only lines removed and whitespace collapsed. */
export function canonicalContactEntry(entry: unknown): unknown {
  if (typeof entry !== 'string') return entry;
  return entry
    .split(/\r?\n/)
    .filter((line) => line.trim() !== COMPANY_CONTACT_HEADING)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The raw FSIS record with only the contact field canonicalized. Anything that
 * is not the expected shape is returned untouched, so it compares exactly.
 */
export function fsisPresentationKey(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const contact = record[FSIS_CONTACT_FIELD];
  if (!Array.isArray(contact)) return raw;
  return { ...record, [FSIS_CONTACT_FIELD]: contact.map(canonicalContactEntry) };
}
