# Manual customization parameters

Edit these values directly, save, rebuild. No other file needs to change.
They are applied at render time, so they also win over a store's **saved**
page document and **saved** brand colors — that is why editing only the
shipped JSON had no effect on a store that already saved a layout in Studio.

## 1. Sections — visibility and order

`src/theme/appearance.ts` → `STORE_PARAMETERS.sections` is the live control:
`home` / `area:header` arrays are the render order; the `hidden` map forces
each named section on (`false`) or off (`true`). This overrides the saved
document on shopper pages. `home.page.json` / `header.area.json` keep the same
order and flags as the shipped fallback for a store with no saved document.

`home.page.json` → `sections[]`: **array order is render order**;
`hidden: false` shows a section, `hidden: true` skips it.

| id | type | What it is | Shipped |
| --- | --- | --- | --- |
| `cmp_h1hero` | `hero` | hero / slider | shown |
| `cmp_h1strip` | `marquee` | moving announcement strip | hidden |
| `cmp_h2cats` | `category-cards` | category tiles | shown |
| `cmp_h3picks` | `product-tabs` | featured products (tabs in `slots.tabs`) | shown |
| `cmp_h4offer` | `image-banner` | image-with-text / promotion | hidden |
| `cmp_h4how` | `how-it-works` | COD steps | shown |
| `cmp_h8reviews` | `customer-testimonials` | reviews | shown |
| `cmp_h6feat` | `features-bar` | shipping / trust features | hidden |

Keep `features-bar` hidden on home: the footer already prints the
cash-on-delivery promise, so showing it here duplicates the bottom strip.

`header.area.json` → `sections[]`: `announcement` (`announcement-bar`) is
`hidden: true`; `header` is `hidden: false`. Flip either flag to show/hide it.

Per-section breathing room: each section's `scheme` and `style.spacing` fields.
Spacing steps `s0`…`s12` (0…128px) and widths `wide` / `content` / `narrow`
are defined in `../style-sizes.json`.

## 2. Media and layout sizing

`src/theme/appearance.ts` → `LAYOUT` (CSS lengths / aspect ratios):

| Parameter | Feeds |
| --- | --- |
| `category.imageAspectMobile`, `category.imageMaxMobile` | `CategoryCards.astro` phone tiles |
| `category.imageAspectDesktop`, `category.imageMaxDesktop` | `CategoryCards.astro` desktop tiles |
| `product.imageMaxMobile`, `product.imageMaxDesktop` | `ProductCard.astro` photo caps |
| `gallery.aspectMobile`, `gallery.maxMobile`, `gallery.maxTablet` | `ProductGallery.astro` phone/tablet stage |
| `gallery.aspectDesktop`, `gallery.maxDesktop` | `ProductGallery.astro` desktop stage |

`Hero.astro` and `ImageBanner.astro` carry no photo at any breakpoint; their
copy is centered and uses the spacing steps below. Lower a `max*` value if a
product or category photo looks oversized; keep mobile caps below the viewport
height and desktop caps near half the screen.

## 3. Colors and spacing scale

`src/theme/appearance.ts` → `DESIGN`:

- `DESIGN.colors.surface*` — scheme backgrounds (page, stone, sand, olive, night).
- `DESIGN.colors.ink`, `body*` — headings and paragraph text per background.
- `DESIGN.colors.accent`, `accentNight` — the indigo primary behind buttons,
  badges, links, focus rings and sale prices; its night counterpart is light.
- `DESIGN.colors.button*`, `onButton*` — order button and its label.
- `DESIGN.colors.border*` — hairlines per background.
- `DESIGN.spacing.xs`, `sm`, `md`, `lg`, `xl`, `xxl` — injected as
  `--space-*` by `BaseHead.astro` and used by section copy/padding.

These feed `DEFAULT_SCHEMES`. With `STORE_PARAMETERS.enforcePalette = true`,
`BaseHead.astro` writes those roles into every `.wc-scheme-*` class after the
SDK stylesheet, so saved yellow/clashing brand colors cannot reach shoppers.
Set `enforcePalette = false` to let the dashboard's saved colors win.
No hex value lives in a section component.

## 4. RTL (AR) and LTR (FR/EN)

No direction-specific numbers: sizing and spacing are the same in both
directions, and the layout uses logical properties. Copy stays in the language
packs under `../content/<ar|fr|en>/`.
