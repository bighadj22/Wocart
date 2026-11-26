// @vitest-environment node
/**
 * The Appearance tab's semantic colors, safe banner HTML, ticker words and
 * small category icons, proven through the same renderers the store uses.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { Category } from "@wocart/storefront";
import { describe, expect, it } from "vitest";
import StoreLayout from "@/theme/layouts/StoreLayout.astro";
import { theme00 } from "@/theme/theme";
import { fakeStorefront, renderSections } from "../support/home-render";
import { testLocals, TEST_CONFIG } from "../support/locals";

const category = {
  id: "cat_shoes",
  name: "Shoes",
  slug: "shoes",
  description: null,
  parentId: null,
  image: {
    key: "categories/shoes.webp",
    url: "https://media.boutique.test/categories/shoes.webp",
    width: 48,
    height: 48,
  },
  metaTitle: null,
  metaDescription: null,
  metaKeywords: null,
  position: 1,
  createdAt: "",
  updatedAt: "",
} as Category;

describe("semantic price colors", () => {
  it("writes the saved colors as tokens while the scheme still supplies the rest", async () => {
    const html = await (await AstroContainer.create()).renderToString(StoreLayout, {
      props: {},
      locals: testLocals({
        config: {
          ...TEST_CONFIG,
          themeSettings: { priceOldColor: "#123456", priceNewColor: "#abcdef" },
        },
      }),
      request: new Request("https://example.dz"),
    });
    expect(html).toContain("--clr-price-old: #123456;");
    expect(html).toContain("--clr-price-new: #abcdef;");
    expect(html).toContain(".wc-scheme-scheme-1{");
  });

  it("does not inject a hostile color the resolver rejected", async () => {
    const html = await (await AstroContainer.create()).renderToString(StoreLayout, {
      props: {},
      locals: testLocals({ config: { ...TEST_CONFIG, themeSettings: { priceNewColor: "red; background:url(x)" } } }),
      request: new Request("https://example.dz"),
    });
    expect(html).not.toContain("background:url(x)");
    expect(html).not.toContain("--clr-price-new:");
  });
});

describe("banner copy beside its photo", () => {
  it("renders the merchant's sanitized HTML and keeps the photo", async () => {
    const html = await renderSections(
      [{ id: "b", type: "image-banner", props: {} }],
      fakeStorefront([], []),
      {
        themeSettings: {
          bannerBodyHtml: '<p class="lead">Free <strong>delivery</strong></p>',
          homeImageBannerImage: { key: "products/promo.webp", alt: "Offer", width: 1200, height: 1200 },
        },
      },
    );
    expect(html).toContain('<p class="lead">Free <strong>delivery</strong></p>');
    expect(html).toContain("products/promo.webp");
  });
});

describe("the scrolling strip", () => {
  it("is a ticker whose fourth line is editable copy", async () => {
    const field = theme00.components.marquee?.fields.find((item) => item.key === "message4");
    expect(field).toMatchObject({ kind: "text", contentKey: "trust4Title" });
    const html = await renderSections([{ id: "m", type: "marquee", props: {} }], fakeStorefront([], []), {
      content: { trust4Title: "Pay at your door" },
    });
    expect(html).toContain("marquee-track");
    expect(html).toContain("Pay at your door");
    expect(html).not.toContain("type=\"file\"");
  });
});

describe("small category icons", () => {
  it("shows a 48×48 icon whole and capped instead of stretching a banner frame", async () => {
    const html = await renderSections(
      [{ id: "c", type: "category-cards", props: {} }],
      fakeStorefront([], [category]),
    );
    expect(html).toContain("is-whole");
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
    expect(html).not.toContain('width="600"');
  });

  it("keeps a full-size category photo as a framed cover", async () => {
    const html = await renderSections([{ id: "c", type: "category-cards", props: {} }], fakeStorefront([], [
      { ...category, image: { ...category.image!, width: 1200, height: 1500 } },
    ]));
    expect(html).not.toContain("is-whole");
    expect(html).toContain('width="600"');
  });
});
