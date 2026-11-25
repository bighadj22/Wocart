/**
 * The Appearance tab's contract: the store's color schemes and the theme text
 * edits, as the dashboard writes them and the API checks them.
 *
 * Pure — no database access. The theme still validates what it reads
 * (`resolveThemeSettings`), so a value written here by an older editor falls
 * back to the theme's default instead of breaking a page.
 */
import type { StoreLocale } from "../i18n/locales";

export const APPEARANCE_COLOR_ROLES = [
  "background",
  "text",
  "heading",
  "accent",
  "button",
  "buttonText",
  "border",
] as const;

export type AppearanceColorRole = (typeof APPEARANCE_COLOR_ROLES)[number];

export const APPEARANCE_MAX_SCHEMES = 12;
export const APPEARANCE_SCHEME_ID = /^[a-z0-9-]+$/;
export const APPEARANCE_HEX = /^#[0-9a-f]{6}$/i;
export const APPEARANCE_MEDIA_KEY = /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

export type AppearanceSchemeName = string | Record<string, string>;

export interface AppearanceColorScheme {
  id: string;
  name: AppearanceSchemeName;
  colors: Record<AppearanceColorRole, string>;
}

export interface AppearanceSettings {
  colorSchemes: AppearanceColorScheme[];
  pageScheme: string;
}

/** The editor's starting palette, mirroring Theme-00's shipped schemes. */
export const APPEARANCE_DEFAULT_SCHEMES: AppearanceColorScheme[] = [
  {
    id: "scheme-1",
    name: { ar: "فاتح", fr: "Clair", en: "Light" },
    colors: { background: "#faf8f3", text: "#4b524c", heading: "#141815", accent: "#14532d", button: "#14532d", buttonText: "#ffffff", border: "#e2ddd1" },
  },
  {
    id: "scheme-2",
    name: { ar: "حجري", fr: "Pierre", en: "Stone" },
    colors: { background: "#f1ede4", text: "#4b524c", heading: "#141815", accent: "#14532d", button: "#14532d", buttonText: "#ffffff", border: "#d8d2c4" },
  },
  {
    id: "scheme-3",
    name: { ar: "رملي", fr: "Sable", en: "Sand" },
    colors: { background: "#e7e1d4", text: "#5b6055", heading: "#141815", accent: "#14532d", button: "#14532d", buttonText: "#ffffff", border: "#cdc6b5" },
  },
  {
    id: "scheme-4",
    name: { ar: "زيتوني", fr: "Olive", en: "Olive" },
    colors: { background: "#e3e6db", text: "#444b3d", heading: "#141815", accent: "#14532d", button: "#14532d", buttonText: "#ffffff", border: "#c9cdbb" },
  },
  {
    id: "scheme-5",
    name: { ar: "ليلي", fr: "Nuit", en: "Night" },
    colors: { background: "#121710", text: "#ece9df", heading: "#e3c77d", accent: "#e3c77d", button: "#e3c77d", buttonText: "#121710", border: "#2f372c" },
  },
];

/** The theme text keys the Appearance tab edits, with what each one is. */
export const APPEARANCE_TEXT_KEYS = [
  "heroTitle",
  "heroSubtitle",
  "heroCtaPrimary",
  "heroCtaSecondary",
  "bannerTag",
  "bannerTitle",
  "bannerSub",
] as const;

export type AppearanceTextKey = (typeof APPEARANCE_TEXT_KEYS)[number];

export const APPEARANCE_TEXT_LIMITS: Record<AppearanceTextKey, { max: number; multiline: boolean }> = {
  heroTitle: { max: 120, multiline: false },
  heroSubtitle: { max: 400, multiline: true },
  heroCtaPrimary: { max: 40, multiline: false },
  heroCtaSecondary: { max: 40, multiline: false },
  bannerTag: { max: 40, multiline: false },
  bannerTitle: { max: 120, multiline: false },
  bannerSub: { max: 400, multiline: true },
};

export const APPEARANCE_IMAGE_KEYS = ["heroImage", "bannerImage", "categoryCardsImage"] as const;

export type AppearanceImageKey = (typeof APPEARANCE_IMAGE_KEYS)[number];

