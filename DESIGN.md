---
version: alpha
name: Dotify
description: A radically achromatic product canvas — pure black floor, pure white
  voltage, and not a single brand hue anywhere in the chrome. Display type runs
  enormous at a restrained weight 500 with aggressive negative tracking, so
  hierarchy comes from size and letterspacing rather than ink weight. Depth is
  built from hairline borders and low-alpha white fills instead of shadows, and
  the only color on the page arrives inside the product screenshots themselves.
colors:
  canvas: "#000000"
  surface-card: "#0A0A0A"
  surface-raised: "#1A1A1A"
  ink: "#FFFFFF"
  on-ink: "#000000"
  ink-hover: "#EAEAEA"
  body: "rgba(255, 255, 255, 0.60)"
  muted: "rgba(255, 255, 255, 0.40)"
  faint: "rgba(255, 255, 255, 0.25)"
  hairline: "rgba(255, 255, 255, 0.08)"
  hairline-faint: "rgba(255, 255, 255, 0.04)"
  hairline-strong: "rgba(255, 255, 255, 0.15)"
  fill-ghost: "rgba(255, 255, 255, 0.08)"
  fill-ghost-hover: "rgba(255, 255, 255, 0.12)"
  fill-subtle: "rgba(255, 255, 255, 0.05)"
  scrim: "rgba(0, 0, 0, 0.60)"
  ring: "#D4D4D4"
  link-footer: "#888888"
  ok: "#3ECF8E"
  warn: "#FBBF24"
  warn-ink: "#FCD34D"
  danger: "#EF4444"
typography:
  display-xl:
    fontFamily: "Instrument Sans, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: 84px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -4.2px
  display-lg:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 48px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -2.4px
  display-sm:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 36px
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: -1.8px
  heading-md:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 20px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -0.5px
  heading-sm:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: -0.16px
  lead:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.16px
  lead-sm:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.16px
  body-md:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.16px
  body-sm:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: -0.16px
  label:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.16px
  button:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.43
    letterSpacing: -0.16px
  caption:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: 0.3px
  micro:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.16px
  link-sm:
    fontFamily: "Instrument Sans, Inter, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: -0.16px
rounded:
  none: 0px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
  pill: 50px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  gutter: 16px
  gutter-lg: 24px
  section: 96px
  section-lg: 144px
  hero-top: 176px
