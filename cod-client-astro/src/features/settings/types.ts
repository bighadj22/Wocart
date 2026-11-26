import type { MediaImage } from "../../../../cod-shared/media/model";
import type { StoreLocale } from "../../../../cod-shared/i18n/locales";
import type { LocaleRow, StoreLanguage } from "../../../../cod-shared/stores/settings";
import type {
  AppearanceColorScheme,
  AppearanceHomeSectionKey,
  AppearanceLogoAlignment,
} from "../../../../cod-shared/stores/appearance";

export type { StoreLanguage };

/** A store language (`cod-shared/i18n/locales.ts`). */
export type StoreLang = StoreLocale;

/** The single tenant's configuration as returned by the stores API. */
export interface StoreConfig {
  id: string;
  name: string;
  domain: string | null;
  logo: MediaImage | null;
  themeId: string;
  /** The primary language: the storefront's language and first fallback. */
  lang: StoreLang;
  /** Every language the store has added, primary first, published or not. */
  languages: StoreLanguage[];
  currency: string;
  currencySymbol: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: MediaImage | null;
  /** Shopping cart opt-in. False keeps the storefront exactly as it is. */
  cartEnabled: boolean;
  /** Order subtotal (DZD) at or above which delivery is free. null = off. */
  freeShippingThreshold: number | null;
  /** Which rate a basket spanning several shipping profiles pays. */
  cartShippingMode: "highest" | "default_profile";
  storeApiKey: string | null;
}

export type UpdateStoreData = Partial<
  Pick<
    StoreConfig,
    | "name"
    | "domain"
    | "lang"
    | "currencySymbol"
    | "metaTitle"
    | "metaDescription"
    | "cartEnabled"
    | "freeShippingThreshold"
    | "cartShippingMode"
  >
> & {
  /** The logo's Media Key, from a completed upload; null removes it. */
  logoKey?: string | null;
  /** The share image's Media Key, from a completed upload; null removes it. */
  ogImageKey?: string | null;
  /** Replaces the store's languages; must publish the primary. */
  languages?: LocaleRow[];
};

/** The storefront's colors and theme text, as the Appearance tab reads them. */
export interface StoreAppearance {
  /** The theme whose settings row and text edits are being edited. */
  themeKey: string;
  primaryLocale: StoreLocale;
  /** Every language the store lists; only these can hold text edits. */
  locales: StoreLocale[];
  colorSchemes: AppearanceColorScheme[];
  pageScheme: string;
  hideLogo: boolean;
  searchEnabled: boolean;
  /** Sanitized HTML the store puts above its header. */
  headerHtml: string;
  /** Where the logo sits, regardless of the header's own logo position. */
  logoAlignment: AppearanceLogoAlignment;
  priceColors?: { oldPrice?: string; newPrice?: string };
  bannerBodyHtml: string;
  /** One entry for every home section, including an image ready to preview. */
  sections: Record<AppearanceHomeSectionKey, { hidden: boolean; image: MediaImage | null }>;
  /** Saved text edits, `{ ar: { heroTitle: "…" } }`. */
  texts: Partial<Record<StoreLocale, Record<string, string>>>;
}
