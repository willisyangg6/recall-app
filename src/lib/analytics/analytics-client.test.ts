import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { AnalyticsClient, MAX_QUEUE, parseState, type AnalyticsPorts } from './analytics-client';
import {
  CONTEXT_KEYS,
  CONVERSION_WINDOW_DAYS,
  EVENT_PROPERTIES,
  eventProperties,
  analyticsSuppressedForAge,
  distributionOf,
  isMinorAgeAnswer,
  VISIT_GAP_MS,
} from './analytics-events';

interface Sent {
  event: string;
  uuid: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

function harness(
  overrides: Partial<AnalyticsPorts> & { stored?: string | null; status?: number | 'throw' } = {},
) {
  let stored: string | null = overrides.stored ?? null;
  let clock = Date.parse('2026-11-25T12:00:00Z');
  let n = 0;
  const requests: { url: string; batch: Sent[] }[] = [];
  const timers: (() => void)[] = [];
  const box = { status: overrides.status ?? 200 };
  const ports: AnalyticsPorts = {
    apiKey: 'phc_test',
    host: 'https://us.i.posthog.com',
    baseContext: {
      app_version: '1.2.0',
      app_build: '17',
      environment: 'production',
      os: 'ios',
      os_version: '26.1',
    },
    readState: async () => stored,
    writeState: async (value) => {
      stored = value;
    },
    priorOnboardingProgress: async () => false,
    suppressed: async () => false,
    storeEnvironment: async () => 'Production',
    randomUUID: () => `uuid-${++n}`,
    now: () => new Date(clock),
    fetch: async (url, init) => {
      if (box.status === 'throw') throw new Error('offline');
      requests.push({ url, batch: JSON.parse(init.body).batch });
      return { status: box.status as number };
    },
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => {},
    ...overrides,
  };
  const client = new AnalyticsClient(ports);
  return {
    client,
    requests,
    box,
    sent: () => requests.flatMap((r) => r.batch),
    names: () => requests.flatMap((r) => r.batch.map((e) => e.event)),
    state: () => parseState(stored),
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let queued work run, fire the debounce timer, and let the send finish. */
    drain: async () => {
      await client.settled();
      timers.splice(0).forEach((t) => t());
      await client.settled();
    },
  };
}

test('off without a project key: nothing stored, nothing sent', async () => {
  const h = harness({ apiKey: null });
  await h.client.start();
  h.client.capture({ name: 'paywall_viewed', props: { placement: 'onboarding' } });
  await h.client.settled();
  assert.equal(h.requests.length, 0);
  assert.equal(h.state(), null);
});

test('off for a person whose age answer says 13–17', async () => {
  const h = harness({ suppressed: async () => true });
  await h.client.start();
  h.client.capture({ name: 'purchase_started', props: { placement: 'onboarding' } });
  await h.client.settled();
  assert.equal(h.requests.length, 0);
  assert.equal(h.state(), null);
  assert.equal(isMinorAgeAnswer({ kind: 'shared', lowerBound: 13, upperBound: 15 }), true);
  assert.equal(isMinorAgeAnswer({ kind: 'shared', lowerBound: 16, upperBound: null }), true);
  assert.equal(isMinorAgeAnswer({ kind: 'shared', lowerBound: 18, upperBound: null }), false);
  assert.equal(isMinorAgeAnswer({ kind: 'declined' }), false);
  assert.equal(isMinorAgeAnswer(null), false);
});

test('a new installation: first seen as new, one launch open, sent once to the batch endpoint', async () => {
  const h = harness();
  await h.client.start();
  await h.client.start(); // a second call in the same launch counts nothing
  await h.client.settled();
  assert.deepEqual(h.names(), ['app_first_seen', 'app_opened']);
  assert.equal(h.requests[0].url, 'https://us.i.posthog.com/batch/');
  const [first, open] = h.sent();
  assert.equal(first.properties.install_kind, 'new');
  assert.equal(open.properties.trigger, 'launch');
  assert.equal(first.distinct_id, h.state()!.analyticsId);
  assert.notEqual(first.uuid, open.uuid);
  assert.equal(first.properties.$process_person_profile, false);
  assert.equal(first.properties.$geoip_disable, true);
  assert.equal(first.properties.app_build, '17');
  // Known before the first send, so a first open passes the customer filter.
  assert.equal(first.properties.store_environment, 'Production');
  assert.equal(first.properties.distribution, 'app_store');
  assert.equal(h.state()!.queue.length, 0);
});

test('a person updating from a build without analytics is "returning", not new', async () => {
  const h = harness({ priorOnboardingProgress: async () => true });
  await h.client.start();
  await h.client.settled();
  assert.equal(h.sent()[0].properties.install_kind, 'returning');
});

test('a later build on the same installation reports app_updated, never first seen again', async () => {
  const first = harness();
  await first.client.start();
  await first.client.settled();
  const stored = JSON.stringify({ ...first.state()!, lastBuild: '16' });
  const h = harness({ stored });
  await h.client.start();
  await h.client.settled();
  assert.deepEqual(h.names(), ['app_updated', 'app_opened']);
  assert.equal(h.sent()[0].properties.previous_build, '16');
  // Same build again: only the open.
  const again = harness({ stored: JSON.stringify(h.state()) });
  await again.client.start();
  await again.client.settled();
  assert.deepEqual(again.names(), ['app_opened']);
});

test('a failed send keeps the events and resends the SAME uuids; delivered once', async () => {
  const h = harness({ status: 'throw' });
  await h.client.start();
  await h.client.settled();
  assert.equal(h.requests.length, 0);
  assert.equal(h.state()!.queue.length, 2);
  const uuids = h.state()!.queue.map((e) => e.uuid);
  h.box.status = 200;
  h.client.background();
  await h.client.settled();
  assert.deepEqual(
    h.sent().map((e) => e.uuid),
    uuids,
  );
  h.client.background();
  await h.client.settled();
  assert.equal(h.sent().length, 2, 'nothing sent twice');
});

test('PostHog rejecting a batch as invalid drops it rather than retrying forever', async () => {
  const h = harness({ status: 400 });
  await h.client.start();
  await h.client.settled();
  assert.equal(h.state()!.queue.length, 0);
});

test('analytics failures never reach the app: storage and network throwing', async () => {
  const h = harness({
    writeState: async () => {
      throw new Error('disk full');
    },
    status: 'throw',
  });
  assert.doesNotThrow(() => h.client.start());
  assert.doesNotThrow(() =>
    h.client.capture({ name: 'purchase_started', props: { placement: 'standalone' } }),
  );
  assert.doesNotThrow(() => h.client.background());
  await h.client.settled(); // resolves, never rejects
  const broken = harness({
    readState: async () => {
      throw new Error('unreadable');
    },
  });
  await broken.client.start();
  broken.client.capture({ name: 'feed_viewed', props: { first_time: true } });
  await broken.client.settled();
});

test('the purchase sheet backgrounding the app is not a visit; a real return is', async () => {
  const h = harness();
  await h.client.start();
  await h.client.settled();
  h.client.background();
  h.advance(60_000);
  h.client.foreground();
  await h.client.settled();
  assert.equal(h.names().filter((n) => n === 'app_opened').length, 1);
  h.client.background();
  h.advance(VISIT_GAP_MS);
  h.client.foreground();
  await h.drain();
  const opens = h.sent().filter((e) => e.event === 'app_opened');
  assert.deepEqual(
    opens.map((e) => e.properties.trigger),
    ['launch', 'foreground'],
  );
});

test('feed entry: first time once per installation, then a plain view', async () => {
  const h = harness();
  await h.client.start();
  h.client.feedViewed();
  h.client.feedViewed();
  await h.drain();
  const feed = h.sent().filter((e) => e.event === 'feed_viewed');
  assert.deepEqual(
    feed.map((e) => e.properties.first_time),
    [true, false],
  );
});

test('purchase and restore outcomes are sent at once and stay distinct', async () => {
  const h = harness();
  await h.client.start();
  await h.client.settled();
  h.client.capture({ name: 'restore_completed', props: { placement: 'standalone' } });
  await h.client.settled();
  h.client.capture({ name: 'purchase_completed', props: { placement: 'onboarding' } });
  await h.client.settled();
  assert.deepEqual(h.names().slice(-2), ['restore_completed', 'purchase_completed']);
  assert.equal(h.requests.length, 3);
});

test('a team device is marked on every later event, with the store environment', async () => {
  const h = harness();
  await h.client.start();
  h.client.setInternal(true);
  h.client.capture({ name: 'paywall_viewed', props: { placement: 'onboarding' } });
  await h.drain();
  const paywall = h.sent().find((e) => e.event === 'paywall_viewed')!;
  assert.equal(paywall.properties.internal, true);
  assert.equal(paywall.properties.store_environment, 'Production');
  assert.equal(h.client.isInternal(), true);
});

test('reset discards the id and unsent events; the next start is a new analytics installation', async () => {
  const h = harness({ status: 'throw' });
  await h.client.start();
  const firstId = h.client.analyticsId();
  await h.client.reset();
  assert.equal(h.state(), null);
  h.client.capture({ name: 'paywall_viewed', props: { placement: 'onboarding' } });
  await h.client.settled();
  assert.equal(h.state(), null, 'nothing recorded after reset');
  let m = 0;
  const next = harness({ randomUUID: () => `fresh-${++m}` });
  await next.client.start();
  assert.notEqual(next.client.analyticsId(), firstId);
});

test('the offline queue is bounded', async () => {
  const h = harness({ status: 'throw' });
  await h.client.start();
  for (let i = 0; i < MAX_QUEUE + 20; i += 1) {
    h.client.capture({ name: 'onboarding_completed', props: {} });
  }
  await h.client.settled();
  assert.equal(h.state()!.queue.length, MAX_QUEUE);
});

test('only catalog properties and context are sent — no preferences, tokens, ids or personal data', async () => {
  const h = harness();
  await h.client.start();
  // A caller passing an extra key cannot widen what is sent.
  h.client.capture({
    name: 'paywall_viewed',
    props: { placement: 'onboarding', allergens: ['peanut'] } as never,
  });
  await h.drain();
  const allowed = new Set([
    ...Object.values(EVENT_PROPERTIES).flat(),
    ...CONTEXT_KEYS,
    'distribution',
    '$process_person_profile',
    '$geoip_disable',
    '$lib',
    '$app_version',
    '$app_build',
    '$os',
    'distinct_id',
  ]);
  for (const event of h.sent()) {
    for (const key of Object.keys(event.properties))
      assert.ok(allowed.has(key), `unexpected ${key}`);
  }
  const forbidden =
    /allergen|health|symptom|preference|state_code|states|retailer|token|receipt|email|phone|name|installation|purchase_id|app_user|recall/i;
  for (const key of allowed) assert.ok(!forbidden.test(key), `catalog key ${key} looks personal`);
  assert.equal(CONVERSION_WINDOW_DAYS, 7);
});

test('no analytics SDK: events go over plain HTTP, and the lock stays free of PostHog packages', () => {
  const lock = readFileSync(join(__dirname, '..', '..', '..', 'package-lock.json'), 'utf8');
  assert.ok(!/posthog/i.test(lock));
  const source = readFileSync(join(__dirname, 'analytics.ts'), 'utf8');
  assert.ok(!/autocapture|session.?replay|captureScreens|PostHogProvider/i.test(source));
});

test('distribution separates App Store, TestFlight, Xcode, preview and development', () => {
  assert.equal(distributionOf('production', 'Production'), 'app_store');
  assert.equal(distributionOf('production', 'Sandbox'), 'testflight');
  assert.equal(distributionOf('production', 'Xcode'), 'xcode');
  assert.equal(distributionOf('production', null), 'unknown');
  assert.equal(distributionOf('preview', 'Production'), 'preview');
  assert.equal(distributionOf('development', 'Production'), 'development');
});

test('TestFlight events are marked testflight, never app_store', async () => {
  const h = harness({ storeEnvironment: async () => 'Sandbox' });
  await h.client.start();
  await h.client.settled();
  for (const event of h.sent()) assert.equal(event.properties.distribution, 'testflight');
});

test('no event before the launch age decision exists, or for a minor', () => {
  const adult = { kind: 'proceed', ageClass: 'adult' };
  const unknown = { kind: 'proceed', ageClass: 'unknown' };
  assert.equal(analyticsSuppressedForAge(null, null), true, 'undecided = off');
  assert.equal(analyticsSuppressedForAge({ kind: 'retry' }, null), true);
  assert.equal(analyticsSuppressedForAge({ kind: 'under13' }, null), true);
  assert.equal(analyticsSuppressedForAge({ kind: 'proceed', ageClass: 'minor' }, null), true);
  assert.equal(
    analyticsSuppressedForAge(unknown, { kind: 'shared', lowerBound: 13, upperBound: 17 }),
    true,
    'a stored minor answer keeps it off',
  );
  assert.equal(analyticsSuppressedForAge(adult, null), false);
  assert.equal(analyticsSuppressedForAge(unknown, { kind: 'declined' }), false);
});

test('every catalog event carries $geoip_disable: true and no person profile', () => {
  const context = {
    app_version: '1.2.0',
    app_build: '17',
    environment: 'production' as const,
    store_environment: 'Production',
    internal: false,
    os: 'ios',
    os_version: '26.1',
  };
  for (const name of Object.keys(EVENT_PROPERTIES)) {
    const props = eventProperties({ name, props: {} } as never, context);
    assert.ok(props, name);
    assert.equal(props.$geoip_disable, true, name);
    assert.equal(props.$process_person_profile, false, name);
  }
});
