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
 * the store's header and footer areas, edited where they are seen. The home
 * section hide/photo switches are written by the dashboard's Appearance tab;
 * declaring them here lets the same renderer read and validate them.
 */
import type { SettingsGroup } from "@wocart/theme";
import { BODY_FONT, CARD_RATIOS, CORNERS, DEFAULT_SCHEMES, FONT_FAMILIES, HEADING_FONT, PAGE_SCHEME } from "./appearance";
import { HOME_SETTING, OPTION, SETTING, SETTINGS_GROUP } from "./catalog/labels";

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
  {
    key: "storefront",
    label: SETTINGS_GROUP.storefront,
    fields: [
      { key: "hideLogo", kind: "boolean", label: SETTING.hideLogo, default: false },
      { key: "searchEnabled", kind: "boolean", label: SETTING.searchEnabled, default: true },
      { key: "hideHeroImages", kind: "boolean", label: SETTING.hideHeroImages, default: false },
      { key: "headerHtml", kind: "textarea", label: SETTING.headerHtml, default: "" },
      {
        key: "logoAlignment",
        kind: "select",
        label: SETTING.logoAlignment,
        options: ["right", "left", "center"],
        optionLabels: { right: OPTION.right, left: OPTION.left, center: OPTION.center },
        default: "right",
        display: "segmented",
      },
    ],
  },
  {
    key: "home-sections",
    label: SETTINGS_GROUP.homeSections,
    fields: [
      { key: "homeHeroHidden", kind: "boolean", label: HOME_SETTING.hero.hidden, default: false },
      { key: "homeHeroImage", kind: "image", label: HOME_SETTING.hero.image },
      { key: "homeMarqueeHidden", kind: "boolean", label: HOME_SETTING.marquee.hidden, default: false },
      { key: "homeMarqueeImage", kind: "image", label: HOME_SETTING.marquee.image },
      { key: "homeCategoryCardsHidden", kind: "boolean", label: HOME_SETTING["category-cards"].hidden, default: false },
      { key: "homeCategoryCardsImage", kind: "image", label: HOME_SETTING["category-cards"].image },
      { key: "homeProductTabsHidden", kind: "boolean", label: HOME_SETTING["product-tabs"].hidden, default: false },
      { key: "homeProductTabsImage", kind: "image", label: HOME_SETTING["product-tabs"].image },
      { key: "homeImageBannerHidden", kind: "boolean", label: HOME_SETTING["image-banner"].hidden, default: false },
      { key: "homeImageBannerImage", kind: "image", label: HOME_SETTING["image-banner"].image },
      { key: "homeHowItWorksHidden", kind: "boolean", label: HOME_SETTING["how-it-works"].hidden, default: false },
      { key: "homeHowItWorksImage", kind: "image", label: HOME_SETTING["how-it-works"].image },
      { key: "homeCustomerTestimonialsHidden", kind: "boolean", label: HOME_SETTING["customer-testimonials"].hidden, default: false },
      { key: "homeCustomerTestimonialsImage", kind: "image", label: HOME_SETTING["customer-testimonials"].image },
      { key: "homeFeaturesBarHidden", kind: "boolean", label: HOME_SETTING["features-bar"].hidden, default: false },
      { key: "homeFeaturesBarImage", kind: "image", label: HOME_SETTING["features-bar"].image },
    ],
  },
] as const satisfies readonly SettingsGroup[];
