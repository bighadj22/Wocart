import { describe, expect, it } from "vitest";
import {
  APPEARANCE_DEFAULT_SCHEMES,
  APPEARANCE_HEX,
  appearanceLocaleProblem,
  appearanceSettingsOf,
  appearanceSettingsProblem,
  appearanceTextProblem,
  colorSchemesProblem,
  mergeAppearance,
  type AppearanceSettings,
} from "./appearance";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const valid = (): AppearanceSettings => ({
  colorSchemes: clone(APPEARANCE_DEFAULT_SCHEMES),
  pageScheme: "scheme-1",
});

describe("APPEARANCE_DEFAULT_SCHEMES", () => {
  it("starts from Theme-00's forest-and-champagne palette", () => {
    expect(APPEARANCE_DEFAULT_SCHEMES.map((scheme) => scheme.id)).toEqual([
      "scheme-1",
      "scheme-2",
      "scheme-3",
      "scheme-4",
      "scheme-5",
    ]);
    expect(APPEARANCE_DEFAULT_SCHEMES.map((scheme) => scheme.name)).toEqual([
      { ar: "فاتح", fr: "Clair", en: "Light" },
      { ar: "حجري", fr: "Pierre", en: "Stone" },
      { ar: "رملي", fr: "Sable", en: "Sand" },
      { ar: "زيتوني", fr: "Olive", en: "Olive" },
      { ar: "ليلي", fr: "Nuit", en: "Night" },
    ]);
    expect(APPEARANCE_DEFAULT_SCHEMES.map((scheme) => scheme.colors.background)).toEqual([
      "#faf8f3",
      "#f1ede4",
      "#e7e1d4",
      "#e3e6db",
      "#121710",
    ]);
    expect(APPEARANCE_DEFAULT_SCHEMES[4]!.colors).toEqual({
      background: "#121710",
      text: "#ece9df",
      heading: "#e3c77d",
      accent: "#e3c77d",
      button: "#e3c77d",
      buttonText: "#121710",
      border: "#2f372c",
    });
  });
});

describe("colorSchemesProblem", () => {
  it("accepts the theme's shipped schemes", () => {
    expect(colorSchemesProblem(APPEARANCE_DEFAULT_SCHEMES)).toBeNull();
  });

  it("rejects a list that is empty or not a list", () => {
    expect(colorSchemesProblem([])).toMatch(/non-empty/);
    expect(colorSchemesProblem({})).toMatch(/non-empty/);
    expect(colorSchemesProblem(null)).toMatch(/non-empty/);
  });

  it("rejects a color that is not a six-digit hex", () => {
    const schemes = clone(APPEARANCE_DEFAULT_SCHEMES);
    schemes[0]!.colors.button = "red";
    expect(colorSchemesProblem(schemes)).toMatch(/hex color for "button"/);
  });

  it("rejects an id that is not lowercase letters, digits and dashes", () => {
    const schemes = clone(APPEARANCE_DEFAULT_SCHEMES);
    schemes[0]!.id = "Scheme 1";
    expect(colorSchemesProblem(schemes)).toMatch(/lowercase letters/);
  });

  it("rejects a repeated id", () => {
    const schemes = clone(APPEARANCE_DEFAULT_SCHEMES);
    schemes[1]!.id = schemes[0]!.id;
    expect(colorSchemesProblem(schemes)).toMatch(/repeats the id/);
  });

  it("rejects a scheme without a name", () => {
    const schemes = clone(APPEARANCE_DEFAULT_SCHEMES) as unknown as Record<string, unknown>[];
    delete schemes[0]!.name;
    expect(colorSchemesProblem(schemes)).toMatch(/needs a name/);
  });

  it("rejects a color role the theme does not read", () => {
    const schemes = clone(APPEARANCE_DEFAULT_SCHEMES) as unknown as Record<string, unknown>[];
    (schemes[0]!.colors as Record<string, string>).glow = "#ffffff";
    expect(colorSchemesProblem(schemes)).toMatch(/unknown role "glow"/);
  });
});

