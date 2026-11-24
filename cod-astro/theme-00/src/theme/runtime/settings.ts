/**
 * The theme's settings for this request: the store's values checked against
 * the theme's declaration (`resolveThemeSettings`), resolved once per store
 * context however many components ask — the layout, every product card.
 */
import { resolveThemeSettings, type InferSettings } from "@wocart/theme";
import { shellCatalog } from "@/theme/catalog/families/shell";
import type { StoreContext } from "./store";

export type ThemeSettings = InferSettings<typeof shellCatalog>;

const resolved = new WeakMap<StoreContext, ThemeSettings>();

export function settingsOf(store: StoreContext): ThemeSettings {
  let values = resolved.get(store);
  if (values === undefined) {
    values = resolveThemeSettings(shellCatalog, store.config.themeSettings, {
      content: store.content,
      locales: [store.locale, ...store.fallbackLocales],
    }).values;
    resolved.set(store, values);
  }
  return values;
}

export type HomeImageSettings = Pick<ThemeSettings, "heroImage" | "bannerImage" | "categoryCardsImage">;

export function homeImageSettingsOf(store: StoreContext): HomeImageSettings {
  const { heroImage, bannerImage, categoryCardsImage } = settingsOf(store);
  return { heroImage, bannerImage, categoryCardsImage };
}

export type HomeVisibilitySettings = Pick<ThemeSettings, "heroVisible" | "categoryCardsVisible">;

export function homeVisibilityOf(store: StoreContext): HomeVisibilitySettings {
  const { heroVisible, categoryCardsVisible } = settingsOf(store);
  return { heroVisible, categoryCardsVisible };
}
