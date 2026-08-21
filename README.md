# recall-app

A consumer mobile app for US product recall alerts, starting with food recalls.

**Current status:** minimal application shell only. Recall data ingestion, backend services, accounts, and push notifications have **not** been implemented yet. The app launches to a single placeholder screen.

## Tech stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) / React Native
- TypeScript (strict mode)
- [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing)
- ESLint + Prettier

## Prerequisites

- Node.js (LTS)
- npm
- Xcode with an iOS Simulator (for iOS development on macOS)

## Getting started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm start
```

### iOS Simulator

```bash
npm run ios
```

This starts the dev server and opens the app in the iOS Simulator. You should see a screen titled "Recall Alerts" with a placeholder card. (You can also press `i` in a running `npm start` terminal.)

## Validation

```bash
npm run typecheck   # TypeScript type checking
npm run lint        # ESLint
npm run check       # both of the above
npm run format      # Prettier, rewrites files
```

There is no test suite yet; one will be added when there is domain logic to test.

## Project structure

```
src/
  app/          # Expo Router routes (every file here is a route)
  components/   # reusable UI components
  constants/    # theme tokens (placeholder — final branding undecided)
  hooks/        # reusable hooks
assets/         # icons and splash images
```

See [AGENTS.md](AGENTS.md) for standing rules for coding agents working in this repository.