components:
  header-bar:
    backgroundColor: "{colors.scrim}"
    borderColor: "{colors.hairline-faint}"
    borderWidth: 1px
    rounded: "{rounded.full}"
    height: 56px
    padding: 0px 24px
    backdropFilter: blur(12px)
    maxWidth: 1000px
  nav-link:
    backgroundColor: transparent
    textColor: "{colors.body}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 32px
    padding: 0px 12px
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    borderColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    height: 48px
    padding: 0px 32px
    shadow: "0 20px 25px -5px rgba(0,0,0,0.2), 0 8px 10px -6px rgba(0,0,0,0.2)"
  button-primary-thin:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    borderColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 32px
    padding: 0px 12px
  button-ghost:
    backgroundColor: "{colors.fill-ghost}"
    textColor: "{colors.ink}"
    borderColor: "{colors.fill-subtle}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    height: 40px
    padding: 0px 24px
  icon-button:
    backgroundColor: "{colors.fill-subtle}"
    textColor: "{colors.body}"
    borderColor: "{colors.hairline-strong}"
    rounded: "{rounded.full}"
    height: 32px
    padding: 0px
  badge-muted:
    backgroundColor: "{colors.hairline-faint}"
    textColor: "rgba(255, 255, 255, 0.55)"
    borderColor: "{colors.hairline}"
    typography: "{typography.micro}"
    rounded: "{rounded.md}"
    padding: 2px 8px
  badge-default:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "rgba(255, 255, 255, 0.75)"
    borderColor: "{colors.hairline-strong}"
    typography: "{typography.micro}"
    rounded: "{rounded.md}"
    padding: 2px 8px
  badge-strong:
    backgroundColor: "{colors.fill-ghost}"
    textColor: "rgba(255, 255, 255, 0.90)"
    borderColor: "{colors.hairline-strong}"
    typography: "{typography.micro}"
    rounded: "{rounded.md}"
    padding: 2px 8px
  faq-row:
    backgroundColor: transparent
    textColor: "rgba(255, 255, 255, 0.80)"
    typography: "{typography.heading-sm}"
    borderColor: "{colors.hairline}"
    padding: 24px 0px
  feature-item:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.heading-md}"
    padding: 0px
  media-frame:
    backgroundColor: transparent
    rounded: "{rounded.xl}"
    shadow: "0 25px 50px -12px rgba(0,0,0,0.25)"
  media-frame-peek:
    backgroundColor: transparent
    rounded: "{rounded.lg}"
    opacity: 0.3
  carousel-dot:
    backgroundColor: "rgba(255, 255, 255, 0.20)"
    rounded: "{rounded.full}"
    height: 4px
    width: 6px
  carousel-dot-active:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: 4px
    width: 24px
  footer-link:
    backgroundColor: transparent
    textColor: "{colors.link-footer}"
    typography: "{typography.link-sm}"
  section-divider:
    borderColor: "{colors.hairline-faint}"
    borderWidth: 1px
  status-dot-ok:
    backgroundColor: "{colors.ok}"
    rounded: "{rounded.full}"
    height: 8px
  status-dot-warn:
    backgroundColor: "{colors.warn}"
    rounded: "{rounded.full}"
    height: 8px
  status-dot-down:
    backgroundColor: "{colors.danger}"
    rounded: "{rounded.full}"
    height: 8px
---

## Overview

