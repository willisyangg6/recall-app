/**
 * Launch readiness (P2B7X.1): the offline checks a release must pass before
 * a build is prepared. Exits non-zero while any fails.
 *
 * Today it checks the three release destinations the paywall's footer opens
 * — Terms, Privacy, Support — which are typed configuration in
 * src/lib/release-destinations.ts and are null until the founder supplies
 * real HTTPS URLs (docs/recall-launch-blockers.md §1). Nothing here reads
 * the network or the database.
 *
 *   npm run qa:launch-readiness
 */

import { launchReadinessFailures } from '../src/lib/release-destinations';

function main(): void {
  const failures = launchReadinessFailures();
  console.log('Launch readiness (offline)');
  console.log('');
  if (failures.length === 0) {
    console.log('  OK: every release destination is a valid HTTPS URL.');
    return;
  }
  for (const failure of failures) console.log(`  FAIL: ${failure}`);
  console.log('');
  console.log(
    `  ${failures.length} blocker(s). Supply the destinations in src/lib/release-destinations.ts ` +
      'once they exist (docs/recall-launch-blockers.md §1); the paywall shows ' +
      '"This link is not available yet." for each until then.',
  );
  process.exitCode = 1;
}

main();
