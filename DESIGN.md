---
version: alpha
name: Lotly
description: 'Mobile-first design system for Lotly, a consumer food-recall discovery and personalization app. The visual language combines grocery-app warmth with trusted public-information clarity.'

colors:
  background/page: '#FDFCF6'
  background/surface: '#FFFFFF'
  background/subtle: '#C0D6EB'
  background/brand: '#2B4A6C'
  background/accent: '#E2EE57'
  background/media-placeholder: '#EEF1F1'

  text/primary: '#001F3E'
  text/secondary: '#66747A'
  text/inverse: '#FFFFFF'
  text/disabled: '#D1D7D9'

  border/default: '#D1D7D9'
  border/subtle: '#E1E5E6'
  border/strong: '#89969B'

  action/primary: '#2B4A6C'
  action/secondary: '#3560A9'
  action/accent: '#E2EE57'
  action/disabled: '#D1D7D9'

  icon/primary: '#2B4A6C'
  icon/secondary: '#66747A'
  icon/inverse: '#FFFFFF'
  icon/brand: '#3560A9'

  risk/critical/background: '#EF4E47'
  risk/critical/foreground: '#001F3E'
  risk/critical/border: '#C82728'

  risk/very-high/background: '#F28C28'
  risk/very-high/foreground: '#001F3E'
  risk/very-high/border: '#C86700'

  risk/high/background: '#F3B63F'
  risk/high/foreground: '#001F3E'
  risk/high/border: '#C78C00'

  risk/moderate/background: '#E8D348'
  risk/moderate/foreground: '#001F3E'
  risk/moderate/border: '#BBA600'

  risk/low/background: '#F2E76B'
  risk/low/foreground: '#001F3E'
  risk/low/border: '#C8BD3E'

  risk/pending/background: '#C0D6EB'
  risk/pending/foreground: '#001F3E'
  risk/pending/border: '#D1D7D9'

  risk/unknown/background: '#EEF1F1'
  risk/unknown/foreground: '#4B585E'
  risk/unknown/border: '#D1D7D9'

  relevance/affects-you/background: '#E2EE57'
  relevance/affects-you/foreground: '#001F3E'
  relevance/affects-you/border: '#ADB600'

  # Harm notices (P2B7V). illnesses -> risk/high, hospitalizations ->
  # risk/very-high, deaths -> risk/critical: REFERENCES to the risk palette's
  # own entries, never copies of its values, so they define no colour here and
  # the death box moves with Critical. Only the denial has a value of its own.
  harm-notice/none/background: '#C0D6EB'
  harm-notice/none/foreground: '#001F3E'
  harm-notice/none/border: '#C0D6EB'

typography:
  display:
    fontFamily: Public Sans
    fontSize: 33px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0em

  heading-1:
    fontFamily: Public Sans
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0em

  heading-2:
    fontFamily: Public Sans
    fontSize: 23px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0em

  heading-3:
    fontFamily: Public Sans
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0em

  body:
    fontFamily: Public Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em

  body-small:
    fontFamily: Public Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0em

  body-small-bold:
    fontFamily: Public Sans
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0em

  caption:
    fontFamily: Public Sans
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0em

  micro-caption:
    fontFamily: Public Sans
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0em

  label:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0.02em

  label-strong:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0.02em

radius:
  radius/4: 4px
  radius/8: 8px
  radius/12: 12px
  radius/16: 16px
  radius/full: 999px

spacing:
  spacing/4: 4px
  spacing/8: 8px
  spacing/12: 12px
  spacing/16: 16px
  spacing/24: 24px
  spacing/32: 32px
  spacing/48: 48px

elevation:
  elevation/none: none
  elevation/card: '0 2px 8px rgba(0, 0, 0, 0.06)'

icon-size:
  icon-size/12: 12px
  icon-size/16: 16px
  icon-size/20: 20px
  icon-size/24: 24px

hit-target:
  minimum: 44pt

layout:
  reference-width: 393px
  page-margin: 16px
  content-width: 361px
  bottom-nav-height: 72px
  search-bar-height: 44px
  risk-label-height: 24px
  card-media-size: 112px
  max-content-width: 800px
  detail-media-size: 152px
  row-media-size: 40px
  page-dot-size: 8px
  table-column-width: 144px

components:
  search-bar:
    backgroundColor: '{colors.background/surface}'
    textColor: '{colors.text/secondary}'
    typography: '{typography.caption}'
    radius: '{radius.radius/12}'
    padding: '{spacing.spacing/12}'
    height: 44px

  nav-chip-selected:
    backgroundColor: '{colors.background/brand}'
    textColor: '{colors.text/inverse}'
    typography: '{typography.caption}'
    radius: '{radius.radius/full}'
    height: 32px

  recall-card:
    backgroundColor: '{colors.background/surface}'
    textColor: '{colors.text/primary}'
    border: '{colors.border/subtle}'
    elevation: '{elevation.elevation/card}'
    radius: '{radius.radius/16}'
    padding: '{spacing.spacing/12}'

  risk-label:
    typography: '{typography.label}'
    radius: '{radius.radius/4}'
    paddingHorizontal: '{spacing.spacing/8}'
    paddingVertical: '{spacing.spacing/4}'
    borderWidth: 1px
    height: 24px

  relevance-affects-you:
    backgroundColor: '{colors.relevance/affects-you/background}'
    textColor: '{colors.relevance/affects-you/foreground}'
    border: '{colors.relevance/affects-you/border}'
    typography: '{typography.label}'
    radius: '{radius.radius/4}'
    height: 24px

  information-warning:
    backgroundColor: '{colors.relevance/affects-you/background}'
    textColor: '{colors.text/primary}'
    typography: '{typography.body-small}'
    radius: '{radius.radius/8}'
    padding: '{spacing.spacing/12}'

  information:
    backgroundColor: '{colors.background/subtle}'
    textColor: '{colors.text/primary}'
    typography: '{typography.body-small}'
    radius: '{radius.radius/8}'
    padding: '{spacing.spacing/12}'

  affected-products-viewport:
    backgroundColor: '{colors.background/surface}'
    textColor: '{colors.text/primary}'
    border: '{colors.border/subtle}'
    radius: '{radius.radius/8}'
    padding: '{spacing.spacing/12}'

  bottom-nav:
    backgroundColor: '{colors.background/surface}'
    iconColor: '{colors.icon/primary}'
    iconSize: '{icon-size.icon-size/24}'
    height: 72px
---

# Lotly Design System

_Authoritative home for the Lotly design contract: reusable tokens, their
semantic meaning, the Figma ↔ code mapping, the product contracts the visual
system must carry, and the implementation guardrails. The tokens in the front
matter above are the same values as `src/constants/design-tokens.ts`;
`src/constants/design-tokens.test.ts` proves the two agree, and
`src/constants/design-contract.test.ts` pins the product rules below._

_Status (P2B6B, 2026-09-15): reconciled against Figma and the shipped product.
The token foundation and fourteen shared primitives exist in code — `Text`,
`Surface`, `DisclosureControl` and `RiskLabel` from P2B0; `Icon`,
`RelevanceLabel`, `Chip` and `SearchBar` from P2B1; `MediaTile`, `Callout`
and `NoticeLabel` from P2B2; `Button` and `ChoiceRow` from P2B3; `CheckRow`
from P2B6A — plus the shared `StateMessage`, which from P2B4 may carry a
decorative glyph above its title; Public Sans and IBM Plex Mono are installed and loaded at the root;
the app is locked to light appearance; the risk label reads its bare
canonical word on every surface. **The Feed (P2B1), Recall Detail (P2B2),
the shopper-report questionnaire (P2B3), Saved (P2B4), the Profile hub
(P2B5), its Personalization and Notifications screens (P2B6A) and the seven
trust documents (P2B6B) are the restyled product screens**: the Feed's page, search bar, chip
row, section headings, recall card, whole-screen states and the bottom
navigation; Detail's product header, callouts, sections, community block and
Affected Products table; the questionnaire's steps, review, disclosure,
endings and paused state; Saved's page, list rhythm, whole-screen states and
notices; and Profile's featured Personalization card, boxed Notifications
row, grouped document sections, version row and development entry; and
Personalization's multi-choice states, allergens and stores
and autosave line, and Notifications' status callout and one action; and the trust documents'
reading page, section hierarchy, notes, label rows, links and the one reset
control — render from the tokens with every shipped behaviour intact. The pushed screens'
header chrome is styled from the same tokens and their back control is the
platform chevron alone. Every product screen now renders from the
tokens. P2B6C (2026-09-16) applied the consumer-copy rules below to every
authored string; behaviour is unchanged._

## Overview

Lotly is a mobile-first food-recall product that should feel like a
**grocery-shopping app crossed with a trusted news/public-information app**.
It is consumer-friendly, calm, modern, and highly legible. The interface should
make serious information understandable without looking bureaucratic,
medicalized, or alarmist.

The design direction is **editorial utility with consumer-product warmth**:

- Warm cream page backgrounds soften the experience.
- Deep navy provides authority, trust, and high-contrast structure.
- White cards separate product information cleanly.
- Soft blue supports neutral informational content.
- Bright lime is a distinctive Lotly personalization signal.
- Risk colors remain vivid enough to scan quickly, but the surrounding UI stays
  calm.

Lotly should feel credible enough for safety information and approachable
enough to check routinely while shopping.

### Source of truth

Use this priority when implementing or extending the product. Earlier entries
win:

1. **Production code owns behavior, data, navigation, and business rules.**
   What a screen shows, in what order, under which conditions, with which
   words, is decided by the shipped presentation contracts (`src/lib/`) and
   the domain (`src/domain/`). The risk-tier mapping, the disclosure rules,
   the community-report states, and the questionnaire are product behavior,
   not visual choices.
