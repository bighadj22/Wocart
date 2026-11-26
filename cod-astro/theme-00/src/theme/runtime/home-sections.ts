/**
 * The dashboard's per-section home controls, as the theme reads them. The
 * settings are written flat by the server (`homeHeroHidden`, `homeHeroImage`,
 * …) and declared in `settings.ts`; this module names them once and turns a
 * section's type into the state the renderer needs. A stored value the SDK
 * rejected simply never reaches here, so the shipped section stands.
 */
import type { StoreContext } from "./store";
import { settingsOf } from "./settings";
import { pickedPicture } from "@/theme/utils/images";
import type { PickedImage, Picture } from "@wocart/storefront";

export const HOME_SECTION_TYPES = [
  "hero",
  "marquee",
  "category-cards",
  "product-tabs",
  "image-banner",
  "how-it-works",
  "customer-testimonials",
  "features-bar",
] as const;

export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

const CAMEL: Record<HomeSectionType, string> = {
  hero: "Hero",
  marquee: "Marquee",
  "category-cards": "CategoryCards",
  "product-tabs": "ProductTabs",
  "image-banner": "ImageBanner",
  "how-it-works": "HowItWorks",
  "customer-testimonials": "CustomerTestimonials",
  "features-bar": "FeaturesBar",
};

export const hiddenSettingKey = (type: HomeSectionType): string => `home${CAMEL[type]}Hidden`;
export const imageSettingKey = (type: HomeSectionType): string => `home${CAMEL[type]}Image`;

/** Only these two sections draw their picked photo themselves; the rest wear it as a backdrop. */
export const NATIVE_IMAGE_SECTIONS = new Set<HomeSectionType>(["hero", "image-banner"]);

export function homeSectionTypeOf(type: string): HomeSectionType | null {
  return (HOME_SECTION_TYPES as readonly string[]).includes(type) ? (type as HomeSectionType) : null;
}

export type HomeSectionState = {
  hidden: boolean;
  image: Picture | null;
  picked: PickedImage | null;
};

/** One home section's visibility and photo, for the page and the section components alike. */
export function homeSectionStateOf(store: StoreContext, type: string): HomeSectionState {
  const key = homeSectionTypeOf(type);
  if (!key) return { hidden: false, image: null, picked: null };
  const values = settingsOf(store) as unknown as Record<string, unknown>;
  const stored = (store.config.themeSettings ?? {}) as Record<string, unknown>;
  const hiddenKey = hiddenSettingKey(key);
  const legacy =
    (key === "hero" || key === "image-banner") &&
    stored.hideHeroImages === true &&
    !Object.prototype.hasOwnProperty.call(stored, hiddenKey);
  const hidden = values[hiddenKey] === true || legacy;
  const picked = (values[imageSettingKey(key)] as PickedImage | undefined) ?? null;
  return { hidden, image: pickedPicture(picked, store.config.media), picked };
}
