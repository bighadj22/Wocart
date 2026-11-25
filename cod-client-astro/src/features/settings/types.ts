import type { MediaImage } from "../../../../cod-shared/media/model";
import type { StoreLocale } from "../../../../cod-shared/i18n/locales";
import type { LocaleRow, StoreLanguage } from "../../../../cod-shared/stores/settings";

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
