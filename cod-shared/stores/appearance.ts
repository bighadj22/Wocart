/**
 * The Appearance tab's contract: the store's color schemes and the theme text
 * edits, as the dashboard writes them and the API checks them.
 *
 * Pure — no database access. The theme still validates what it reads
 * (`resolveThemeSettings`), so a value written here by an older editor falls
 * back to the theme's default instead of breaking a page.
 */
import type { StoreLocale } from "../i18n/locales";
import { MEDIA_FOLDERS } from "../media/keys";

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
const MEDIA_KEY_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
export const APPEARANCE_MEDIA_KEY = new RegExp(
  `^(?=.{3,512}$)(?:${MEDIA_FOLDERS.join("|")})(?:/${MEDIA_KEY_SEGMENT})+$`,
);

export const APPEARANCE_LOGO_ALIGNMENTS = ["right", "left", "center"] as const;
export type AppearanceLogoAlignment = (typeof APPEARANCE_LOGO_ALIGNMENTS)[number];

/** The home sections the Appearance tab controls, in the page's order. */
export const APPEARANCE_HOME_SECTIONS = [
  { key: "hero", hiddenKey: "homeHeroHidden", imageKey: "homeHeroImage" },
  { key: "marquee", hiddenKey: "homeMarqueeHidden", imageKey: "homeMarqueeImage" },
  { key: "category-cards", hiddenKey: "homeCategoryCardsHidden", imageKey: "homeCategoryCardsImage" },
  { key: "product-tabs", hiddenKey: "homeProductTabsHidden", imageKey: "homeProductTabsImage" },
  { key: "image-banner", hiddenKey: "homeImageBannerHidden", imageKey: "homeImageBannerImage" },
  { key: "how-it-works", hiddenKey: "homeHowItWorksHidden", imageKey: "homeHowItWorksImage" },
  { key: "customer-testimonials", hiddenKey: "homeCustomerTestimonialsHidden", imageKey: "homeCustomerTestimonialsImage" },
  { key: "features-bar", hiddenKey: "homeFeaturesBarHidden", imageKey: "homeFeaturesBarImage" },
] as const;

export type AppearanceHomeSectionKey = (typeof APPEARANCE_HOME_SECTIONS)[number]["key"];

export interface AppearanceImage {
  key: string;
  alt?: string;
  width?: number;
  height?: number;
  focal?: { x: number; y: number };
}

export interface AppearanceSectionEdit {
  /** Absent or false shows the section; true hides it. */
  hidden?: boolean | null;
  /** A media key; null removes the merchant's photo. */
  image?: AppearanceImage | null;
}

export type AppearanceSectionEdits = Partial<Record<AppearanceHomeSectionKey, AppearanceSectionEdit>>;

export type AppearanceSchemeName = string | Record<string, string>;

export interface AppearanceColorScheme {
  id: string;
  name: AppearanceSchemeName;
  colors: Record<AppearanceColorRole, string>;
}

export interface AppearanceSettings {
  colorSchemes: AppearanceColorScheme[];
  pageScheme: string;
  /** A write that only saves colors leaves the other controls as they were. */
  hideLogo?: boolean;
  searchEnabled?: boolean;
  headerHtml?: string;
  /** Where the logo sits, independent of the search icon and the header's own fields. */
  logoAlignment?: AppearanceLogoAlignment;
  /** Per-section visibility and photo overrides. */
  sections?: AppearanceSectionEdits;
}

