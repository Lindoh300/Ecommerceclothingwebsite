---
name: 4Nguru The Brand
description: "Gallery storefront theme: white ground, near-black ink, tight grotesque type, pill controls and soft photo tiles."
colors:
  ink: "#0b0b0b"
  paper: "#ffffff"
  mist: "#f4f4f2"
  hairline: "#e6e5e2"
  dimmed: "#85837f"
  graphite: "#62605c"
  low-stock-amber: "#8f5400"
  signal-red: "#c8102e"
typography:
  display:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "clamp(46px, 7.4vw, 88px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "clamp(32px, 4.5vw, 48px)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  category:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "clamp(38px, 6.4vw, 72px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.01em"
rounded:
  pill: "999px"
  card: "1.25rem"
  control: "0.875rem"
spacing:
  xs: "6px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "72px"
  section-lg: "120px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "#373737"
  button-quiet:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 24px"
  button-quiet-hover:
    backgroundColor: "{colors.hairline}"
  search-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    height: "52px"
    padding: "0 20px"
  product-tile:
    backgroundColor: "{colors.mist}"
    rounded: "{rounded.card}"
  nav-pill:
    backgroundColor: "{colors.mist}"
    rounded: "{rounded.pill}"
    padding: "4px"
  category-link:
    textColor: "{colors.dimmed}"
    typography: "{typography.category}"
  category-link-hover:
    textColor: "{colors.ink}"
---

# Design System: 4Nguru The Brand

## Overview

**Creative North Star: "The Searchable Gallery"**

The storefront reads as a quiet image gallery that happens to be searchable. The ground is white, fading to a soft neutral grey in the hero. Ink is near-black and warm greys do the rest of the work. Nothing in the chrome competes with the photographs: the wordmark and the product photographs are the only colour on the page. The first screen is one sentence, "For the culture.", with no search box and no moving strip. Search lives on the shop page, so the shopper reaches the garments from the first screen with one click.

Every control is a full pill, and every image is a soft rounded tile with no card chrome. Headings are large, sentence-case, and set tight (negative tracking, leading near 1). Depth comes from tone (paper on mist on hairline) with a single soft float shadow reserved for things that sit above the page: the active nav pill and the hero photo stack. The theme is applied at build time when `VITE_THEME=gallery`, which sets `data-theme="gallery"` on the document. A header toggle switches to a warm dark mode, which is remembered. The plain default look in `theme.css` remains the fallback when the variable is unset; it is not described here.

The gallery world's native devices are pills, the float shadow, the rotated overlapping photo stack, and the gradient hero ground. These are part of the world. The small-corner and no-pill conventions of the plain default do not carry over.

**Key Characteristics:**
- White ground with a soft grey fade in the hero; no coloured backgrounds in the chrome.
- Near-black ink as both accent and text; the wordmark and product photographs are the only colour.
- Schibsted Grotesk throughout, 600 to 700 for headings, 500 for controls, tight negative tracking.
- Full pill controls: buttons, nav, cart and menu toggle, and the shop search.
- Warm dark mode from a header toggle; light stays the default.
- Soft tiles (1.25rem radius, 4:5 ratio) for products; no borders or shadows on tiles.
- One float shadow, used only for raised elements.
- Photo tile mosaic for categories.

## Colors

A near-monochrome palette of warm neutrals on white, with colour arriving only through the wordmark and the product photographs.

