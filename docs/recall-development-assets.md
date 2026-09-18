# Development asset serving (icons and the dev server)

_Authoritative home for how local image assets reach a running app in
development versus release, why glyphs can vanish during a development
session, and the reset that restores them._

_Status: development-environment behaviour. No product code implements or
works around any of this — it is the standard React Native asset pipeline,
recorded here because its failure mode looks exactly like an app bug._

## 1. The two asset paths

Every glyph in the app is a local PNG required statically by the icon
primitive (`src/components/ui/icon.tsx`), which draws it through React
Native's `Image` with a tint. How that PNG reaches the screen depends
entirely on how the app was built.

| Build                                      | How a required PNG resolves                                 | Needs the dev server at render time |
| ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------- |
| Expo Go                                    | `http://<LAN-IP>:<port>/assets/?unstable_path=...&hash=...` | **Yes**                             |
| Installed development build (`dev-client`) | `http://<LAN-IP>:<port>/assets/?unstable_path=...&hash=...` | **Yes**                             |
| Release / TestFlight / App Store           | Embedded in the app bundle (`packager_assets://assets/...`) | No                                  |

In development the icon is **not in the app**. It is an HTTP fetch against
the exact host and port that were baked into the JavaScript bundle when it
was loaded. In a release build the same PNG is copied into the binary at
build time and resolved from local storage, with no network involved.

## 2. The failure this produces

When the dev server the bundle points at stops answering — it was killed,
restarted on a different port, or the machine's LAN IP changed because it
moved networks — the running app keeps working, because the JavaScript is
already loaded. Only newly requested assets fail.

That splits the icons on screen into two groups:

- **An icon that is already mounted keeps drawing.** Its bitmap is decoded
  and held by the native image view. Nothing re-requests it.
- **An icon that mounts fresh renders as nothing.** The new native view must
  fetch its URL, the fetch cannot complete, and there is no bitmap to draw.

Text is unaffected, because text is not fetched. So a control renders its
word and not its glyph — `Save` without the bookmark, a location line
without its pin.

### Which icons disappear

The boundary is exactly "did this icon remount?", not which screen it is on.
Switching the Feed between `All` and `Affects me` replaces the list's data,
which remounts the Feed's content and the filter row. Measured over one
`All → Affects me → All` cycle, the glyphs that remount are:

| Glyph             | Where it is         | Remounts per mode cycle |
| ----------------- | ------------------- | ----------------------- |
| `map-pin`         | card location line  | 42                      |
| `bookmark`        | card save control   | 40                      |
| `flag`            | Affects-You label   | 20                      |
| `chevron-down`    | Location/Risk chips | 3                       |
| `bookmark-filled` | saved card          | 2                       |

Over the same cycle the tab-bar glyphs (`home`, `user`, and the Saved tab's
`bookmark`), the `search` glyph and the development gear do not remount at
all. They sit outside the list that the mode switch rebuilds, so they keep
their bitmaps and stay visible while everything inside the Feed goes blank.

That is why the symptom reads as "the Feed lost its icons but the tab bar is
fine", and why returning to `All` does not bring them back: the return is
another remount into the same unreachable URL.

## 3. Restarting is a real fix, not a coincidence

Shutting the simulator down, quitting the client and restarting the dev
server with a cleared cache loads a **new** JavaScript bundle carrying the
**current** host and port. Every icon then fetches successfully. The icons
were never lost or corrupted; only the address they were being fetched from
had gone stale.

## 4. The reset

```bash
npm run dev:reset
```

Stops any dev server this project has running, clears the Metro and Expo
caches, and starts a fresh server. Reload the app afterwards so it picks up
the new bundle.

Reach for it when glyphs are missing from a running development session,
after switching networks or VPNs, or whenever more than one dev server has
been started for this project. It touches caches and the dev server only —
never the working tree, never the database.

## 5. Release builds are not affected

A release build has no dev server to lose. Its assets are embedded, verified
two ways:

- `npx expo export --platform ios` emits every icon as a content-hashed file
  under `dist/assets/`, which is what gets embedded.
- The exported bundle contains no LAN address and no dev-server asset URL;
  assets resolve through the `packager_assets://` scheme from the app bundle.

So TestFlight and App Store builds have never been at risk from this, and a
missing glyph in a development session is not evidence of a shipping defect.

## 6. What holds this in place

The icon primitive's contract is pinned in
`src/components/ui/design-foundation.test.ts` — every declared glyph exists
on disk at every scale, is required statically, and the primitive passes its
source unconditionally, so no state transition can render an icon without
one. Save-control glyph transitions are pinned in
`src/lib/save-control-state.test.ts`, and the Feed's call sites in
`src/components/feed-design.test.ts`.
