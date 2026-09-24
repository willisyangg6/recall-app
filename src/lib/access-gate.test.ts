/**
 * The access gate (P2B7X.1): the phase matrix, the route matrix, and the
 * root layout's enforcement of both — pinned against the layout source as
 * text, the technique every structural suite here uses.
 *
 * What is proven:
 *   - the four phases resolve from the record, the entitlement and the
 *     paywall's Back exactly as the contract says, and a completed but
 *     unsubscribed device goes to the PAYWALL, never Welcome;
 *   - every route file under src/app is declared in the root layout inside
 *     a `Stack.Protected` group whose guard is its own phase — so a tab, a
 *     deep link, a notification route or a gesture has no screen to reach;
 *   - the declaration order is the landing order the navigator uses when a
 *     phase changes: the paywall first, then education, then the tabs, then
 *     onboarding with the resume step first;
 *   - a push-notification tap navigates only in the app phase;
 *   - no route navigates across a phase imperatively — every transition is
 *     a state change the gate acts on;
 *   - expiration changes the phase and touches no local data.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import {
  ACCESS_PHASES,
  entryRoute,
  onboardingDeclarationOrder,
  onboardingEntryStep,
  pushNavigationAllowed,
  resolveAccessPhase,
  ROUTE_GROUPS,
  routeGroupAllowed,
  type AccessPhase,
  type RouteGroup,
} from './access-gate';
import {
  completeNotificationEducation,
  completePersonalization,
  INITIAL_ONBOARDING,
  recordShownStep,
} from './onboarding-state';

const APP = join(__dirname, '..', 'app');
const read = (...parts: string[]): string => readFileSync(join(APP, ...parts), 'utf8');
const LAYOUT = read('_layout.tsx');

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const incomplete = recordShownStep(INITIAL_ONBOARDING, 'retailers');
const complete = completePersonalization(INITIAL_ONBOARDING);
const educated = completeNotificationEducation(complete);

// ── The phase matrix ────────────────────────────────────────────────────────

test('an incomplete personalization is the onboarding phase whatever the entitlement says', () => {
  for (const entitled of [false, true]) {
    for (const reviewingPreview of [false, true]) {
      assert.equal(
        resolveAccessPhase({ onboarding: incomplete, entitled, reviewingPreview }),
        'onboarding',
      );
    }
  }
  assert.equal(
    onboardingEntryStep({ onboarding: incomplete, entitled: false, reviewingPreview: false }),
    'retailers',
  );
});

test('a completed, unsubscribed device relaunches on the PAYWALL — never Welcome', () => {
  const inputs = { onboarding: complete, entitled: false, reviewingPreview: false };
  assert.equal(resolveAccessPhase(inputs), 'paywall');
  assert.equal(entryRoute('paywall', onboardingEntryStep(inputs)), 'paywall');
  // The same after education was once completed (expiry after a subscription).
  assert.equal(
    resolveAccessPhase({ onboarding: educated, entitled: false, reviewingPreview: false }),
    'paywall',
  );
});

test('Back from the paywall reviews the Preview: the onboarding phase, opening on Preview, without losing completion', () => {
  const inputs = { onboarding: complete, entitled: false, reviewingPreview: true };
  assert.equal(resolveAccessPhase(inputs), 'onboarding');
  assert.equal(onboardingEntryStep(inputs), 'preview');
  assert.equal(complete.personalizationCompleted, true);
  // A relaunch forgets the in-memory flag → the paywall.
  assert.equal(resolveAccessPhase({ ...inputs, reviewingPreview: false }), 'paywall');
});

test('entitlement success opens education once, then the app; a re-subscription after expiry skips education', () => {
  assert.equal(
    resolveAccessPhase({ onboarding: complete, entitled: true, reviewingPreview: false }),
    'education',
  );
  assert.equal(
    resolveAccessPhase({ onboarding: educated, entitled: true, reviewingPreview: false }),
    'app',
  );
  // Even mid-review, an entitlement that becomes active leaves the paywall side.
  assert.equal(
    resolveAccessPhase({ onboarding: educated, entitled: true, reviewingPreview: true }),
    'app',
  );
});

test('expiration is a phase change only: the record, and therefore every local datum, is untouched', () => {
  const before = { onboarding: educated, entitled: true, reviewingPreview: false };
  const after = { ...before, entitled: false };
  assert.equal(resolveAccessPhase(before), 'app');
  assert.equal(resolveAccessPhase(after), 'paywall');
  assert.equal(after.onboarding, before.onboarding);
  // The provider that performs expiry reaches the onboarding record and the
  // entitlement cache, and NOTHING else on the device: no preferences, no
  // saved recalls, no installation identity, no reset.
  const provider = codeOnly(readFileSync(join(__dirname, '..', 'hooks', 'use-access.tsx'), 'utf8'));
  for (const forbidden of [
    'preferences-store',
    'saved-recalls',
    'installation-id',
    'installation-reset',
    'deleteLocal',
    'clearLocal',
    'clearInstallationId',
    'SecureStore',
  ]) {
    assert.ok(!provider.includes(forbidden), `the access provider reaches ${forbidden}`);
  }
  // Nothing in the gate can reach a store: it imports no persistence at all.
  const gate = codeOnly(readFileSync(join(__dirname, 'access-gate.ts'), 'utf8'));
  for (const forbidden of [
    'SecureStore',
    'preferences-store',
    'saved-recalls',
    'deleteLocal',
    'clear',
  ]) {
    assert.ok(!gate.includes(forbidden), `the gate reaches ${forbidden}`);
  }
});

test('a notification tap may navigate in the app phase only', () => {
  assert.deepEqual(
    ACCESS_PHASES.map((phase) => [phase, pushNavigationAllowed(phase)]),
    [
      ['onboarding', false],
      ['paywall', false],
      ['education', false],
      ['app', true],
    ],
  );
});

// ── The route matrix ────────────────────────────────────────────────────────

test('every product route group is mounted in exactly its own phase', () => {
  const groups: RouteGroup[] = ['onboarding', 'paywall', 'education', 'app'];
  for (const group of groups) {
    for (const phase of ACCESS_PHASES) {
      assert.equal(routeGroupAllowed(group, phase, false), group === phase, `${group} in ${phase}`);
      assert.equal(
        routeGroupAllowed(group, phase, true),
        group === phase,
        `${group} in ${phase} (dev)`,
      );
    }
  }
  // The one exception: the development hub, in every phase of a development
  // build and only the app phase of a release build.
  for (const phase of ACCESS_PHASES) {
    assert.equal(routeGroupAllowed('development', phase, true), true);
    assert.equal(routeGroupAllowed('development', phase, false), phase === 'app');
  }
});

test('the route matrix covers every route file under src/app exactly once', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry) && !/^_layout\.tsx$/.test(entry)) {
        files.push(relative(APP, full).replace(/\.tsx$/, ''));
      }
    }
  };
  walk(APP);
  // Screens inside the tab group are covered by the group.
  const routes = files.map((file) => (file.startsWith('(tabs)/') ? '(tabs)' : file));
  const declared = Object.values(ROUTE_GROUPS).flat();
  assert.deepEqual([...new Set(routes)].sort(), [...declared].sort());
  assert.equal(new Set(declared).size, declared.length, 'a route is in two groups');
});

test('the landing route of each phase is the first declared screen of its group', () => {
  assert.equal(entryRoute('paywall', 'welcome'), ROUTE_GROUPS.paywall[0]);
  assert.equal(entryRoute('education', 'welcome'), ROUTE_GROUPS.education[0]);
  assert.equal(entryRoute('app', 'welcome'), ROUTE_GROUPS.app[0]);
  assert.equal(entryRoute('app', 'welcome'), '(tabs)');
  assert.equal(entryRoute('onboarding', 'allergens'), 'onboarding/allergens');
  assert.deepEqual(onboardingDeclarationOrder('allergens'), [
    'onboarding/allergens',
    'onboarding/welcome',
    'onboarding/states',
    'onboarding/retailers',
    'onboarding/preview',
  ]);
  assert.deepEqual(onboardingDeclarationOrder('welcome'), [...ROUTE_GROUPS.onboarding]);
});

// ── The root layout enforces it ─────────────────────────────────────────────

/** The `<Stack.Protected guard={…}>` blocks in declaration order, with their screens. */
function protectedBlocks(): { guard: string; screens: string[] }[] {
  const code = codeOnly(LAYOUT);
  const blocks: { guard: string; screens: string[] }[] = [];
  const pattern = /<Stack\.Protected guard=\{([^}]+)\}>([\s\S]*?)<\/Stack\.Protected>/g;
  for (const match of code.matchAll(pattern)) {
    const screens = [
      ...match[2].matchAll(/<Stack\.Screen\s+(?:key=\{name\}\s+)?name=(?:"([^"]+)"|\{name\})/g),
    ].map((m) => m[1] ?? '{name}');
    blocks.push({ guard: match[1].trim(), screens });
  }
  return blocks;
}

