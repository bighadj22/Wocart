// @vitest-environment node
/**
 * The Appearance tab's per-section controls reach the shopper through the same
 * surface renderer the home page uses: a hidden section is not in the markup,
 * and a picked photo sits behind the section that owns it.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createReadCache } from "@wocart/theme/astro";
import { describe, expect, it } from "vitest";
import Sections from "@/theme/components/surface/Sections.astro";
import { homeCatalog } from "@/theme/catalog/families/home";
import {
  hiddenSettingKey,
  HOME_SECTION_TYPES,
  homeSectionStateOf,
  imageSettingKey,
} from "@/theme/runtime/home-sections";
import { TEST_CONFIG, testLocals, testStore } from "../support/locals";

const document = {
  version: 1,
  surface: "home",
  sections: [
    { id: "m", type: "marquee" },
    { id: "f", type: "features-bar" },
  ],
};

async function render(themeSettings: Record<string, unknown>) {
  return (await AstroContainer.create()).renderToString(Sections, {
    props: { theme: homeCatalog, surface: "home", document, reads: createReadCache() },
    locals: testLocals({ config: { ...TEST_CONFIG, themeSettings } }),
  });
}

describe("the dashboard's home section controls", () => {
  it("names a hide switch and a photo for every section of the home page", () => {
    for (const type of HOME_SECTION_TYPES) {
      const store = testStore({
        config: {
          ...TEST_CONFIG,
          themeSettings: {
            [hiddenSettingKey(type)]: true,
            [imageSettingKey(type)]: { key: "products/panel.webp", alt: "Panel" },
          },
        },
      });
      const state = homeSectionStateOf(store, type);
      expect(state.hidden, type).toBe(true);
      expect(state.image?.src, type).toBe("https://media.boutique.test/products/panel.webp");
    }
  });

  it("leaves out only the section the store hid", async () => {
    const shown = await render({});
    expect(shown).toContain("marquee-track");
    expect(shown).toContain('class="features"');

    const hidden = await render({ homeMarqueeHidden: true });
    expect(hidden).not.toContain("marquee-track");
    expect(hidden).toContain('class="features"');
  });

  it("ignores a photo on a section that does not draw one", async () => {
    const html = await render({
      homeFeaturesBarImage: { key: "products/panel.webp", alt: "Panel" },
    });
    expect(html).not.toContain("home-section-backdrop");
    expect(html).not.toContain("products/panel.webp");
    expect(html).toContain('class="features"');
  });
});
