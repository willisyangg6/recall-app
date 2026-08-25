/**
 * Loader for the recorded real FDA fixtures (see fixtures/README.md).
 * Test-only helper; npm scripts run from the repo root, so paths are
 * cwd-relative.
 */

import { readFileSync } from 'node:fs';

import type { FdaListingItem } from './parse';

/** All recorded raw listing items (verbatim rows from the listing JSON). */
export function loadListingItems(): FdaListingItem[] {
  return JSON.parse(
    readFileSync('src/server/fda/fixtures/listing-items.json', 'utf8'),
  ) as FdaListingItem[];
}

/** One recorded listing item by its path slug. */
export function loadListingItem(slug: string): FdaListingItem {
  const item = loadListingItems().find((i) => i.path.endsWith(`/${slug}`));
  if (!item) throw new Error(`fixture listing item missing: ${slug}`);
  return item;
}

/** The recorded <main> content region of one announcement detail page. */
export function loadDetailPage(slug: string): string {
  return readFileSync(`src/server/fda/fixtures/pages/${slug}.html`, 'utf8');
}

/** The recorded food-safety RSS feed XML. */
export function loadFoodRss(): string {
  return readFileSync('src/server/fda/fixtures/food-rss.xml', 'utf8');
}
