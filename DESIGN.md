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

_Status (P2B4, 2026-09-15): reconciled against Figma and the shipped product.
The token foundation and thirteen shared primitives exist in code — `Text`,
`Surface`, `DisclosureControl` and `RiskLabel` from P2B0; `Icon`,
`RelevanceLabel`, `Chip` and `SearchBar` from P2B1; `MediaTile`, `Callout`
and `NoticeLabel` from P2B2; `Button` and `ChoiceRow` from P2B3 — plus the
shared `StateMessage`, which from P2B4 may carry a decorative glyph above its
title; Public Sans and IBM Plex Mono are installed and loaded at the root;
the app is locked to light appearance; the risk label reads its bare
canonical word on every surface. **The Feed (P2B1), Recall Detail (P2B2),
the shopper-report questionnaire (P2B3) and Saved (P2B4) are the restyled
product screens**: the Feed's page, search bar, chip row, section headings,
recall card, whole-screen states and the bottom navigation; Detail's product
header, callouts, sections, community block and Affected Products table; the
questionnaire's steps, review, disclosure, endings and paused state; and
Saved's page, list rhythm, whole-screen states and notices, render from the
tokens with every shipped behaviour intact. The pushed screens' header chrome
is styled from the same tokens and their back control is the platform chevron
alone. Profile keeps the provisional appearance until its own milestone._

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

The product name is **Lotly**. The final logo/brand mark is not yet locked. Do
not invent a new logo, mascot, shield, siren, warning triangle, grocery cart,
or food icon in implementation work unless a later approved brand asset
explicitly provides one.

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
dark token. The legacy provisional theme the un-migrated screens still use
carries dark values from before the system existed; they are unreachable now
and go when the last screen migrates.

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

