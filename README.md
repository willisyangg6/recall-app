# recall-app

A consumer mobile app for US product recall alerts, starting with food recalls.

**Current status:** the FSIS vertical slice is implemented. The app can ingest
real USDA FSIS recall and Public Health Alert data through the full canonical
pipeline (raw snapshots → normalized records → recall cases → material-change
detection → notification ledger) and render it on a basic dashboard. FDA
ingestion, push notification delivery, accounts, and personalization are not
implemented yet.

Design documents:

- [docs/recall-source-contract.md](docs/recall-source-contract.md) — verified behavior of the official FDA/FSIS data sources
- [docs/recall-domain-architecture.md](docs/recall-domain-architecture.md) — the canonical domain model and ingestion architecture

## Tech stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) / React Native, TypeScript (strict), [Expo Router](https://docs.expo.dev/router/introduction/)
- Supabase (Postgres + Data API) for persistence; schema in [supabase/migrations/](supabase/migrations/)
- Node's built-in test runner (via `tsx`) with recorded real FSIS fixtures
- ESLint + Prettier

## Project structure

```
src/
  app/          # Expo Router routes (dashboard + recall detail)
  components/   # reusable UI components
  constants/    # theme tokens (placeholder — final branding undecided)
  domain/       # canonical model: types, projection, material-change rules
  lib/          # client-safe read path + display formatting
  server/       # server-only: FSIS adapter, ingestion pipeline, stores
scripts/        # explicitly invoked commands (live FSIS ingest)
supabase/       # Supabase CLI config + SQL migrations
docs/           # design documents
```

`src/server/` and `scripts/` run in Node only and may use secrets; nothing in
`src/app/`, `src/components/`, or `src/lib/` may import them or touch anything
beyond `EXPO_PUBLIC_*` configuration.

## Getting started

```bash
npm install
```

### Validation (no backend needed)

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # domain/pipeline tests against recorded real FSIS fixtures
npm run check        # all three
```

The test suite never touches the network: it runs against real FSIS API
records recorded in [src/server/fsis/fixtures/](src/server/fsis/fixtures/).

### Live FSIS ingestion (explicit, never automatic)

```bash
npm run ingest:fsis:dry   # fetch live FSIS data, run the full pipeline in memory,
                          # persist nothing — works with zero configuration
npm run ingest:fsis       # same, but persists to your Supabase project (needs .env)
```

### Backend setup (one-time)

1. Create a free Supabase project at [supabase.com](https://supabase.com).
2. Apply the schema:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
3. Copy `.env.example` to `.env` and fill in the values from your project's
   dashboard (Project Settings → API). `SUPABASE_SECRET_KEY` is server-only:
   it is used by the ingest script and must never appear in app code or in any
   `EXPO_PUBLIC_*` variable.
4. Run `npm run ingest:fsis` to load current FSIS data.

### Run the app

```bash
npm start            # dev server (press i for iOS Simulator)
npm run ios
```

With `.env` configured, the home screen shows current FSIS recalls and Public
Health Alerts (newest activity first); tapping an item opens a detail view with
the official USDA FSIS source link. Without configuration it shows setup
instructions.

## What the FSIS slice supports

- Fetches the official FSIS Recall API (browser-fingerprint headers + retries
  for its Akamai bot filtering; no auth exists).
- Preserves every raw payload as hash-gated, append-only source snapshots.
- Normalizes FSIS quirks (dirty recall numbers, HTML entities, empty-vs-unknown
  fields) into the canonical model; unparseable records are quarantined with
  their raw payload, never silently dropped.
- One consumer case per real-world recall: expansion records (`005-2026-EXP`)
  join their parent case; PHA retractions retract the case they reference.
- Deterministic material-change detection (expansions, classification
  assignment/change — upgrades and downgrades alike, illness reports,
  instruction changes, retractions) with
  an auditable, deduplicated notification-eligibility ledger. Closures update
  the dashboard but never notify. Historical records discovered at first import
  are ledgered but suppressed as backfill.
- Read model exposed to the app via the Supabase Data API with row-level
  security: the mobile client can only read `recall_cases` and
  `affected_products`; all writes are service-role only.

## Intentionally not implemented yet

FDA ingestion (announcements + openFDA reconciliation), push delivery and
notification permissions, accounts, state-based personalization, retailer/label
PDF parsing, Spanish records, CPSC/NHTSA, analytics, final visual design.

See [AGENTS.md](AGENTS.md) for standing rules for coding agents working in this
repository.