/** The editor's starting palette, mirroring Theme-00's shipped schemes. */
export const APPEARANCE_DEFAULT_SCHEMES: AppearanceColorScheme[] = [
  {
    id: "scheme-1",
    name: "Light",
    colors: { background: "#ffffff", text: "#3b4250", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#e8e8e5" },
  },
  {
    id: "scheme-2",
    name: "Stone",
    colors: { background: "#f4f4f1", text: "#3b4250", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#e2e2dc" },
  },
  {
    id: "scheme-3",
    name: "Sand",
    colors: { background: "#efe4d6", text: "#4a4136", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#e0d2bf" },
  },
  {
    id: "scheme-4",
    name: "Saffron",
    colors: { background: "#f2c14e", text: "#2a2416", heading: "#0f1626", accent: "#c8102e", button: "#0f1626", buttonText: "#ffffff", border: "#d9a93a" },
  },
  {
    id: "scheme-5",
    name: "Night",
    colors: { background: "#0f1626", text: "#b9c0cd", heading: "#ffffff", accent: "#f2c14e", button: "#ffffff", buttonText: "#0f1626", border: "#26324b" },
  },
  {
    id: "scheme-6",
    name: "Olive",
    colors: { background: "#f3f2e7", text: "#343a29", heading: "#1f2716", accent: "#66763b", button: "#4b5b2c", buttonText: "#ffffff", border: "#d6d9bd" },
  },
];

export const APPEARANCE_HEADER_HTML_MAX = 2000;

const HEADER_HTML_TAGS = new Set(["a", "b", "strong", "i", "em", "u", "small", "span", "br"]);
const HEADER_HTML_ATTR = /([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const HEADER_HTML_TAG = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi;
const SAFE_HEADER_HREF = /^(https?:\/\/|\/|#|\?|mailto:|tel:)/i;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function sanitizeHeaderHtml(value: string): string {
  let output = "";
  let last = 0;
  for (const match of value.matchAll(HEADER_HTML_TAG)) {
    const start = match.index ?? 0;
    output += escapeHtml(value.slice(last, start));
    last = start + match[0].length;
    const tag = match[1]!.toLowerCase();
    if (!HEADER_HTML_TAGS.has(tag)) {
      output += escapeHtml(match[0]);
      continue;
    }
    if (match[0].startsWith("</")) {
      output += `</${tag}>`;
      continue;
    }
    const attributes: string[] = [];
    for (const attribute of (match[2] ?? "").matchAll(HEADER_HTML_ATTR)) {
      const name = attribute[1]!.toLowerCase();
      const raw = attribute[3] ?? attribute[4] ?? attribute[5] ?? "";
      if (name === "class") {
        const className = raw.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 120);
        if (className) attributes.push(`class="${escapeHtml(className)}"`);
      } else if (tag === "a" && name === "href" && SAFE_HEADER_HREF.test(raw.trim())) {
        attributes.push(`href="${escapeHtml(raw.trim())}"`);
      } else if (tag === "a" && name === "target" && raw.trim() === "_blank") {
        attributes.push('target="_blank"', 'rel="noopener noreferrer"');
      }
    }
    const selfClosing = /\/\s*$/.test(match[2] ?? "") ? " /" : "";
    output += `<${tag}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}${selfClosing}>`;
  }
  return output + escapeHtml(value.slice(last));
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SECTION_KEYS: readonly string[] = APPEARANCE_HOME_SECTIONS.map((section) => section.key);

export function appearanceImageProblem(value: unknown): string | null {
  if (!isRecord(value)) return "must be an image reference";
  const image = value;
  const unknown = Object.keys(image).find((key) => !["key", "alt", "width", "height", "focal"].includes(key));
  if (unknown !== undefined) return `has an unknown key "${unknown}"`;
  if (typeof image.key !== "string" || !APPEARANCE_MEDIA_KEY.test(image.key)) return "needs a media key";
  if (image.alt !== undefined && typeof image.alt !== "string") return "needs a string alt";
  for (const dimension of ["width", "height"] as const) {
    const size = image[dimension];
    if (size !== undefined && !(typeof size === "number" && Number.isInteger(size) && size > 0)) {
      return `needs a whole-number ${dimension}`;
    }
  }
  if (image.focal !== undefined) {
    if (!isRecord(image.focal)) return "needs a focal point";
    for (const axis of ["x", "y"] as const) {
      const point = image.focal[axis];
      if (typeof point !== "number" || !Number.isFinite(point) || point < 0 || point > 1) {
        return `needs a focal ${axis} between 0 and 1`;
      }
    }
  }
  return null;
}

export function appearanceSectionsProblem(value: unknown): string | null {
  if (!isRecord(value)) return "sections must be an object";
  for (const [key, edit] of Object.entries(value)) {
    if (!SECTION_KEYS.includes(key)) return `"${key}" is not a home section`;
    if (!isRecord(edit)) return `section "${key}" must be an object`;
    const unknown = Object.keys(edit).find((name) => name !== "hidden" && name !== "image");
    if (unknown !== undefined) return `section "${key}" has an unknown key "${unknown}"`;
    if (edit.hidden !== undefined && edit.hidden !== null && typeof edit.hidden !== "boolean") {
      return `section "${key}" must be hidden or shown`;
    }
    if (edit.image !== undefined && edit.image !== null) {
      const problem = appearanceImageProblem(edit.image);
      if (problem) return `section "${key}" image ${problem}`;
    }
  }
  return null;
}

/**
 * The flat keys a section edit takes in `themeSettings` — the theme declares
 * them one by one so its own resolver can validate what it reads.
 */
export function appearanceSettingsToTheme(settings: AppearanceSettings): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    colorSchemes: settings.colorSchemes,
    pageScheme: settings.pageScheme,
    hideLogo: settings.hideLogo ?? false,
    searchEnabled: settings.searchEnabled ?? true,
    headerHtml: sanitizeHeaderHtml(settings.headerHtml ?? ""),
    logoAlignment: settings.logoAlignment ?? "right",
  };
  for (const section of APPEARANCE_HOME_SECTIONS) {
    const edit = settings.sections?.[section.key];
    if (edit?.hidden === true) flat[section.hiddenKey] = true;
    if (edit?.image !== undefined && edit.image !== null) flat[section.imageKey] = edit.image;
  }
  return flat;
}

/** Flat keys a cleared override — and the old grouped switch — must remove from a stored settings row. */
export function appearanceSettingsToRemove(settings: AppearanceSettings): string[] {
  const removed = ["hideHeroImages"];
  for (const section of APPEARANCE_HOME_SECTIONS) {
    const edit = settings.sections?.[section.key];
    if (edit?.hidden !== true) removed.push(section.hiddenKey);
    if (edit?.image === null || edit?.image === undefined) removed.push(section.imageKey);
  }
  return removed;
}

/** Read the flat theme settings row back into the tab's nested shape. */
export function appearanceThemeSettingsOf(stored: Record<string, unknown> | null | undefined): AppearanceSettings | null {
  if (!stored) return null;
  const sections: AppearanceSectionEdits = {};
  for (const section of APPEARANCE_HOME_SECTIONS) {
    const edit: AppearanceSectionEdit = {};
    if (stored[section.hiddenKey] === true) edit.hidden = true;
    const image = stored[section.imageKey];
    if (image !== undefined && appearanceImageProblem(image) === null) edit.image = image as AppearanceImage;
    if (Object.keys(edit).length > 0) sections[section.key] = edit;
  }
  if (stored.hideHeroImages === true) {
    if (stored.homeHeroHidden === undefined) sections.hero = { ...sections.hero, hidden: true };
    if (stored.homeImageBannerHidden === undefined) {
      sections["image-banner"] = { ...sections["image-banner"], hidden: true };
    }
  }
  const candidate = {
    colorSchemes: stored.colorSchemes,
    pageScheme: stored.pageScheme,
    hideLogo: stored.hideLogo ?? false,
    searchEnabled: stored.searchEnabled ?? true,
    headerHtml: typeof stored.headerHtml === "string" ? stored.headerHtml : "",
    logoAlignment: APPEARANCE_LOGO_ALIGNMENTS.includes(stored.logoAlignment as AppearanceLogoAlignment)
      ? (stored.logoAlignment as AppearanceLogoAlignment)
      : "right",
    sections: Object.keys(sections).length > 0 ? sections : undefined,
  };
  return appearanceSettingsProblem(candidate) === null ? (candidate as AppearanceSettings) : null;
}

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
  for (const key of ["hideLogo", "searchEnabled"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return `${key} must be on or off`;
  }
  if (value.headerHtml !== undefined && typeof value.headerHtml !== "string") {
    return "headerHtml must be text";
  }
  if (typeof value.headerHtml === "string" && value.headerHtml.length > APPEARANCE_HEADER_HTML_MAX) {
    return `headerHtml holds at most ${APPEARANCE_HEADER_HTML_MAX} characters`;
  }
  if (value.logoAlignment !== undefined && !(APPEARANCE_LOGO_ALIGNMENTS as readonly string[]).includes(value.logoAlignment as string)) {
    return "logoAlignment must be right, left or center";
  }
  if (value.sections !== undefined) {
    const sectionsProblem = appearanceSectionsProblem(value.sections);
    if (sectionsProblem) return sectionsProblem;
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
  const sections: AppearanceSectionEdits = current?.sections ? JSON.parse(JSON.stringify(current.sections)) : {};
  for (const [key, edit] of Object.entries(next.sections ?? {})) {
    const merged: AppearanceSectionEdit = { ...sections[key as AppearanceHomeSectionKey] };
    if (edit.hidden !== undefined) merged.hidden = edit.hidden;
    if (Object.prototype.hasOwnProperty.call(edit, "image")) merged.image = edit.image ?? null;
    if (merged.hidden === undefined || merged.hidden === null) delete merged.hidden;
    if (merged.image === undefined) delete merged.image;
    sections[key as AppearanceHomeSectionKey] = merged;
  }
  const controls = {
    hideLogo: next.hideLogo ?? current?.hideLogo ?? false,
    searchEnabled: next.searchEnabled ?? current?.searchEnabled ?? true,
    headerHtml: sanitizeHeaderHtml(next.headerHtml ?? current?.headerHtml ?? ""),
    logoAlignment: next.logoAlignment ?? current?.logoAlignment ?? "right",
    sections: Object.keys(sections).length > 0 ? sections : undefined,
  };
  if (!current || current.colorSchemes.length === 0) return { settings: { ...next, ...controls } };
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
  return {
    settings: {
      colorSchemes: merged,
      pageScheme: next.pageScheme,
      ...controls,
    },
  };
}

/** Parse whatever the row holds into the tab's shape, or null. */
export function appearanceSettingsOf(stored: Record<string, unknown> | null | undefined): AppearanceSettings | null {
  if (!stored) return null;
  const candidate = {
    colorSchemes: stored.colorSchemes,
    pageScheme: stored.pageScheme,
    hideLogo: stored.hideLogo ?? false,
    searchEnabled: stored.searchEnabled ?? true,
    headerHtml: typeof stored.headerHtml === "string" ? stored.headerHtml : "",
    logoAlignment: stored.logoAlignment ?? "right",
    sections: stored.sections,
  };
  return appearanceSettingsProblem(candidate) === null ? (candidate as AppearanceSettings) : null;
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
