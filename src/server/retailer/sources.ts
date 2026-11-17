/**
 * The retailers whose own public recall notices the monitor reads
 * (docs/recall-retailer-notices.md, "Sources").
 *
 * One pipeline, one spec per publisher: where its index lives, which hosts may
 * serve the index and its documents, how its index is parsed, and the name
 * its notices are attributed to. Everything after the index (fetching,
 * archiving, reading, deciding, approving) is shared and publisher-blind.
 *
 * A source is added here only after it is verified to answer the honest
 * client identity and to publish its own documents. A retailer that only
 * links agency notices (Walmart, Target, Whole Foods) supplies distribution
 * for agency cases, not notices, and is not a source in this sense.
 */

import { ALDI_DOCUMENT_HOST, ALDI_INDEX_URL, parseAldiIndex } from './aldi-index';
import { COSTCO_INDEX_URL, parseCostcoIndex } from './costco-index';
import type { RetailerIndexEntry, RetailerPublisher } from './types';

export interface RetailerSourceSpec {
  publisher: RetailerPublisher;
  /** The name notices are attributed to, as the retailer writes it. */
  displayName: string;
  indexUrl: string;
  /** Hosts the index may be served from (a redirect elsewhere fails the run). */
  indexHosts: readonly string[];
  /** Hosts a notice document may be fetched from. */
  documentHosts: readonly string[];
  /** Stored on every row, so a parser change is visible per publisher. */
  parserVersion: string;
  parseIndex(html: string): RetailerIndexEntry[];
}

export const COSTCO_SOURCE: RetailerSourceSpec = {
  publisher: 'costco',
  displayName: 'Costco',
  indexUrl: COSTCO_INDEX_URL,
  indexHosts: ['www.costco.com'],
  documentHosts: ['gdx-assets.costco.com'],
  parserVersion: 'costco-letter/1',
  parseIndex: parseCostcoIndex,
};

export const ALDI_SOURCE: RetailerSourceSpec = {
  publisher: 'aldi',
  displayName: 'ALDI',
  indexUrl: ALDI_INDEX_URL,
  indexHosts: ['corporate.aldi.us'],
  documentHosts: [ALDI_DOCUMENT_HOST],
  parserVersion: 'aldi-notice/1',
  parseIndex: parseAldiIndex,
};

/**
 * H-E-B: MANUAL INTAKE ONLY. Every H-E-B endpoint (newsroom.heb.com posts,
 * its RSS feeds, its WordPress API and heb.com's recall page) answers the
 * honest client with a bot challenge (verified 2026-11-16), and the monitor
 * never gets past one. A person saves the official notice from a browser and
 * hands the file to `retailer:monitor -- --publisher heb --intake …`; its
 * "index" is that one intake entry, serialized as JSON.
 */
export const HEB_SOURCE: RetailerSourceSpec = {
  publisher: 'heb',
  displayName: 'H-E-B',
  indexUrl: 'https://newsroom.heb.com/heb-news/recalls/',
  indexHosts: [],
  documentHosts: [],
  parserVersion: 'heb-intake/1',
  parseIndex: parseIntakeIndex,
};

/** A manual intake's one-entry index (see `intake.ts`). */
export function parseIntakeIndex(json: string): RetailerIndexEntry[] {
  return JSON.parse(json) as RetailerIndexEntry[];
}

export const RETAILER_SOURCES: Readonly<Record<RetailerPublisher, RetailerSourceSpec>> = {
  costco: COSTCO_SOURCE,
  aldi: ALDI_SOURCE,
  heb: HEB_SOURCE,
};

/** Sources whose notices enter only through a person's saved copy. */
export const MANUAL_INTAKE_PUBLISHERS: readonly RetailerPublisher[] = ['heb'];

export function isRetailerPublisher(value: string): value is RetailerPublisher {
  return Object.prototype.hasOwnProperty.call(RETAILER_SOURCES, value);
}
