/**
 * FDA announcement ↔ enforcement reconciliation — manual CLI over the
 * canonical run in src/server/fda-enforcement/reconcile.ts (the scheduled
 * enforcement job runs the same function).
 *
 *   npm run reconcile:fda-enforcement                  # DRY RUN (default)
 *   npm run reconcile:fda-enforcement -- --apply       # perform the writes
 *   npm run reconcile:fda-enforcement -- --file <p>    # offline corpus
 *                                                      # (bulk-export JSON)
 *
 * Dry-run reports everything an apply would do — matches, evidence,
 * classifications, notifications and their suppression — and writes nothing.
 */

import {
  downloadEnforcementCorpus,
  loadEnforcementCorpusFromFile,
  reconcileFdaEnforcement,
} from '../src/server/fda-enforcement/reconcile';
import { createSupabaseServerClient, SupabaseStore } from '../src/server/store/supabase-store';

const apply = process.argv.includes('--apply');
const fileArgIndex = process.argv.indexOf('--file');
const corpusFile = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : null;

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment may be configured another way.
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  const client = createSupabaseServerClient(url, secretKey);
  const store = new SupabaseStore(client);

  const corpus = corpusFile
    ? loadEnforcementCorpusFromFile(corpusFile)
    : await downloadEnforcementCorpus();
  await reconcileFdaEnforcement(client, store, { apply, corpus });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