describe("appearanceSettingsProblem", () => {
  it("accepts a page scheme the list names", () => {
    expect(appearanceSettingsProblem(valid())).toBeNull();
  });

  it("rejects a page scheme the list does not name", () => {
    expect(appearanceSettingsProblem({ ...valid(), pageScheme: "scheme-9" })).toMatch(/does not have/);
  });

  it("rejects a page scheme that is not a string", () => {
    expect(appearanceSettingsProblem({ ...valid(), pageScheme: 1 })).toMatch(/must name a scheme/);
  });
});

describe("mergeAppearance", () => {
  it("takes the whole list when the store has no valid schemes yet", () => {
    const next = valid();
    expect(mergeAppearance(null, next)).toEqual({ settings: next });
  });

  it("changes colors while keeping the store's ids, names and order", () => {
    const current = valid();
    const next = valid();
    next.colorSchemes[2]!.colors.background = "#123456";
    next.colorSchemes[2]!.name = "Renamed";
    next.pageScheme = "scheme-3";

    const merged = mergeAppearance(current, next);
    expect(merged.error).toBeUndefined();
    expect(merged.settings!.colorSchemes[2]).toEqual({
      ...current.colorSchemes[2],
      colors: next.colorSchemes[2]!.colors,
    });
    expect(merged.settings!.colorSchemes.map((scheme) => scheme.id)).toEqual(
      current.colorSchemes.map((scheme) => scheme.id),
    );
    expect(merged.settings!.pageScheme).toBe("scheme-3");
  });

  it("refuses to add or remove a scheme", () => {
    const next = valid();
    next.colorSchemes.pop();
    expect(mergeAppearance(valid(), next).error).toMatch(/cannot be added, removed or reordered/);
  });

  it("refuses a list whose ids name different schemes", () => {
    const next = valid();
    next.colorSchemes[0]!.id = "brand";
    next.pageScheme = "brand";
    expect(mergeAppearance(valid(), next).error).toMatch(/cannot be added, removed or reordered|missing/);
  });

  it("refuses a page scheme the store does not have", () => {
    const next = valid();
    next.pageScheme = "scheme-9";
    expect(mergeAppearance(valid(), next).error).toMatch(/scheme-9/);
  });
});

describe("appearanceSettingsOf", () => {
  it("returns the saved settings when the row holds them", () => {
    expect(appearanceSettingsOf({ ...valid() })).toEqual(valid());
  });

  it("returns null for an empty row or a row without usable colors", () => {
    expect(appearanceSettingsOf({})).toBeNull();
    expect(appearanceSettingsOf({ pageScheme: "scheme-1" })).toBeNull();
    expect(appearanceSettingsOf(null)).toBeNull();
  });

  it("ignores the other keys a theme's settings row carries", () => {
    const stored = { ...valid(), headingFont: "Cairo", corners: "round" };
    expect(appearanceSettingsOf(stored)).toEqual(valid());
  });
});

describe("appearanceTextProblem", () => {
  it("accepts a known key within its limit", () => {
    expect(appearanceTextProblem("heroTitle", "Shop with ease")).toBeNull();
    expect(appearanceTextProblem("heroCtaPrimary", "")).toBeNull();
  });

  it("refuses a key the tab does not edit", () => {
    expect(appearanceTextProblem("checkoutTitle", "x")).toMatch(/not an editable text/);
  });

  it("refuses a value past the key's limit", () => {
    expect(appearanceTextProblem("heroCtaPrimary", "x".repeat(41))).toMatch(/at most 40/);
  });

  it("keeps single-line keys single-line and lets a subtitle wrap", () => {
    expect(appearanceTextProblem("heroTitle", "one\ntwo")).toMatch(/single line/);
    expect(appearanceTextProblem("heroSubtitle", "one\ntwo")).toBeNull();
  });
});

describe("appearanceLocaleProblem", () => {
  it("accepts a language the store lists", () => {
    expect(appearanceLocaleProblem("ar", ["ar", "fr"])).toBeNull();
  });

  it("refuses a language the store does not list", () => {
    expect(appearanceLocaleProblem("en", ["ar"])).toMatch(/not one of the store's languages/);
  });
});