test('every screen the root layout declares sits inside a protected group guarded by its own phase', () => {
  const blocks = protectedBlocks();
  assert.equal(blocks.length, 5, 'five groups: paywall, education, app, onboarding, development');
  assert.deepEqual(blocks[0], { guard: "phase === 'paywall'", screens: ['paywall'] });
  assert.deepEqual(blocks[1], {
    guard: "phase === 'education'",
    screens: ['onboarding/notifications'],
  });
  assert.deepEqual(blocks[2], { guard: "phase === 'app'", screens: [...ROUTE_GROUPS.app] });
  // Onboarding is declared from the gate's own ordering function, so the
  // resume step is first by construction.
  assert.equal(blocks[3].guard, "phase === 'onboarding'");
  assert.deepEqual(blocks[3].screens, ['{name}']);
  assert.ok(
    codeOnly(LAYOUT).includes('onboardingDeclarationOrder(access.entryStep).map((name) =>'),
  );
  assert.deepEqual(blocks[4], {
    guard: "__DEV__ || phase === 'app'",
    screens: ['design-preview/index'],
  });
  // No `Stack.Screen` lives outside a protected group.
  const outside = codeOnly(LAYOUT).replace(
    /<Stack\.Protected guard=\{[^}]+\}>[\s\S]*?<\/Stack\.Protected>/g,
    '',
  );
  assert.ok(!outside.includes('<Stack.Screen'), 'a screen is declared outside the gate');
});

