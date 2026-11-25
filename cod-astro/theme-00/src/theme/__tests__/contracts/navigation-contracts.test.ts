// @vitest-environment node
/**
 * Theme-00's navigation is the merchant's: the header, the phone menu and the
 * footer show the store menus their sections name — `main-menu` and `footer`,
 * which every store starts with — and nothing of the theme's own. Internal
 * links stay in the shopper's language; an address outside the store is left
 * as typed. The header and the footer are areas: the store's saved document
 * for each, else the theme's. Its colors, faces and corners are its settings,
 * read against its declaration, so a value it cannot use falls back to its
 * design and a setting of an older version is ignored.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { resolveThemeSettings } from "@wocart/theme";
import { localizeHref, type LocaleRouting, type StoreMenu } from "@wocart/storefront";
import Header from "@/theme/components/layout/Header.astro";
import FooterMenu from "@/theme/components/footer/FooterMenu.astro";
import StoreLayout from "@/theme/layouts/StoreLayout.astro";
import { menuLinks } from "@/theme/runtime/navigation";
import { DEFAULT_SCHEMES } from "@/theme/appearance";
import { theme00 } from "@/theme/theme";
import { fr } from "@/theme/content/fr";
import { testLocals, TEST_CONFIG } from "../support/locals";

const routing: LocaleRouting = { primary: "ar", published: ["ar", "fr"] };
const href = (path: string) => localizeHref(path, "fr", routing);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!);

const menu: StoreMenu = {
  handle: "main-menu",
  title: "Menu",
  items: [
    { label: "Accueil", href: "/", type: "home", children: [] },
    {
      label: "Boutique",
      href: "/products",
      type: "catalog",
      children: [
        { label: "Robes", href: "/category/robes", type: "category", children: [{ label: "Robe d'été", href: "/products/robe-ete", type: "product", children: [] }] },
      ],
    },
    { label: "Instagram", href: "https://instagram.com/boutique", type: "url", children: [] },
    { label: "Contact", href: "mailto:contact@boutique.dz", type: "url", children: [] },
  ],
};

const MENU_HREFS = ["/fr", "/fr/products", "/fr/category/robes", "/fr/products/robe-ete", "https://instagram.com/boutique", "mailto:contact@boutique.dz"];
const HEADER_PROPS = { menu: "main-menu", logoPosition: "start", logoWidth: 140, sticky: true, scheme: "scheme-1" } as const;

describe("menuLinks", () => {
  it("localizes the store's paths, leaves other addresses as typed, and marks the current page", () => {
    const links = menuLinks(menu, href, "/category/robes")!;
    expect(links.map((link) => [link.href, link.external, link.active])).toEqual([
      ["/fr", false, false],
      ["/fr/products", false, false],
      ["https://instagram.com/boutique", true, false],
      ["mailto:contact@boutique.dz", false, false],
    ]);
    expect(links[1]!.children[0]).toMatchObject({ href: "/fr/category/robes", active: true });
    expect(links[1]!.children[0]!.children[0]).toMatchObject({ label: "Robe d'été", href: "/fr/products/robe-ete", active: false });
  });

  it("is null when the store has no such menu", () => {
    expect(menuLinks(null, href, "/")).toBeNull();
  });
});

describe("the header and the footer's menu", () => {
  const locals = () => testLocals({ locale: "fr", routing, content: fr });
  const renderHeader = async (storeMenu: StoreMenu | null) =>
    (await AstroContainer.create()).renderToString(Header, { props: { ...HEADER_PROPS, storeMenu }, locals: locals() });
  const renderFooterMenu = async (storeMenu: StoreMenu | null) =>
    (await AstroContainer.create()).renderToString(FooterMenu, { props: { title: fr.footerQuickLinks, menu: "footer", storeMenu }, locals: locals() });

  it("show the merchant's menu, every level of it, in the shopper's language", async () => {
    for (const html of [await renderHeader(menu), await renderFooterMenu(menu)]) {
      for (const expected of MENU_HREFS) expect(hrefs(html)).toContain(expected);
      expect(html).toContain("Robe d&#39;été");
    }
  });

  it("give a phone the same menu, behind a button", async () => {
    const html = await renderHeader(menu);
    expect(html).toMatch(/<button[^>]*popovertarget="site-menu"/);
    const panel = html.slice(html.indexOf('id="site-menu"'));
    for (const expected of MENU_HREFS) expect(hrefs(panel)).toContain(expected);
  });

  it("show no links of their own when the store has no such menu", async () => {
    const header = await renderHeader(null);
    expect(header).not.toContain("site-menu");
    expect(header).not.toContain('class="nav-link"');
    expect(await renderFooterMenu(null)).not.toContain(fr.footerQuickLinks);
  });
});

describe("the layout", () => {
  const render = async (client: object, themeSettings: Record<string, unknown> = {}) =>
    (await AstroContainer.create()).renderToString(StoreLayout, {
      locals: testLocals({ locale: "fr", routing, content: fr, config: { ...TEST_CONFIG, themeSettings }, client: client as never }),
      request: new Request("https://example.dz/fr"),
    });

  it("names one canonical address per page: its path in its language and its listing page, never a sort or an ad's click id", async () => {
    const html = await (await AstroContainer.create()).renderToString(StoreLayout, {
      locals: testLocals({ locale: "fr", routing, content: fr, pathname: "/collections/ete" }),
      request: new Request("https://example.dz/fr/collections/ete?page=2&sort=newest&fbclid=abc&utm_source=meta"),
    });
    expect(html).toContain('<link rel="canonical" href="https://example.dz/fr/collections/ete?page=2">');
  });

  it("renders the header and footer the store saved, with the menus their sections name", async () => {
    const asked: string[] = [];
    const saved: Record<string, unknown> = {
      "area:header": { version: 1, surface: "area:header", sections: [{ id: "h", type: "header", props: { menu: "top" } }] },
    };
    const html = await render({
      menus: { get: async (handle: string) => (asked.push(handle), handle === "top" ? menu : null) },
      pageData: { get: async (surface: string) => saved[surface] ?? null },
    });
    expect(asked.sort()).toEqual(["footer", "top"]);
    expect(hrefs(html)).toContain("/fr/category/robes");
    expect(html).not.toContain(fr.announcementText);
  });

  it("renders the theme's header and footer when the store saved none: the announcement in the theme's words", async () => {
    const html = await render({});
    expect(html).toContain(fr.announcementText);
    expect(html).toContain('class="site-header');
    expect(html).toContain(fr.footerRights);
  });

  it("shows the merchant's announcement in the shopper's language", async () => {
    const header = {
      version: 1,
      surface: "area:header",
      sections: [
        { id: "a", type: "announcement-bar", slots: { default: [{ id: "a1", type: "announcement", props: { text: { ar: "توصيل مجاني", fr: "Livraison gratuite" } } }] } },
        { id: "h", type: "header" },
      ],
    };
    const html = await render({ pageData: { get: async (surface: string) => (surface === "area:header" ? header : null) } });
    expect(html).toContain("Livraison gratuite");
    expect(html).not.toContain(fr.announcementText);
  });

  it("paints the store's color schemes and faces, never an older version's colors", async () => {
    const schemes = [{ ...DEFAULT_SCHEMES[0], colors: { ...DEFAULT_SCHEMES[0].colors, button: "#0a7e3c" } }];
    const html = await render({}, { colorSchemes: schemes, font: "Tajawal", headingFont: "Almarai", primaryColor: "#123456" });
    expect(html).toContain(".wc-scheme-scheme-1{");
    expect(html).toContain("--wc-color-button:#0a7e3c");
    expect(html).toContain("--font-text: var(--font-tajawal)");
    expect(html).toContain("--font-display: var(--font-almarai)");
    const bodyClasses = /<body class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/) ?? [];
    expect(bodyClasses).toEqual(expect.arrayContaining(["wc-scheme", "wc-scheme-scheme-1"]));
    expect(html).not.toContain("#123456");
  });

  it("asks for no menu and no area on a page that leaves out the header and footer", async () => {
    const asked: string[] = [];
    const client = { menus: { get: async (handle: string) => (asked.push(handle), null) }, pageData: { get: async (surface: string) => (asked.push(surface), null) } };
    const container = await AstroContainer.create();
    await container.renderToString(StoreLayout, {
      props: { header: false, footer: false },
      locals: testLocals({ client: client as never }),
      request: new Request("https://example.dz/lp/promo"),
    });
    expect(asked).toEqual([]);
  });
});

describe("the theme's settings", () => {
  it("render the theme as designed when the store saved nothing", () => {
    expect(resolveThemeSettings(theme00, undefined).values).toEqual({
      colorSchemes: DEFAULT_SCHEMES,
      pageScheme: "scheme-1",
      headingFont: "Alexandria",
      font: "Readex Pro",
      corners: "soft",
      cardImageRatio: "portrait",
      cardButton: true,
    });
  });

  it("fall back to the design for a value the theme cannot use, and ignore an older version's settings", () => {
    const { values, issues } = resolveThemeSettings(theme00, { corners: "pointy", pageScheme: "Not An Id", font: "Comic Sans", primaryColor: "#0a7e3c" });
    expect(values).toMatchObject({ corners: "soft", pageScheme: "scheme-1", font: "Readex Pro" });
    expect(values).not.toHaveProperty("primaryColor");
    expect(issues.map((issue) => issue.code).sort()).toEqual(["invalid-setting", "invalid-setting", "invalid-setting", "unknown-setting"]);
  });
});