export interface AppearanceImage {
  key: string;
  alt?: string;
  width?: number;
  height?: number;
  focal?: { x: number; y: number };
}

export type AppearanceImages = Partial<Record<AppearanceImageKey, AppearanceImage | null>>;

export function appearanceImageProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "must be an image reference";
  const image = value as Record<string, unknown>;
  const unknown = Object.keys(image).find((key) => !["key", "alt", "width", "height", "focal"].includes(key));
  if (unknown !== undefined) return `has an unknown key "${unknown}"`;
  if (typeof image.key !== "string" || !APPEARANCE_MEDIA_KEY.test(image.key)) return "needs a media key";
  if (image.alt !== undefined && typeof image.alt !== "string") return "needs a string alt";
  for (const dimension of ["width", "height"] as const) {
    const size = image[dimension];
    if (size !== undefined && !(typeof size === "number" && Number.isInteger(size) && size > 0)) return `needs a whole-number ${dimension}`;
  }
  if (image.focal !== undefined) {
    const focal = image.focal as Record<string, unknown>;
    if (typeof focal !== "object" || focal === null || Array.isArray(focal)) return "needs a focal point";
    for (const axis of ["x", "y"] as const) {
      const point = focal[axis];
      if (typeof point !== "number" || !Number.isFinite(point) || point < 0 || point > 1) return `needs a focal ${axis} between 0 and 1`;
    }
  }
  return null;
}

export function appearanceImagesOf(stored: Record<string, unknown> | null | undefined): AppearanceImages {
  const images: AppearanceImages = {};
  if (!stored) return images;
  for (const key of APPEARANCE_IMAGE_KEYS) {
    const value = stored[key];
    if (appearanceImageProblem(value) === null) images[key] = value as AppearanceImage;
  }
  return images;
}

