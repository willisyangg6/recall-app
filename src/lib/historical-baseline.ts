/**
 * HISTORICAL TEST DATA — the bundled baseline as committed on 2026-10-04,
 * recovered verbatim from Git (content/historical/README.md). Never shipped.
 *
 * It preserves real decks the current baseline no longer produces: photo-less
 * rated recalls and Pending recalls filling Ready's deck, from before
 * agency-confirmed open recalls were counted. Read through the same reader as
 * the shipped baseline, so it is matched exactly as any corpus is.
 *
 * Import it ONLY from tests and from development-only tooling
 * (components/development/), which a release bundle folds away.
 * `historical-baseline.test.ts` fails if anything else imports it.
 */

import historical from '@/content/historical/baseline-recalls-2026-10-04.json';
import { baselineFeedItems, type BaselineDocument } from '@/lib/baseline-recalls';
import type { FeedItem } from '@/lib/recall-feed';

const document = historical as unknown as BaselineDocument;

/** When the historical baseline was recorded: the clock its scenarios are read at. */
export const HISTORICAL_BASELINE_RECORDED_AT: string = document.recordedAt;

/** The historical baseline's 64 real recall records. */
export const HISTORICAL_BASELINE_RECALLS: readonly FeedItem[] = baselineFeedItems(document);
