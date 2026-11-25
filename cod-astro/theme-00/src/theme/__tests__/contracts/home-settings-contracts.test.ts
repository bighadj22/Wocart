// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The home settings an editor can change, proven through the real renderer:
 * a saved value takes effect, an absent one keeps the shipped behavior, and a
 * hostile value never reaches the markup.
 */
import { describe, expect, it } from "vitest";
import type { Category } from "@wocart/storefront";
import type { RendererIssue } from "@wocart/theme/astro";
import { en } from "@/theme/content/en";
import { fakeStorefront, makeProduct, renderSections } from "../support/home-render";

const products = Array.from({ length: 6 }, (_, index) =>
  makeProduct({
    id: `prod_${index}`,
    name: `Product ${index}`,
    handle: `product-${index}`,
  }),
);
const categories = Array.from(
  { length: 6 },
  (_, index) =>
    ({ id: `cat_${index}`, name: `Category ${index}`, slug: `category-${index}`, position: index, image: null }) as unknown as Category,
);
const storefront = fakeStorefront(products, categories);

const countOf = (html: string, text: string) => html.split(text).length - 1;

describe("hero and promo links", () => {
  it("keep the shipped targets when nothing is saved", async () => {
    const html = await renderSections(
      [
        { id: "h", type: "hero" },
        { id: "w", type: "whatsapp-cta" },
      ],
      storefront,
    );
    expect(html).toContain('href="/products"');
    expect(html).toContain('href="#best-sellers"');
  });

  it("use the saved targets", async () => {
    const html = await renderSections(
      [
        { id: "h", type: "hero", props: { ctaPrimaryHref: "/lp/summer", ctaSecondaryHref: "/category/chairs" } },
        { id: "w", type: "whatsapp-cta", props: { ctaHref: "https://wa.me/213555000000" } },
      ],
      storefront,
    );
    expect(html).toContain('href="/lp/summer"');
    expect(html).toContain('href="/category/chairs"');
    expect(html).toContain('href="https://wa.me/213555000000"');
  });

  it.each(["javascript:alert(1)", "//evil.example", "data:text/html,x"])(
    "never render the hostile link %j, and report it",
    async (href) => {
      const issues: RendererIssue[] = [];
      const html = await renderSections(
        [{ id: "h", type: "hero", props: { ctaPrimaryHref: href } }],
        storefront,
        { onIssue: (issue) => issues.push(issue) },
      );
      expect(html).not.toContain(href);
      expect(html).toContain('href="/products"');
      expect(issues).toEqual([
        expect.objectContaining({ code: "invalid-prop", path: "props.ctaPrimaryHref" }),
      ]);
    },
  );
});

describe("section titles", () => {
  it("best sellers and new arrivals show the saved title, else the pack's", async () => {
    const edited = await renderSections(
      [
        { id: "b", type: "best-sellers", props: { bestSellersSection: "Our picks" } },
        { id: "n", type: "new-arrivals", props: { newArrivalsSection: "Just in" } },
      ],
      storefront,
    );
    expect(edited).toContain("Our picks");
    expect(edited).toContain("Just in");
    expect(edited).not.toContain(en.bestSellersSection);

    const shipped = await renderSections([{ id: "b", type: "best-sellers" }], storefront);
    expect(shipped).toContain(en.bestSellersSection);
  });
});

describe("how many items a section shows", () => {
  it("best sellers shows 8 by default and the saved limit otherwise", async () => {
    const shipped = await renderSections([{ id: "b", type: "best-sellers" }], storefront);
    expect(products.slice(0, 5).every((p) => shipped.includes(p.name))).toBe(true);

    const limited = await renderSections(
      [{ id: "b", type: "best-sellers", props: { limit: 2 } }],
      storefront,
    );
    expect(["Product 0", "Product 1"].every((name) => limited.includes(name))).toBe(true);
    expect(limited).not.toContain("Product 2");
  });

  it("category cards shows 4 by default and the saved limit otherwise", async () => {
    const shipped = await renderSections([{ id: "c", type: "category-cards" }], storefront);
    expect(countOf(shipped, 'href="/category/')).toBe(4);

    const limited = await renderSections(
      [{ id: "c", type: "category-cards", props: { limit: 2 } }],
      storefront,
    );
    expect(countOf(limited, 'href="/category/')).toBe(2);
  });

  it("an out-of-range limit is reported and the default applies", async () => {
    const issues: RendererIssue[] = [];
    const html = await renderSections(
      [{ id: "c", type: "category-cards", props: { limit: 500 } }],
      storefront,
      { onIssue: (issue) => issues.push(issue) },
    );
    expect(countOf(html, 'href="/category/')).toBe(4);
    expect(issues).toEqual([expect.objectContaining({ code: "invalid-prop", path: "props.limit" })]);
  });
});
