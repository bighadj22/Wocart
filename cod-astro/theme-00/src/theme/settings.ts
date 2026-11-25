/**
 * Theme-00's global settings: what a merchant chooses once for the whole
 * store — its color schemes and which one the page wears, the faces for
 * headings and text, the corners, and the shape of a product card's photo —
 * read from `StoreConfig.themeSettings` against this declaration
 * (`resolveThemeSettings`). Every setting has a default, so a store that saved
 * nothing renders exactly as designed. The merchant edits them in the theme
 * editor (CodFlow Cloud); this theme only reads them.
 *
 * The header and the footer — their menus, the announcement — are sections of
 * the store's header and footer areas, edited where they are seen.
 */
import type { SettingsGroup } from "@wocart/theme";
import { BODY_FONT, CARD_RATIOS, CORNERS, DEFAULT_SCHEMES, FONT_FAMILIES, HEADING_FONT, PAGE_SCHEME } from "./appearance";
import { OPTION, SETTING, SETTINGS_GROUP } from "./catalog/labels";

export const THEME_SETTINGS = [
  {
    key: "colors",
    label: SETTINGS_GROUP.colors,
    fields: [
      { key: "colorSchemes", kind: "colorSchemes", label: SETTING.colorSchemes, default: DEFAULT_SCHEMES },
      { key: "pageScheme", kind: "colorScheme", label: SETTING.pageScheme, default: PAGE_SCHEME },
    ],
  },
  {
    key: "typography",
    label: SETTINGS_GROUP.typography,
    fields: [
      { key: "headingFont", kind: "select", label: SETTING.headingFont, options: FONT_FAMILIES, default: HEADING_FONT },
      { key: "font", kind: "select", label: SETTING.font, options: FONT_FAMILIES, default: BODY_FONT },
    ],
  },
  {
    key: "shape",
    label: SETTINGS_GROUP.shape,
    fields: [
      {
        key: "corners",
        kind: "select",
        label: SETTING.corners,
        options: CORNERS,
        optionLabels: { sharp: OPTION.sharp, soft: OPTION.soft, round: OPTION.round },
        default: "soft",
        display: "segmented",
      },
    ],
  },
  {
    key: "product-cards",
    label: SETTINGS_GROUP.productCards,
    fields: [
      {
        key: "cardImageRatio",
        kind: "select",
        label: SETTING.cardImageRatio,
        options: CARD_RATIOS,
        optionLabels: { square: OPTION.square, portrait: OPTION.portrait, landscape: OPTION.landscape },
        default: "portrait",
        display: "segmented",
      },
      { key: "cardButton", kind: "boolean", label: SETTING.cardButton, default: true },
    ],
  },
] as const satisfies readonly SettingsGroup[];
