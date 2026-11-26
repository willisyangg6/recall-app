/**
 * Create Lotly's customer analytics dashboard in PostHog
 * (docs/recall-analytics.md).
 *
 *   npm run analytics:dashboard              # prints every insight; writes nothing
 *   npm run analytics:dashboard -- --apply   # creates the dashboard and insights
 *
 * --apply needs POSTHOG_PERSONAL_API_KEY (scopes dashboard:write,
 * insight:write) and POSTHOG_PROJECT_ID; optionally POSTHOG_API_HOST
 * (default https://us.posthog.com) and POSTHOG_EXCLUDED_IDS (comma-separated
 * analytics ids of team devices, excluded by distinct_id). The key is never
 * printed.
 *
 * Lotly uses ONE PostHog project for every build, so every insight carries
 * the customer filter itself: `distribution = app_store` (App Store installs
 * only — never TestFlight, Xcode, preview or development) and `internal ≠
 * true` (team devices). It does not depend on the project's test-account
 * filter.
 */

import {
  CONVERSION_WINDOW_DAYS,
  type AnalyticsEventName,
} from '../src/lib/analytics/analytics-events';
import { ONBOARDING_STEPS } from '../src/lib/onboarding-state';

type Json = Record<string, unknown>;

const EXCLUDED_IDS = (process.env.POSTHOG_EXCLUDED_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

/** App Store customers only: no testing builds, no team devices. */
export const CUSTOMER: Json[] = [
  { key: 'distribution', value: ['app_store'], operator: 'exact', type: 'event' },
  { key: 'internal', value: ['true'], operator: 'is_not', type: 'event' },
  ...(EXCLUDED_IDS.length
    ? [{ key: 'distinct_id', value: EXCLUDED_IDS, operator: 'is_not', type: 'event' }]
    : []),
];

const event = (name: AnalyticsEventName, extra: Json = {}): Json => ({
  kind: 'EventsNode',
  event: name,
  name,
  ...extra,
});

const viz = (source: Json): Json => ({ kind: 'InsightVizNode', source });

const base = { filterTestAccounts: false, properties: CUSTOMER, dateRange: { date_from: '-30d' } };

const funnel = (series: Json[]): Json =>
  viz({
    kind: 'FunnelsQuery',
    ...base,
    series,
    funnelsFilter: {
      funnelWindowInterval: CONVERSION_WINDOW_DAYS,
      funnelWindowIntervalUnit: 'day',
      funnelVizType: 'steps',
      funnelOrderType: 'ordered',
    },
  });

export const INSIGHTS: { name: string; description: string; query: Json }[] = [
  {
    name: 'First opens (new vs returning)',
    description: 'app_first_seen per day, split by install_kind.',
    query: viz({
      kind: 'TrendsQuery',
      ...base,
      interval: 'day',
      series: [event('app_first_seen')],
      breakdownFilter: { breakdown: 'install_kind', breakdown_type: 'event' },
    }),
  },
  {
    name: 'Active installations',
    description: 'Unique installations opening the app, daily and weekly.',
    query: viz({
      kind: 'TrendsQuery',
      ...base,
      interval: 'day',
      series: [
        event('app_opened', { math: 'dau' }),
        event('app_opened', { math: 'weekly_active' }),
      ],
    }),
  },
  {
    name: `New-installation funnel (${CONVERSION_WINDOW_DAYS}-day window)`,
    description: 'First open → setup finished → paywall → purchase → Feed.',
    query: funnel([
      event('app_first_seen', {
        properties: [{ key: 'install_kind', value: ['new'], operator: 'exact', type: 'event' }],
      }),
      event('onboarding_completed'),
      event('paywall_viewed'),
      event('purchase_completed'),
      event('feed_viewed'),
    ]),
  },
  {
    name: 'Onboarding step drop-off',
    description: 'Each setup screen in order, then the paywall.',
    query: funnel(
      ONBOARDING_STEPS.map((step) =>
        event('onboarding_step_viewed', {
          custom_name: step,
          properties: [{ key: 'step', value: [step], operator: 'exact', type: 'event' }],
        }),
      ),
    ),
  },
  {
    name: `Paywall conversion (${CONVERSION_WINDOW_DAYS}-day window)`,
    description: 'Paywall shown → purchase started → purchase completed.',
    query: funnel([
      event('paywall_viewed'),
      event('purchase_started'),
      event('purchase_completed'),
    ]),
  },
  {
    name: 'Purchase and restore outcomes',
    description: 'Restores are counted apart from new purchases.',
    query: viz({
      kind: 'TrendsQuery',
      ...base,
      interval: 'week',
      series: [
        event('purchase_completed'),
        event('purchase_cancelled'),
        event('purchase_failed'),
        event('restore_completed'),
        event('restore_nothing_found'),
        event('restore_failed'),
      ],
    }),
  },
  {
    name: 'Return visits',
    description: 'Installations opening the app again after their first open.',
    query: viz({
      kind: 'RetentionQuery',
      ...base,
      retentionFilter: {
        targetEntity: { id: 'app_first_seen', type: 'events', name: 'app_first_seen' },
        returningEntity: { id: 'app_opened', type: 'events', name: 'app_opened' },
        period: 'Day',
        totalIntervals: 14,
        retentionType: 'retention_first_time',
      },
    }),
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  for (const insight of INSIGHTS) {
    console.log(`\n# ${insight.name}\n${insight.description}\n${JSON.stringify(insight.query)}`);
  }
  if (!apply) {
    console.log('\nDry run: nothing was created. Add --apply to create the dashboard.');
    return;
  }
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  const host = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/$/, '');
  if (!key || !project) {
    console.error('Missing POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID. Nothing was created.');
    process.exit(1);
  }
  const post = async (path: string, body: Json): Promise<Json> => {
    const response = await fetch(`${host}/api/projects/${project}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as Json;
  };
  const dashboard = await post('dashboards/', {
    name: 'Lotly — customers',
    description: `App Store customers only (distribution = app_store, internal ≠ true). Conversion window ${CONVERSION_WINDOW_DAYS} days. docs/recall-analytics.md`,
  });
  for (const insight of INSIGHTS) {
    await post('insights/', { ...insight, dashboards: [dashboard.id] });
    console.log(`  ✓ ${insight.name}`);
  }
  console.log(`\nCreated dashboard ${String(dashboard.id)} with ${INSIGHTS.length} insights.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