export function mergeAppearanceImages(current: AppearanceImages, next: AppearanceImages): AppearanceImages {
  const merged: AppearanceImages = { ...current };
  for (const key of APPEARANCE_IMAGE_KEYS) {
    const value = next[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

export const APPEARANCE_VISIBILITY_KEYS = ["heroVisible", "categoryCardsVisible"] as const;

export type AppearanceVisibilityKey = (typeof APPEARANCE_VISIBILITY_KEYS)[number];

export type AppearanceVisibility = Partial<Record<AppearanceVisibilityKey, boolean | null>>;

export function appearanceVisibilityOf(stored: Record<string, unknown> | null | undefined): AppearanceVisibility {
  const values: AppearanceVisibility = {};
  if (!stored) return values;
  for (const key of APPEARANCE_VISIBILITY_KEYS) {
    if (typeof stored[key] === "boolean") values[key] = stored[key] as boolean;
  }
  return values;
}

export function mergeAppearanceVisibility(current: AppearanceVisibility, next: AppearanceVisibility): AppearanceVisibility {
  const merged: AppearanceVisibility = { ...current };
  for (const key of APPEARANCE_VISIBILITY_KEYS) {
    const value = next[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemeNameProblem = (name: unknown): string | null => {
  if (typeof name === "string") return name.length > 0 ? null : "needs a name";
  if (!isRecord(name) || Object.keys(name).length === 0) return "needs a name";
  return Object.values(name).every((value) => typeof value === "string" && value.length > 0)
    ? null
    : "needs a name";
};

/** Mirrors the theme's `colorSchemesProblem`, so a bad value never reaches D1. */
export function colorSchemesProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return "must be a non-empty list of color schemes";
  if (value.length > APPEARANCE_MAX_SCHEMES) return `holds at most ${APPEARANCE_MAX_SCHEMES} color schemes`;
  const ids = new Set<string>();
  for (const [index, scheme] of value.entries()) {
    if (!isRecord(scheme)) return `scheme ${index} must be { id, name, colors }`;
    const extra = Object.keys(scheme).find((key) => key !== "id" && key !== "name" && key !== "colors");
    if (extra !== undefined) return `scheme ${index} has an unknown key "${extra}"`;
    if (typeof scheme.id !== "string" || !APPEARANCE_SCHEME_ID.test(scheme.id)) {
      return `scheme ${index} needs an id of lowercase letters, digits and dashes`;
    }
    if (ids.has(scheme.id)) return `scheme ${index} repeats the id "${scheme.id}"`;
    ids.add(scheme.id);
    const nameProblem = schemeNameProblem(scheme.name);
    if (nameProblem) return `scheme "${scheme.id}" ${nameProblem}`;
    if (!isRecord(scheme.colors)) return `scheme "${scheme.id}" needs colors`;
    for (const role of APPEARANCE_COLOR_ROLES) {
      const color = scheme.colors[role];
      if (typeof color !== "string" || !APPEARANCE_HEX.test(color)) {
        return `scheme "${scheme.id}" needs a hex color for "${role}"`;
      }
    }
    const unknown = Object.keys(scheme.colors).find(
      (role) => !(APPEARANCE_COLOR_ROLES as readonly string[]).includes(role),
    );
    if (unknown !== undefined) return `scheme "${scheme.id}" has an unknown role "${unknown}"`;
  }
  return null;
}

/** The whole `themeSettings` slice the tab owns. */
export function appearanceSettingsProblem(value: unknown): string | null {
  if (!isRecord(value)) return "settings must be an object";
  const schemesProblem = colorSchemesProblem(value.colorSchemes);
  if (schemesProblem) return schemesProblem;
  const schemes = value.colorSchemes as AppearanceColorScheme[];
  if (typeof value.pageScheme !== "string") return "pageScheme must name a scheme";
  if (!schemes.some((scheme) => scheme.id === value.pageScheme)) {
    return `pageScheme names "${value.pageScheme}", which the store does not have`;
  }
  return null;
}

/**
 * Keep every scheme the store already has, in its order: page documents name
 * scheme ids, so adding, removing or renaming one would silently restyle
 * sections the merchant never opened. Only colors (and, for a store with no
 * saved schemes yet, the whole list) may change.
 */
export function mergeAppearance(
  current: AppearanceSettings | null,
  next: AppearanceSettings,
): { settings?: AppearanceSettings; error?: string } {
  const problem = appearanceSettingsProblem(next);
  if (problem) return { error: problem };
  if (!current || current.colorSchemes.length === 0) return { settings: next };
  if (next.colorSchemes.length !== current.colorSchemes.length) {
    return { error: "The store's color schemes cannot be added, removed or reordered here" };
  }
  const byId = new Map(next.colorSchemes.map((scheme) => [scheme.id, scheme]));
  for (const scheme of current.colorSchemes) {
    if (!byId.has(scheme.id)) {
      return { error: `The store's color scheme "${scheme.id}" is missing` };
    }
  }
  const merged = current.colorSchemes.map((scheme) => ({
    ...scheme,
    colors: byId.get(scheme.id)!.colors,
  }));
  if (!merged.some((scheme) => scheme.id === next.pageScheme)) {
    return { error: `pageScheme names "${next.pageScheme}", which the store does not have` };
  }
  return { settings: { colorSchemes: merged, pageScheme: next.pageScheme } };
}

/** Parse whatever the row holds into the tab's shape, or null. */
export function appearanceSettingsOf(stored: Record<string, unknown> | null | undefined): AppearanceSettings | null {
  if (!stored) return null;
  const candidate = { colorSchemes: stored.colorSchemes, pageScheme: stored.pageScheme };
  return appearanceSettingsProblem(candidate) === null ? (candidate as unknown as AppearanceSettings) : null;
}

export function appearanceTextProblem(key: string, value: string): string | null {
  if (!(APPEARANCE_TEXT_KEYS as readonly string[]).includes(key)) return `"${key}" is not an editable text`;
  const limit = APPEARANCE_TEXT_LIMITS[key as AppearanceTextKey];
  if (value.length > limit.max) return `"${key}" holds at most ${limit.max} characters`;
  if (!limit.multiline && /[\r\n]/.test(value)) return `"${key}" must be a single line`;
  return null;
}

/** A locale is editable only while the store lists it (`store_locales`). */
export function appearanceLocaleProblem(locale: string, storeLocales: readonly StoreLocale[]): string | null {
  return (storeLocales as readonly string[]).includes(locale)
    ? null
    : `"${locale}" is not one of the store's languages`;
}
