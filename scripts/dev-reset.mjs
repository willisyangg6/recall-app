#!/usr/bin/env node
/**
 * Restart the development server from a clean cache (P2B7F).
 *
 * In development every required PNG — every icon in the app — is fetched over
 * HTTP from the dev server at the exact host and port baked into the loaded
 * JavaScript bundle. When that address goes stale (the server was killed,
 * restarted on another port, or the machine changed networks), any icon that
 * mounts afterwards has nothing to draw, while icons already on screen keep
 * their bitmaps. The result looks like the app lost its glyphs.
 *
 * This script removes the cause rather than the symptom: it stops the dev
 * servers this project has running, clears the caches a stale bundle can hide
 * in, and starts one fresh server. Reload the app afterwards.
 *
 * It touches the dev server and caches only — never the working tree, never
 * the database, and never another project's processes.
 *
 * See docs/recall-development-assets.md.
 */

import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();

/** Run a command for its output; a non-zero exit is an answer, not a crash. */
function tryExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// ── 1. Stop this project's dev servers ────────────────────────────────────
//
// Matched on the project path so a dev server belonging to another checkout,
// and any unrelated node process, is left alone.
const listing = tryExec('ps', ['-eo', 'pid=,command=']);
const stale = listing
  .split('\n')
  .filter((line) => line.includes(root))
  .filter((line) => /expo start|react-native\/cli|metro/.test(line))
  .map((line) => Number(line.trim().split(/\s+/)[0]))
  .filter((pid) => Number.isInteger(pid) && pid !== process.pid);

for (const pid of stale) {
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`stopped dev server pid ${pid}`);
  } catch {
    // Already gone between listing and signalling — nothing to stop.
  }
}
if (stale.length === 0) console.log('no dev server was running for this project');

// ── 2. Clear the caches a stale bundle can survive in ─────────────────────
for (const dir of [
  join(root, '.expo'),
  join(root, 'node_modules', '.cache'),
  join(tmpdir(), 'metro-cache'),
  join(tmpdir(), 'haste-map-metro'),
]) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`cleared ${dir}`);
}

// ── 3. Start one fresh server ─────────────────────────────────────────────
//
// `--clear` resets Metro's transform cache too, so the next bundle is built
// and addressed from scratch. Reload the app once it is up.
console.log('\nstarting a fresh dev server — reload the app once it is ready\n');
spawn('npx', ['expo', 'start', '--clear'], { stdio: 'inherit', shell: false }).on('exit', (code) =>
  process.exit(code ?? 0),
);
