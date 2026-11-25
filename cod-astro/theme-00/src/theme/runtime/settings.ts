/**
 * The theme's settings for this request: the store's values checked against
 * the theme's declaration (`resolveThemeSettings`), resolved once per store
 * context however many components ask — the layout, every product card.
 *
 * The declaration is read from the settings module, not from `shellCatalog`:
 * that catalog imports the header, and the header reads these settings. Going
 * through the catalog would make its own component reference circular.
 */
import { resolveThemeSettings, type InferSettings, type ThemeDefinition } from "@wocart/theme";
import { THEME_STYLE } from "@/theme/appearance";
import { THEME_KEY } from "@/theme/key";
import { THEME_SETTINGS } from "@/theme/settings";
import type { shellCatalog } from "@/theme/catalog/families/shell";
import type { StoreContext } from "./store";

export type ThemeSettings = InferSettings<typeof shellCatalog>;

const declaration = { key: THEME_KEY, style: THEME_STYLE, settings: THEME_SETTINGS } as unknown as ThemeDefinition;
const resolved = new WeakMap<StoreContext, ThemeSettings>();

export function settingsOf(store: StoreContext): ThemeSettings {
  let values = resolved.get(store);
  if (values === undefined) {
    values = resolveThemeSettings(declaration, store.config.themeSettings, {
      content: store.content,
      locales: [store.locale, ...store.fallbackLocales],
    }).values as ThemeSettings;
    resolved.set(store, values);
  }
  return values;
}