Risk labels are uppercase.

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
- Recall-card media tile: 112px square, image and placeholder alike
  (`card-media-size`; Figma's 115 is normalized to the 4pt grid)
- Content column cap: 800px (`max-content-width`) — reached on tablets and
  the web only, so a phone's column is always the device width less the
  margins
- Recall Detail hero tile: 152px square (`detail-media-size`; Figma's 150 is
  normalized to the 4pt grid), rendered only when the recall has an image
- Affected Products version image: 40px square (`row-media-size`)
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
technology. The stale-feed notice is the soft-blue Information callout.

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
both the soft-blue Information callout. The empty state is decided only after
storage AND the corpus have answered, so it can never flash at a user who has
saves; a failed feed read says the recalls could not load and never that a
save was removed.

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

If a product image exists, show the actual product image. If it does not,
preserve the same media footprint and render `background/media-placeholder`
(`#EEF1F1`). Do not collapse the media area, leave a broken-image icon, or
substitute an unrelated stock image.

A relevance badge is shown only when the recall affects the user.

Card content hierarchy:

1. risk label + recency/update metadata
2. optional Affects You relevance label
3. product media
4. product title
5. manufacturer/brand
6. one-sentence recall summary
7. affected location
8. save/bookmark affordance

A Public Health Alert additionally carries its explicit notice label (shipped
behavior; not yet in Figma). Product titles and summaries must tolerate
realistic wrapping without breaking card layout.

Implemented in `src/components/recall-card.tsx` (P2B1). The card is
`spacing/12` padding with `spacing/8` between its rows: the status row (risk
label, the PHA notice label when there is one, and the one activity date in
`micro-caption`, with the relevance label at the trailing edge), the content
row (the 112px media tile, then the product name in `heading-3`, the brand in
`caption`, and the summary in `body-small`), and `spacing/16` later the footer
(the 12px pin glyph and the location in `caption`, with the save control
trailing). The media tile renders the real hero image `contain`ed on
`background/media-placeholder`, so the neutral colour shows around a tall or
wide label photo, and the same tile with no image inside when there is none
or the load fails. The Public Health Alert notice label is the compact-label
geometry on `background/subtle` with a `border/default` border in `label`
type — a notice type, so it borrows neither the risk nor the relevance
palette. Nothing on the card is truncated or fixed in height; the text column
takes the remaining width and wraps.

The save control (`src/components/save-recall-button.tsx`) is the design's
bookmark glyph — outline unsaved, filled saved — beside the visible `Save` /
`Saved` word in `action/primary`, reaching 44pt through `hitSlop`; Figma
shows the glyph alone (conflict 16). To VoiceOver the card is one element, so
the save action is also exposed as a custom accessibility action on the card
with the same spoken names, and the card announces `Opens the recall
details` as its hint.

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
information cannot land on it without saying so in code.

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
6. product image

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
shared save control (glyph and `Save` / `Saved` word) at its trailing edge —
in the body with the recall's identity, per the P2A founder decision,
rather than in Figma's utility row (conflict 9); then the product name in
`heading-2`, the brand in `body-small` `text/secondary`, and the
official-source link — `caption` in `action/secondary` with the 16px
`external-link` glyph, a `link` role, the spoken hint `Opens in your
browser`, and a 44pt target — beside the 152px hero tile when the recall has
an image. With no image the identity takes the whole row: Detail removes the
tile rather than reserving its space, the second of the two approved
no-image treatments. At accessibility text sizes, where one `heading-2`
word can be wider than the column beside the tile, the header stacks — the
identity at full width, the tile beneath it — decided from the name's own
text layout (a line that ended mid-word) and latched, so a product name
never stays broken inside a word. A retracted notice renders the information callout in
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
line carries the 12px pin; the community block follows it `spacing/12`
below, in the same body type with its add/edit action as a `caption` text
action in `action/secondary`. Health Risk keeps its `COMMON SYMPTOMS` group
label (a `caption` in `text/secondary`, the contract's pinned words) over
bulleted `body-small` lines and the `Learn more from …` external link.
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
the hairline. The Feed's header is styled from the same layout — the page
colour, no shadow, `heading-3` for the `Feed` title — because a screen's
header is navigation chrome the navigator owns.

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
| `external-link`   | `external-link` in Detail (`81:837`)       | `external-link`     | the official-source and Learn more links (P2B2) |
| `warning`         | `icon/warning` in `Information` (`78:223`) | `triangle-alert`    | the warning callout (P2B2)                      |
| `info`            | `lucide/info` in `Information` (`81:687`)  | `info`              | the information callout (P2B2)                  |

Figma exports each glyph cropped to its path bounds at some scale; each was
drawn at `export size × S / (24 × k)` centred in an `S`-point box, where `k`
is the export's scale against the Lucide 24-unit grid, which reproduces the
design's optical size exactly. Every export carries a stroke of about 2.4
grid units (Figma's 20px icons scaled to 24), so the whole set lands at one
stroke weight. Figma's bell and sliders glyphs are deliberately not in the
set: neither has product behaviour (conflicts 11 and 17).

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
  fabricated fallback content. A missing image removes the tile or renders the
  media placeholder; it never shows a broken-image glyph.
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
  reports `accessibilityState.checked`.
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
  that names its action (`Save this recall`, `See all 10 jurisdictions`), and
  every status label announces its meaning (`Risk level: High`) rather than
  its visible text. Icon-only controls always carry a label.
- **Expanded/collapsed state.** Every disclosure control sets
  `accessibilityState.expanded`, so its state is announced and its visible
  word (`See all (N)` / `Show less`) changes with it.
- **Dynamic Type and text wrapping.** Text scales with the user's setting; no
  `maxFontSizeMultiplier` caps anywhere. Product names, summaries, and cell
  values wrap rather than truncate; only a paired identifier/date line is
  capped to one line, so the two columns stay aligned. Layouts must survive a
  200% text size without overlapping or clipping.
- **Reduced motion.** The system has no essential motion: disclosures grow in
  place, tabs switch without animation, and the only motion is the platform's
  own navigation transition, which respects the Reduce Motion setting. Any
  future animation must be skipped when
  `AccessibilityInfo.isReduceMotionEnabled` reports true.
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
  Alert label), and from P2B3 `Button` (the 44pt primary / secondary pill,
  with disabled and busy states) and `ChoiceRow` with `ChoiceGroup` (a
  single-choice answer row and its radio group). The whole-screen `StateMessage`
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
| `icon/chevron-left` `63:1343`            | the platform back control (`headerBackButtonDisplayMode`)                 |
| `share` `63:1358`                        | **not rendered** — no behaviour (conflict 9)                              |
| `label/Critical` `42:832`                | **retired** — nothing in code                                             |
| text styles                              | `typography` in `design-tokens.ts` (`Text variant=`)                      |
| `Elevation/Card`                         | `elevation.card`                                                          |
| color / spacing / radius variables       | `color`, `spacing`, `radius` in `design-tokens.ts`, same names            |
| — (no questionnaire frame; conflict 26)  | `src/app/report/[id].tsx`, `src/components/report-questionnaire.tsx`      |
| — (no button or radio component)         | `src/components/ui/button.tsx`, `src/components/ui/choice-row.tsx` (P2B3) |

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
reads nor writes this device's saved list. Only the values each caption
names are simulated. It is not a product surface.

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
16. **Save control on the card.** Figma shows the bookmark glyph alone; the
    product shows the glyph (outline / filled) beside the visible `Save` /
    `Saved` word — a P2A founder copy decision and the state's non-colour
    channel. Code wins on copy; the word stays.
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
    a lot code or date is checked against a package, not glanced at.
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
- [ ] Recall-Card: show the `Save` / `Saved` word beside the bookmark (outline
      unsaved, filled saved), normalize the media tile to 112, and add the
      Public Health Alert notice label beside the risk label.
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
      width; show the `Save` / `Saved` control on the status row instead of
      the bookmark in the utility row, and remove the share glyph (conflict
      9); replace the frame's own chevron row with a navigator header
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

- **Don't** interpret lime as low risk, safety, success, or resolution.
- **Don't** use green as part of the recall-severity scale.
- **Don't** hardcode `FDA` as the source agency.
- **Don't** allow the Affected Products table to make the entire screen
  scroll sideways.
- **Don't** collapse no-image Recall Cards into a different card geometry.
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
