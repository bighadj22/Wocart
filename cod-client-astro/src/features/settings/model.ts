import { Languages, Search, ShoppingCart, Store, Truck, type LucideIcon } from "lucide-react";
import { STORE_LOCALES, type StoreLocale } from "../../../../cod-shared/i18n/locales";
import type { TranslatableKey } from "../../../../cod-shared/i18n/translations";
import type { StoreLanguage } from "./types";

export type CategoryId = "general" | "languages" | "seo" | "cart" | "delivery";

export interface SettingsCategory {
  id: CategoryId;
  icon: LucideIcon;
  /** Dot-path into the settings `store` namespace. */
  labelKey: string;
}

/** The settings categories, in sidebar order: the store itself. Its Apps and Integrations have their own pages. */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "general", icon: Store, labelKey: "general_title" },
  { id: "languages", icon: Languages, labelKey: "languages_title" },
  { id: "seo", icon: Search, labelKey: "seo_title" },
  { id: "cart", icon: ShoppingCart, labelKey: "cart_title" },
  { id: "delivery", icon: Truck, labelKey: "delivery_pricing_title" },
];

/** The store's translatable text, each translated beside the field it translates: the currency symbol in General, the search listing in SEO. */
export const STORE_TRANSLATED_FIELDS = {
  general: ["currencySymbol"],
  seo: ["metaTitle", "metaDescription"],
} as const satisfies Record<string, readonly TranslatableKey<"store">[]>;

/** The category a link opens Settings on (`/settings?section=cart`); General otherwise. */
export function categoryFromSearch(search: string): CategoryId {
  const section = new URLSearchParams(search).get("section");
  return SETTINGS_CATEGORIES.find((category) => category.id === section)?.id ?? "general";
}

export function settingsErrorMessage(_cause: unknown, t: (key: string) => string) {
  return t("store.save_error");
}

/**
 * The store's languages while the merchant edits them (Settings → Languages).
 * The rules mirror the server's (`cod-shared/stores/settings.ts`): the
 * default language is always listed and published; the others are published
 * or drafts. The server re-checks every save.
 */
export interface LanguageDraft {
  primary: StoreLocale;
  languages: { locale: StoreLocale; published: boolean }[];
}

export function languageDraft(languages: readonly StoreLanguage[], primary: StoreLocale): LanguageDraft {
  return { primary, languages: languages.map(({ locale, published }) => ({ locale, published })) };
}

/** Languages the platform supports that the store has not added yet. */
export function addableLocales(draft: LanguageDraft): StoreLocale[] {
  return STORE_LOCALES.filter((locale) => !draft.languages.some((language) => language.locale === locale));
}

/** A new language starts unpublished, so it can be translated before shoppers see it. */
export function addLanguage(draft: LanguageDraft, locale: StoreLocale): LanguageDraft {
  if (draft.languages.some((language) => language.locale === locale)) return draft;
  return { ...draft, languages: [...draft.languages, { locale, published: false }] };
}

export function removeLanguage(draft: LanguageDraft, locale: StoreLocale): LanguageDraft {
  if (locale === draft.primary) return draft;
  return { ...draft, languages: draft.languages.filter((language) => language.locale !== locale) };
}

export function setPublished(draft: LanguageDraft, locale: StoreLocale, published: boolean): LanguageDraft {
  if (locale === draft.primary) return draft;
  return {
    ...draft,
    languages: draft.languages.map((language) => (language.locale === locale ? { ...language, published } : language)),
  };
}

/** The default language must be published; making one the default publishes it. */
export function makeDefault(draft: LanguageDraft, locale: StoreLocale): LanguageDraft {
  if (!draft.languages.some((language) => language.locale === locale)) return draft;
  return {
    primary: locale,
    languages: draft.languages.map((language) => (language.locale === locale ? { ...language, published: true } : language)),
  };
}

/** The `PATCH /api/stores/me` body for a language save. */
export function languagesPayload(draft: LanguageDraft): { lang: StoreLocale; languages: LanguageDraft["languages"] } {
  return { lang: draft.primary, languages: draft.languages };
}
