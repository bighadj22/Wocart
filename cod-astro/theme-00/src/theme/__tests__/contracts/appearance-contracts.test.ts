// @vitest-environment node
/**
 * How a store looks is the theme's settings, and every one of them holds up:
 * the default schemes are valid schemes whose text stays readable, the faces
 * are the ones the theme ships, a corners choice keeps its hierarchy, and the
 * style classes the theme bundles are exactly the ones its sizes allow.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkThemeSettings, contrastRatio, themeStyleSheet } from "@wocart/theme";
import themeFonts from "@/theme/fonts.json";
import styleSizes from "@/theme/style-sizes.json";
import { BODY_FONT, CORNERS, DEFAULT_SCHEMES, HEADING_FONT, cardAspect, cornerRadii, schemeBackground, themeFont } from "@/theme/appearance";
import { theme00 } from "@/theme/theme";

const rem = (value: string) => (value === "0" ? 0 : Number.parseFloat(value));

describe("the default color schemes", () => {
  it("are schemes the SDK accepts, the page's first", () => {
    expect(checkThemeSettings(theme00, { colorSchemes: DEFAULT_SCHEMES })).toEqual([]);
    expect(DEFAULT_SCHEMES[0].id).toBe("scheme-1");
    expect(DEFAULT_SCHEMES.map((scheme) => scheme.id)).toEqual(["scheme-1", "scheme-2", "scheme-3", "scheme-4", "scheme-5"]);
  });

  it("keep their text, headings and button labels readable (WCAG AA, 4.5:1)", () => {
    for (const { id, colors } of DEFAULT_SCHEMES) {
      for (const [text, on] of [["text", "background"], ["heading", "background"], ["buttonText", "button"]] as const) {
        expect(contrastRatio(colors[text], colors[on]), `${id} ${text} on ${on}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("name themselves in every language the theme ships", () => {
    for (const scheme of DEFAULT_SCHEMES) expect(Object.keys(scheme.name).sort()).toEqual(["ar", "en", "fr"]);
  });

  it("give the browser's chrome the page scheme's background, white for an unknown one", () => {
    expect(schemeBackground(DEFAULT_SCHEMES, "scheme-5")).toBe("#0f1626");
    expect(schemeBackground(DEFAULT_SCHEMES, "gone")).toBe("#ffffff");
    expect(schemeBackground(undefined, "scheme-1")).toBe("#ffffff");
  });
});

describe("the faces", () => {
  it("are the ones the theme ships, under the variable Astro registered", () => {
    for (const font of themeFonts) expect(themeFont(font.family)).toEqual({ family: font.family, cssVariable: font.cssVariable });
  });

  it("render a name the theme does not ship in the setting's default, never loading it", () => {
    for (const name of ["Cairo", "", "x&family=evil", "<script>"]) {
      expect(themeFont(name).family).toBe(BODY_FONT);
      expect(themeFont(name, HEADING_FONT).family).toBe(HEADING_FONT);
    }
  });

  it("have one default for text and one for headings, each face under its own variable", () => {
    expect(themeFonts.filter((font) => "default" in font && font.default)).toHaveLength(1);
    expect(themeFonts.filter((font) => "headingDefault" in font && font.headingDefault)).toHaveLength(1);
    const variables = themeFonts.map((font) => font.cssVariable);
    expect(new Set(variables).size).toBe(variables.length);
    for (const variable of variables) expect(variable).toMatch(/^--font-[a-z0-9-]+$/);
  });
});

describe("the corners", () => {
  it("keep a panel at least as round as the photo in it, and only grow rounder from sharp to soft to round", () => {
    for (const corners of CORNERS) {
      const radii = cornerRadii(corners);
      expect(rem(radii.panel)).toBeGreaterThanOrEqual(rem(radii.media));
    }
    for (const [less, more] of [["sharp", "soft"], ["soft", "round"]] as const) {
      for (const part of ["media", "panel", "input", "button", "tag"] as const) {
        expect(rem(cornerRadii(more)[part]), `${part}: ${less} → ${more}`).toBeGreaterThanOrEqual(rem(cornerRadii(less)[part]));
      }
    }
    expect(cornerRadii("pointy")).toEqual(cornerRadii("soft"));
  });
});

describe("a product card's photo", () => {
  it("takes the shape the setting names, portrait otherwise", () => {
    expect([cardAspect("square"), cardAspect("portrait"), cardAspect("landscape"), cardAspect("x")]).toEqual(["1 / 1", "3 / 4", "4 / 3", "3 / 4"]);
  });
});

describe("the style classes the theme bundles", () => {
  it("are the theme's sizes, and the stylesheet is the SDK's for them (run scripts/generate-style-classes.mjs)", () => {
    expect(theme00.style).toEqual(styleSizes);
    const bundled = readFileSync(path.resolve(process.cwd(), "src/theme/styles/style-classes.css"), "utf8");
    expect(bundled.replace(/^\/\*.*\*\/\n/, "").replaceAll("\n", "")).toBe(themeStyleSheet(styleSizes));
  });

  it("ship inside the theme's own stylesheet", () => {
    expect(readFileSync(path.resolve(process.cwd(), "src/theme/styles/global.css"), "utf8")).toContain('@import "./style-classes.css";');
  });
});