test('the tabs are declared first in the app group, and the paywall and education keep no header and no back gesture', () => {
  assert.equal(ROUTE_GROUPS.app[0], '(tabs)');
  const code = codeOnly(LAYOUT);
  assert.ok(
    code.includes(
      `<Stack.Screen name="paywall" options={{ headerShown: false, gestureEnabled: false }} />`,
    ),
  );
  assert.match(
    code,
    /name="onboarding\/notifications"\s+options=\{\{ headerShown: false, gestureEnabled: false \}\}/,
  );
});

test('the gate is read once, above the stack, and the splash waits for it', () => {
  const code = codeOnly(LAYOUT);
  assert.ok(code.includes('<AccessProvider>'));
  assert.ok(code.includes('const access = useAccess();'));
  assert.ok(code.includes('const ready = fontsSettled && access.ready;'));
  assert.ok(code.includes('if (ready) void SplashScreen.hideAsync();'));
  assert.ok(code.includes('if (!ready) return null;'));
  // The push hook is handed the phase predicate, never a bare router.
  assert.ok(
    code.includes(
      'usePushNotifications(useCallback(() => pushNavigationAllowed(phase), [phase]));',
    ),
  );
  const push = codeOnly(
    readFileSync(join(__dirname, '..', 'hooks', 'use-push-notifications.ts'), 'utf8'),
  );
  assert.ok(push.includes('if (!canNavigate()) return;'));
  assert.ok(
    push.indexOf('if (!canNavigate()) return;') <
      push.indexOf("router.push({ pathname: '/recall/[id]'"),
  );
});

test('no route navigates across a phase: transitions are state changes the gate acts on', () => {
  const phaseRoutes = ['paywall', 'onboarding/notifications', 'onboarding/preview'];
  for (const route of phaseRoutes) {
    const code = codeOnly(read(...`${route}.tsx`.split('/')));
    for (const forbidden of [
      "router.replace('/')",
      "router.push('/')",
      "'/paywall'",
      "'/(tabs)'",
      'dismissAll',
      "router.replace('/onboarding/notifications')",
    ]) {
      assert.ok(!code.includes(forbidden), `${route} navigates across a phase with ${forbidden}`);
    }
  }
  // The Preview completes personalization and the paywall applies the
  // entitlement; neither pushes what follows.
  assert.ok(
    codeOnly(read('onboarding', 'preview.tsx')).includes('access.completePersonalization()'),
  );
  const paywall = codeOnly(read('paywall.tsx'));
  assert.ok(paywall.includes('await access.applyEntitlement(outcome.entitlement);'));
  assert.ok(paywall.includes('onBack={access.reviewPreview}'));
  assert.ok(!paywall.includes('router.'), 'the paywall route holds no router');
  const education = codeOnly(read('onboarding', 'notifications.tsx'));
  assert.ok(education.includes('access.completeNotificationEducation()'));
  assert.ok(!education.includes('router.'), 'education holds no router');
});

test('every onboarding step records itself as the resume point on focus', () => {
  for (const [step, file] of [
    ['welcome', 'welcome.tsx'],
    ['states', 'states.tsx'],
    ['allergens', 'allergens.tsx'],
    ['retailers', 'retailers.tsx'],
    ['preview', 'preview.tsx'],
  ] as const) {
    const code = codeOnly(read('onboarding', file));
    assert.ok(
      code.includes(`access.recordShownStep('${step}')`),
      `${file} does not record ${step}`,
    );
    assert.ok(code.includes('useFocusEffect('), `${file} records outside a focus effect`);
  }
});

test('the phase list is closed', () => {
  const phases: AccessPhase[] = ['onboarding', 'paywall', 'education', 'app'];
  assert.deepEqual([...ACCESS_PHASES], phases);
});
