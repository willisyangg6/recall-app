# Agent instructions for recall-app

US product recall alerts app (food first). Expo SDK 57, React Native, TypeScript (strict), Expo
Router, Supabase (Postgres + Data API).

The system is live, not a shell: real USDA FSIS and FDA data flow through one canonical pipeline
(raw snapshots → normalized records → recall cases → material-change detection → notification
ledger), on a scheduled job layer with leases and health metrics. Push **delivery** is built but
deliberately not activated.

Read [README.md](README.md) for the current status, project structure, and the full command list.
This file is the standing contract for how to work here; it does not restate product or domain
rules, which live in the documents below.

## Expo has changed

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code that
depends on Expo, React Native, or other fast-moving APIs. Use official current documentation, not
memory.

## Authoritative documentation

One topic, one authoritative home. Read the relevant document before changing that area, and update
it in the same change rather than describing the new behavior somewhere else.

| Topic                                              | Document                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| Domain model, ingestion, lifecycle                 | [docs/recall-domain-architecture.md](docs/recall-domain-architecture.md)   |
| Verified FDA/FSIS source behavior                  | [docs/recall-source-contract.md](docs/recall-source-contract.md)           |
| Scheduling, jobs, secrets, repairs                 | [docs/recall-operations.md](docs/recall-operations.md)                     |
| Scheduler watchdog (permanent fallback)            | [docs/recall-scheduler-watchdog.md](docs/recall-scheduler-watchdog.md)     |
| Feed sync and cache                                | [docs/recall-feed-sync.md](docs/recall-feed-sync.md)                       |
| Feed usability and filtering                       | [docs/recall-feed-usability.md](docs/recall-feed-usability.md)             |
| Product categories                                 | [docs/recall-food-categories.md](docs/recall-food-categories.md)           |
| Personalization and Affects-Me                     | [docs/recall-personalization.md](docs/recall-personalization.md)           |
| Community shopper reports                          | [docs/recall-shopper-reports.md](docs/recall-shopper-reports.md)           |
| Push delivery                                      | [docs/recall-push-delivery.md](docs/recall-push-delivery.md)               |
| Imagery                                            | [docs/recall-imagery.md](docs/recall-imagery.md)                           |
| Data-flow audit                                    | [docs/recall-data-flow-audit.md](docs/recall-data-flow-audit.md)           |
| App Store readiness                                | [docs/recall-app-store-readiness.md](docs/recall-app-store-readiness.md)   |
| Launch blockers and founder inputs                 | [docs/recall-launch-blockers.md](docs/recall-launch-blockers.md)           |
| Privacy policy (draft, unpublished)                | [docs/recall-privacy-policy-draft.md](docs/recall-privacy-policy-draft.md) |
| Milestone prompts, reports, context, model routing | [docs/recall-agent-workflow.md](docs/recall-agent-workflow.md)             |

## Environment and commands

