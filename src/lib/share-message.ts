/**
 * Native-share message construction (C6) — one pure function, so what leaves
 * the app is a tested contract rather than JSX string-building.
 *
 * The message is generated ONLY from canonical projection-derived facts the
 * detail screen already shows: product identity, company/brand, the "What
 * happened" sentence, the source-stated consumer action, and the official
 * agency URL (always included). By construction it can carry nothing
 * personal: the input type has no place for state, allergens, retailers, or
 * relevance, and the copy never claims the recipient is affected. The link is
 * the agency's own page — never a tracking link.
 */

export interface ShareMessageInput {
  /** Consumer product name (productDisplayName output — never empty). */
  productName: string;
  /** Recalling firm display name, when the projection has one. */
  firmDisplayName: string | null;
  /** Source-structured brands; used when there is no firm name. */
  brands: string[];
  /** The 1–2 sentence "What happened" text (buildWhatHappened — never empty). */
  whatHappened: string;
  /**
   * The notice's own consumer instruction. Pass null when the app would be
   * substituting its own recommendation — a shared message quotes the source.
   */
  consumerAction: string | null;
  /** 'FDA' | 'USDA FSIS' (agencyLabel output). */
  agencyLabel: string;
  /** The official agency notice URL. Required — sharing without it is a bug. */
  officialUrl: string;
}

export interface ShareMessage {
  /** Share-sheet title/subject. */
  title: string;
  /** Full message body, official URL last. */
  message: string;
}

function cleaned(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function buildShareMessage(input: ShareMessageInput): ShareMessage {
  const url = cleaned(input.officialUrl);
  if (url === null) {
    throw new TypeError('A share message requires the official source URL.');
  }
  const product = cleaned(input.productName) ?? 'Recalled product';

  const firm = cleaned(input.firmDisplayName);
  const brands = input.brands.map((brand) => cleaned(brand)).filter((b): b is string => b !== null);
  const companyLine = firm
    ? `Company: ${firm}`
    : brands.length > 0
      ? `Brand: ${brands.join(', ')}`
      : null;

  const action = cleaned(input.consumerAction);
  const lines = [
    `Food recall: ${product}`,
    companyLine,
    cleaned(input.whatHappened),
    action ? `What to do: ${action}` : null,
    `Official ${cleaned(input.agencyLabel) ?? 'agency'} notice: ${url}`,
  ];

  return {
    title: `Recall: ${product}`,
    message: lines.filter((line): line is string => line !== null).join('\n\n'),
  };
}
