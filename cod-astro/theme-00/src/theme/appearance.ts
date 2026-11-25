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
 * sections: a stone ground, warm sand behind photos, saffron for a promotion,
 * the night of the footer and the announcement. The accent is the sale color:
 * a saving's tag and a price below its old one. Their ids never change, since
 * sections store them.
 */
export const DEFAULT_SCHEMES = [
  {
    id: "scheme-1",
    name: SCHEME.light,
    colors: { background: "#ffffff", text: "#3b4250", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#e8e8e5" },
  },
  {
    id: "scheme-2",
    name: SCHEME.stone,
    colors: { background: "#f4f4f1", text: "#3b4250", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#e2e2dc" },
  },
  {
    id: "scheme-3",
    name: SCHEME.sand,
    colors: { background: "#efe4d6", text: "#4a4136", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#e0d2bf" },
  },
  {
    id: "scheme-4",
    name: SCHEME.saffron,
    colors: { background: "#f2c14e", text: "#2a2416", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#d9a93a" },
  },
  {
    id: "scheme-5",
    name: SCHEME.night,
    colors: { background: "#0f1626", text: "#b9c0cd", heading: "#ffffff", accent: "#f2c14e", button: "#ffffff", buttonText: "#0f1626", border: "#26324b" },
  },
] as const satisfies readonly ColorScheme[];

export type SchemeId = (typeof DEFAULT_SCHEMES)[number]["id"];

/** The default schemes by role, for the theme's own defaults. */
export const SCHEME_OF = { light: "scheme-1", stone: "scheme-2", sand: "scheme-3", saffron: "scheme-4", night: "scheme-5" } as const satisfies Record<string, SchemeId>;

/** The page's scheme unless the merchant picks another. */
export const PAGE_SCHEME: SchemeId = "scheme-1";

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