Dotify is a music player, and its marketing site is built on one hard rule: the
interface contributes no color at all. The canvas is true black `{colors.canvas}`
(#000000) — not a near-black, not a warm charcoal — and the only voltage in the
system is pure white `{colors.ink}` (#FFFFFF). Every primary CTA, every active
state, the wordmark, and every heading are that same white. There is no brand
hue, no gradient, no tinted surface anywhere in the chrome.

That absence is the design decision, not an omission. The page exists to show
screenshots of a music player, and those screenshots are saturated with album
artwork. A neutral shell lets the product supply 100% of the color. Any accent
hue in the chrome would compete with the very thing the page is selling.

With color removed, typography carries the entire hierarchy. The site uses one
family and — nearly — one weight: everything sits at 500, with only footer links
stepping to 600. Levels are separated by size and by tracking, which tightens
progressively as type grows: -0.05em at display sizes, -0.025em at heading sizes,
-0.01rem everywhere else. An 84px headline at weight 500 with -4.2px of tracking
reads as confident rather than loud; the same headline at weight 700 would read
as a shout.

Depth is equally restrained. Cards as filled surfaces essentially do not exist on
the landing page — sections are separated by 1px `{colors.hairline-faint}` rules
and nothing else, and interactive surfaces are low-alpha white fills over black
rather than raised planes. Exactly two elements on the page carry a shadow. The
one piece of visible chrome is the header: a 56px fully-rounded pill floating 16px
off the top of the viewport, backdrop-blurred over a 60% black scrim.

**Key Characteristics:**
- Zero brand hue. `{colors.ink}` white is the accent. Primary CTAs are white
  buttons with black labels — the exact inverse of the page.
- One family, one weight. Instrument Sans at 500 for everything; hierarchy is
  built from size and tracking, never from weight.
- Tracking as a display device. `{typography.display-xl}` runs -4.2px (-0.05em),
  which is what keeps an 84px headline from feeling airy at weight 500.
- Hairline-only depth. Sections divide on 1px `{colors.hairline-faint}`; shadows
  appear on the hero CTA and the showcase centerpiece and nowhere else.
- A layered alpha ladder does the work a gray scale would normally do: white at
  60 / 40 / 25 / 15 / 8 / 5 / 4 percent covers text, borders, and fills alike.
- Color is quarantined into status semantics (`{colors.ok}`, `{colors.warn}`,
  `{colors.danger}` on the status page) and product screenshots.

## Colors

### Brand & Accent
- **Ink** (`{colors.ink}` — #FFFFFF): The single brand color. Carries every
  primary CTA fill, all headings, the wordmark, the active carousel dot, and every
  hover-resolved text state. Used at full opacity only where it must dominate —
  most of the page is white at 60% or less.
- **On Ink** (`{colors.on-ink}` — #000000): Label color inside white buttons. A
  primary CTA is a literal inversion of the page.
- **Ink Hover** (`{colors.ink-hover}` — #EAEAEA): The primary button hover fill.
  A 6% step down, not a hue shift — the system has no hue to shift to.

### Surface
- **Canvas** (`{colors.canvas}` — #000000): The page floor. True black, chosen so
  OLED screens render it as unlit pixels and screenshots appear to float without
  a frame.
- **Surface Card** (`{colors.surface-card}` — #0A0A0A): Card and popover plates,
  4% lightness. Declared in the token set but barely used on the landing page —
  the marketing surfaces prefer transparency plus a hairline.
- **Surface Raised** (`{colors.surface-raised}` — #1A1A1A): Secondary, muted, and
  accent surfaces all resolve to this same 10% lightness. The system deliberately
  does not distinguish them.
- **Scrim** (`{colors.scrim}` — rgba(0,0,0,0.60)): The header backing. Paired with
  `blur(12px)`, it lets page content read through while keeping nav legible.

### Hairlines
- **Hairline Faint** (`{colors.hairline-faint}` — 4% white): Section-to-section
  dividers. Deliberately near-invisible — it marks a boundary without drawing one.
- **Hairline** (`{colors.hairline}` — 8% white): FAQ row dividers and badge
  borders. The default "there is an edge here" value.
- **Hairline Strong** (`{colors.hairline-strong}` — 15% white): Ghost button hover
  borders and emphasized badges. The strongest edge in the system.

### Fills
- **Fill Subtle** (`{colors.fill-subtle}` — 5% white): Icon buttons and carousel
  arrows at rest.
- **Fill Ghost** (`{colors.fill-ghost}` — 8% white): The default secondary button
  surface. Reads as a button without becoming a plane.
- **Fill Ghost Hover** (`{colors.fill-ghost-hover}` — 12% white): The +4% hover
  step. Every interactive alpha surface moves in 4% increments.

### Text
- **Ink** (100% white): Headings only.
- **80% white**: FAQ question titles at rest — they resolve to 100% on hover.
- **Body** (`{colors.body}` — 60% white): All paragraph copy and idle nav links.
  This is the real reading color; pure white body text would vibrate against #000.
- **Muted** (`{colors.muted}` — 40% white): Platform lists, secondary metadata.
- **Faint** (`{colors.faint}` — 25% white): Footer column labels, separator dots.
- **Link Footer** (`{colors.link-footer}` — #888888): The one place a literal hex
  gray is used instead of an alpha, resolving to white on hover.

### Semantic
Semantic color exists only on the status page and is the sole chromatic content in
the UI. It is never used for branding, CTAs, or emphasis elsewhere.
- **OK** (`{colors.ok}` — #3ECF8E): Operational service dots.
- **Warn** (`{colors.warn}` — #FBBF24) with **Warn Ink** (`{colors.warn-ink}` —
  #FCD34D) for text on dark: partial outage. Backed by 4% amber fill and 20% amber
  border.
- **Danger** (`{colors.danger}` — #EF4444): Down state; also the `destructive`
  token.

### Light Inversion
The site ships a light mode as a straight token inversion, not a separate palette
— which is only possible because the dark palette is achromatic to begin with.
Canvas becomes #FFFFFF, ink becomes #000000, surface-card #FAFAFA, surface-raised
#F2F2F2, muted text #666666, border #E0E0E0. Every white-alpha overlay becomes the
identical black-alpha value (`white/8` to `black/8`). Semantic colors step one
shade darker for contrast: emerald-600 #059669, amber-600 #D97706. The logo is
inverted via a CSS filter rather than shipped as a second asset.

## Typography

**Font family:** `Instrument Sans`, falling back to `Inter`, then the system stack
(`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`). Root size is 16px.
Both faces load from Google Fonts; Instrument Sans is a variable face supplying
400–700.

| Token | Size | Weight | Line height | Tracking | Used for |
|---|---|---|---|---|---|
| `display-xl` | 84px | 500 | 1.0 | -4.2px | Hero H1, 768px and up |
| `display-lg` | 48px | 500 | 1.0 | -2.4px | Section H2, 768px and up |
| `display-sm` | 36px | 500 | 0.9 | -1.8px | H1 and H2 below 640px |
| `heading-md` | 20px | 500 | 1.0 | -0.5px | Feature card titles |
| `heading-sm` | 17px | 500 | 1.375 | -0.16px | FAQ question titles |
| `lead` | 20px | 400 | 1.4 | -0.16px | Section intro paragraphs |
| `lead-sm` | 16px | 400 | 1.5 | -0.16px | Hero subheadline |
| `body-md` | 16px | 500 | 1.25 | -0.16px | Document default |
| `body-sm` | 14px | 400 | 1.625 | -0.16px | Feature descriptions |
| `label` | 13px | 500 | 1.25 | -0.16px | Nav links, thin buttons |
| `button` | 14px | 500 | 1.43 | -0.16px | Primary CTA labels |
| `caption` | 12px | 500 | 1.33 | **+0.3px** | Platform hint line |
| `micro` | 11px | 500 | 1.25 | -0.16px | Badges, footer labels |
| `link-sm` | 12px | 600 | 1.33 | -0.16px | Footer links |

### Principles
The scale is a two-population system, not a smooth ramp. Display sizes (36 / 48 /
84) are separated by large jumps and set at line-height 1.0 or tighter, so
headlines become dense typographic blocks. Everything else clusters between 11 and
20px, where line-height opens up to 1.4–1.625 for reading. There is almost nothing
between 20px and 36px — the site does not do "medium-large" type.

Tracking is the mechanism that makes weight 500 work at display scale. It scales
with size as a ratio, not a fixed value: -0.05em on display, -0.025em on
`heading-md`, and a global -0.01rem baseline that applies to literally every other
element, including buttons and badges. `caption` is the one positive-tracking
token in the file (+0.3px), used on the `for Windows · macOS · Linux` hint line
where letterspacing signals "technical metadata" rather than prose.

Body copy defaults to weight 500 at the document level but drops to 400 wherever
it is actually paragraph text. Treat 400 as the reading weight and 500 as the UI
weight.

### Note on Font Substitutes
Instrument Sans is a free Google font (SIL Open Font License), so no licensed
substitute is required. There is, however, a real coverage gap: **Instrument Sans
ships no Cyrillic subset.** On this Russian-language site, Latin glyphs render in
Instrument Sans while all Cyrillic renders in Inter — including the 84px hero
headline. If you build in a Cyrillic locale, treat Inter as the primary display
face and tune tracking against Inter metrics, not Instrument Sans metrics. For a
paid alternative with matching proportions across both scripts, Söhne or Suisse
International substitute cleanly at the same sizes and tracking.

## Layout

### Spacing system
The scale is 4-based through the UI range (`{spacing.xs}` 4px up to
`{spacing.xxl}` 48px) and then jumps hard into section rhythm. Four values are
declared as CSS variables in the source and act as the spine of the system: 12px,
24px, 32px, 48px.

Vertical section rhythm is the dominant spatial gesture: `{spacing.section}` 96px
on mobile and `{spacing.section-lg}` 144px from 768px up, applied symmetrically as
top and bottom padding on every section. The hero adds more — `{spacing.hero-top}`
176px of top padding on desktop — to clear the floating header and give the
wordmark room. Feature grid gutters run 40px on mobile and `{spacing.xxl}` 48px on
desktop; FAQ rows are 24px top and bottom.

### Grid and container widths
There is no single container width. Each region caps at its own measure:

| Region | Max width |
|---|---|
| Header pill | 1000px |
| Hero content | 896px |
| Hero headline | 768px |
| Lead paragraph | 672px |
| Features section | 1024px |
| FAQ section | 1000px |
| Footer | 1280px |

Horizontal gutters are `{spacing.gutter}` 16px on mobile and `{spacing.gutter-lg}`
24px from 768px; the footer widens to 64px. The features grid runs 1 to 2 to 3
columns at 640px and 1024px. The footer runs 2 to 4 columns at 768px, with the
brand cell spanning both columns while stacked.

### Whitespace philosophy
The page is mostly empty. With no color and no filled surfaces, negative space is
the only tool left for grouping, so it is used at an unusual scale — 144px between
sections is roughly double a conventional marketing rhythm. Content measures stay
narrow (672–1024px) even on wide viewports, so the black canvas frames every block
rather than content stretching to fill. Do not close these gaps when adapting the
system; the restraint elsewhere only reads as intentional because the spacing is
this generous.

## Elevation

This system is almost flat by policy. Separation is achieved with hairline borders
and alpha fills; a raised plane is the exception, not the default.

**Surface tiers:**
1. `{colors.canvas}` — the page. Where nearly everything sits.
2. Alpha fill over canvas (`{colors.fill-subtle}` / `{colors.fill-ghost}`) —
   interactive surfaces. Not a plane, a tint.
3. `{colors.scrim}` plus `blur(12px)` — the header only. The single element that
   genuinely floats above the page.

**Shadows** — three definitions exist, and only two appear on the landing page:
- **CTA shadow** — `0 20px 25px -5px rgba(0,0,0,0.2), 0 8px 10px -6px
  rgba(0,0,0,0.2)`. On `{components.button-primary}` only. Note the shadow is
  black on a black canvas, so it is invisible in dark mode and does real work only
  in light mode — it is a light-mode affordance that survives into dark.
- **Media shadow** — `0 25px 50px -12px rgba(0,0,0,0.25)`. On
  `{components.media-frame}`, the showcase centerpiece.
- The hero screenshot explicitly sets `shadow-none` and `border-none`, so it reads
  as pasted directly onto the canvas rather than framed.

The header carries **no shadow at all** — it separates purely through backdrop
blur and a 4% border. When adapting this system, reach for a hairline before you
reach for a shadow.

## Components

**`header-bar`** — The floating navigation pill. Background `{colors.scrim}` with
`backdrop-filter: blur(12px)`, 1px `{colors.hairline-faint}` border, rounded
`{rounded.full}`, height 56px, padding 0 × 24px, capped at 1000px and centered.
Detached from the viewport top by 16px and inset 16px on each side. No shadow.

**`nav-link`** — Idle top-nav item. Transparent background, text `{colors.body}`,
type `{typography.label}`, height 32px, padding 0 × 12px, rounded
`{rounded.full}`. Hover fills to 6% white and resolves text to `{colors.ink}`.
Hidden entirely below 640px.

**`button-primary`** — The hero CTA and the signature component of the system: a
white button on a black page. Background `{colors.ink}`, text `{colors.on-ink}`,
border 1px `{colors.ink}`, type `{typography.button}`, height 48px, padding
0 × 32px, rounded `{rounded.lg}` (12px), plus the CTA shadow. Hover shifts fill
and border to `{colors.ink-hover}`. Press applies `scale(0.98)`.

**`button-primary-thin`** — The compact download CTA in the header. Same colors as
`{components.button-primary}` but height 32px, padding 0 × 12px, type
`{typography.label}`, and rounded `{rounded.pill}` (50px) rather than 12px. The
radius change is deliberate: inside a fully-rounded header, a 12px corner would
fight the container.

**`button-ghost`** — The base button before any variant class. Background
`{colors.fill-ghost}`, 1px `{colors.fill-subtle}` border, text `{colors.ink}`,
height 40px, padding 0 × 24px, rounded `{rounded.lg}`. Hover moves fill to
`{colors.fill-ghost-hover}` and border to `{colors.hairline-strong}` — the fill
and the edge brighten together.

**`icon-button`** — 32 × 32 circular control for the language toggle and mobile
carousel arrows. Background `{colors.fill-subtle}`, 1px `{colors.hairline-strong}`
border, icon `{colors.body}` at 16px, rounded `{rounded.full}`. Hover doubles the
fill to 10% white.

**`badge-muted`** — Lowest-emphasis FAQ tag. Background `{colors.hairline-faint}`,
text 55% white, 1px `{colors.hairline}` border, type `{typography.micro}`, rounded
`{rounded.md}` (10px), padding 2 × 8px.

**`badge-default`** — Mid-emphasis tag. Background 6% white, text 75% white, 1px
`{colors.hairline-strong}` border. Same geometry as `{components.badge-muted}`.

**`badge-strong`** — Highest-emphasis tag. Background `{colors.fill-ghost}`, text
90% white, 1px `{colors.hairline-strong}` border. Same geometry again. The three
badge tiers differ only in alpha — 4% / 6% / 8% fill and 55% / 75% / 90% text —
which is how the system expresses emphasis without a second color.

**`faq-row`** — Full-width accordion trigger. Transparent background, padding
24px × 0, separated from siblings by a 1px `{colors.hairline}` divider, with the
whole stack bounded top and bottom by the same rule. Title uses
`{typography.heading-sm}` at 80% white, resolving to 100% on hover; a 16px leading
icon at 60% white sits 14px to its left, and a plus glyph plus a copy-link button
sit right. No fill, no radius, no hover background — the row is a text row.

**`feature-item`** — Grid cell in the features section. No background, no border,
no padding, no radius. A `{typography.heading-md}` title over a
`{typography.body-sm}` description at `{colors.body}`, spaced 12px apart. Cells
are separated by 48px grid gutters and nothing else.

**`media-frame`** — The showcase centerpiece screenshot. Transparent background,
rounded `{rounded.xl}` (16px), media shadow, capped at 620px. The only image in
the system that is elevated.

**`media-frame-peek`** — The flanking preview screenshots on desktop. Rounded
`{rounded.lg}` (12px), 240px wide, held at 30% opacity and rising to 50% on hover.
They exist to signal "there is more," not to be read. Replaced by
`{components.icon-button}` chevrons below 768px.

**`carousel-dot`** — Inactive slide indicator. Background 20% white, 4px tall, 6px
wide, rounded `{rounded.full}`. Hover doubles to 40% white.

**`carousel-dot-active`** — Active indicator. Background `{colors.ink}`, 4px tall
and 24px wide. The active state is expressed as width, not color — a 4× stretch
animated over 300ms.

**`footer-link`** — Background transparent, text `{colors.link-footer}` (#888888),
type `{typography.link-sm}` at weight 600 — the only weight-600 text in the
system, used because 12px at 500 loses too much presence against a black canvas.
Resolves to `{colors.ink}` on hover.

**`section-divider`** — 1px top border in `{colors.hairline-faint}` on the
showcase, FAQ, and footer regions. The entire page structure is communicated by
this one element repeated three times.

**`status-dot-ok`** — 8px circle, background `{colors.ok}`, rounded
`{rounded.full}`. Operational service.

**`status-dot-warn`** — 8px circle, background `{colors.warn}`. Degraded service.
Its containing row picks up a 4% amber fill and a 20% amber border.

**`status-dot-down`** — 8px circle, background `{colors.danger}`. Offline service.
Containing row takes an 8% red fill and a 20% red border.

## Responsive Behavior

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 640px | H1/H2 36px at line-height 0.9; nav hidden with no hamburger; features 1-up; footer 2-up; sections 96px; gutters 16px; carousel peeks become chevrons |
| Small | 640–767px | H1 48px; display line-height opens to 1.0; nav row appears; features 2-up |
| Tablet | 768–1023px | H1 84px; sections 144px; hero top padding 176px; gutters 24px; showcase peeks return; FAQ header goes row-wise |
| Desktop | 1024px and up | Features 3-up at 48px gutters; containers cap at 1000 / 1024 / 1280px |

The site also carries custom breakpoints at 535px, 550px, 1100px, and 1200px for
individual adjustments — the lead paragraph drops from 20px to 18px at 535px.

### Touch Targets
- `{components.button-primary}` at 48px height clears WCAG AAA (44 × 44).
- `{components.faq-row}` at 24px padding yields a roughly 72px tap row. Clears.
- `{components.icon-button}` at 32 × 32 falls **below** the 44px minimum. This
  affects the mobile carousel chevrons and the language toggle. If you adapt this
  system, keep the 32px visual size and add an invisible 44px hit area.
- `{components.nav-link}` at 32px height is also under the minimum, but is hidden
  on touch widths, so it does not surface as a real defect.
- `{components.carousel-dot}` at 4px tall is far under minimum and is best treated
  as an indicator with a padded hit box, not a control.

### Collapsing Strategy
- The header keeps its pill geometry at every width, only shrinking to
  `calc(100% - 32px)`. Below 640px the nav row simply disappears — there is no
  hamburger and no drawer; only the wordmark, language toggle, and download CTA
  survive. Replicate this only if your nav is genuinely optional.
- Feature grid steps 1 to 2 to 3 columns; column count changes cleanly and rows
  never reflow.
- The showcase swaps its two peek screenshots for 32px chevron buttons below
  768px, keeping the centerpiece at full container width.
- The FAQ section header stacks from a baseline-aligned row into a centered column
  below 768px.
- Section padding halves from 144px to 96px; gutters from 24px to 16px.

## Known Gaps

- **Display line-height is inconsistent by accident.** `leading-[0.9]` is declared
  unprefixed on H1 and H2, but `sm:text-5xl` re-declares line-height at 640px and
  wins the cascade. The result is 0.9 below 640px and 1.0 above. This file
  documents observed behavior; if you want the tighter 0.9 everywhere, declare it
  at each breakpoint.
- **Motion is only partially captured.** Three transitions are documented
  (background and border 150ms, transform 100ms, carousel width 300ms) plus
  `scroll-behavior: smooth`. The root element carries live `--mouse-x` /
  `--mouse-y` custom properties for a pointer-tracking effect whose visual outcome
  is not present in the extracted CSS.
- **No form controls were observed.** `--input` and `--ring` tokens exist but the
  landing page renders no text input, select, checkbox, or validation state. Error
  and success visualizations are undefined.
- **Focus states are undocumented.** Several controls set `focus:outline-none`
  with no visible replacement. Any adaptation must add a focus ring —
  `{colors.ring}` (#D4D4D4) is the declared token and the intended value.
- **In-app UI is out of scope.** This describes the marketing site only. The
  player itself ships dynamic album-art-derived theming, which is a fundamentally
  different color model from the achromatic system documented here.
- **Light mode is documented at token level.** The inversion rules are complete,
  but per-component light values were not exhaustively captured on every surface.
- **Loading and empty states** are limited to a single spinner observed on the
  status page.

---

*This file documents publicly observable design patterns of dotify.fun for
development reference. It is not an official design system of Dotify, and all
trademarks, brand names, logos, and imagery belong to their respective owners.*
