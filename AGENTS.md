# Agent instructions for recall-app

US product recall alerts app (food first). Expo SDK 57, React Native, TypeScript, Expo Router. Currently a minimal shell — no recall data, backend, accounts, or notifications yet.

## Expo has changed

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code. This applies to any implementation that depends on Expo, React Native, or other fast-moving APIs — use official, current documentation, not memory.

## Standing rules

- Inspect repository state (`git status`, branch, structure) before editing. Treat pre-existing changes as intentional; never discard or overwrite unrelated user changes.
- No destructive Git operations (force push, reset --hard, history rewriting, deleting branches).
- Do not commit or push unless the current task explicitly authorizes it. Do not stage files without a compelling reason.
- Never commit secrets, API keys, or `.env` files with real values.
- Keep changes bounded to the requested task. Do not broaden scope to fix unrelated warnings or add speculative features.
- Prefer simple architecture and minimal dependencies. Do not add state management, backend SDKs, or infrastructure libraries before they are actually needed.
- Recall correctness matters: once data ingestion exists, recall information must be accurate and traceable to its official government source. Never fabricate recall data, even as placeholder content.
- Do not claim tests, builds, or behavior passed without running them and showing evidence.
- Run proportionate verification for the change: `npm run typecheck` and `npm run lint` at minimum for code changes.
