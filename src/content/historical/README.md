# Historical test data — not shipped

`baseline-recalls-2026-10-04.json` is the bundled baseline exactly as it was committed before the
2026-10-09 re-recording. It was recovered verbatim from Git (`git show
1cde325:src/content/baseline-recalls.json`; blob `e2f1a1136e25a2a4ca6f351cdf83612a5eb0f87a`) and
must never be edited, reformatted or re-recorded.

It is frozen real recall data for one purpose: the Ready fallback scenarios that need a corpus in
which photo-less rated recalls and Pending recalls fill the deck. The current baseline, which
counts agency-confirmed open recalls, no longer produces those decks.

- Read only through `src/lib/historical-baseline.ts`.
- Imported only by tests and by development-only tooling (`src/components/development/`), which a
  release bundle folds away. `src/lib/historical-baseline.test.ts` enforces this.
- It is never a fallback for the app: offline Ready uses `src/content/baseline-recalls.json`.