### Primary
- **Ink** (#0b0b0b): The accent and the text colour. Primary buttons, the cart pill, the active search submit state and the focus outline all use it. The theme's `--brand` and `--ink` are both this value, so the accent and the text share one ink.

### Neutral
- **Paper** (#ffffff): The page ground, the active nav pill, the search field and the text on ink fills.
- **Mist** (#f4f4f2): The faint surface. Quiet buttons, the nested search well, the nav pill rail, product tiles and the footer ground.
- **Hairline** (#e6e5e2): The inset ring on the search rail, and the hover fill for quiet buttons. The header and footer carry no rules.
- **Graphite** (#62605c): Secondary text: navigation at rest, the hero note, placeholders and the search icon. Passes 4.5:1 on both paper and mist.
- **Dimmed** (#85837f): Available for large text only (about 3.8:1 on paper).

### Dark Mode
A warm dark mode, set by the header toggle and remembered (`data-mode="dark"` on the document). Its tokens come from the dark block in `src/styles/gallery.css`:
- **Paper** (#171310): The page ground, a warm near-black.
- **Ink** (#f3ece2): The accent and the text, a cream.
- **Mist** (#221c17): The faint surface, used for the nav rail, inputs and secondary fills. **Mist raised** (#2c251f) is the accent fill.
- **Hairline** (#3a322a): Borders. **Graphite** (#b8ac9d) is the secondary text; **Dimmed** (#8f8478) is for large text only.
- **Low-stock Amber** (#e8ac62) and **Signal Red** (#f0695a) are lightened so they stay readable on the dark ground.
- **Scrim** (#0b0806) sits behind text on photos.
Light is the default and does not follow the system setting.

### Signal
- **Low-stock Amber** (#8f5400): The low-stock mark's border and dot. Signal only; it never decorates.
- **Signal Red** (#c8102e): Destructive states in the shared button and select primitives and on the admin door screen.

### Named Rules
**The Photographs Carry the Colour Rule.** Chrome is achromatic: ink, paper and warm greys only. Colour belongs to the wordmark and the product photographs. Amber and red are status signals and never decorative.

## Typography

**Display Font:** Schibsted Grotesk (with system-ui, sans-serif fallback). Loaded only for this theme.
**Body Font:** Schibsted Grotesk (with system-ui, sans-serif fallback).
**Label/Mono Font:** None in the gallery build. Order references and tracking codes use the default monospace stack.

**Character:** One grotesque family carries the whole site. Its tight tracking and heavy headings make the page feel like a printed exhibition caption, and its neutral shapes leave the photographs to carry the personality.

### Hierarchy
- **Display** (700, clamp 46px to 88px, line-height 1, tracking -0.04em): The hero headline only, centred, balanced across two lines.
- **Headline** (600, clamp 32px to 48px, line-height 1.05, tracking -0.04em): Section titles such as "New in" and "Shop by category". Mobile nav links use the same weight and tracking at 28px.
- **Category** (600, clamp 38px to 72px, line-height 1.12, tracking -0.04em): The category list rows. Large enough that dimmed grey still reads as text.
- **Body** (400, 16px, line-height 1.5, tracking -0.01em): Running text. Line length is held by the hero note at 44ch.
- **Label** (500, 15px, line-height 1.5, tracking -0.01em): Buttons, navigation links, product names and prices. Filter and status labels use the 13px `micro` size at the same tracking.

### Named Rules
**The Tight Heading Rule.** Headings and display text are sentence case with tracking at -0.04em and leading near 1. Controls and labels are never tracked open; they stay at -0.01em.

## Layout

- **Hero:** From 820px two columns: left-aligned copy on the left, a 4:5 new-in tile on the right; under 820px it stacks. Minimum height the smaller of the viewport and 860px. Top padding 120px (112px under 640px), side padding 16px, bottom padding 72px (24px under 640px). The header is 72px tall and the hero pulls up 72px beneath it so the gradient starts at the top of the viewport.
- **Hero stack order:** under 820px the headline "For the culture.", then the "Shop all" and "Ask on WhatsApp" pills, then the delivery note. From 820px the headline and pills sit in the left column. The hero has no search box and no rotating text.
- **Sections:** Gallery sections use 16px side padding, rising to 24px at 640px. The top padding is 72px, rising to 120px at 768px. Content is capped at 1360px.
- **Product grid:** Two columns under 768px, three from 768px and four from 1024px. Gap is 32px between rows and 12px between columns under 640px, 16px from 640px.
- **Product tiles:** Aspect ratio 4:5. Descriptions are hidden in this theme; the name and price are the caption.
- **Categories:** A mosaic of photo tiles on a 12-column grid, with spans 5, 4, 3 then 3, 4, 5; two columns under 820px. Captions sit under the image.
- **Footer:** 64px above, Mist ground, top corners 32px. Its link columns expand at 1024px. A small "Staff sign in" text link sits at the foot of the footer; it is the only public link to `/admin`.
- **Breakpoints:** 640px, 768px and 1024px. Under 768px the desktop nav is replaced by a 44px menu toggle.

## Elevation & Depth

Flat by default. Depth comes from tone: paper on mist on the white ground, with the hero's gradient providing a single soft fade. One shadow token, the float shadow, is reserved for elements that rise above the page: the active nav pill and the hero photo stack. Product tiles, buttons and the footer have no shadow.

Panels such as the next-event band and the order steps are Mist `.band-tile` blocks at the card radius; quiet buttons on them are Paper.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px -8px rgb(11 11 11 / 0.12)`): The active nav pill and the hero photo stack. The only shadow in the system. In dark mode it is the same shape with a black shadow at 0.5 opacity.

### Named Rules
**The Raised Only Rule.** Shadow appears only on elements that sit above the page. Resting tiles and controls are flat, and their depth is tonal.

## Shapes

Pills for every control and soft tiles for every image. Each control is a full 999px pill: primary and quiet buttons, the cart link, the nav rail and its links, the menu toggle, the search, the search submit and the stock marks. The shop filters are native dropdowns, not pills. Images and product cards use a 1.25rem radius. Form inputs from the shared primitives take their radius from the 0.875rem `--radius` token. Photo thumbnails inside the category list and the hero stack use a radius of 0.2em. The footer has 32px top corners and no bottom corners, the only non-uniform shape in the system.

## Components

### Buttons
- **Shape:** Full pill (999px), 48px tall, 24px horizontal padding.
- **Primary:** Ink fill with paper text, 15px label at weight 500. "Shop all" is the example.
- **Hover / Focus:** Hover and keyboard focus both mix the ink fill 82% over paper (about #373737), with a 200ms background transition. Pressing scales to 0.98 over 200ms with the expo-out curve. Disabled stays at 50% opacity and does not respond.
- **Quiet:** Mist fill with ink text. Hover and focus move to Hairline. "Ask on WhatsApp" and "All products" are quiet.

### Search
- **Style:** A nested pill. The outer rail is Mist with a 6px inset and a 1px hairline ring. The inner field is a 52px Paper pill with the float shadow and 20px side padding. The submit control is a 52px Paper circle.
- **Width:** Full width, capped at 640px, at the top of the shop page. It is not on the home page.
- **Focus:** A 2px ink outline with 2px offset appears on the field when it has focus within.
- **Placeholder:** Graphite, a fixed prompt. There is no rotating category placeholder.
- **Submit:** Paper at rest; ink fill with paper icon on hover.

### Navigation
- **Style:** A Mist rail with 4px padding and 2px gaps. Links are 15px at weight 500 in Graphite, with 8px by 16px padding in a pill.
- **States:** Hover moves the link to ink. The current page is a Paper pill with ink text and the float shadow.
- **Cart:** A 44px ink pill with paper text and an 18px side padding. The count badge is a 20px Paper pill set inline after the label.
- **Mobile:** Under 768px the rail is replaced by a 44px Mist circle menu toggle. The sheet is Paper with 28px links at weight 600, tracking -0.04em, separated by padding only; the current page is ink.

### Product Tile
- **Shape:** 4:5 image on a Mist tile with a 1.25rem radius, no border, no shadow, no card wrapper.
- **Caption:** The product name at 15px weight 500 on the left and the price at weight 500 with tabular figures on the right, with 12px above it. Descriptions are not shown.
- **Hover:** The photograph scales to 1.03 over 300ms. Reduced motion stops the scale.
- **Stock:** A sold-out product dims its photograph to 60%. A "Sold out" mark is an ink pill; a "Low stock" mark is a Paper pill with an amber border and dot. Both are 13px labels in pill shape at the top-left of the tile.

### Category Tiles
- **Shape:** Mist tile at the card radius, no border or shadow. Name left and style count right, under the image.
- **Layout:** Tiles in a row share a height.
- **Hover:** The photo scales to 1.03. Reduced motion stops the scale.

### Shop Filters
- **Style:** Native dropdowns on one row: category, size and colour, then an in-stock tick box and the sort (newest or price). They use the shared select control, so they follow the pill and token rules above.
- **Layout:** One row on wide screens, wrapping on phones.

### Your Fit Tiles
- **Where:** The "Your fit, here" wall on `/community`.
- **Style:** Placeholder tiles where customer photos will go. Each shows a faded product photograph at 35% opacity under a dashed border. They are placeholders, not links.
- **Content:** The community page has no past events. Past events stay on the events page.

### Hero Photo Stack (signature)
- **Style:** Two real product photographs, each 0.82em square with a 0.2em radius and the float shadow, set inline after "next fit". The second overlaps the first by 0.3em.
- **Motion:** Rotated -6 degrees and +5 degrees; the rotation is the device, and it is static.

### Named Rules
**The Pill Controls Rule.** Every control is a full pill. Content is a soft rounded rectangle at 1.25rem. The two shapes never swap roles.

## Do's and Don'ts

### Do:
- **Do** use the `[data-theme="gallery"]` hook classes in `src/styles/gallery.css` (`cta`, `cta-quiet`, `product-search`, `gallery-hero`, `site-nav`) for gallery surfaces, and switch new layout on `isGallery` from `src/app/config/theme.ts`.
- **Do** keep headings sentence case, at -0.04em tracking, and at the display, headline and category sizes listed above.
- **Do** use Dimmed (#85837f) only for large text, where it clears 3:1.
- **Do** keep every control a full pill and every image on the 1.25rem tile radius.
- **Do** honour `prefers-reduced-motion`: the transitions and scales are removed.

### Don't:
- **Don't** put chromatic colour into the chrome (controls, navigation, borders or backgrounds). Colour belongs to the wordmark and the product photographs.
- **Don't** add borders or shadows to product tiles. Tiles are tonal blocks on Mist.
- **Don't** introduce square-cornered controls. Pills are the native control shape of this world.
- **Don't** add a second shadow token. The float shadow is the only shadow in the system.
- **Don't** use the plain default's small-corner or no-pill conventions in this theme.
