/**
 * How a store looks, as the theme's settings decide it: the default color
 * schemes, the faces for headings and text, the corners, the product cards'
 * image shape, and the sizes behind the style steps a merchant picks. Plain
 * data and pure functions — the layout turns them into the page's tokens.
 */
import type { CssVariable } from "astro:assets";
import type { ColorScheme, ThemeStyle } from "@wocart/theme";
import { SCHEME } from "./catalog/labels";
import themeFonts from "./fonts.json";
import styleSizes from "./style-sizes.json";

/**
 * MANUAL EDIT — colors + spacing. Change a value here and every scheme,
 * section and frame that reads it follows. The palette is cream and parchment
 * surfaces, near-black ink, a deep forest-green primary and champagne gold on
 * dark bands, for buttons, badges, links and sale prices. `DESIGN.spacing` feeds
 * `--space-*` in `BaseHead.astro`;
 * `LAYOUT` below holds the remaining image limits. Section toggles/order are
 * in `pages/*.json`. The full map is in `pages/PARAMETERS.md`.
 */
export const DESIGN = {
  colors: {
    // Surface = scheme background: page/cards, parchment, champagne sand band,
    // pale sage promotion band, near-black forest footer + announcement.
    surface: "#faf8f3",
    surfaceStone: "#f1ede4",
    surfaceSand: "#e7e1d4",
    surfaceOlive: "#e3e6db",
    surfaceNight: "#121710",
    // Ink = headings; body = paragraph text on that background.
    ink: "#141815",
    body: "#4b524c",
    bodySand: "#5b6055",
    bodyOlive: "#444b3d",
    bodyNight: "#ece9df",
    // Accent = the single sale/highlight color; Night is its dark-band counterpart.
    accent: "#14532d",
    accentNight: "#e3c77d",
    // Button + its label, per light and dark band.
    button: "#14532d",
    buttonNight: "#e3c77d",
    onButton: "#ffffff",
    onButtonNight: "#121710",
    // Border = hairlines, per background.
    border: "#e2ddd1",
    borderStone: "#d8d2c4",
    borderSand: "#cdc6b5",
    borderOlive: "#c9cdbb",
    borderNight: "#2f372c",
  },
  spacing: {
    // xs → xxl become --space-xs → --space-xxl (BaseHead, every page).
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    xxl: "3rem",
  },
} as const;

/**
 * The schemes a store starts with. The first is the page's; the others band
 * sections: a soft parchment ground, champagne sand, a pale sage promotion band,
 * and the near-black forest of the footer and announcement. The accent is the
 * primary/sale
 * color: buttons, badges, links and a price below its old one. Their ids
 * never change, since sections store them.
 */
const C = DESIGN.colors;
export const DEFAULT_SCHEMES = [
  { id: "scheme-1", name: SCHEME.light, colors: { background: C.surface, text: C.body, heading: C.ink, accent: C.accent, button: C.button, buttonText: C.onButton, border: C.border } },
  { id: "scheme-2", name: SCHEME.stone, colors: { background: C.surfaceStone, text: C.body, heading: C.ink, accent: C.accent, button: C.button, buttonText: C.onButton, border: C.borderStone } },
  { id: "scheme-3", name: SCHEME.sand, colors: { background: C.surfaceSand, text: C.bodySand, heading: C.ink, accent: C.accent, button: C.button, buttonText: C.onButton, border: C.borderSand } },
  { id: "scheme-4", name: SCHEME.olive, colors: { background: C.surfaceOlive, text: C.bodyOlive, heading: C.ink, accent: C.accent, button: C.button, buttonText: C.onButton, border: C.borderOlive } },
  { id: "scheme-5", name: SCHEME.night, colors: { background: C.surfaceNight, text: C.bodyNight, heading: C.buttonNight, accent: C.accentNight, button: C.buttonNight, buttonText: C.onButtonNight, border: C.borderNight } },
] as const satisfies readonly ColorScheme[];

export type SchemeId = (typeof DEFAULT_SCHEMES)[number]["id"];

/** The default schemes by role, for the theme's own defaults. */
export const SCHEME_OF = { light: "scheme-1", stone: "scheme-2", sand: "scheme-3", olive: "scheme-4", night: "scheme-5" } as const satisfies Record<string, SchemeId>;

/** The page's scheme unless the merchant picks another. */
export const PAGE_SCHEME: SchemeId = "scheme-1";

/**
 * Editable image sizing — CSS lengths / aspect ratios, no UI edits needed.
 * Category tiles, product cards and the product gallery still use these; the
 * home hero, promotion band and category banner carry no photo, so they need
 * no sizes. Keep the mobile cap below the viewport's height and the desktop
 * cap near half the screen so photographs stay balanced in AR, FR and EN.
 * Section toggles + order live in the page files (`hidden: true`, array order);
 * section spacing uses `style.spacing` with steps s0..s12 from style-sizes.json.
 */
