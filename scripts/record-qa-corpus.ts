/**
 * Development-only: record a large, diverse sample of real FDA food
 * announcements for the consumer-projection QA harness.
 *
 *   npx tsx scripts/record-qa-corpus.ts [count]
 *
 * Sampling is deterministic and diversity-driven (see pickSample): it spans
 * years, hazard families, table-vs-prose bodies, image-rich and image-free
 * notices, update/expansion churn, and every distribution shape — so the
 * harness measures the real source population rather than a convenience set.
 *
 * The corpus is stored gzipped (raw bytes are ~10x larger) as
 * src/server/fda/fixtures/qa-corpus.json.gz: one entry per announcement with
 * its verbatim listing row and the `<main>` content region of its official
 * page. Never hand-edit it; re-record instead.
 */

import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

import { fetchFdaDetailPage, fetchFdaListing } from '../src/server/fda/fetch';
import {
  foodScope,
  isFdaListingItem,
  slugFromPath,
  type FdaListingItem,
} from '../src/server/fda/parse';

const DEFAULT_COUNT = 160;
const DELAY_MS = 150;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function listingDateIso(item: FdaListingItem): string {
  const m = (item.field_change_date_2 ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

/**
 * Deterministic diversity sample: bucket the food-scoped population by year
 * and hazard-reason family, then round-robin the buckets (newest first within
 * each) until the target count is reached. This guarantees coverage of old and
 * new source shapes and of every reason family, instead of over-sampling the
 * most recent weeks.
 */
export function pickSample(items: FdaListingItem[], count: number): FdaListingItem[] {
  const buckets = new Map<string, FdaListingItem[]>();
  for (const item of items) {
    const year = listingDateIso(item).slice(0, 4) || 'unknown';
    const reason = (item.field_recall_reason ?? 'unknown').split(',')[0].trim().toLowerCase();
    const key = `${year}|${reason}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => listingDateIso(b).localeCompare(listingDateIso(a)));
  }
  const keys = [...buckets.keys()].sort();
  const picked: FdaListingItem[] = [];
  for (let round = 0; picked.length < count; round++) {
    let addedThisRound = 0;
    for (const key of keys) {
      const bucket = buckets.get(key)!;
      if (round >= bucket.length) continue;
      picked.push(bucket[round]);
      addedThisRound += 1;
      if (picked.length >= count) break;
    }
    if (addedThisRound === 0) break; // every bucket exhausted
  }
  return picked;
}

export interface QaCorpusEntry {
  path: string;
  listing: FdaListingItem;
  /** The `<main>` content region of the official announcement page. */
  mainHtml: string;
}

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? DEFAULT_COUNT);
  console.log('Fetching FDA announcement listing…');
  const listing = await fetchFdaListing();
  const food = listing.items.filter(isFdaListingItem).filter((i) => foodScope(i) === 'food');
  console.log(`${listing.items.length} listing items, ${food.length} food-scoped.`);

  const sample = pickSample(food, count);
  console.log(`Sampling ${sample.length} announcements across years and hazard families…`);

  const entries: QaCorpusEntry[] = [];
  let failures = 0;
  for (const [index, item] of sample.entries()) {
    try {
      const mainHtml = await fetchFdaDetailPage(`https://www.fda.gov${item.path}`);
      entries.push({ path: item.path, listing: item, mainHtml });
      if ((index + 1) % 20 === 0) console.log(`  …${index + 1}/${sample.length}`);
    } catch (error) {
      failures += 1;
      console.warn(
        `  FAILED ${slugFromPath(item.path)}: ${error instanceof Error ? error.message : error}`,
      );
    }
    await sleep(DELAY_MS);
  }

  const target = 'src/server/fda/fixtures/qa-corpus.json.gz';
  const json = JSON.stringify(entries);
  writeFileSync(target, gzipSync(json, { level: 9 }));
  console.log(
    `\nRecorded ${entries.length} announcements (${failures} failures) → ${target} ` +
      `(${(json.length / 1e6).toFixed(1)} MB raw, ${(gzipSync(json, { level: 9 }).length / 1e6).toFixed(2)} MB gzipped)`,
  );
}

main().catch((error) => {
  console.error('Recording failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