2. **Final founder decisions override outdated Figma content.** The
   decisions recorded in this document ("Product contracts the design must
   carry", "Known Figma/code conflicts") are those decisions.
3. **Figma owns approved visual composition** — layout, hierarchy, proportion,
   and the look of each component.
4. **This `DESIGN.md` owns reusable tokens, semantic meaning, and
   implementation guardrails.**

When Figma and code disagree, do not silently invent a compromise, and never
discard working product behavior because it is absent from Figma. Preserve the
behavior, follow the Figma visual intent where it can be followed, and record
the conflict here.

Primary Figma references (file `WN8RP0xZGYdj4CSztvQ7Km`):

- Final page: node `81:792`
- Feed (named `home` in Figma — see "Naming"): node `81:793`
- Recall Detail (named `product information` in Figma): node `81:819`
- Components: node `36:524`

### Branding status

The product name is **Lotly**. The approved mascot is
`assets/brand/production/lotly-mascot-transparent.png` (1024×1024,
transparent, sRGB). It is drawn whole with `contain`, never cropped,
recoloured or placed on a dark surface, and today appears on Welcome only.
The final logo and wordmark are not yet locked: the name is set in the type
system, and no logo, traced wordmark, shield, siren, warning triangle,
grocery cart, or food icon is invented in implementation work unless a later
approved brand asset explicitly provides one.

The brand should not resemble a government emergency-alert product.
Seriousness comes from hierarchy, typography, information quality, and
navy—not from constant alarm imagery.

### Naming

- **The consumer screen is `Feed`, never `Home`.** The bottom navigation reads
  `Feed` · `Saved` · `Profile`. Figma's frame is still named `home`, and older
  code comments say "Home"; both are drift, not decisions. No consumer-facing
  string may say "Home".
- **Semantic tokens carry their Figma variable names**, slash-separated:
  `background/page`, `text/primary`, `risk/critical/background`,
  `spacing/16`, `radius/8`. Code keys them by exactly these strings
  (`color['background/page']`, `spacing[16]`, `radius[8]`), so the Figma ↔
  code mapping is the identity and needs no lookup table.
- **Typography tokens use the kebab-case names in the front matter**
  (`heading-3`, `body-small`, `label`), because Figma text styles are not
  variables and carry display names instead. The mapping is in "Typography".
- React Native property mappings are recorded separately, in "Implementation
  guardrails → React Native mapping", never inside the token names.

## Colors

The core palette uses warm cream, white, deep navy, muted blue, soft
informational blue, vivid risk hues, and one distinctive lime personalization
accent.

### Core surfaces and text

- **Page (`background/page`, `#FDFCF6`)** is the default app background. It is
  intentionally warmer than pure white.
- **Surface (`background/surface`, `#FFFFFF`)** is used for cards, search,
  navigation surfaces, and table surfaces.
- **Primary text (`text/primary`, `#001F3E`)** is the main reading color for
  headlines, product names, labels, and important facts.
- **Secondary text (`text/secondary`, `#66747A`)** is used for descriptions,
  manufacturer names, timestamps, and supporting metadata. Do not lighten this
  value for normal-size text.
- **Brand navy (`background/brand` / `action/primary` / `icon/primary`,
  `#2B4A6C`)** is used for primary actions, selected navigation, and primary
  icons.
- **Action blue (`action/secondary` / `icon/brand`, `#3560A9`)** is used for
  links, in-place disclosure controls, and secondary actions.
- **Soft blue (`background/subtle`, `#C0D6EB`)** is used for informational
  callouts.
- **Lime (`background/accent` / `action/accent`, `#E2EE57`)** is reserved for
  personalization/relevance and rare branded emphasis.

Use semantic colors rather than reaching directly for palette primitives.
Components should conceptually resolve as:

`component → semantic role → color value`

Do not hardcode primitive or raw colors inside reusable UI when a semantic
token exists. Figma primitives such as `tomato/500` and `tomato/300` are not
tokens and must not be bound to anything a component renders.

### Risk colors

Risk and relevance are different systems.

Risk labels use this ordered severity system. All seven are the complete set;
there is no eighth label and no second spelling of any of them:

| Label     | Token prefix     | Background | Foreground | Border    |
| --------- | ---------------- | ---------- | ---------- | --------- |
| Critical  | `risk/critical`  | `#EF4E47`  | `#001F3E`  | `#C82728` |
| Very High | `risk/very-high` | `#F28C28`  | `#001F3E`  | `#C86700` |
| High      | `risk/high`      | `#F3B63F`  | `#001F3E`  | `#C78C00` |
| Moderate  | `risk/moderate`  | `#E8D348`  | `#001F3E`  | `#BBA600` |
| Low       | `risk/low`       | `#F2E76B`  | `#001F3E`  | `#C8BD3E` |
| Pending   | `risk/pending`   | `#C0D6EB`  | `#001F3E`  | `#D1D7D9` |
| Unknown   | `risk/unknown`   | `#EEF1F1`  | `#4B585E`  | `#D1D7D9` |

`Pending` and `Unknown` deliberately leave the red-to-yellow severity
spectrum. They communicate classification state, not danger.

The risk scale does **not** use green. Never make a low-severity recall green
or describe green as "safe."

**Critical is one treatment everywhere.** The canonical Critical label is
`risk/critical` — `#EF4E47` background, `#001F3E` foreground, `#C82728`
border, visible label `CRITICAL` — on the feed card, on Recall Detail, and in
any gallery. The older darker-red/white `label/Critical` treatment on the
Recall Detail frame (bound to `tomato/500` with white text) is obsolete: it is
not reproduced in code, and it is retired in Figma (see "Figma corrections for
Cheyenne").

**The mapping into these labels is business logic, not design.** Which recall
gets which label is decided by `src/domain/risk-tier.ts` from the official
FDA/FSIS classification set, and worded by `src/lib/risk-display.ts`. The
design system looks a treatment up **by** the tier; it never infers, adjusts,
or re-ranks one.

### Personal relevance

`Affects You` is **not a severity level**. It answers a different question:
whether the recall is personally relevant to the user's saved location,
retailers, allergens, or other personalization inputs.

Use `relevance/affects-you`:

- Background: `#E2EE57`
- Foreground/icon: `#001F3E`
- Border: `#ADB600`

Lime must mean **"this matters to you"**, not "safe," "resolved," or "low
risk." In code the relevance palette is a separate object that cannot be
indexed by a risk tier, and the Risk Label component cannot render it.

### Dark mode

Dark mode is **intentionally deferred**, not accidentally unsupported. The
tokens define one light palette and no dark variant, and none may be added
without approved tokens and designs.

Until then the app is locked to light appearance (founder decision,
2026-09-14): `userInterfaceStyle` is `light` in `app.json`, which is the
supported Expo configuration, and the root navigation theme is pinned to light
so no screen can follow the system into dark. There is no toggle and no fake
dark token. The legacy provisional theme (`theme.ts`) still carries dark values from
before the system existed; no product screen reads them since P2B6B — only the
dev-only Design Preview hub does, now that P2B7C deleted the unmounted photo
gallery that was its other reader — and they go when that last user migrates.

## Typography

Lotly uses two type families with distinct jobs.

### Public Sans

**Public Sans** is the primary interface family. It provides the clarity and
institutional credibility needed for public-information content without
making the app feel governmental or clinical.

Use it for:

- page and section headings
- product names
- manufacturer names
- explanatory body copy
- location and retailer information
- search
- navigation
- links and actions

### IBM Plex Mono

**IBM Plex Mono** is reserved for structured, verified, scan-oriented
metadata. It should feel factual rather than decorative.

Use it for:

- risk labels and the relevance label
- lot codes and identifiers when shown as compact metadata
- other terse structured facts where monospacing improves recognition

Risk labels are uppercase — as are the relevance and notice labels, and
nothing else the product authors. See "Capitalization" under "Section
headings and group labels" for the complete rule.

Do not use IBM Plex Mono for paragraph copy, buttons, navigation labels,
product titles, or long instructions.

### The type scale

The canonical hierarchy, with the Figma text style each token _is_ and the
whole-point line height React Native renders (the ratio resolved and rounded,
which is also what Figma draws — a 19px Heading 3 measures 26 high on the
canvas):

| Token             | Figma style       | Family        | Size | Weight | Ratio | Line height | Tracking        |
| ----------------- | ----------------- | ------------- | ---- | ------ | ----- | ----------- | --------------- |
| `display`         | —                 | Public Sans   | 33   | 700    | 1.2   | 40          | 0               |
| `heading-1`       | —                 | Public Sans   | 28   | 700    | 1.2   | 34          | 0               |
| `heading-2`       | `Heading 2`       | Public Sans   | 23   | 700    | 1.3   | 30          | 0               |
| `heading-3`       | `Heading 3`       | Public Sans   | 19   | 600    | 1.35  | 26          | 0               |
| `body`            | —                 | Public Sans   | 16   | 400    | 1.5   | 24          | 0               |
| `body-small`      | `Body Small`      | Public Sans   | 13   | 400    | 1.4   | 18          | 0               |
| `body-small-bold` | `Body Small Bold` | Public Sans   | 13   | 600    | 1.4   | 18          | 0               |
| `caption`         | `Caption`         | Public Sans   | 12   | 500    | 1.35  | 16          | 0               |
| `micro-caption`   | `Micro-caption`   | Public Sans   | 10   | 500    | 1.35  | 14          | 0               |
| `label`           | `Label`           | IBM Plex Mono | 12   | 500    | 1.35  | 16          | 0.02em = 0.24pt |
| `label-strong`    | —                 | IBM Plex Mono | 12   | 600    | 1.35  | 16          | 0.02em = 0.24pt |

No other size, weight, or leading is approved. Figma's `Label` style records
its tracking as `2` (percent); that is the same `0.02em`.

### Fonts

Both families are installed as direct dependencies —
`@expo-google-fonts/public-sans`, `@expo-google-fonts/ibm-plex-mono`, and
`expo-font`, at the versions Expo selected for SDK 57 — and
`CUSTOM_FONTS_INSTALLED` in `src/constants/design-tokens.ts` is `true`. The
installing command, for the record:

```bash
npx expo install expo-font @expo-google-fonts/public-sans @expo-google-fonts/ibm-plex-mono
```

`design-tokens.test.ts` pins that flag to `package.json`, so the two cannot
disagree in either direction.

The root layout (`src/app/_layout.tsx`) loads exactly six faces, once, before
the first screen renders, and holds the native splash until they have settled:

- `PublicSans_400Regular`
- `PublicSans_500Medium`
- `PublicSans_600SemiBold`
- `PublicSans_700Bold`
- `IBMPlexMono_500Medium`
- `IBMPlexMono_600SemiBold`

`fontFace` in the tokens maps each family-and-weight the contract uses to the
name the package registers, and a typography token can only name one of those
six — an unapproved weight is a compile error, not a synthesized face.
`textStyle` therefore emits `fontFamily` and never `fontWeight`: React Native
selects a custom face by its full name, and a weight on a single-weight face
makes iOS synthesize one.

If loading fails, the app is not left blank: the splash still hides, the
failure is named in development, and React Native's own fallback face stands
in for any name it cannot resolve. That is a degraded state to fix, never a
design.

## Layout

Lotly is designed mobile-first around a **393px-wide iPhone frame**.

### Base geometry

- Reference viewport: 393px wide
- Standard horizontal page margin: 16px
- Standard content width: 361px at the reference width
- Bottom navigation: 72px tall
- Search field: 44px tall
- Recall cards: full content width
- Risk and relevance labels: 24px tall
- Recall-card media tile: 112px square (`card-media-size`; Figma's 115 is
  normalized to the 4pt grid), rendered only when the recall has a usable
  image — a no-image card has no media column (P2B7I)
- Content column cap: 800px (`max-content-width`) — reached on tablets and
  the web only, so a phone's column is always the device width less the
  margins
- Recall Detail product media: 152px square (`detail-media-size`; Figma's 150
  is normalized to the 4pt grid), rendered only when the recall has official
  photography that loads — one photo as a static tile, several as a manually
  paged, virtualized set in the same footprint (P2B7C)
- Position dot under a paged image set: 8px (`page-dot-size`), decorative and
  never interactive; one per image up to five, and beyond that a sliding
  window of five dots over all the pages, with a compact `current / total`
  counter beside it (P2B7I). The dot count never bounds the page count
- Affected Products version image: 40px square (`row-media-size`), rendered
  only for a row the allocator matched an image to
- Affected Products column: 144px (`table-column-width`), one width for every
  column so the header row and each version row stay aligned
- Common icon glyph size: 20px for utility icons, 24px in the bottom
  navigation, 16px inline with text, 12px inside labels

The 393px frame is a **reference, not a constraint**. Screens size to the real
device width: the page margin is what carries over, content width is what is
left, and a card is as wide as the content column. Nothing is fixed to 361px
or 393px in code.

### Safe areas

Honor native safe areas in implementation rather than hardcoding a status-bar
or home-indicator inset. Figma's frames use `48px` (Feed) and `40px` (Detail)
of top padding to stand in for the status bar; in code that is the safe-area
inset plus a spacing token. Scrollable content adds the bottom inset to its
own bottom padding; the bottom navigation sits above the home indicator.

### Spacing

Use the established spacing scale only:

`4 / 8 / 12 / 16 / 24 / 32 / 48`

Prefer 8–16px for internal component rhythm and 16–24px for separation between
major content groups. Use 4px only for tightly related micro-elements such as
an icon-to-label gap.

Do not introduce arbitrary values when a scale value works. Figma values off
the scale are accidental (see "Normalized Figma values") and are snapped to
the nearest step, never copied.

### Feed

The Feed is a vertically scrolling recall feed. Its hierarchy is:

1. top utility/header area
2. search — search lives **inside** the Feed and is never a destination
3. feed-mode and filter controls (All / Affects me, Location, Category, Risk)
4. section heading
5. recall cards
6. persistent bottom navigation

The category/filter row may overflow horizontally when needed, but it must not
cause the page itself to overflow.

Feed chips are browse/navigation controls, not a pile of independent
multi-select toggles. Keep unrelated filter dimensions visually distinct. In
the shipped product `All` and `Affects me` are mutually exclusive **feed
modes** and the Location / Risk / Category chips are filters that apply to the
`All` feed only; the visual row may present them together, the behavior stays.

The Feed's section headings are decided by the presentation contract
(`Recent activity`, `Older active notices`, `Affects me`), not by the
composition.

**As implemented (P2B1, `src/app/(tabs)/index.tsx`).** The header area is the
navigator's own `Feed` title bar on the page colour with no shadow (Figma's
frame has no title and a notification bell; the bell has no product behaviour
and is not rendered — conflict 11). Then the search bar, then one horizontally
scrolling chip row: the `All` / `Affects me` pair first, a hairline, and —
while `All` is active — `Location`, `Risk`, `Category` (each with a chevron,
because each opens its picker sheet) and `Clear all` once a filter is applied.
Figma's `Urgency` chip is the shipped `Risk` filter under its shipped name;
Figma's leading sliders glyph has no behaviour and is not rendered. In
`Affects me` the row holds the pair alone and the `Based on your
personalization · Edit` line follows. Section headings render in `heading-3`
with the contract's words; the older section keeps its count, its
explanation, and its in-place reveal. Cards sit 16px apart at the content
width. Every whole-screen state (not configured, loading, load failure, no
results, nothing personal, nothing loaded) is a `heading-3` title over a
`body-small` explanation, centred; loading is announced to assistive
technology. The stale-feed notice is the soft-blue Information callout, a
polite live region so a failed refresh is announced (P2B6C).

### Saved

Saved is one personal list and nothing more: the recalls this device
bookmarked, newest save first. It has no search, no sorting controls, no
folders, no categories, no notes, no filters, no bulk editing and no
recommendations — recalls are found in the Feed, and Saved is where they are
kept. It is device-local: no account, no cloud sync, and nothing about a save
reaches the server.

A save stores a case id, never a copy of the recall, so a saved card always
renders today's official facts from the same corpus the Feed holds. A saved
recall the active feed no longer carries is reported plainly, and its id
stays on the device.

**As implemented (P2B4, `src/app/(tabs)/saved.tsx`).** The navigator's own
`Saved` title bar on the warm page with no shadow, styled from the same
`screenHeader` as the Feed's, and no second in-page heading. Below it the
list: the shared `RecallCard` at the content width, 16px apart, inside 16pt
page margins — the Feed's rhythm exactly, with the same pull-to-refresh over
the one shared feed session. Every whole-screen state (saving unavailable,
backend not configured, loading, empty, load failure) is the shared
`StateMessage`; the empty state adds the `bookmark` glyph the tab and the
save control already use, above `No saved recalls` / `Save a recall to find
it here later.` The stale-feed notice and the missing-from-feed notice are
both the soft-blue Information callout, the stale notice as a polite live
region (P2B6C). The empty state is decided only after
storage AND the corpus have answered, so it can never flash at a user who has
saves; a failed feed read says the recalls could not load and never that a
save was removed.

### Profile

Profile is a navigation page, not a settings form, and it never implies an
account: no name, picture, email, subscription, statistic, sync or sign-in.
Its hierarchy is fixed (founder decision, 2026-09-15 — a hybrid of the P2B5
Phase 1 explorations: Direction B's personalization-first lead over
Direction A's grouped boxes, with no permanent trust callout):

1. **Personalization** — the featured card
2. **Notifications** — one boxed row
3. **Privacy & Data** — Privacy & Data Controls, with its supporting line
4. **About & Safety** — Sources & Methodology, How Affects Me Works, Risk
   Levels Explained, Safety Disclaimer, Corrections Policy, by title alone,
   with the official-source sentence as the group's caption
5. **Legal** — Attributions
6. **App** — the version line, a non-interactive label/value row
7. **Development** — Design Preview, development builds only

Every destination the hub had before P2B5 is still reached exactly once;
the hub carries no toggle and no destructive action (the installation reset
stays at the bottom of Privacy & Data Controls alone, C7.1). The unfinished
Privacy Policy and Terms are not rows.

**As implemented (P2B5, `src/app/(tabs)/profile.tsx`,
`src/components/profile/`).** The navigator's own `Profile` title bar from
the shared `screenHeader` — no second heading on the page — over the warm
page, 16pt margins, the content column capped at `max-content-width`, the
bottom safe-area inset added to the content padding, `spacing/24` between
groups. The featured **Personalization card** (`PersonalizationCard`) is a
white `radius/16` surface with `border/subtle` and the one canonical
`card` lift: the `flag` glyph at 20, `Personalization` in
`body-small-bold`, `Edit` in `caption` `action/secondary` at the trailing
edge, then three `body-small` lines — `State`, `Allergens`, `Stores` — label
at the leading edge in `text/secondary`, value at the trailing edge, wrapping
beneath its label when a value or the type size asks. The whole card is one
link to `/settings/personalization`; `Edit` is a word on it, not a nested
control. No height is fixed.

The card shows **this device's real preferences, read and never written**:
Profile reads the one existing store on every focus (the Feed's own
pattern), so an edit made on Personalization is on the card when the user
returns, and it holds no second copy. Compact-display rules
(`src/lib/profile-hub.ts`): `State` is the chosen state's name or
`Not chosen`; `Allergens` and `Stores` read `None selected` for zero, one
or two names in full (allergens in the canonical catalog order, stores in
the order chosen, under canonical names), and beyond two the first two
followed by `+N` — while the card's spoken label always carries every
name. A read that has not resolved shows `Loading…` on each line (with the
busy state set); a read that failed, or a platform without preferences,
shows `Unavailable`. Neither is ever rendered as an empty choice, and a
re-read in flight keeps the last real answer rather than flashing back to
loading.

Beneath the card, **Notifications** is one boxed `NavigationRow` with its
supporting line. Each remaining group is a `ProfileSection`: a `caption`
heading in capitals over a white `radius/16` surface with `border/subtle`,
rows parted by hairlines in `border/subtle`, and an optional `caption`
footnote beneath (About & Safety carries the sources sentence). A
`NavigationRow` is `body` label, optional `body-small` supporting line,
and the `chevron-right` glyph at 20 in `icon/secondary` at the trailing
edge, at least 44pt tall with `spacing/16` × `spacing/12` padding; it is
one link that speaks its label and a hint naming what it opens, and the
chevron is decorative. A `ValueRow` is the same geometry with a value in
place of the chevron and no interaction — one spoken element. The
**development entry** (`DevelopmentEntry`) is set apart from the consumer
groups: a `DEVELOPMENT BUILDS ONLY` heading over a `radius/8` surface in
the page colour with `border/strong`, its row's hint saying the same; it
renders nothing outside a development build and the live Profile wraps it
in the bare `__DEV__` identifier besides.

### Personalization and Notifications

Profile's two interactive children (P2B6A, selectors reworked in its
follow-up). Both keep every behaviour, storage rule, permission boundary and
route they had — the one preference store and its autosave, the read-only
status check on focus, the explicit enable as the only path to the system
prompt, the system-settings pointer, the web message — and changed in
appearance and copy. The navigator's own `Personalization` / `Notifications`
title from the root stack's tokenized header is the only page heading; each
page is the warm page, 16pt margins, the content column capped at
`max-content-width`, the bottom safe-area inset added to the content padding.

**Personalization** (`src/app/settings/personalization.tsx`;
`src/components/settings/personalization-form.tsx`). One `body-small`
secondary intro line, then three groups `spacing/24` apart, each a
`SettingsSection`: a content section heading (title case, `heading-3`, navy
— see "Section headings and group labels"), a `body-small` helper line, and
the controls.

- **States you shop in** (multi-select since P2B7U) is one compact trigger
  row on the main screen (`SelectorTrigger`: a white `radius/12` surface with
  `border/default`, the `map-pin` glyph at 20, the chosen jurisdictions in
  `body` or `No states selected` in `text/secondary`, and `Add states` /
  `Edit states` in `caption` `action/secondary`; a 44pt button spoken as
  `States: California, Montana and New York` / `States: none selected`). The
  row shows the **first two full names in canonical order, then `+N`** —
  `District of Columbia, Montana +1` — because 52 can be chosen and a row
  that printed them all would push the screen off itself; the spoken name
  still carries every one. Above a text scale of 1.5 the row becomes a
  column, the value on its line and the action beneath it, rather than
  squeezing the value into a few characters' width.

  It opens the **states selector**, a page sheet titled `Choose your states`:
  a count line in words under the title (`No states selected`, `1 state
selected`, `N states selected`; a polite live region), the shared Search Bar
  pinned beneath (focused as it appears, the questionnaire's `Search states`
  words), `Clear selection` as a secondary Button while anything is checked,
  and the 52 jurisdictions as `CheckRow`s **in canonical order — by full
  name, so District of Columbia sits between Delaware and Florida** —
  filtered by the query, with `No state matches that search.` when nothing
  matches. No radio row or `radiogroup` survives on this screen.

  **This sheet edits a draft, and it is the only one that does.** Opening it
  copies the saved selection; a tap changes the copy and nothing else, and
  the sheet stays open however many are tapped. `Clear selection` empties the
  draft and keeps the sheet open. **`Done` — the trailing action — writes the
  whole draft once and closes, however many times it is pressed. Any other
  exit (the swipe down, Android's back) discards the draft** and leaves the
  saved jurisdictions exactly as they were. The bar's `Clear` empties the
  search; `Clear selection` empties the draft; they are separate controls.
  Every visit starts from a blank search and a fresh draft.

  Why the top-right action and not a bottom one: the list is long and
  searchable, and `Done` has to stay reachable while the list scrolls and
  while the keyboard is open. It also stays clear of the home indicator,
  reuses the sheet's existing structure, and takes no list space.

- **Allergens to watch** is the nine allergens as `CheckRow`s in catalog
  order on the main screen, under the household-aware helper (C5.2B,
  reworded by the founder in the follow-up).
- **Stores you shop at** is the same trigger-and-sheet shape as the states,
  because the catalog is long — but it **autosaves on every check** rather
  than editing a draft. The two differ on purpose: a store list is composed
  one chain at a time and each check is independently meaningful, while a
  jurisdiction list is picked from 52 rows in one sitting, usually replacing
  the previous answer, and each intermediate state of that edit is a
  different set of recalls in Affects me. The main screen's trigger row shows
  **every chosen store by name**, wrapping naturally, in the order chosen (or
  `No stores selected` in `text/secondary`), with one action word: `Add stores`
  when none is chosen, `Edit stores` otherwise. The full catalog never
  renders on the main screen, and nothing scrolls sideways. The **store
  selector** is a page sheet titled `Choose stores`: a count line in words
  under the title (`No stores selected`, `1 store selected`, `N stores
selected`; a polite live region), the shared Search Bar with its `Clear`
  (`Search stores`), and the whole catalog as `CheckRow`s **in the
  catalog's canonical alphabetical order**. Checking a row changes its state
  and nothing about its place; the search narrows the same stable list with
  the catalog's own matching (names and aliases); clearing the search
  restores the list with every selection intact; `Done` closes. Every check
  autosaves through the route's existing `savePreferences` path the moment
  it is made, so `Done`, a swipe down and Android's back all simply close —
  none is a save step and none can lose a choice.
- The autosave line beneath the form (`Saving…` / `Saved.` / `Saved on this
device. It will sync when you are back online.`) is `body-small` secondary
  and a polite live region.

**The selector sheet** (`src/components/settings/selector-sheet.tsx`) is
React Native's own `Modal` as a native page sheet (`presentationStyle:
pageSheet`, swipe-to-dismiss routed through `onRequestClose`) on the warm
page: the title in `heading-3` as a header, the `Done` word in
`body-small-bold` `action/secondary` at the trailing edge on a 44pt target,
the optional count line, the pinned controls, and the scrolling list, which
keeps taps working while the keyboard is up, dismisses the keyboard on a
drag, and grows its inset beneath it. When a sheet closes, focus returns to
the trigger row that opened it.

The sheet keeps its two ways out apart. The swipe down and Android's back
always mean dismissal; the trailing action means dismissal too **unless** the
caller gives it something to do (`onAction`), and then that is the only thing
it calls. The stores sheet gives it nothing, so its `Done` just closes and
its hint says the choices are already saved; the states sheet gives it the
commit, so its `Done` saves and its hint says so, and says that leaving
without it keeps the saved states. At the accessibility text sizes the title
wraps onto as many lines as it needs while the action refuses to shrink, so
the one word that saves is never squeezed or cut. A page sheet rather than the Feed's bottom
sheet because these lists are long (52 and the whole catalog) and need the
full height, the pinned search and the system's own dismissal; no
dependency was added.

A read that has not answered, a read that failed, and the web each render
the shared `StateMessage` (`Loading your preferences…`, `Your preferences
could not be read`, `Available in the app`) in place of the form — never an
empty form, and a re-read in flight keeps the last real answer.

**The Check Row** (`src/components/ui/check-row.tsx`) is the Choice Row's
sibling for any-of-these lists: the same white `radius/12` surface with
`border/default`, a 20pt square `radius/4` indicator with a 2px
`border/strong` border that fills `action/primary` and draws a check mark
(the corner of a small rectangle in `icon/inverse`, turned — views, not a
glyph, like the Choice Row's dot) when checked, the row border turning
`action/primary` with it; the `checkbox` role and `accessibilityState.checked`.
The round-versus-square indicator is what tells single- from multi-select
before a word is read, and the mark is the non-colour channel.

**Notifications** (`src/app/settings/notifications.tsx`;
`src/components/settings/notifications-panel.tsx`). The `body-small` intro,
then the panel: the status as the soft-blue information `Callout` with one
truthful sentence per permission state (the approved copy below), and
beneath it the one action that state allows, as the shared `Button`:
primary `Enable recall alerts` (busy `Working…`, hint `May ask for
notification permission.`), secondary `Turn off alerts` (busy `Working…`),
or primary `Open system settings`. While the status is being read there is
a plain `Checking status…` line in `body-small` secondary with the busy
state and no control, so nothing can pass for a disabled one; a failed
operation reads beneath the action on a `radius/8` `border/strong` surface
as an alert; the web gets the `StateMessage` (`Available in the app`) and
no control. The `caption` footnote closes the page. "On" is said only when
permission is granted and this installation is registered — never before
the OS confirms, and never as a promise of delivery (push delivery stays
deactivated on the server). The copy and the status → action mapping live
in `src/lib/notifications-screen.ts`; the permission mapping itself
(`src/lib/alert-status.ts`) is unchanged.

**Approved copy (founder, P2B6A follow-up).** Personalization intro:
`Choose what Lotly should watch for. These preferences shape Affects me and
your recall alerts. You can still browse every recall.` State: `Your state`
/ `Choose the state you want Lotly to watch. Nationwide recalls are always
included.` Allergens: `Allergens to watch` / `Choose any allergens that
matter to you or someone you shop for.` Stores: `Stores you shop at` /
`Choose stores you shop at. Lotly flags recalls that name them. Some notices
do not list every store, so an unflagged recall may still apply.` Store
search placeholder: `Search stores`. Notifications intro: `Get alerts when a
relevant recall is announced or changes. Lotly does not send marketing
notifications.` Off: `Alerts are off for this device. You will not receive
notifications until you turn them on.` On: `Recall alerts are on for this
device.` Denied: `Notifications for Lotly are turned off in your device
settings. Allow them there, then return to Lotly to turn on alerts.`
Footnote: `Lotly uses your state, allergens, and stores to decide which
recall alerts to send.` The action labels (`Enable recall alerts`, `Turn off
alerts`, `Open system settings`, `Working…`, `Checking status…`) are
unchanged; the failure line beneath the action is the one consumer sentence
`Lotly couldn’t update your alert settings. Check your connection and try
again.` whatever the cause (P2B6C; the raw error goes to the development
console). The web sentence reads `Recall alerts are available in the Lotly
mobile app.` (P2B6C: `recall alerts` is the feature's name); the other two
product-name sentences from P2B6A stand.

### Onboarding and paywall (P2B7X.1)

The first-launch flow, the hard paywall and the one-time notification
education — seven screens in one frame
(`src/components/onboarding/onboarding-frame.tsx`), each mounted only in its
own access phase (`docs/recall-onboarding-and-paywall.md` §3). The visual
contract is directionally approved, not pixel-final: it is built from the
tokens and the shared primitives so it can be refined after native QA, and
no image-generation artifact was cloned.

**The frame.** The warm page, safe-area correct. A top bar at least 44pt tall
holding the `chevron-left` back control (a 44pt target; the slot keeps its
size when Welcome renders no control) and, for a counted step, the mono
`label` progress line `1 of 4` … `4 of 4` in `text/secondary`. The
scrolling content column at the 16pt margin, capped at `max-content-width`:
the headline in `heading-1`, the body in `body` `text/secondary`, then the
screen's own content, `spacing/16` apart. A sticky footer on the page colour
above a `border/subtle` hairline, padded by the bottom inset, holding the
screen's actions as the shared `Button` (primary for the one forward action,
secondary for the lesser one); on iOS it lifts with the keyboard. No fixed
height around text, no `maxFontSizeMultiplier`, no gradient, no marketing
carousel.

**Welcome.** One promise, one short explanation, one example, one action.
The name `lotly`, lowercase in `heading-2` `text/primary`, centred above the
approved mascot ("Branding status"), which is sized to a quarter of the
window's height between 172 and 220pt (`mascotSize`). Then the frame's
headline and body, the one illustrative example card under a `caption` label
`Example`, the `caption` source note, and `Get started` in the sticky footer.
No benefit rows. The screen plays the app's one entrance on first
appearance: the mascot fades in and settles from 90%, then the heading and
the card rise 14pt as they fade in, done by 860ms; nothing loops, and the
footer never moves ("Reduced motion").

**The example card.** The Feed card's own `RecallCardSurface` over a static
model — CRITICAL, `Example` in the date slot, AFFECTS YOU, a bundled flat
illustration of gummy candy in the media slot, `Gummy Products`, `Example,
not a live recall` in the brand slot, `Undeclared peanut allergen`,
`Nationwide` — with no save control and no press. It is the ONE surface that
shows a picture that is not an official image, which is why it draws its own
tile of the card's geometry rather than the shared `MediaTile`, whose
"official URL or nothing" rule (P2B7I) is unchanged. It never appears on a
live card. This is a deliberate, founder-directed exception to "Don't
replace product data with decorative content": it is labelled an example
three ways and is not product data.

**States, Allergens, Retailers.** The shared selectors in the frame: the
count line (`body-small` secondary, always rendered), then a fixed controls
column — the search field where the list is long, and `Clear selection` as
the secondary Button, present on every visit and disabled with nothing
selected — then the Check Rows. Nothing above the list is conditional, so
choosing or clearing never moves a row (the P2B7V rule). Every allergen row
carries its glyph in the row's leading slot: a 20pt Lucide outline in
`icon/secondary`, `icon/primary` when checked, one treatment for all nine
("Iconography"). Every store row carries its mark contained in a 40×24pt box
or the `home` glyph centred in the same box, so rows are one height. On
States, Continue is disabled with nothing chosen and the reason
(`caption`, centred, permanently allocated) reads beneath it. On the optional
steps Continue is never disabled.

**Personalized Preview.** A white `radius/16` card with the `card` lift
holding three `body-small` rows — `States`, `Allergens`, `Retailers` — label
in `text/secondary` at the leading edge, value taking the rest and wrapping
beneath; an empty optional group reads `None` in `text/secondary` and keeps
its row. Then the example card under `Example match`, the independence note
in `caption`, and the footer's `View plans` over `Edit preferences`.

**The hard paywall.** The frame without progress; its back control is the one
way back (to the Preview). Three benefit rows, an 8pt `icon/brand` dot
beside `body` text; then the two plans as a
real radio group: each a white `radius/12` surface with a `border/default`
border that turns `action/primary` when selected, the Choice Row's ring and
dot, the plan title in `body-small-bold`, the store's price with its period
in `heading-3` (`$29.99/year`), the store-derived monthly equivalent and the
saving in `caption` `text/secondary`, and on Annual the `BEST VALUE` mark —
the compact-label geometry on `background/accent` with an `action/accent`
border, IBM Plex Mono `label`. Lime is the value surface here and the
success surface on the education screen and on the restore-success notice;
nowhere else in the flow. The footer: the last outcome's notice (calm on the
information callout, errors on the `border/strong` alert surface, success on
lime), the primary action naming the selected commitment (`Subscribe for
$29.99/year`), the renewal disclosure in `caption`, and the four footer
actions — Restore Purchases, Terms, Privacy, Support — as `caption`
`action/secondary` text buttons grown to 44pt by hitSlop in one wrapping
toolbar. From the accessibility text sizes (a text scale of 1.5, the
threshold the settings selector row stacks at) the disclosure and the four
actions leave the sticky footer for the end of the scrolling content,
directly above the primary action — pinned, they would take the whole
screen and leave the plans unreachable; the notice and the primary action
stay sticky at every size. No close, skip, dismiss, free, trial, lifetime,
countdown, crossed-out price or scarcity.

**Notification education.** `Subscription active` as a compact
`body-small-bold` mark on `background/accent` (rendered as written, not
uppercased); the headline and body; a `caption` label `Notification preview`
over a white `radius/16` card with the `card` lift — a 16pt `background/brand`
square standing for the not-yet-final app icon beside `Lotly` in `caption`,
the title in `body-small-bold`, the body in `body-small`; the footer's `Turn
on notifications` over `Not now` and the reassurance in `caption`.

**After either choice** the Feed shows `Your preferences are set.` once, as
the information callout above the list, until the screen loses focus.

### Trust documents

The seven documents under Profile's Privacy & Data, About & Safety and Legal
groups — Privacy & Data Controls, Sources & Methodology, How Affects Me
Works, Risk Levels Explained, Safety Disclaimer, Corrections Policy and
Attributions — are one reading page (P2B6B). Their content is the registry
(`src/content/`, one structured document per topic, unchanged in slug, route
and claim); the page is one shared renderer (`src/components/document/`),
and the seven differ only where their content does.

**Two titles, one rule.** The navigator's bar names the Profile group the
document was opened from — `Privacy & Data`, `About & Safety`, `Legal`
(`navigatorTitle`, from the registry's own grouping) — and the page names
the document in full, so the reader sees where they are and what they are
reading and never the same words twice. A long title (`Privacy & Data
Controls`, `Sources & Methodology`) therefore lives in the page, where it
wraps, not in the bar, where it would clip.

**Hierarchy** (`DocumentView`): the document title in `heading-1` as a
header; the registry's one-line summary as the standfirst in `body`
`text/secondary`; the lead section's blocks; then each titled section — a
content section heading (title case as written, `heading-3`, navy; see
"Section headings and group labels") over its blocks. Sections are parted by
`spacing/32` of air and nothing else: no card per paragraph, no rule between
sections, no illustration, gradient or animation. Within a section the
blocks sit `spacing/12` apart. The page is the warm page under the tokenized
header, 16pt margins, the content column capped at `max-content-width`, the
bottom inset added to the content padding; text is selectable; nothing
scrolls sideways (there is no table block, because no document holds a
table, and no ordered list, because none holds one).

**Blocks** (`DocumentBlockView`), one treatment per kind in the model:

- `paragraph` — `body` in `text/primary`, the scale's 1.5 leading, wrapping
  at the content width.
- `bullets` — a bullet in the same type beside each item, each row one
  element to assistive technology.
- `note` — a limitation or boundary the reader should not miss, as the
  soft-blue information Callout; never the lime warning tone, which is
  personal relevance. The Safety Disclaimer's medical-advice sentence, the
  two source-precedence sentences and Risk Levels' "no level means safe"
  sentence are notes.
- `risk-levels` — Risk Levels Explained's rows: the production Risk Label
  (the same component, word and colours as the feed card, spelled by
  `riskTierLabel`) above the tier's meaning in `body`, one row per tier, the
  five levels in one section and the two states in the next, exactly as the
  domain orders them. This is the registry's one dense comparison; it stacks
  rather than scrolls, so it survives any type size.
- `link` — an external official-source link: the label in `body`
  `action/secondary` with the 16px `external-link` glyph, the `link` role,
  the spoken hint `Opens in your browser.` and a 44pt row — Recall Detail's
  treatment exactly.
- `document-link` — a link to another registered document: the same row
  with the `chevron-right` glyph and Profile's hint `Opens the document.`,
  pushed through the router to the one document route. Three exist:
  Sources → Corrections Policy, How Affects Me → Privacy & Data Controls,
  Privacy → How Affects Me Works.

**The reset** (`InstallationResetSection`, on Privacy & Data Controls only,
C7.1) is set apart from the document by a `border/default` rule and
`spacing/32`, then the content section heading `Delete my data` over one
white `radius/12` panel with the `border/strong` border — the system's
existing emphasis border, the one the development entry also uses to stand
apart — holding the consequence sentence first, then the one action as the
shared secondary `Button` (`Reset app and delete my data`, busy `Deleting…`,
disabled while a run is in flight), then the outcome sentence as a polite
live region. Danger is carried by the words, the border and the platform's
own destructive confirmation dialog, never by a colour: no risk token is
borrowed and no destructive token was added, because the system could
already say it. Cancel in the dialog mutates nothing, and the queued
orchestrator, its success and failure handling and every label are unchanged.

**Copy.** P2B6B applied the product-name rule to the document bodies
(`Lotly` where the product was meant, `recall` and `Recall data` where a
recall is). P2B6C toned them under "Consumer copy": no em dashes, `Affects
me` and `All recalls` in prose, `state` and `store`, no claim about a Detail
screen or a case timeline the product does not render, the shopper-report
sections phrased conditionally while the gate is off, and the two interim
launch-placeholder sentences removed. Official agency language and the two
official page titles inside the Sources link labels are untouched; every
section, block and claim is still there.

### Affected Products table

Affected Products intentionally uses a **horizontally scrollable table** on
mobile.

Rules:

- The table viewport is exactly the content width.
- `Clip content` is enabled on the viewport.
- The inner table may be wider than the viewport.
- **Horizontal scrolling is applied to the table viewport only.** No other
  surface in the app scrolls horizontally except the filter-chip row.
- The screen/page and main inner-content frame must never horizontally pan.
- The section heading, `See all (N)`, and any callout remain fixed outside the
  scrolling viewport.
- Preserve structured columns such as Product, Package Size, Expiration Date,
  Barcode (UPC), and Lot Codes; the columns actually rendered are decided by
  the presentation contract from what the notice states.

Never allow the wide table to create page-level horizontal overflow.

**As implemented (P2B2, `AffectedProductsTableView` in
`src/app/recall/[id].tsx`).** The viewport is a horizontal `ScrollView` at
the content width; inside it, one white `radius/8` surface with a
`border/subtle` border (the front matter's `affected-products-viewport`),
`spacing/4` padding, and no shadow (conflict 15). Column labels render once
in `body-small-bold`; values in `caption` (Figma's 10px `micro-caption` is
normalized up one step so a lot code or date is legible — a value a shopper
checks against a package is not metadata). Every cell is `table-column-width`
wide with `spacing/8` padding; `border/subtle` hairlines separate columns and
version rows. The section heading and its `See all (N)` stay outside the
viewport on the heading row. Nothing on the page pans sideways but this
grid.

## Elevation & Depth

Lotly is mostly flat. Depth is used sparingly to separate interactive/product
surfaces from the warm page background.

The canonical card elevation is `elevation/card`:

`0 2px 8px rgba(0, 0, 0, 0.06)`

Use it for primary card-like surfaces such as recall cards and similar
elevated content containers. Figma's `Elevation/Card` effect style is this
value (`#0000000F` is 6% black).

Do not stack multiple strong shadows or use glossy/glass effects. Hierarchy
should primarily come from:

- warm page vs. white surface contrast
- borders
- spacing
- typography
- restrained card elevation

Risk and relevance labels do not need shadows.

## Shapes

The shape language is soft but controlled. Rounded corners communicate
consumer-product warmth without becoming playful or toy-like.

Canonical radii:

- **`radius/4` (4px):** risk and relevance labels
- **`radius/8` (8px):** information callouts, media tiles, and compact
  structured containers
- **`radius/12` (12px):** search/input surfaces
- **`radius/16` (16px):** recall cards and larger product surfaces
- **`radius/full` (999px):** pill-shaped navigation/filter chips

Keep radii tokenized. Do not type arbitrary corner values directly into
reusable components if an existing radius token fits.

Avoid extreme bubbly shapes on content-heavy surfaces. Full-pill geometry is
for chips and compact controls, not large cards.

## Components

### Section headings and group labels

Two heading patterns, deliberately distinct (P2B6A follow-up). Choose by
what sits beneath the heading, not by the screen. **Both render their words
as written** — the difference is treatment, never casing (P2B7H).

1. **Navigation group label** — a small caption: `caption`,
   `text/secondary`, a header to assistive technology. It labels a group of
   rows that lead somewhere: Profile's `Privacy & Data`, `About & Safety`,
   `Legal`, `App` and `Development builds only` (`ProfileSection`). Recall
   Detail's `Common symptoms:` keeps this caption SIZE and weight but not its
   colour (P2B7V): it opens the list beneath it rather than labelling a group
   from above, so it renders in `text/primary` like the bullets it introduces.
2. **Content section heading** — `heading-3` (Public Sans semibold, 19/26),
   `text/primary` navy, a header to assistive technology. It heads a section
   the shopper reads and acts in: Personalization's `Your state`, `Allergens
to watch`, `Stores you shop at` (`SettingsSection`), the selector sheets'
   titles (`Choose your state`, `Choose stores`), every trust document's
   section headings and the reset section's `Delete my data` (P2B6B).

A future screen with both kinds keeps them apart the same way: groups of
links get the label, sections of content and controls get the heading.

#### Capitalization (P2B7H)

Lotly-authored interface text is written and rendered in natural case. This
**replaces** the earlier convention in which `ProfileSection` and
`DevelopmentEntry` uppercased their titles at render time and Detail's
symptom eyebrow was typed `COMMON SYMPTOMS`; nothing in the product
transforms case in a style, and `textTransform` is not used.

Uppercase is reserved for **compact status badges**, where shouting is the
established component treatment and the word is a token rather than
language:

- the seven risk labels (`CRITICAL`, `VERY HIGH`, `HIGH`, `MODERATE`, `LOW`,
  `PENDING`, `UNKNOWN`) — `riskTierLabel` cases the canonical word;
- the relevance label (`AFFECTS YOU`);
- the notice label (`PUBLIC HEALTH ALERT`) — `NoticeLabel` cases the
  contract's own words.

Each of those speaks in natural case: a screen reader hears `Risk level:
High`, `Affects you`, `Public Health Alert`, never the shouted token.

Never recased, in either direction: official notice prose, the trust and
legal documents, product and brand names (P2B7G), acronyms and agencies
(FDA, USDA, FSIS, CDC, UPC, URL), state codes, roman-numeral recall classes,
codes, identifiers, units, and the raw government strings the source-data
normalization modules match against. The development-only Design Preview
harness keeps its own uppercase gallery labels; it is not shopper-facing.

The contract is enforced by `src/components/capitalization-design.test.ts`,
which scopes the scan to the files that render Lotly-authored chrome and
allow-lists the approved acronyms and badge words individually — a new
uppercase string in scope fails until it is reviewed and named there.

### Search Bar

The search bar is a 44px-tall white surface with `radius/12`, `spacing/12`
padding, and `elevation/card`. It uses a secondary-color search icon and
secondary text for placeholder content, both `text/secondary` in meaning even
where Figma binds the icon-token twin.

Default placeholder pattern:

`Search product, brands, or recalls.`

Search must feel like a primary discovery tool, not a form field buried in
chrome. It is a control inside the Feed: it filters the loaded feed and never
navigates.

Implemented as `src/components/ui/search-bar.tsx` (P2B1): the surface, the
20px search glyph in `icon/secondary`, the field in `caption` type, and —
while the field holds text — an explicit `Clear` control in `action/secondary`
that reads aloud as `Clear search`, clears the caller's query, and hands focus
back to the field. It replaces iOS's native in-field clear glyph so the
affordance exists on every platform and carries a spoken name. The bar holds
no query and matches nothing; the Feed's `filterBySearch` and the shipped
placeholder (`Search product, company, brand, or code`, conflict 13) are
untouched.

### Navigation Chips

Navigation/filter chips use pill geometry and compact heights in the 32–36px
range.

- Selected states use `background/brand` with `text/inverse`.
- Default states stay light and low-emphasis: `background/surface` with
  `text/primary`.
- Icons may precede labels where they clarify meaning.
- Dropdown chevrons may be used for controls such as Location or Category.
- "All" behaves as a selected browse state.
- "Affects me" is a personalized filter/control and should remain semantically
  distinct from ordinary product categories.

A 32px chip is under the minimum touch target; the pressable grows to 44pt
through `hitSlop` without changing the layout. Do not turn every surfaced chip
into an independent multi-select toggle.

Implemented as `src/components/ui/chip.tsx` (P2B1) at the compact 32px
height — one `caption` line with `spacing/8` above and below, `spacing/12`
at the sides, `radius/full` — with an optional trailing 16px glyph (the
chevron on a chip that opens a picker). It carries no behaviour and reports
`accessibilityState.selected`; its callers make the visible label itself
change too (the counted `Location · 2`, or the either/or pair). The Feed's
chip row sits inside a scroll view whose own vertical padding keeps every
chip's 44pt hit area within reach. The sheet a filter chip opens uses
bordered white pills for Cancel and Clear and a brand-navy pill for Apply,
each a full 44pt target.

### Risk Label

Risk Label is a 24px-high compact status label using IBM Plex Mono `label`
type, uppercase text, `radius/4`, `spacing/8` horizontal and `spacing/4`
vertical padding, a 1px border in the tier's own border color, and no shadow.

Supported states, and the only states:

- Critical
- Very High
- High
- Moderate
- Low
- Pending
- Unknown

The visible copy and semantic risk token must describe the **same** level. Do
not shift or reuse neighboring severity colors. The label text is mandatory —
color is the second, redundant channel — and the spoken label ("Risk level:
High") comes from the presentation contract.

There is exactly one Risk Label component (`src/components/ui/risk-label.tsx`),
one size, and one word: Recall Detail renders the same 24px label as the feed
card, reading exactly `CRITICAL`, `VERY HIGH`, `HIGH`, `MODERATE`, `LOW`,
`PENDING`, or `UNKNOWN`. The former Detail wording `CRITICAL RISK` is retired
(founder decision, 2026-09-14); `risk-display.test.ts` pins the closed
seven-word vocabulary on both surfaces.

A Public Health Alert renders **no** Risk Label (P2B7N). The vocabulary is
unchanged — this is a visibility rule, not an eighth word: a PHA never
receives a classification, so `UNKNOWN` beside `PUBLIC HEALTH ALERT` stated
nothing and made a correctly processed alert look incomplete. The presentation
contract decides it once (`riskLabelSuppressed` → `riskView`, so Feed, Saved
and Detail cannot drift), and the surfaces render the label only when the model
gives them one. A hidden label leaves nothing behind: the status rows are
gapped, wrapping flex rows with no fixed height, so `PUBLIC HEALTH ALERT` takes
the leading position and the activity date stays beside it. A _recall_ whose
classification is genuinely unknown keeps `UNKNOWN`. See
[docs/recall-feed-usability.md](docs/recall-feed-usability.md) for the rule and
its matrix.

### Relevance Label

Relevance Label is separate from Risk Label.

Current supported state:

`AFFECTS YOU`

It uses `relevance/affects-you`: lime, navy text, a 12px flag icon, `radius/4`,
and a 1px `#ADB600` border.

Never implement `Affects You` as an additional risk/severity variant.

Implemented as `src/components/ui/relevance-label.tsx` (P2B1): the same 24px
compact-label geometry as the Risk Label, the design's flag glyph, the visible
word `AFFECTS YOU` and the spoken label `Affects you`. It takes no props, so
no tier can reach it, and it reads `relevancePalette` only. The card renders
it exactly when the model's `affectsYou` verdict is true; the decision itself
(lib/relevance.ts) is untouched.

### Illness Notice

The compact illness notice (P2B7K) answers one question — **did the official
notice report illnesses?** — in Recall Detail's identity area, below the brand
and above the official FDA/FSIS report link.

It is a third, independent question. It is not severity and not personal
relevance:

- **Not a Risk Label.** A Critical recall can report no illnesses; a Low one
  can report many. The Risk Label is uppercase IBM Plex Mono on a filled
  severity colour at a 24px minimum height. The notice is sentence-case
  `caption` sans on a foundation surface, `radius/4`, 8×4 padding, auto-width.
- **Not an Affects You callout.** That is a full-width lime Callout about
  _this shopper_. The notice is compact and about the recall.

**One fact, one box (P2B7V).** Each harm the notice established renders in its
own compact box. The boxes stack vertically, every one aligned to the same
left edge and sized to its own sentence, in the fixed order **illnesses →
hospitalizations → deaths**. No box is indented under another, none has a
leading inset of its own, and none has a fixed height — each is its own
caption line box plus padding, so it grows with Dynamic Type instead of
clipping. The order does not change when one of the three is absent.

**Severity is the treatment** (founder decision, P2B7V):

| box              | treatment          | glyph     | copy                                                                                                                                    |
| ---------------- | ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| illnesses        | `risk/high`        | `warning` | `1 illness reported`, `12 illnesses reported`, `Approximately 12 illnesses reported`, or `Illnesses reported` when no trustworthy count |
| hospitalizations | `risk/very-high`   | `warning` | `1 hospitalization reported` / `12 hospitalizations reported`                                                                           |
| deaths           | `risk/critical`    | `warning` | `1 death reported` / `12 deaths reported`                                                                                               |
| explicit none    | `harm-notice/none` | `info`    | `No illnesses reported`                                                                                                                 |

**Unknown** — nothing renders. No box, no placeholder, no spacer, no spoken
element. Absence of a statement is never displayed as a zero.

`harmNoticePalette` holds **references** to `riskPalette`'s entries, never
copies of their values, so this introduces no hex and cannot become a second
definition of Critical. P2B7K's "the Risk Label is the only consumer of
`riskPalette`" is deliberately narrowed rather than abandoned: severity is
reached only through a **named semantic map**, and no screen and no component
may index the risk palette directly — the Risk Label remains the only
component that does.

These still never read as Risk Labels, because colour was never the
distinction: a Risk Label is uppercase IBM Plex Mono at a 24px minimum height
stating a TIER; a harm notice is sentence-case `caption` at its own line
height stating a COUNTED FACT. Each glyph is tinted with its own box's
foreground — the same navy the Risk Label's text uses on the same fills — so
every treatment clears WCAG AA for both the words and the icon.

Injuries and adverse reactions still never appear and never produce a box; the
contract that feeds this component cannot express them.

Implemented as `src/components/ui/illness-notice.tsx`. Its only input is the
finished copy from the presentation contract, so it can neither classify prose
nor acquire a second subject. It is informational: no press target, no button
role, no hint. To assistive technology each box is one element speaking one
sentence, with the glyph decorative. Semantics and copy live in
[docs/recall-illness-status.md](docs/recall-illness-status.md).

### Category Tag

The one product-category mark on a recall card (P2B7D) — Feed and Saved, the
same component, one call site in the shared card. It answers "what kind of
product is this", and it is the quietest labelled thing on the card by
design.

- **Shape and type.** `radius/4`, a 1px `border/subtle` outline, **no fill of
  its own** (the card's own `background/surface` shows through), `spacing/8`
  horizontal and `spacing/4` vertical padding, `alignSelf: flex-start`. The
  word is `caption` in `text/secondary` — Public Sans, sentence case, the
  vocabulary's own label verbatim.
- **Placement.** In the identity column, directly beneath the brand and above
  the recall summary. Never in the status row (risk and relevance live there)
  and never in the footer (the save control's tap target lives there).
- **What it deliberately is not.** Not a risk tier: it reads neither
  `riskPalette` nor `relevancePalette`, and having no fill it survives
  greyscale because colour carries nothing. Not a compact status label: it is
  **not** IBM Plex Mono, **not** uppercase, and carries no glyph. Not a
  control: `radius/full` is the Navigation Chip's pill and is deliberately
  not used here, and the tag has no press handler, no button role and no
  hitSlop. Nothing about it animates.
- **Absence.** A recall with no displayable category renders **no element** —
  no container, no reserved height, no spacer, nothing spoken. The identity
  column is a gapped flex column, so the omitted child leaves no gap.
- **Dynamic Type.** No fixed height and no cap: the box is the caption's own
  line box, so at accessibility sizes the label wraps inside the outline and
  the outline grows with it. Verified in the simulator at default,
  accessibility-extra-large and the largest supported size.
- **Accessibility.** `accessibilityRole="text"` with the spoken label
  `Category: <label>` — named once, in the Risk Label's
  `Risk level: <tier>` shape, because the bare word is ambiguous aloud
  between a brand and a reason.

Three token-compliant treatments were compared in Design Preview over the
same two real recalls before this one shipped; the comparison stays in the
harness as the decision record
([docs/recall-design-preview.md](docs/recall-design-preview.md)). The two
rejected options were an inline metadata label on the brand line — no fixed
position, and at real brand lengths it reads as more brand — and a filled
neutral tag in the status row, which wraps directly under the risk badge and
reads as a second status.

Which categories appear, and why three of the twelve never do, is a product
rule rather than a visual one:
[docs/recall-feed-usability.md](docs/recall-feed-usability.md), "The card tag
(P2B7D)". Implemented in `src/components/ui/category-tag.tsx`.

### Recall Card

Recall Card is the primary feed object. It is a white card at the content
width with `radius/16`, a 1px `border/subtle` border, `elevation/card`, strong
product-title hierarchy, and a trailing save/bookmark action.

The component has two independent state dimensions:

**Relevance**

- Affects You
- Does not affect you

**Media**

- Image
- No Image

The complete supported matrix is:

- Affects You + Image
- Affects You + No Image
- Does not affect you + Image
- Does not affect you + No Image

If a usable product image exists, show the actual product image, `contain`ed
on `background/media-placeholder` (`#EEF1F1`) so the neutral colour shows
around a tall or wide label photo. If it does not — no stored hero, or a hero
whose URL failed to load — **there is no media column at all** (P2B7I,
founder direction): the title, brand, category tag and summary take the
card's full width, and everything around the content row (the status row,
the three-line title clamp, the location/save footer) is identical in both
shapes. Never a grey placeholder square, a broken-image icon, an unrelated
stock image, generated imagery, a mascot, a decorative "image unavailable"
illustration, or a pressable stand-in. A remote image that is still loading
may hold its square on the placeholder colour only while the request is
active — the square is the final size, so the image arriving reflows
nothing; once a failure is known the card settles into the no-image shape,
once, and the verdict is remembered for the session so a recycled card
neither re-requests the URL nor flickers between a square and none.

Through P2B7H the card kept the tile's footprint in every state and drew the
bare placeholder for "none" and "failed" alike — the persistent grey
rectangle on no-image cards that P2B7I removed.

A relevance badge is shown only when the recall affects the user.

Card content hierarchy:

1. risk label + recency/update metadata
2. optional Affects You relevance label
3. product media
4. product title
5. manufacturer/brand
6. the product-category tag, when the recall has a displayable one
7. one-sentence recall summary
8. affected location
9. save/bookmark affordance

A Public Health Alert additionally carries its explicit notice label (shipped
behavior; not yet in Figma). Product titles and summaries must tolerate
realistic wrapping without breaking card layout.

Implemented in `src/components/recall-card.tsx` (P2B1). The card is
`spacing/12` padding with `spacing/8` between its rows: the status row (risk
label, the PHA notice label when there is one, and the one activity date in
`caption`, with the relevance label at the trailing edge), the content
row (the 112px media tile, then the product name in `heading-3`, the brand in
`caption`, the optional Category Tag, and the summary in `body-small`), and
`spacing/16` later the footer
(the 12px pin glyph and the location in `caption`, with the save control
trailing). The media tile renders the real hero image `contain`ed on
`background/media-placeholder`, so the neutral colour shows around a tall or
wide label photo — and renders nothing at all when there is no image or the
load fails, so the content row is the text column alone (`MediaTile` decides
this; the card holds no media rule and reserves no width, which is how Feed
and Saved stay identical). The Public Health Alert notice label is the compact-label
geometry on `background/subtle` with a `border/default` border in `label`
type — a notice type, so it borrows neither the risk nor the relevance
palette. Nothing on the card is truncated or fixed in height; the text column
takes the remaining width and wraps.

The save control (`src/components/save-recall-button.tsx`) is the design's
bookmark glyph alone — outline unsaved, the same bookmark filled saved, in
`icon/primary`, reaching 44pt through `hitSlop`. It carries no visible word
(P2B7H, resolving conflict 16). The state's non-colour channel is therefore
the glyph pair, and the wording moves entirely into the accessible contract:
`accessibilityRole="button"`, an action label (`Save recall` / `Remove from
saved recalls`) and `accessibilityState.selected`. All three come from one
pure function, `saveControlState`, so Feed, Saved and Detail cannot drift
apart, and there is no label in the contract for a surface to render. To
VoiceOver the card is one element, so the save action is also exposed as a
custom accessibility action on the card with the same spoken names, and the
card announces `Opens the recall details` as its hint.

### Information Callouts

Two callout types are currently established.

**Warning**

- `relevance/affects-you/background` (lime)
- `text/primary` text and icon
- `radius/8`
- Used for personal relevance, e.g. `Warning: This recall affects you.` The
  sentence itself comes from the presentation contract.

**Information**

- `background/subtle` (soft blue)
- `text/primary` text and icon
- `radius/8`
- Used for neutral guidance

Do not use the lime warning treatment for generic informational content. Note
that Recall Detail currently ships **no** informational callout above
Affected Products (a founder decision, P2a); see "Known Figma/code conflicts".

Implemented as `src/components/ui/callout.tsx` (P2B2): `tone="warning"` is
the lime `background/accent` surface with the design's 16px `warning` glyph,
`tone="information"` the soft-blue `background/subtle` surface with the
`info` glyph; both `radius/8`, `spacing/12` padding, `body-small` text in
`text/primary` (Figma binds the text to `background/brand`, corrected to a
text token), the glyph centred on the first line of text, and no shadow
(conflict 15). Recall Detail renders the affects-you sentence as the warning
tone and a retracted notice as the information tone; the sentences are the
presentation contract's. The lime tone is keyed by name, so generic
information cannot land on it without saying so in code. The trust documents'
`note` blocks render as the information tone (P2B6B); no document can reach
the warning tone. A caller may mark a callout that appears after the screen
is up as a polite live region (the stale-feed notice, P2B6C).

### Disclosure Control

Every in-place reveal — the jurisdiction list, the Affected Products rows, and
each multi-value cell — renders through one control
(`src/components/ui/disclosure-control.tsx`): `caption` type in
`action/secondary`, visible text `See all (N)` while collapsed and `Show less`
while expanded, where `N` is always the complete count.

It is a button with a real expanded state: VoiceOver announces the spoken
label from the presentation contract ("See all 22 lot codes", "Show less")
plus `button` and `collapsed` / `expanded`. Its visible footprint is one
caption line, so it reaches the 44pt minimum target through `hitSlop`. Nothing
animates when it toggles: the list simply grows, which is also its
reduced-motion behavior.

### Recall Detail

The recall detail view prioritizes source credibility and user actionability.

Header hierarchy:

1. navigation and utility actions
2. risk label + the one material activity date
3. product title
4. manufacturer/brand
5. official source link
6. product imagery — one official photo, or a bounded manually paged set of
   them (P2B7C)

The official-source copy is data-driven. The shipped label is
`View the official {agency} report` (`…alert` for a Public Health Alert),
where the agency is the notice's own source (`FDA`, `FSIS`). Never hardcode
`FDA` as the universal source. Keep the external-link icon.

Section order — this is product behavior and must survive any restyle:

1. Header / product identity
2. What Happened
3. Where It Was Sold
4. Health Risk
5. Affected Products

Community information belongs **under** the official Where It Was Sold
statement, never beside or above it.

Keep section headings direct and plain-language. Avoid bureaucratic
terminology when a clear consumer phrase is available.

**As implemented (P2B2, `src/app/recall/[id].tsx`).** The warm page,
`spacing/16` margins and gaps, the content column capped at
`max-content-width`, the bottom safe-area inset added to the content
padding. The navigation header is the navigator's own (`Recall Details` in
`heading-3` on the page colour, no shadow) with the platform's back chevron
alone — see "Bottom Navigation" for the pushed-screen chrome. The product
header: the Risk Label, the Public Health Alert notice label when there is
one, and the one activity date in `caption` on the status row, with the
shared save control (the bookmark glyph alone, P2B7H) at its trailing edge —
in the body with the recall's identity, per the P2A founder decision,
rather than in Figma's utility row (conflict 9); then the product name in
`heading-2`, the brand in `body-small` `text/secondary`, and the
official-source link — `caption` in `action/secondary` with the 16px
`external-link` glyph, a `link` role, the spoken hint `Opens in your
browser`, and a 44pt target — beside the 152px media tile when the recall has
official photography. With no image the identity takes the whole row: Detail
removes the tile rather than reserving its space, the second of the two
approved no-image treatments.

**Official imagery (P2B7C; indicators settled in P2B7I).** The tile position
holds the notice's official FDA product photography, as the shared
presentation contract assembles it: the image-role allocation's hero first —
**the same picture the Feed card showed for that recall** — then its gallery
in the agency's own order, **complete**.

**There is no presentation cap.** Every official photo that loads is a page
a shopper can swipe to: a 74-photo notice pages from `1 / 74` to `74 / 74`.
A denominator the reader cannot reach would be a lie about what the agency
published, so the set is never truncated for presentation; the pager
virtualizes instead (`FlatList`, one page mounted and fetched at a time —
the live corpus holds 74- and 87-photo notices, the recorded one 51).

What **is** bounded is the indicator, and it bounds nothing else. Two marks
say two different things, and above the threshold they **coexist**:

| Official photos | Pages | Indicator                                                                                                              |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 0               | —     | nothing at all — the no-image header                                                                                   |
| 1               | 1     | none — the static `detail-media-size` tile, as before                                                                  |
| 2–5             | 2–5   | `page-dot-size` dots, one per image (`border/strong`; current `background/brand`)                                      |
| 6 or more       | all   | a sliding window of at most **five** dots **and** the compact counter `2 / 74` in `caption` `text/secondary` beside it |

The **dots** say where the shopper is inside the carousel — a window of at
most `IMAGE_DOTS_WINDOW` (5) marks that slides: the first pages at the
beginning, centred on the current page through the middle, the final pages
at the end, always containing the active position. **How many dots there
are never says how many images there are.** The **counter** says the current
page over the pages that can be shown — which is the agency's official total
until something fails — and is added beside the dots, never swapped for
them. Both update as the shopper swipes. Dots and counter share one centred
row under the tile; at a large text size the counter wraps beneath the dots.
**No prose**: the rejected `Showing 6 of N official images.` sentence and
every explanatory word with it are gone.

A candidate whose image cannot load **leaves the set** — only that page, so
every healthy image after it stays reachable; the dots, the counter and the
spoken position all describe what actually rendered. The counter's
denominator then drops to the reachable count (`2 / 72`), never the
published one, and the shortfall is stated once to assistive technology
rather than implying a failed image is viewable. If every candidate fails,
the header takes its no-image shape rather than showing a blank tile under
an indicator — a grey square that still counted as a page is the exact
defect this rule closes. A failure is remembered for the session, so
reopening the recall neither re-requests the broken URL nor shows a blank
page first.

Rules the composition must keep:

- **No page advances on its own.** There is no timer, no auto-advance, no
  animated transition of ours, and therefore nothing for Reduce Motion to
  turn off.
- **No arrows, and the images are not pressable.** There is no full-screen
  image destination in the product, and a control that leads nowhere is worse
  than none. If an image control is ever added it takes the 44pt minimum.
- **`contain`, always.** Government photography runs from about 0.28 to 5.85
  in width ÷ height; a tall or wide photo is letterboxed on the media
  placeholder, never cropped or stretched to fill the square.
- **Only the pager moves sideways.** The page's own scroll view keeps
  vertical scrolling, so a drag that starts vertically scrolls Detail.
- **The dots are decoration** — hidden from assistive technology. Position
  is announced on the image itself instead, after its factual label, over
  the pages that can be reached: `Image 2 of 74`. Every counted page IS
  reachable, so the count needs no qualifier. The counter is hidden too
  while nothing has failed, because each page already announces those two
  numbers and a second element would only duplicate them; when something
  has failed it becomes the one spoken element, labelled with the sentence
  that keeps the totals apart (`72 of 74 official images can be shown; the
rest could not be loaded`), so the slash is never read aloud.
- **Feed imagery stays single-image**, and it is the same image. The Recall
  Card's 112px tile shows one official photo (conflict 30) — the stored hero,
  which is also Detail's first page. Neither screen selects or transforms it.

**Official label pages are not rendered (P2B7C, corrected).** FSIS label PDFs
are rasterized into official label-page images and stay in the allocation for
the evidence pipeline, but **no screen shows them as a gallery**. The
`Official product labels` gallery above the Affected Products table, and the
standalone section for a notice without that table, were both built in P2B7C
and **removed by founder decision**: imagery under Affected Products is only
ever an image the allocator matched to that exact affected-product row — the
Outshine shape, where each photo depicts the version in the row it sits in.
An image that cannot be tied to a row is not evidence about any row on
screen, and a section is never fabricated to hold one. At accessibility text sizes, where one `heading-2`
word can be wider than the column beside the tile, the header stacks — the
identity at full width, the tile beneath it — decided from the name's own
text layout (a line that ended mid-word) and latched, so a product name
never stays broken inside a word.

**The title collapses to four lines (P2B7V).** Detail only — Feed and Saved
clamps are untouched. A title that fits within four lines carries **no control
at all**; one that overflows carries a quiet `caption` text action in
`action/secondary` sitting with the title block: `Show full title` collapsed,
`Show less` expanded. It is deliberately not a Button — this reveals the rest
of a name and must never read as the screen's primary action — and its 44pt
target comes from `hitSlop` so the visible mark stays one caption line.

Overflow is **measured, never guessed**. An off-layout probe renders the same
string in the same type at the same width with no clamp; its line count
decides whether the control exists, and it also feeds the stacked-header
decision above. A character-count heuristic would be wrong at accessibility
text sizes and wrong beside the 152px hero tile, which are exactly the cases
the control exists for. The probe is absolutely positioned at zero opacity, so
it contributes no layout and no height, and is hidden from assistive
technology. Expansion removes the clamp entirely rather than raising it, the
title block has no fixed height, and every per-recall disclosure resets when
the route points at a different recall. The **full** title is always what a
screen reader hears, what search matches, and what share, push, identity and
de-duplication use. A retracted notice renders the information callout in
the header; the affects-you verdict renders the warning callout beneath it.

Sections follow in `heading-3` (`What Happened`, `Where It Was Sold`,
`Health Risk`, `Affected Products` — the design's title case replaces the
legacy uppercase grey headings), separated by `border/default` hairlines
that render only between sections that exist, each with its reveal on the
heading row: the jurisdiction `See all (N)` opposite `Where It Was Sold`
(where Figma's `View Retailers (10)` sits), the row reveal opposite
`Affected Products`. Section bodies are `body-small` in `text/primary` —
Figma's `text/secondary` body copy is not used for the narrative, because
the shipped rule mutes only the `Update` line (conflict 21). The jurisdiction
line carries the 12px pin, and the **retailer row** follows it `spacing/8`
below in the same shape — the 12px `house` glyph (the Feed tab's own, from the
shared icon set, never an image asset) in the same leading column the pin
occupies, then `Retailers:` and the names in ONE text flow, in ONE colour
(`text/primary` throughout), so the list wraps as one and is announced once
(P2B7V). The names are punctuated by the shared
`joinNames`: `Retailers: ALDI` / `Retailers: ALDI and BJ's` /
`Retailers: ALDI, Costco, and BJ's`. The text column takes the remaining
width, so a long list wraps inside it and every continuation line stays clear
of the glyph. No trusted store: **no row at all** — no icon, no label, no
spacer, no empty wrapper. Detail only; Feed and Saved carry no retailer
content. The community block follows `spacing/12`
below, in the same body type with its add/edit action as a `caption` text
action in `action/secondary`. Health Risk keeps its `Common symptoms:` label
(a `caption` in `text/primary` since P2B7V — same size, same weight, same
position, and a colon, because it opens the list rather than sitting muted
over it) above bulleted `body-small` lines and the `Learn more from …`
external link.
Loading, not-found and load-failure states are the shared `StateMessage`
with the copy in `src/lib/detail-copy.ts`.

### Bottom Navigation

The bottom navigation is a 72px-tall white surface with 24px icons. It has
**exactly three visible destinations**, in this order, with Feed initial:

- Feed (home icon)
- Saved (bookmark icon)
- Profile (user icon)

Search stays inside Feed. There is no fourth tab, and Feed is never renamed
Home in consumer-facing UI. Recall Detail, the shopper-report questionnaire,
the settings pages and the trust documents push over the bar.

The three destinations are visibly labelled `Feed`, `Saved`, `Profile`
(founder decision, 2026-09-14), in `caption` type on `background/surface`,
`action/primary` navy when selected and `text/secondary` otherwise, and each
carries its name as its accessibility label with the selected state exposed.
Icons join the labels once an icon set is chosen; they never replace them.

Interactive targets should be comfortably tappable even when the visible glyph
is only 20–24px: each tab is a 44pt-or-larger target.

Implemented in `src/app/(tabs)/_layout.tsx` (P2B1): the design's own exported
home, bookmark and user glyphs at 24px above each label, on a
`background/surface` bar `bottom-nav-height` (72px) tall plus the home
indicator's inset, with `spacing/8` above the glyphs and `border/subtle` as
the hairline. The three destinations' headers are styled from the same
layout — the page colour, no shadow, `heading-3` for the `Feed` / `Saved` /
`Profile` title — because a screen's header is navigation chrome the
navigator owns.

### Iconography

Use **Lucide-style** outline icons with consistent stroke weight.

Common patterns include:

- search
- filter/sliders
- map pin
- bell
- bookmark
- home
- user
- chevron
- share
- external link
- flag
- warning
- information

Use semantic icon colors (`icon/primary`, `icon/secondary`, `icon/inverse`,
`icon/brand`). Do not mix filled illustration-style icons into the core
utility UI without an explicit approved design. Icon glyphs come from the
`icon-size` scale; an icon inside a label is 12, inline with text 16, a
utility control 20, and a tab 24.

### The icon set as implemented (P2B1)

No icon library is installed — adding one was a dependency decision the Feed
milestone was told not to make — so the glyphs are the Figma file's own
exported vectors, rasterised once into `assets/icons/<name>.png` at 1x, 2x
and 3x on a 24pt box (black on transparent) and tinted at render time by
`src/components/ui/icon.tsx`. Nothing was drawn by hand: every export is the
Lucide-style outline the design uses, unchanged in shape.

| Icon              | Figma export (node)                        | Lucide name         | Used by                                         |
| ----------------- | ------------------------------------------ | ------------------- | ----------------------------------------------- |
| `home`            | `icon/home` in `nav bar` (`81:816`)        | `house`             | Feed tab                                        |
| `bookmark`        | `icon` in `nav bar` (`81:817`)             | `bookmark`          | Saved tab; the save control, unsaved            |
| `bookmark-filled` | the same path with its interior filled     | `bookmark` (filled) | the save control, saved                         |
| `user`            | `icon/user` in `nav bar` (`81:818`)        | `user-round`        | Profile tab                                     |
| `search`          | `Search-Bar` glyph (`30:404`)              | `search`            | the search bar                                  |
| `map-pin`         | `Nav-Chip` glyph (`33:458`)                | `map-pin`           | the card's location line                        |
| `flag`            | `Relevance Label` glyph (`42:866`)         | `flag`              | the relevance label                             |
| `chevron-down`    | `Nav Chip/icon` (`42:809`)                 | `chevron-down`      | the Location / Risk / Category chips            |
| `chevron-right`   | the `chevron-down` export, a quarter turn  | `chevron-right`     | Profile's navigation rows (P2B5)                |
| `external-link`   | `external-link` in Detail (`81:837`)       | `external-link`     | the official-source and Learn more links (P2B2) |
| `warning`         | `icon/warning` in `Information` (`78:223`) | `triangle-alert`    | the warning callout (P2B2)                      |
| `info`            | `lucide/info` in `Information` (`81:687`)  | `info`              | the information callout (P2B2)                  |
| `chevron-left`    | the `chevron-down` export, a quarter turn  | `chevron-left`      | the onboarding screens' back control (P2B7X.1)  |
| `allergen-*`      | Lucide repository, vendored SVG sources    | see below           | the nine allergen rows (P2B7X.1)                |

Figma exports each glyph cropped to its path bounds at some scale; each was
drawn at `export size × S / (24 × k)` centred in an `S`-point box, where `k`
is the export's scale against the Lucide 24-unit grid, which reproduces the
design's optical size exactly. Every export carries a stroke of about 2.4
grid units (Figma's 20px icons scaled to 24), so the whole set lands at one
stroke weight. Figma's bell and sliders glyphs are deliberately not in the
set: neither has product behaviour (conflicts 11 and 17). `chevron-right`
(P2B5) has no export of its own: it is the `chevron-down` rasters rotated a
quarter turn anticlockwise, which on the Lucide 24-unit grid is exactly
`chevron-right` (`m9 18 6-6-6-6` is `m6 9 6 6 6-6` turned about the
centre), so the stroke weight and optical size are the set's own; a
lossless raster rotation, nothing redrawn. When Figma gains a Profile frame
with its own chevron export, that export replaces these files.
`chevron-left` (P2B7X.1) is the same rotation the other way.

**The allergen glyphs (P2B7X.1).** The nine allergen rows need nine glyphs
and the Figma file has none, so they come from the Lucide repository itself —
the family the set already is — under the ISC license: `lucide-icons/lucide`
at commit `f06ac67e33d645c40b8ce19a0419c85c5d7dd751` (release 1.47.0),
retrieved 2026-09-23, the SVG sources vendored with the license under
`assets/icon-sources/lucide/` and rasterised offline by
`scripts/render-onboarding-assets.mjs` onto the same 24pt box at 1x, 2x and
3x at the set's 2.4-unit stroke, black on transparent, tinted at render time.
The mapping and its provenance are the tested contract in
`src/lib/allergen-icons.ts`:

| Allergen             | Icon                 | Lucide           | Depiction |
| -------------------- | -------------------- | ---------------- | --------- |
| Peanuts              | `allergen-peanut`    | `nut`            | concept   |
| Tree nuts            | `allergen-tree-nut`  | `tree-deciduous` | concept   |
| Milk                 | `allergen-milk`      | `milk`           | literal   |
| Egg                  | `allergen-egg`       | `egg`            | literal   |
| Wheat                | `allergen-wheat`     | `wheat`          | literal   |
| Soy                  | `allergen-soy`       | `bean`           | literal   |
| Sesame               | `allergen-sesame`    | `sprout`         | concept   |
| Fish                 | `allergen-fish`      | `fish`           | literal   |
| Crustacean shellfish | `allergen-shellfish` | `shrimp`         | literal   |

No permissively licensed outline family publishes a peanut, a tree-nut or a
sesame glyph (Lucide, Lucide Lab, Phosphor, Tabler, Iconoir and Font Awesome
were checked), so those three rows use the family's nearest honest concept
and the label carries the meaning. Every glyph is decorative and hidden from
assistive technology; every row uses one treatment (20pt, `icon/secondary`
unchecked, `icon/primary` checked). No emoji, no second family, no food
symbol drawn by hand. The "Branding status" rule against inventing food
icons is unchanged: nothing here is invented, and the founder directed the
set.

## Product contracts the design must carry

These are shipped behaviors. They are recorded here so that no visual pass
removes or reorders them; the words are the presentation contracts' own and
are pinned by `src/constants/design-contract.test.ts`.

### Community shopper reports

Rendered beneath the official Where It Was Sold statement on Recall Detail.
The server gate is authoritative: while it is off the block renders nothing at
all, the app holds no local feature flag, and production shopper reports are
not enabled by any design work.

When no installation report exists:

- Below the public threshold: `Did you find this product here?` followed by
  the action `Add your report`.
- At three or more reports: `{count} shoppers reported finding it here`
  followed by `Add your report`.

When this installation already has a report:

- The action reads `Edit your report`.
- No personal confirmation sentence appears on Recall Detail (no restatement
  of the state, retailer, or timeframe submitted).
- Removal is available only inside the edit flow, behind a confirmation.

Unknown geography — a recall whose notice states no usable jurisdiction:

- The recall is ineligible for shopper reports entirely (founder decision,
  2026-09-14). A report carrying only a purchase timeframe says nothing about
  where shoppers found the product, which is the purpose of the feature, and
  nothing surfaces it.
- No community block, no metrics, no `Add your report`, and no questionnaire.

### Questionnaire

One question per screen, in this order:

1. **State** — always first.
   - One-state recall: `Did you find this product in {State}?` with Yes/No.
     "No" ends the flow with nothing stored.
   - Multi-state recall: ask directly which listed state:
     `What state did you find it in?`
   - Unknown geography: the recall is ineligible and asks nothing at all —
     there is no entry point and no questionnaire (see "Community shopper
     reports" above). The state question is therefore unconditional.
2. **Retailer** — only when the notice names canonical retailers; otherwise
   the question is absent.
3. **Purchase timeframe.**
4. **Review.**
5. **Disclosure** — exactly:
   `Your anonymous report contributes to community totals and does not change official recall information. Learn more.`
   `Learn more.` opens Privacy & Data Controls.
6. **Submit** — the action reads `Submit report`, or `Update report` when
   editing an existing report.

Success:

- Title: `Thanks for contributing!`
- Body: `Your report helps other shoppers make safer decisions.`

Do not collect health information. There is no field for symptoms, illness,
purchase proof, free text, or location beyond the state.

**As implemented (P2B3, `src/app/report/[id].tsx` over
`src/components/report-questionnaire.tsx`).** Figma holds no questionnaire
frame (conflict 26), so the composition is the system's own. The warm page
under the navigator's `Share a shopper report` header, `spacing/16` margins,
the content column capped at `max-content-width`, the bottom inset added to
the content padding. Each step is a `caption` progress line in
`text/secondary` (`Question 1 of 3`, from the presentation contract), the
question in `heading-2` as a header, the answers as Choice Rows in one radio
group named by the question, and the actions — `Back` as a secondary pill
after the first step, `Next` as the primary pill, inert until the question
is answered. The single-state confirm carries its one line of context in
`body-small` above `Yes` / `No`. The jurisdiction picker lists the notice's
own states and, past eight of them, puts the shared Search Bar above the list
(`Search states`, with a spoken instruction; it filters the rows and is
never an answer; an empty match says `No state matches that search.`). The
review step is `Review your report` in `heading-2` over one white
`radius/12` surface with a `border/subtle` border, one row per question
asked (the question in `caption` `text/secondary`, the answer in `body`),
separated by hairlines; then the disclosure: the sentence as static
`body-small` `text/secondary` text, and `Learn more.` beneath it in
`action/secondary` as the one interactive element — a link with its own
spoken name and hint and its own 44pt row, because the statement itself is
not a control; then `Back` and the primary action (`Submit
report`, or `Update report` while editing); a refused submission renders its
message beneath them as an alert on the white surface with a `border/strong`
border, with every answer kept; and, only while editing, the `Remove my
report` secondary pill, which opens the platform's own confirmation. The
three endings — submitted, declined, removed — are the contract's title in
`heading-2` over its body in `body` `text/secondary`, announced politely,
with `Done` as the primary pill. The paused state is the contract's sentence
over the removal pill alone. Loading and not-available are the shared
`StateMessage`. IBM Plex Mono appears nowhere on the screen; nothing is
truncated; no height is fixed; the scroll view keeps the search field above
the keyboard and dismisses it on a drag; and no transition is animated, so
Reduce Motion has nothing to disable beyond the platform's own screen
transition. The dev-only Design Preview renders the same step components in
a gallery and opens the real screen for every flow (`docs/recall-design-preview.md`).

Unknown geography, as implemented: nothing renders and nothing is asked.
`evaluateReportEligibility` refuses a notice with no usable jurisdiction, so
`communityReportsSection` is null, Recall Detail draws no community block,
and `/report/[id]` reached by a deep link shows its own `Not available`
state. The presentation contract models no timeframe-only flow at all — the
state question is unconditional, and `questionnaireOutcome` reports the
state question as outstanding rather than building a draft without a
jurisdiction. The server's requirement for a notice-authorized jurisdiction
is unchanged and remains authoritative.

### Detail disclosure behavior

Jurisdictions (Where It Was Sold):

- Five or fewer: show all.
- More than five: show the first five and `See all (N)`.
- Expanded action: `Show less`.
- Do not reorder values — a collapsed list is always a prefix of the expanded
  one, in the source's order.

Affected products:

- Initially show the first product row.
- If more exist, show `See all (N)` beside the section heading.
- Expanded action: `Show less`.

Multi-value cells:

- Show the first two values.
- More than two uses that cell's own independent `See all (N)` control.
- Explicit identifier/date pairs remain aligned line-for-line: line _n_ of the
  code column sits level with line _n_ of its date column, and an undated
  code keeps a blank line so nothing below it shifts.
- A paired group expands and collapses together; one column can never move
  alone.
- Never reconstruct pairs by array position. A pair exists only where the
  source stated it.

## Consumer copy

Rules for the sentences Lotly writes itself — screen intros, helpers, status
lines, hints, empty and error states (P2B6A follow-up). They do not apply to
official recall language, agency text, product data or sourced notice
content, which is never rewritten under them, and they are applied screen by
screen, never by a blind repository-wide replacement.

- No em dashes in authored consumer copy. Use a full stop, a comma or a new
  sentence.
- Prefer short, direct sentences. Give each sentence one clear job.
- Use concrete language that says what Lotly does (`Lotly flags recalls that
name them`), not what it means to do.
- Avoid vague phrases such as `in a way that matters`.
- Avoid defensive or promotional constructions such as `nothing else` or
  `no marketing` used as reassurance; state the fact once (`Lotly does not
send marketing notifications.`).
- Avoid `simply`, `just`, `easy` and unnecessary reassurance.
- Do not over-explain routine controls; a search field or a Done action
  needs no sentence of its own beyond its hint.
- Name the product `Lotly` where the product is meant; keep the common noun
  `recall` for a product recall.

Applied (P2B6A) to Personalization and Notifications, and (P2B6C,
2026-09-16) to every other authored string: the Feed, Saved, Detail, the
questionnaire, Profile, the reset, the push bodies and the seven trust
documents. The audit that preceded P2B6C added these rules, which
`src/lib/consumer-copy.test.ts` pins:

- **Terminology.** `Lotly` for the product; `recall` for the event;
  `official notice` for the agency document and `official source` for its
  link; `Public Health Alert` for the FSIS notice type; `risk level`;
  `personalization`; `recall alerts` for the feature and `notifications`
  only for the OS permission and the `Notifications` title; `saved recalls`;
  `shopper report` in the flow and `community shopper reports` for the
  section; `state` (the catalog includes DC and Puerto Rico) and `store`,
  never `jurisdiction` or `retailer`; `delete my data` for the outcome, with
  `Reset app and delete my data` as the frozen action. `Affects me` in prose
  and controls, `AFFECTS YOU` on the relevance label alone, `How Affects Me
Works` as the document title; `All recalls` in prose and `All` on the
  chip. The compact exceptions stay: `All`, `Risk`, `Saved`, `AFFECTS YOU`.
- **Failure boundaries.** Feed, Saved, Detail and Notifications never render
  a raw error message, HTTP status or operator instruction. Each has one
  consumer sentence (`Lotly couldn’t reach the recall service. Check your
connection and pull down to try again.` / `Lotly couldn’t load this
recall. Check your connection and try again.` / `Lotly couldn’t update
your alert settings. Check your connection and try again.`) and the cause
  goes to the development console. An empty corpus reads `No recalls loaded
yet` / `Pull down to refresh.`
- **Accuracy.** Copy describes what the product renders: Detail shows the
  canonical Risk Label and the official notice link, not the official
  classes; a material change shows as the `Update` line and the `Updated`
  date, not a timeline. While the shopper-report gate is off, the documents
  say `When community shopper reports are available for a recall…` rather
  than describing the feature as universal.
- **Hints.** Authored accessibility hints end with a full stop and add
  something the label does not; state lives in `accessibilityState` and is
  not repeated in the label (`Remove from Saved`, with `selected`).
- Interim launch placeholders were removed, not resolved: the privacy lead
  no longer promises a formal policy and the Corrections Policy no longer
  promises a support contact. Both destinations stay open blockers in
  `docs/recall-launch-blockers.md`, and nothing was invented in their place.
- **Two onboarding exceptions (P2B7X.1).** The founder's final first-launch
  copy says `retailers` in the Retailers step's body (`Choose the retailers
you want Lotly to watch for in recall notices. This is optional.`) and in
  the Preview summary's row label (`Retailers`). Both are exempt by exact
  string in `consumer-copy.test.ts`, as Detail's `Retailers:` is; every other
  onboarding string keeps `store`. The onboarding, paywall and education copy
  otherwise follows every rule above and lives in `src/lib/onboarding-copy.ts`
  and `src/lib/paywall-screen.ts`.

## Interaction states

Every reusable component defines these states; a screen may not leave one to
chance.

- **Loading** — a plain secondary-text message (`Loading…`) in the content
  column; no skeleton chrome, no spinner-only screens. Nothing that could be
  mistaken for real recall content renders while data is absent. The Feed's
  and Detail's loading states (the shared `StateMessage`) are also polite
  live regions that announce their title once, so a screen-reader user hears
  that the screen is loading.
- **Empty** — a `heading-3` title with a `body-small` secondary explanation and
  the one relevant action (for example the Feed's "No matching recalls" with
  "Clear all"). Never an empty white card.
- **Error** — the same shape as empty, with the honest message and no
  fabricated fallback content. A missing or failed image **removes the tile**
  everywhere — the card's media column, Detail's header, an affected-product
  row's thumbnail — and never shows a broken-image glyph or a grey
  placeholder square (P2B7I). Inside a paged image set, failure is **per page
  and removes the page**: it leaves the set, every healthy image after it
  stays reachable, the indicator never counts it, and when the last one goes
  the header returns to its no-image shape. A failure is
  settled once and remembered for the session — no retry, no remount, no
  flicker as a list recycles. An image has no loading state of its own
  beyond holding its square on the placeholder colour while the request is
  active, so none can be left stuck.
- **Disabled** — carried by the SURFACE, with `accessibilityState.disabled`
  set so the state is announced, not just dimmed: a filled action drops to
  `action/disabled`, an outlined one keeps its surface and mutes its border to
  `border/subtle`. **A disabled label stays readable.** `text/disabled` is a
  fill-and-border grey, not a text colour — it is 1.45:1 on the disabled fill
  and 1.45:1 on white — so a disabled label takes the existing semantic text
  token that clears WCAG AA on the surface it actually sits on: `text/primary`
  on `action/disabled` (11.40:1) for a filled action, `text/secondary` on
  `background/surface` (4.83:1) for an outlined one. No new token was
  introduced; `design-foundation.test.ts` recomputes both ratios from the
  token values, so a palette change that broke either one fails there.
- **Pressed** — a brief opacity reduction on the pressed element (60% is the
  primitives' value); no color change that could read as a state change.
- **Selected** — `background/brand` with `text/inverse` for chips and tabs,
  and `accessibilityState.selected` (or `checked` for multi-select rows) set.
  Selection is never carried by color alone: the label or a check mark also
  changes. A single-choice answer (the questionnaire's Choice Row, P2B3)
  keeps its white surface and turns its border `action/primary` while its
  radio indicator fills — the filled dot is the non-colour channel — and
  reports `accessibilityState.checked`. A multi-choice option (the Check
  Row, P2B6A) does the same with a square indicator that fills and draws a
  check mark, under the `checkbox` role.
- **Busy** — a control whose operation is in flight is inert, reports
  `accessibilityState.busy`, and swaps its visible word for the contract's
  progress word (`Sending…`, `Removing…`), so the state is announced and
  seen, never only dimmed.

## Accessibility

- **Minimum interactive target: 44×44pt.** A control whose visible footprint
  is smaller grows through `hitSlop`; a layout may never leave a target short.
  The token is `hit-target.minimum` and shared primitives derive their slop
  from it.
- **VoiceOver labels.** Every interactive element has an accessibility label
  that names its action (`Save this recall`, `See all 10 states`), and
  every status label announces its meaning (`Risk level: High`) rather than
  its visible text. Icon-only controls always carry a label.
- **Expanded/collapsed state.** Every disclosure control sets
  `accessibilityState.expanded`, so its state is announced and its visible
  word (`See all (N)` / `Show less`) changes with it.
- **Position in a set.** An image that is one page of a set keeps its own
  factual label (the product name) and carries its position as the element's
  `accessibilityValue` — `Image 2 of 15` — so a reader hears where they are
  without a visible caption. The indicator, dots or counter alike, is
  decoration and is hidden outright (`accessibilityElementsHidden`,
  `importantForAccessibility`), so `2 / 15` is never read as a fraction.
- **Never describe a picture from its pixels.** An image's spoken label comes
  from the model's own supported identity — never from a source caption, and
  never from anything inferred about the image itself.
- **Dynamic Type and text wrapping.** Text scales with the user's setting; no
  `maxFontSizeMultiplier` caps anywhere. Product names, summaries, and cell
  values wrap rather than truncate; only a paired identifier/date line is
  capped to one line, so the two columns stay aligned. Layouts must survive a
  200% text size without overlapping or clipping. **Fixed-height chrome grows
  with the text rather than capping it.** The navigator header is the worked
  example: its title is `heading-3` and scales, so the bar carries a
  `minHeight` of the scaled line box plus its padding, floored at
  `layout.navHeaderHeight` (44) and offset by the status-bar inset, instead of
  the platform's flat 44pt that clipped Feed and Saved at the accessibility
  sizes. A fixed `height`, a capped multiplier, or a `lineHeight` handed to a
  scaling title would each reintroduce the clipping.
- **Reduced motion.** The system has no essential motion: disclosures grow in
  place, tabs switch without animation, and the only motion is the platform's
  own navigation transition, which respects the Reduce Motion setting, and
  Welcome's one-time entrance. That entrance, and any future animation, is
  skipped when `AccessibilityInfo.isReduceMotionEnabled` reports true (or
  cannot be read): everything is shown in its final state at once.
- **Color is never the only channel.** Risk carries its word, relevance its
  word and flag, selection its check or label change.
- **Contrast.** Maintain WCAG AA for normal text: `text/primary` and
  `text/secondary` on every page and surface token, and each risk foreground on
  its own background.
- **Safe areas** — see "Layout → Safe areas".

## Implementation guardrails

### Do not copy generated code from Figma

Figma's design-context export is React + Tailwind (`<div className="flex
gap-[var(--spacing/12,12px)] …">`). It is a **reference for values and
composition only**. Copying it, or any DOM markup, Tailwind class, CSS
variable, shadcn primitive, or web-only accessibility pattern (`aria-*`,
`role=`) into this React Native app is prohibited. Every screen is built from
React Native views, the tokens, and the shared primitives below.

### Do not copy accidental fractional values

Several Figma nodes carry values produced by scaling a group, not by a
decision. They are normalized to the scale and never reproduced:

| Figma value                    | Where                          | Normalized to              |
| ------------------------------ | ------------------------------ | -------------------------- |
| `17.786px` semibold            | card product title             | `heading-3` (19/600)       |
| `11.233px` medium              | card brand, card location text | `caption` (12/500)         |
| `12.169px` regular             | card summary                   | `body-small` (13/400)      |
| `14.978px` gap                 | card content ↔ footer          | `spacing/16`               |
| `11.233px` gap                 | card media ↔ text              | `spacing/12`               |
| `7.489px` gap                  | card title block ↔ summary     | `spacing/8`                |
| `3.744px` gap, `10px` gap      | card location icon gap, card   | `spacing/4`, `spacing/8`   |
| `13.106px`, `18.722px`, `15px` | pin icon, bookmark, ext. link  | `icon-size/12`, `20`, `16` |
| `194.711px` text column        | card                           | flex remainder             |
| `202.437px` title width        | Detail title column            | flex remainder             |
| `38px` + `48px` nav padding    | bottom navigation              | equal distribution         |
| `115px` media tile             | card                           | `card-media-size` (112)    |
| `36px` default chip            | Nav-Chip (Default)             | 32, the selected height    |
| `150px` hero tile              | Detail header                  | `detail-media-size` (152)  |
| `79–119px` per-column widths   | Product-Information            | `table-column-width` (144) |
| `10px` medium cell values      | Product-Information            | `caption` (12/500)         |
| `40px` Detail top padding      | Detail frame                   | the navigator's header     |

### Extend the existing theme; do not build a parallel one

- Tokens live in `src/constants/design-tokens.ts` (a leaf module: no React
  Native runtime import, no CSS, no I/O) and are re-exported from
  `src/constants/theme.ts`, which remains the app's one theme entry point.
- The legacy provisional values in `theme.ts` (`Colors`, `Spacing`, `Radii`,
  `Fonts`) still serve un-migrated screens. They are not extended. Each
  screen's design milestone moves it onto the tokens.
- Shared primitives live in `src/components/ui/` and consume tokens only:
  `Text` (variant + semantic color), `Surface` (semantic background, radius,
  border, elevation), `DisclosureControl`, `RiskLabel`, from P2B1 `Icon`
  (a glyph from the exported set, an icon-scale size, an icon colour),
  `RelevanceLabel`, `Chip` and `SearchBar`, and from P2B2 `MediaTile` (a
  square image-or-placeholder at one of the three media-size tokens),
  `Callout` (the two Information tones) and `NoticeLabel` (the Public Health
  Alert label), from P2B7C `OfficialImageSet` (the complete set of official
  images, static or manually paged, in a compact or evidence footprint), and
  from P2B3 `Button` (the 44pt primary / secondary pill,
  with disabled and busy states) and `ChoiceRow` with `ChoiceGroup` (a
  single-choice answer row and its radio group), and from P2B6A `CheckRow`
  (the multi-choice sibling). The whole-screen `StateMessage`
  (`src/components/state-message.tsx`) is shared by the Feed and Detail. A
  reusable component contains no hex literal, no off-scale number, and no
  font size of its own.
- Use existing Expo Router / React Native patterns. No Tailwind, NativeWind,
  styled-components, CSS variables, DOM elements, or new state or UI
  libraries.
- Preserve the 393px composition while laying out against the real device
  width and safe areas.

### React Native mapping

| Token family            | React Native property                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background/*`          | `backgroundColor` on a View (`Surface`)                                                                                                                 |
| `text/*`, `action/*`    | `color` on a Text (`Text color=`); `action/secondary` is the link/disclosure color                                                                      |
| `border/*`              | `borderColor` with `borderWidth: 1`                                                                                                                     |
| `icon/*`                | the icon component's `color`                                                                                                                            |
| `risk/*`, `relevance/*` | `backgroundColor` + `borderColor` on the label View, `color` on its Text                                                                                |
| `spacing/N`             | `padding*`, `margin*`, `gap`, `rowGap`, `columnGap`                                                                                                     |
| `radius/N`              | `borderRadius`                                                                                                                                          |
| `elevation/card`        | `shadowColor #000000`, `shadowOffset {0, 2}`, `shadowRadius 8`, `shadowOpacity 0.06`, Android `elevation 2`                                             |
| typography token        | `fontSize`, `lineHeight` (points), `letterSpacing` (points), and `fontWeight` — or `fontFamily` set to the registered face once the fonts are installed |
| `icon-size/N`           | `width` and `height`                                                                                                                                    |
| `hit-target.minimum`    | `minHeight`/`minWidth`, or `hitSlop` from `hitSlopToMinimum(visibleHeight)`                                                                             |

### Figma ↔ code mapping

| Figma                                    | Code                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `home` frame `81:793`                    | `src/app/(tabs)/index.tsx` — the **Feed**                                 |
| `product information` frame `81:819`     | `src/app/recall/[id].tsx` — Recall Detail                                 |
| `nav bar` `163:259`                      | `src/app/(tabs)/_layout.tsx`                                              |
| `Search-Bar` `33:429`                    | `src/components/ui/search-bar.tsx`                                        |
| `Nav-Chip` `33:445` (Default / Selected) | `src/components/ui/chip.tsx` (the mode pair and filter chips)             |
| `Risk Label` `42:833` (seven severities) | `src/components/ui/risk-label.tsx`                                        |
| `Relevance Label` `42:840`               | `src/components/ui/relevance-label.tsx`                                   |
| `icon/*` glyphs                          | `src/components/ui/icon.tsx` over `assets/icons/`                         |
| `Recall-Card` `42:987` (2×2 matrix)      | `src/components/recall-card.tsx`                                          |
| `Information` `81:681` (Warning / Info)  | `src/components/ui/callout.tsx` (P2B2)                                    |
| `Product-Information` `81:719`           | `AffectedProductsTableView` in Recall Detail                              |
| `See all (3)` / `View Retailers (10)`    | `src/components/ui/disclosure-control.tsx`                                |
| Detail hero `81:838`, card media         | `src/components/ui/media-tile.tsx` (P2B2)                                 |
| — (no multi-image frame; conflict 30)    | `src/components/ui/official-image-set.tsx` (P2B7C)                        |
| `icon/chevron-left` `63:1343`            | the platform back control (`headerBackButtonDisplayMode`)                 |
| `share` `63:1358`                        | **not rendered** — no behaviour (conflict 9)                              |
| `label/Critical` `42:832`                | **retired** — nothing in code                                             |
| text styles                              | `typography` in `design-tokens.ts` (`Text variant=`)                      |
| `Elevation/Card`                         | `elevation.card`                                                          |
| color / spacing / radius variables       | `color`, `spacing`, `radius` in `design-tokens.ts`, same names            |
| — (no questionnaire frame; conflict 26)  | `src/app/report/[id].tsx`, `src/components/report-questionnaire.tsx`      |
| — (no button or radio component)         | `src/components/ui/button.tsx`, `src/components/ui/choice-row.tsx` (P2B3) |
| — (no Profile frame; conflict 27)        | `src/app/(tabs)/profile.tsx`, `src/components/profile/` (P2B5)            |
| — (no settings frame; conflict 28)       | `src/app/settings/*.tsx`, `src/components/settings/`, `ui/check-row.tsx`  |
| — (no document frame; conflict 29)       | `src/app/document/[slug].tsx`, `src/components/document/` (P2B6B)         |

### Development gallery

The dev-only Design Preview hub (Profile → Development → Design Preview;
`docs/recall-design-preview.md`) renders the primitives from the tokens — the
type scale, three surfaces, the disclosure control, and all seven risk labels
through the real `riskView` pipeline — and, from P2B1, the Feed's card matrix
(the four relevance × media states, the longest live product name and
summary, nationwide and multi-state geography, and the Public Health Alert
notice label, each on a real current recall) plus the Feed's controls and
state messages with their real copy; and from P2B2, Detail's state messages
and the two callout tones, plus twenty-two further scenarios that open the
real Recall Detail on a real recall chosen for its shape — with and without
a hero, short and long names, nationwide, every reviewed hazard guide, the
risk-only and absent Health Risk states, complete and incomplete
identifier/date groups, and one recall per risk tier; and from P2B3 the
questionnaire's steps and states drawn by the real step components (the
single-state confirm, the multi-state and searchable nationwide pickers, the
stateless shape, the store and timeframe questions, review in both modes,
the refused submission, success, and the paused state) plus scenarios that
open the real questionnaire for every flow; and from P2B4 Saved's
whole-screen states with their real copy, both of its information notices,
and its list drawn by the same shared `RecallCard` over real recalls chosen
for the shapes a saved list has to survive (one item, several, a long
product name, no image, nationwide, multi-state, a Public Health Alert, and
one card per risk label the live corpus holds) — a gallery that neither
reads nor writes this device's saved list; and from P2B5 the live
Profile's own components, imported from production — the featured
Personalization card in every answer the store can give (loading, empty,
populated, long-and-summarized, read failure), a grouped section with the
chevron rows and the value row, and the development entry — each handed the
simulated answer its caption names, reading and writing no preference; and
from P2B6A the Personalization sections and selectors and the
Notifications panel, imported from production — the form loading, empty,
populated and after a read failure; the state row with no selection and
with one, and the state selector's contents searched, cleared while open,
and replacing a selection; the store row with none, several and long
names, and the store selector's contents with no query, filtered, with
several checked rows staying in place, and with no results, each sample's
preferences held in the gallery's memory; and the panel loading, not
determined, enabled, denied-but-askable, requiring system settings,
unsupported, and after a failed operation, its actions wired to nothing —
so no sample can save a preference, register a token, raise the system
prompt or contact a backend; and from P2B6B the trust documents' shared
renderer and blocks over the registry's own content — the shortest and the
longest registered document in full, one real section, one real block of
each kind (bullets, a document link, an external link, a note, the
risk-label rows), the warning callout for comparison — and the reset panel
idle, confirming (the dialog's words as text), busy, succeeded and failed,
its press wired to nothing, so no sample can open the confirmation or start
a deletion; and from P2B7X.1 every first-launch screen and every paywall
state — Welcome, the three selector steps empty, selected and searched, the
retailer rows with the fallback and two neutral fixtures at extreme ratios,
the Preview with and without optional selections, the education idle and
enabling, the paywall in twelve views including a long localized price
pair, and a 568pt viewport — each sample's state held in the gallery's
memory, plus gate scenarios that restart the REAL flow from a chosen state.
Only the values each caption names are simulated.
It is not a product surface.

## Known Figma/code conflicts

Recorded so nobody resolves them by accident. Code wins on behavior and copy;
Figma wins on composition; open items are the founder's.

1. **Critical label.** Detail (`81:828`) instantiates the obsolete
   `label/Critical` (`tomato/500`, white text). Canonical is
   `Risk Label / Severity=Critical` (`156:218`). Code renders the canonical
   treatment; Figma
   is corrected (see below).
2. **Screen name.** Figma `home`; product `Feed`. Code and this contract use
   Feed.
3. **Bottom navigation labels.** Figma shows icons only. **Resolved
   (2026-09-14):** the bar shows visible `Feed` / `Saved` / `Profile` labels;
   icons are added beside them once an icon set is chosen, never instead.
4. **Health Risk.** Absent from the Figma Detail frame; shipped between Where
   It Was Sold and Affected Products and stays.
5. **`View Retailers (10)`.** Figma's Where It Was Sold action. The shipped
   product renders the full jurisdiction list with the `See all (N)`
   disclosure and no retailer list (retailers are a deferred milestone). The
   disclosure pattern applies; the retailer action does not exist.
6. **Community line.** Figma: `12 shoppers reported finding it here.` (period,
   link-styled, no action). Product: no period, followed by the
   `Add your report` / `Edit your report` action, plus the below-threshold
   question state. Copy is the contract's.
7. **Informational callout above Affected Products.** Figma shows
   `Check your package for the lot code and the best buy date near the barcode.`
   The P2a
   founder decision removed helper prose from Affected Products; the product
   renders no such callout. Reinstating it is a founder decision, not a
   design one.
8. **Detail risk label text.** Figma shows `CRITICAL`; the shipped Detail
   headline used to read `CRITICAL RISK` for rated tiers. **Resolved
   (2026-09-14):** the visible label is exactly the canonical word on every
   surface; the suffix is retired and the closed vocabulary is pinned.
9. **Save control placement.** Figma puts the bookmark in the Detail header;
   the shipped Detail renders the shared save control in the body beside the
   recall's identity. **Resolved (P2B2):** it stays in the body, at the
   trailing edge of the status row, the one shared control with its visible
   word (the P2A founder decision: the navigation header carries only
   navigation). The header's share icon has no product behavior and is not
   implemented.
10. **Feed mode vs. chips.** Figma renders `Affects me` as a chip in the filter
    row; the product has a separate All / Affects me mode control and hides
    filters in Affects me mode. **Resolved in composition (P2B1):** one chip
    row, the mode pair first and a hairline before the All-only filters;
    behavior unchanged.
11. **Feed header bell.** No product behavior is defined for it (notification
    settings live under Profile). Not rendered (P2B1) until one is.
12. **Feed heading.** Figma `Recent recalls`; product `Recent activity` /
    `Older active notices` / `Affects me` from the presentation contract. The
    contract's words render in the design's `heading-3` (P2B1).
13. **Search placeholder.** Figma `Search product, brands, or recalls.`;
    shipped `Search product, company, brand, or code` (the field genuinely
    matches codes). Copy decision pending; the shipped string stands.
14. **Dark mode.** Not in the approved system. **Resolved (2026-09-14):** the
    app is locked to light (`userInterfaceStyle: light`, root theme pinned);
    dark mode is deferred until it has approved tokens and designs.
15. **Callout and table shadows.** Figma gives callouts and the product table
    `0 2px 4px 6%` and the nav bar `0 -2px 8px 8%`; only `elevation/card` is a
    token. Either bind them to `Elevation/Card` or approve named effect styles.
    The implemented bar, callouts and table (P2B2) use surface colour and the
    `border/subtle` hairline with no shadow.
16. **Save control on the card.** Figma showed the bookmark glyph alone; the
    product showed the glyph beside a visible `Save` / `Saved` word (a P2A
    founder copy decision). **Resolved (P2B7H) in Figma's favour** — node
    `81:792`: the control is the bookmark alone on cards and on Detail
    alike. The state's non-colour channel is now the glyph pair (outline /
    filled), and the wording lives in the accessible contract (an action
    label plus `accessibilityState.selected`). No conflict remains.
17. **Feed header and filter glyph.** Figma's frame has no title bar, a bell
    at the top right and a sliders glyph leading the chip row. The product
    keeps the navigator's `Feed` title bar (on the page colour, no shadow)
    and renders neither glyph, because neither has behaviour.
18. **`Urgency` chip.** Figma's third filter chip; the product's is the
    shipped `Risk` filter, and reads `Risk`.
19. **Public Health Alert notice label.** Shipped on the card ahead of Figma
    (`background/subtle`, `border/default`, `label` type, beside the risk
    label). Figma should add it (see the corrections below).
20. **Search clear affordance.** Figma's bar has no clear state; the product
    shows an explicit `Clear` control while the field holds text.
21. **Detail body copy colour.** Figma sets the What Happened paragraphs and
    the jurisdiction line in `text/secondary`; the product renders section
    bodies in `text/primary` and mutes only the `Update` line (the shipped
    rule, pinned by the wiring suite). Safety-critical narrative is not
    secondary text.
22. **Detail section headings.** Figma `What Happened` / `Where It Was
Sold`; the shipped titles were sentence case and rendered uppercase.
    **Resolved (P2B2):** the four headings render in the design's title case
    in `heading-3`.
23. **Table cell values.** Figma's `Product-Information` sets values in
    `micro-caption` (10px); the product renders them in `caption` (12px) —
    a lot code or date is checked against a package, not glanced at. The
    same reasoning now governs the **card's activity date** (P2B7H): it was
    `micro-caption`, measured smaller than the brand and category beside
    it, and read as a footnote; it is `caption`, matching Detail's status
    row, so Feed, Saved and Detail carry one metadata hierarchy.
24. **Jurisdiction reveal placement.** Figma's `View Retailers (10)` sits on
    the Where It Was Sold heading row; the product's jurisdiction `See all
(N)` takes that place (the retailer action does not exist; conflict 5).
25. **Detail navigation row.** Figma draws its own chevron, share and
    bookmark row inside the frame with `40px` top padding; the product keeps
    the navigator's header (title `Recall Details`, page colour, no shadow)
    with the platform chevron alone as the back control, named `Back` for
    assistive technology, and no share glyph.
26. **The questionnaire is not in Figma.** The `Final` page holds the Feed
    and Recall Detail frames only; the shopper-report questionnaire, its
    review, endings and paused state have no frame, and the file has no
    button or radio-row component. P2B3 composed them from the system —
    the tokens, the type scale, the Search Bar, and the two new primitives
    — following the Feed sheet's pill actions. When frames arrive, Figma
    owns the composition and this document records any conflict; the
    behaviour and copy stay the contract's.
27. **Profile is not in Figma.** No Profile frame, settings row, grouped
    list or right-pointing chevron exists in the file. P2B5 composed the hub
    from the system — the tokens, the type scale, the card surface and lift,
    the `flag` glyph, and a `chevron-right` derived from the `chevron-down`
    export (see "Iconography") — in the hierarchy the founder chose from the
    Phase 1 explorations. When a frame arrives, Figma owns the composition
    and this document records any conflict; the hierarchy, the read-only
    preference summary and its display rules stay the contract's.
28. **Personalization and Notifications are not in Figma.** No settings
    frame, checkbox row, disclosure trigger or status panel exists in the
    file. P2B6A composed both screens from the system — the tokens, the
    type scale, the Search Bar, the Button, the Choice Row, the information
    Callout, the shared state message, one new primitive, the Check Row
    (the Choice Row with a square indicator), because the system had no
    multi-choice control that carries its state by shape, and a native
    page sheet (`SelectorSheet`) for the two long selection lists. When frames
    arrive, Figma owns the composition and this document records any
    conflict; the behaviour, the storage and permission boundaries and the
    copy stay the contract's.
29. **The trust documents are not in Figma.** No reading page, document
    title, note, label row or link row exists in the file. P2B6B composed the
    document page from the system — the tokens, the type scale (`heading-1`
    for the one full title on a page, its first use), the information
    Callout, the Risk Label, the Button, the shared state message and the
    external-link treatment Recall Detail already had — and added no new
    primitive and no destructive token. When frames arrive, Figma owns the
    composition and this document records any conflict; the registry, its
    slugs, claims, links and the reset's behaviour stay the contract's.

30. **Multi-image Detail media is not in Figma.** The Detail frame draws one
    hero tile (`81:838`), which was the whole imagery contract while a recall
    could show one official photo. **Founder decision, P2B7C:** where a
    notice publishes several official FDA product photos, Detail pages
    through ALL of them in that same tile position — no cap (P2B7I) — with
    one dot per image up to five, a sliding five-dot window beyond that, and
    the compact `current / total` counter added beside the dots, never
    replacing them. Feed imagery is unchanged and
    stays single-image, showing the same stored hero that leads Detail's set.
    Nothing else about the tile moved: same position, same
    `detail-media-size` square, same `contain`, same placeholder, same
    no-image treatment. The set is composed from the system (the media tile,
    the tokens, the `caption` type) and added one primitive
    (`OfficialImageSet`) and one layout token (`page-dot-size`). FSIS label
    galleries were built here and removed by founder decision — see "Official
    label pages are not rendered". When a frame arrives, Figma owns the
    composition of the dots and the counter; the official order, the
    reachability rule and the placements stay the contract's.

## Figma corrections for Cheyenne

Changes to make in Figma itself. Nothing here changes product behavior.

- [ ] On `product information` (`81:819`), replace the `label/Critical`
      instance (`81:828`) with `Risk Label / Severity=Critical` (`156:218`),
      then delete the `label/Critical` symbol (`42:832`) and its `tomato/500`
      / `tomato/300` bindings. Keep `CRITICAL` as the visible label.
- [ ] Rename frame `home` (`81:793`) to `Feed`. Rename `product information`
      (`81:819`) to `Recall Detail`.
- [ ] Bind the `home` frame's page fill to `background/page` (it is a raw
      `#fdfcf6`).
- [ ] Add `radius/4`, `radius/12` and `radius/16` variables and rebind the
      corners currently bound to `spacing/4` (labels), `spacing/12` (search
      bar) and `spacing/16` (recall card). Only `radius/8` and `radius/full`
      exist today.
- [ ] Rebind misused tokens: Nav-Chip fills and text use `icon/primary` /
      `icon/inverse` → `background/brand` / `text/inverse` (selected) and
      `background/surface` / `text/primary` (default); the search placeholder
      uses `icon/secondary` → `text/secondary`; callout text uses
      `background/brand` → `text/primary`; the card's location text uses
      `icon/primary` → a text token.
- [ ] Recall-Card: replace the scaled values — title `17.786` → `Heading 3`,
      brand and location `11.233` → `Caption`, summary `12.169` →
      `Body Small`, gaps `14.978 / 11.233 / 7.489 / 3.744 / 10` →
      `spacing/16 / 12 / 8 / 4 / 8`, icons `13.106` → 12 and `18.722` → 20, and
      let the text column
      fill rather than fixing it at `194.711`.
- [ ] Recall Detail: `202.437` title-column width → fill; external-link icon
      `15` → 16; the Where It Was Sold pin `13.106` → 12; top padding `40` →
      a safe-area placeholder plus a spacing token (Feed's `48` likewise).
- [ ] Add the missing Detail section **Health Risk** between Where It Was Sold
      and Affected Products (body copy, an optional higher-risk line, an
      optional `COMMON SYMPTOMS` bulleted list, an optional source link).
- [ ] Replace `View Retailers (10)` with the jurisdiction disclosure
      (`See all (N)` / `Show less` after five states) or remove it; add the
      per-cell `See all (N)` control and a paired code/date column example to
      `Product-Information`.
- [ ] Community block: drop the period, add the `Add your report` action
      beneath the count, and add the two other states — below threshold
      (`Did you find this product here?` + `Add your report`) and existing
      report (`Edit your report` alone).
- [ ] Remove the informational callout above Affected Products, or flag it
      for the founder (conflict 7).
- [ ] Add the Public Health Alert notice label to Recall-Card and Detail, the
      retracted-notice callout, and Pending / Unknown card examples.
- [ ] Bottom navigation: name the three tabs `Feed`, `Saved`, `Profile` in
      the layer names; replace the `38 + 48` padding with equal distribution;
      show the `Feed` / `Saved` / `Profile` labels beneath the icons
      (decided: labels are visible).
- [ ] Nav-Chip: settle on one height (32 or 36) for the row — code uses 32.
- [ ] Nav-Chip: rename `Urgency` to `Risk`, remove or give behaviour to the
      leading sliders glyph and the header bell, and add the `Clear all` chip
      and the `Location · 2` counted state.
- [ ] Search-Bar: add the filled state with its trailing `Clear` control.
- [ ] Recall-Card: normalize the media tile to 112, add the Public Health
      Alert notice label beside the risk label, and set the activity date in
      `Caption` rather than `Micro-caption` (conflict 23). The save control
      needs no change — P2B7H adopted Figma's icon-only bookmark
      (conflict 16, resolved).
- [ ] Bind callout, product-table and nav-bar shadows to `Elevation/Card` or
      add named effect styles (conflict 15).
- [ ] Add screens that exist in the product but not in Figma: Saved, Profile,
      the questionnaire (state / retailer / timeframe / review / success —
      built in code in P2B3 from the system; see conflict 26 and
      "Questionnaire → As implemented" for the composition to draw), and
      the Feed's loading, empty and error states.
- [ ] Add a `Button` component (primary brand-navy pill, secondary bordered
      white pill; 44pt; disabled and busy states) and a `Choice Row`
      component (white `radius/12` row with a radio indicator; default and
      checked), matching `src/components/ui/button.tsx` and
      `src/components/ui/choice-row.tsx`.
- [ ] Recall Detail: set the section bodies and the jurisdiction line in
      `text/primary` (conflict 21); set the table values in `Caption`
      (conflict 23); normalize the hero to 152 and the columns to one 144
      width; move the bookmark control from the utility row to the status
      row, and remove the share glyph (conflict 9); replace the frame's own chevron row with a navigator header
      placeholder (conflict 25); and add the no-image header, the retracted
      information callout, and the loading / not-found / load-failure
      states.

## Do's and Don'ts

- **Do** use semantic design tokens before raw palette values.
- **Do** preserve the warm cream page background and white-card hierarchy.
- **Do** use navy to communicate trust, structure, and important interaction.
- **Do** keep severity color vivid enough to scan quickly.
- **Do** keep `Affects You` visually prominent and semantically separate from
  severity.
- **Do** use Public Sans for normal interface language and IBM Plex Mono only
  for compact structured metadata.
- **Do** preserve the full Recall Card state matrix for relevance and media
  availability.
- **Do** render a neutral media placeholder when no product image exists.
- **Do** keep the Affected Products table horizontally scrollable inside its
  own clipped viewport.
- **Do** populate the official-source agency from recall data.
- **Do** preserve current business logic and supported data fields when
  implementing from Figma.
- **Do** maintain WCAG AA contrast for normal text.
- **Do** give every interactive element a 44pt target and a spoken label.
- **Do** keep every product route inside its access phase's protected group
  in the root layout (P2B7X.1): a screen the navigator does not have is the
  only kind a deep link, a tab or a notification cannot reach.
- **Do** render prices exactly as the store supplies them, and derive the
  saving and the monthly equivalent from the store's amounts.

- **Don't** interpret lime as low risk, safety, success, or resolution.
- **Don't** use green as part of the recall-severity scale.
- **Don't** hardcode `FDA` as the source agency.
- **Don't** allow the Affected Products table to make the entire screen
  scroll sideways.
- **Don't** reserve a media footprint on a no-image Recall Card: the media
  column is absent, and the text takes the width (P2B7I). Don't fill the
  absence with a placeholder square, stock or generated imagery, a mascot,
  an "image unavailable" illustration, or a pressable stand-in.
- **Don't** use raw primitive colors in reusable components when a semantic
  token exists.
- **Don't** introduce arbitrary spacing or corner-radius values when a defined
  token works.
- **Don't** copy Figma's generated React/Tailwind, DOM markup, or CSS into
  React Native.
- **Don't** add a fourth navigation destination or call the Feed "Home".
- **Don't** remove or reorder shipped product information because Figma lacks
  it.
- **Don't** add sirens, shields, emergency-alert motifs, or government-style
  warning chrome as generic branding.
- **Don't** invent the final Lotly logo or brand mark until an approved asset
  exists.
- **Don't** replace product data with decorative or speculative content.
  The one exception is the onboarding's example card, labelled an example
  three ways and never rendered on a live card.
- **Don't** give the paywall a close, skip, dismiss, free, trial or lifetime
  route, a countdown, a crossed-out price or scarcity copy.
- **Don't** hotlink, scrape or approximate a retailer mark: a mark renders
  only from the provenance manifest, contained in the shared box, or the
  `home` glyph renders in its place.