Offline and non-mutating — safe to run at any time:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # domain/pipeline tests against recorded real fixtures
npm run check        # all three — the full project check
```

Formatting **writes to the working tree**. `npm run format` is `prettier --write .`, which rewrites
every unignored file in the repository — including files your task never touched, and including
unrelated uncommitted work. Do not run it to tidy a change. Verify formatting without writing, and
write only to the files the task authorized:

```bash
npx prettier --check <paths>    # non-mutating — use this to verify
npx prettier --write <paths>    # only for files this task is authorized to change
```

Live-database commands read production data. QA reports (`qa:*`) and `ops:health` are read-only.
Ingestion jobs (`jobs:*`), repairs (`repair:*`), backfills (`backfill:*`), and label rendering
(`labels:*`) write unless run in their dry-run form. See [README.md](README.md) and
[docs/recall-operations.md](docs/recall-operations.md) for each command's exact semantics.

## Repository safety

- Inspect branch, HEAD, upstream synchronization, and full working-tree status before starting
  substantial work.
- Treat pre-existing uncommitted changes as intentional. Never discard, revert, stash, or "clean
  up" work you did not create. If unrelated dirty work makes editing unsafe, stop and report it.
- Never rewrite history: no force push, `reset --hard`, rebase of pushed commits, or branch
  deletion.
- These require explicit approval before running, every time — they destroy uncommitted work or
  irreversible artifacts: `git reset --hard`, broad `git checkout --`, broad `git restore`,
  `git clean -fd`, deleting migrations, and deleting or rewriting production data. Prefer targeted,
  reversible recovery over a broad reset.
- Never commit secrets, API keys, or `.env` files with real values, and never print a secret's
  value — name the variable instead.

## Authorization boundaries

These are separate authorities. Being granted one never implies the next, and approval in one task
does not carry into another.

1. **Analysis** — reading code, docs, and read-only reports. Always allowed.
2. **Implementation** — editing files in the working tree. Allowed within the requested scope.
3. **Application** — anything that writes to the live database or an external service: migrations,
   backfills, repairs, non-dry-run jobs, label rendering, workflow dispatch.
4. **Deployment** — publishing functions, builds, releases. `supabase db push` both deploys and
   applies live database changes; it requires explicit authorization on its own.
5. **Staging and commit** — `git add`, `git commit`.
6. **Push** — `git push`.

Levels 3–6 require explicit authorization in the current task. Authority to stage or commit is
**not** authority to push — pushing needs its own explicit approval, and a commit left unpushed is a
normal, safe end state. Also requiring explicit authorization: rotating or revealing secrets, and
activating push notifications (`npm run push:activate`), which stays off until the founder
activates it.

For any migration, repair, or backfill, run the dry-run first, report what it would change, and
apply only after separate explicit approval. Never rerun a completed one-time backfill — the
historical category backfill (C10B), the retailer repair, and the geography repair are done.

## Verification

Verification is proportional to the risk of the change, not ceremonial.

- While developing, run the focused tests for what you touched.
- At completion, run `npm run check` once when code or configuration risk justifies it. Add the
  smallest relevant QA command on top (for example `npm run qa:categories:launch` for category
  work).
- Documentation-only changes do not need the application test suite. Run the checks that actually
  validate the changed files — Prettier for Markdown, plus confirming that links resolve.
- Never claim a test, build, or behavior passed without running it and showing the evidence.
- Screenshots prove visual rendering, not interaction or persistence.
- Live corpus counts are not stable gates unless the count itself is the invariant under test.
- Do not stack redundant verification — no "double-check," "independently re-verify," "prove it
  again," or a second agent to confirm a result you already demonstrated.
- Do not build mutation tests, evaluation harnesses, exhaustive corpus audits, or other new
  verification infrastructure unless the feature's actual risk requires it.

## Scope discipline

Deliver the requested scope completely. Make routine implementation decisions yourself. Do not add
adjacent infrastructure, new abstractions, research programs, migrations, or verification layers
unless they are necessary for the requested behavior. Do not broaden the change to fix unrelated
warnings or add speculative features. Record genuine, evidence-backed future improvements under
Deferred work (see Reporting) and continue with the requested implementation.

Stop and ask only for genuinely material ambiguity, missing authority, a destructive or
irreversible action, production evidence that contradicts a stated premise, or unsafe unrelated
dirty work. Routine engineering and wording decisions are yours.

## Conventions

- Prefer simple architecture and minimal dependencies. Do not add state management, backend SDKs,
  or infrastructure libraries before they are actually needed.
- Respect the client/server boundary: `src/server/` and `scripts/` are Node-only and may use
  secrets; nothing in `src/app/`, `src/components/`, or `src/lib/` may import them or touch
  anything beyond `EXPO_PUBLIC_*`. Import-boundary tests enforce this — keep client read paths as
  leaf modules so heavy server logic is never pulled into the app bundle.
- Recall correctness is the product. Recall information must be accurate and traceable to its
  official government source. Never fabricate recall data, even as placeholder content.
- Bump a cache schema version whenever a cached payload's shape changes, so a stale cache cannot
  masquerade as a current one.
- Markdown is Prettier-formatted; keep documentation links relative and verify they resolve.

## Context recovery

Clear the session after a completed, committed, and pushed milestone when the next task is
unrelated. Compact when the milestone is unfinished and active reasoning or uncommitted work must
survive. Write a continuation packet before compacting — see
[docs/recall-agent-workflow.md](docs/recall-agent-workflow.md).

After compaction: **before making another edit, re-read the active plan, inspect git status and the
current diff, and restate the outcome, frozen decisions, completed work, and remaining work.
Resolve any mismatch before continuing.**

## Reporting

Lead with plain-English outcomes; include technical detail only where it supports a decision. Keep
reports proportional — a small change does not need a ceremonial report. State explicitly whether
any production or data action was taken and whether anything was committed or pushed. The
final-report template is in [docs/recall-agent-workflow.md](docs/recall-agent-workflow.md).

Deferred work is optional. Include it only when the completed work produced concrete evidence for
it — at most five items, each arising from this milestone. It is not a roadmap. Leave out settled
product decisions, intentionally hidden or deferred features, unrelated repository warnings,
speculative improvements, and anything not established during the authorized work. A known idea
does not become deferred work merely because an agent mentioned it.