export const LAYOUT = {
  category: {
    imageAspectMobile: "4 / 5",           // category tile shape on phone
    imageMaxMobile: "21rem",              // category tile height cap on phone
    imageAspectDesktop: "4 / 5",          // category tile shape on desktop
    imageMaxDesktop: "17rem",             // category tile height cap on desktop
  },
  product: {
    imageMaxMobile: "24rem",              // product card photo cap on phone
    imageMaxDesktop: "22rem",             // product card photo cap on desktop
  },
  gallery: {
    aspectMobile: "1 / 1",                // PDP lead photo shape on phone
    maxMobile: "22rem",                   // PDP lead photo cap on phone
    maxTablet: "28rem",                   // PDP lead photo cap from 640px
    aspectDesktop: "4 / 5",               // PDP lead photo shape on desktop
    maxDesktop: "34rem",                  // PDP lead photo cap on desktop
  },
} as const;

/**
 * MANUAL EDIT — what the shopper actually gets, even when the store has saved
 * its own page document or brand colors in the dashboard. `sections.*` is the
 * render order (unknown types keep their saved order, at the end);
 * `sections.hidden` forces each named section on or off; `enforcePalette`
 * makes DESIGN.colors win over saved colors. Editor draft previews still
 * render exactly what the editor sends, so merchants can keep editing there.
 */
export const STORE_PARAMETERS = {
  sections: {
    home: ["hero", "marquee", "category-cards", "product-tabs", "image-banner", "how-it-works", "customer-testimonials", "features-bar"],
    "area:header": ["announcement-bar", "header"],
    hidden: {
      "announcement-bar": true,
      marquee: true,
      "product-tabs": false,
      "image-banner": false,
      "how-it-works": false,
      "customer-testimonials": false,
      "features-bar": true,
    },
  },
  enforcePalette: true,
} as const;

/** Apply the section order/visibility parameters to a resolved page document. */
export function applyStoreSections<T extends { type: string; hidden?: boolean }>(
  surface: string,
  sections: readonly T[],
  dashboardHidden: Readonly<Record<string, boolean>> = {},
): T[] {
  const settings = STORE_PARAMETERS.sections as unknown as Record<string, readonly string[] | Record<string, boolean>>;
  const order = settings[surface];
  if (!Array.isArray(order)) return [...sections];
  const hidden = settings.hidden as Record<string, boolean>;
  const ranked = sections.map((section, index) => ({ section, index }));
  ranked.sort((a, b) => {
    const ai = order.indexOf(a.section.type);
    const bi = order.indexOf(b.section.type);
    return (ai < 0 ? order.length + a.index : ai) - (bi < 0 ? order.length + b.index : bi);
  });
  return ranked.map(({ section }) => {
    const forced = dashboardHidden[section.type] ?? hidden[section.type];
    return forced === undefined ? section : ({ ...section, hidden: forced } as T);
  });
}

/** The sizes the theme gives the platform's style steps and widths, in pixels. */
export const THEME_STYLE: ThemeStyle = styleSizes;

/** A face the theme ships: its family name and the variable Astro registered it under. */
export type ThemeFont = { family: string; cssVariable: CssVariable };

/** Astro types each variable from the configured list, so a typo here fails the build. */
const FONTS = themeFonts as { family: string; cssVariable: CssVariable; default?: boolean; headingDefault?: boolean }[];

export const FONT_FAMILIES = FONTS.map((font) => font.family) as [string, ...string[]];
export const BODY_FONT = FONTS.find((font) => font.default)!.family;
export const HEADING_FONT = FONTS.find((font) => font.headingDefault)!.family;

/** The face a font setting names; one the theme does not ship renders in that setting's default. */
export function themeFont(family: string, fallback: string = BODY_FONT): ThemeFont {
  const chosen = FONTS.find((font) => font.family === family) ?? FONTS.find((font) => font.family === fallback) ?? FONTS[0]!;
  return { family: chosen.family, cssVariable: chosen.cssVariable };
}

export const CORNERS = ["sharp", "soft", "round"] as const;
export type Corners = (typeof CORNERS)[number];

/**
 * Each corners choice keeps the same order — a photo rounder than a field, a
 * field rounder than a tag — so the hierarchy survives every choice.
 */
const RADII: Readonly<Record<Corners, Readonly<Record<"media" | "panel" | "input" | "button" | "tag", string>>>> = {
  sharp: { media: "0", panel: "0", input: "0.125rem", button: "0.125rem", tag: "0.125rem" },
  soft: { media: "0.875rem", panel: "1.125rem", input: "0.625rem", button: "0.625rem", tag: "62.5rem" },
  round: { media: "1.5rem", panel: "1.75rem", input: "1rem", button: "62.5rem", tag: "62.5rem" },
};

/** The radius tokens for a corners choice; an unknown one is soft. */
export function cornerRadii(corners: string): Readonly<Record<"media" | "panel" | "input" | "button" | "tag", string>> {
  return RADII[(CORNERS as readonly string[]).includes(corners) ? (corners as Corners) : "soft"];
}

export const CARD_RATIOS = ["square", "portrait", "landscape"] as const;
export type CardRatio = (typeof CARD_RATIOS)[number];

/** The CSS aspect ratio of a product card's photo; an unknown shape is portrait. */
export function cardAspect(ratio: string): string {
  return ratio === "square" ? "1 / 1" : ratio === "landscape" ? "4 / 3" : "3 / 4";
}

/** A scheme's background, for the browser's own chrome (`theme-color`); white when the id names none. */
export function schemeBackground(schemes: readonly ColorScheme[] | undefined, id: string | undefined): string {
  return (schemes ?? []).find((scheme) => scheme.id === id)?.colors.background ?? "#ffffff";
}
