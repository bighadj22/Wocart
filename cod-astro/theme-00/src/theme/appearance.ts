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
 * The schemes a store starts with. The first is the page's; the others band
 * sections: a warm stone ground, sand behind photos, a soft olive for a
 * promotion, and the dark ink of the footer and announcement. The accent is
 * the sale color: a saving's tag and a price below its old one. Their ids
 * never change, since sections store them.
 */
export const DEFAULT_SCHEMES = [
  {
    id: "scheme-1",
    name: SCHEME.light,
    colors: { background: "#fbfaf7", text: "#41483d", heading: "#1c241d", accent: "#a4422f", button: "#25301f", buttonText: "#ffffff", border: "#e7e2d8" },
  },
  {
    id: "scheme-2",
    name: SCHEME.stone,
    colors: { background: "#f3f0e9", text: "#41483d", heading: "#1c241d", accent: "#a4422f", button: "#25301f", buttonText: "#ffffff", border: "#e1dbcf" },
  },
  {
    id: "scheme-3",
    name: SCHEME.sand,
    colors: { background: "#ece4d7", text: "#49453a", heading: "#1c241d", accent: "#a4422f", button: "#25301f", buttonText: "#ffffff", border: "#dcd2c0" },
  },
  {
    id: "scheme-4",
    name: SCHEME.olive,
    colors: { background: "#dfe4d6", text: "#33402f", heading: "#1c241d", accent: "#a4422f", button: "#25301f", buttonText: "#ffffff", border: "#c9d2bf" },
  },
  {
    id: "scheme-5",
    name: SCHEME.night,
    colors: { background: "#0f1626", text: "#c3c9bd", heading: "#f7f4ee", accent: "#e8dfcf", button: "#f7f4ee", buttonText: "#1c241d", border: "#2a3429" },
  },
] as const satisfies readonly ColorScheme[];

export type SchemeId = (typeof DEFAULT_SCHEMES)[number]["id"];

/** The default schemes by role, for the theme's own defaults. */
export const SCHEME_OF = { light: "scheme-1", stone: "scheme-2", sand: "scheme-3", olive: "scheme-4", night: "scheme-5" } as const satisfies Record<string, SchemeId>;

/** The page's scheme unless the merchant picks another. */
export const PAGE_SCHEME: SchemeId = "scheme-1";

/**
 * Editable layout values — CSS lengths / aspect ratios, no UI edits needed.
 * - LAYOUT.hero.* / gallery.*: image and container sizing; see Hero.astro and
 *   ProductGallery.astro for where each one lands.
 * - Section toggles + order: `hidden: true` and array order in the page files
 *   (src/theme/pages/home.page.json, catalog/category/collection.page.json,
 *   header.area.json). `false`/omitted shows the section.
 * - Section spacing: `style.spacing` per section, tokens s0..s12 in
 *   style-sizes.json (0..128px).
 * - Colors: `DEFAULT_SCHEMES` above (background/text/heading/accent/button/
 *   buttonText/border) and the badge tokens in styles/global.css.
 */
export const LAYOUT = {
  hero: {
    imageAspectMobile: "5 / 4",
    imageMaxMobile: "22rem",
    imageMaxDesktop: "38rem",
    gridMinDesktop: "min(32rem, calc(100svh - 10rem))",
  },
  gallery: {
    aspectMobile: "1 / 1",
    maxMobile: "24rem",
    maxTablet: "30rem",
    aspectDesktop: "4 / 5",
    maxDesktop: "38rem",
  },
} as const;

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
