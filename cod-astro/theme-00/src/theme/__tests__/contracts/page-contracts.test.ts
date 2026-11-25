/**
 * Page contracts.
 *
 * Some invariants live in a page's frontmatter rather than in any module, so
 * no unit test can reach them and `astro check` is happy either way. They are
 * still invariants, and one of them broke in production.
 *
 * When the checkout page shipped it loaded its own controller, the OTP step
 * and Turnstile — but not `track-abandonment.ts`. Nothing failed. Product
 * pages went on capturing abandoners and the new, higher-value journey
 * captured none, which reads as "the cart is losing us leads" rather than as
 * a missing script tag. That is the class of bug these tests exist for.
 *
 * A page takes an order when what it renders reaches the customer-details
 * form — directly, through `OrderForm`, or through the catalog that places the
 * product's order section. Following imports finds every such page, a new one
 * included, without a list to keep.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { SRC_DIR, themeSourceFiles } from "../guards/theme-source";

const PAGES = join(SRC_DIR, "pages");
/** The composed surfaces a route renders (`theme/pages/*Surface.astro`): they load a page's scripts for it. */
const SURFACES = join(SRC_DIR, "theme/pages");
const ORDER = join(SRC_DIR, "theme/components/order");
const CUSTOMER_FORM = join(ORDER, "CustomerFields.astro");
const OTP_STEP = join(ORDER, "OtpStep.astro");
const BOT_GATE = join(ORDER, "TurnstileField.astro");

function pageFiles(dir: string = PAGES, out: string[] = dir === PAGES ? pageFiles(SURFACES, []) : []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pageFiles(full, out);
    else if (entry.name.endsWith(".astro")) out.push(full);
  }
  return out;
}

const sources = new Map<string, string>();
function read(file: string): string {
  let source = sources.get(file);
  if (source === undefined) sources.set(file, (source = readFileSync(file, "utf8")));
  return source;
}

/** The theme scripts a file's own `<script>` tags load: by `src`, or by an `import` inside the tag. */
function scriptsOf(source: string): Set<string> {
  const names = new Set<string>();
  for (const [, attributes, body] of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = /\bsrc="([^"]+)"/.exec(attributes!)?.[1];
    const specifiers = src ? [src] : [...body!.matchAll(/\bimport\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const specifier of specifiers) {
      const name = /scripts\/([a-z0-9-]+)(?:\.ts)?$/.exec(specifier)?.[1];
      if (name) names.add(name);
    }
  }
  return names;
}

const IMPORT = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** A theme file an import names (`@/…` or relative), or null for a package and anything not a source file. */
function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC_DIR, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.astro`, join(base, "index.ts")]) {
    if (/\.(ts|astro)$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every theme file a page reaches through its imports, the page included. */
function reach(file: string): Set<string> {
  const seen = new Set<string>();
  const pending = [file];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const match of read(current).matchAll(IMPORT)) {
      const next = resolveImport(current, (match[1] ?? match[2])!);
      if (next !== null) pending.push(next);
    }
  }
  return seen;
}

/** Every page that can take an order, with the files it renders and the scripts they load. */
function checkoutPages(): Array<{ file: string; files: Set<string>; scripts: Set<string> }> {
  return pageFiles()
    .map((file) => {
      const files = reach(file);
      const scripts = new Set([...files].filter((f) => f.endsWith(".astro")).flatMap((f) => [...scriptsOf(read(f))]));
      return { file, files, scripts };
    })
    .filter((page) => page.files.has(CUSTOMER_FORM));
}

describe("pages that take an order", () => {
  it("there are some, so this suite is actually checking something", () => {
    const pages = checkoutPages().map((page) => relative(SRC_DIR, page.file));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages).toEqual(expect.arrayContaining(["pages/checkout.astro", "pages/lp/[slug].astro", "theme/pages/ProductSurface.astro"]));
  });

  it("every one of them captures abandoned checkouts", () => {
    const missing = checkoutPages()
      .filter((page) => !page.scripts.has("track-abandonment"))
      .map((page) => relative(SRC_DIR, page.file));

    expect(
      missing,
      `These pages collect a name and a phone number but never load ` +
        `track-abandonment.ts, so everyone who fills the form and leaves is ` +
        `invisible on the merchant's callback list: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every one of them renders the OTP step and the bot gate", () => {
    const missing = checkoutPages()
      .filter((page) => !page.files.has(OTP_STEP) || !page.files.has(BOT_GATE))
      .map((page) => relative(SRC_DIR, page.file));

    expect(missing).toEqual([]);
  });
});

describe("the OTP step and the bot gate", () => {
  it("bring their own scripts, so a page loads them only where they render", () => {
    expect(scriptsOf(read(OTP_STEP)).has("otp-step")).toBe(true);
    expect(scriptsOf(read(BOT_GATE)).has("turnstile-field")).toBe(true);
  });

  it("are loaded by nothing else — a page-level tag loads them for every store", () => {
    const loaders = themeSourceFiles()
      .filter(({ relPath }) => relPath.endsWith(".astro"))
      .filter(({ relPath }) => ![OTP_STEP, BOT_GATE].includes(join(SRC_DIR, relPath)))
      .filter(({ content }) => {
        const scripts = scriptsOf(content);
        return scripts.has("otp-step") || scripts.has("turnstile-field");
      })
      .map(({ relPath }) => relPath);

    expect(loaders).toEqual([]);
  });

  it("render only for a store that switches them on", () => {
    for (const { relPath, content } of themeSourceFiles()) {
      for (const [tag, flag] of [["<OtpStep", "otpEnabled"], ["<TurnstileField", "turnstileEnabled"]] as const) {
        for (const match of content.matchAll(new RegExp(tag, "g"))) {
          const before = content.slice(Math.max(0, match.index - 80), match.index);
          expect(before, `${relPath} renders ${tag.slice(1)} without checking ${flag}`).toMatch(new RegExp(`\\{\\s*${flag}\\b[^{}]*$`));
        }
      }
    }
  });
});

describe("the checkout page", () => {
  const source = read(join(PAGES, "checkout.astro"));

  it("is closed when the merchant has the cart switched off", () => {
    // Otherwise a feature the merchant disabled stays reachable by URL.
    expect(source).toMatch(/if \(!config\.cartEnabled\)/);
    expect(source).toMatch(/Astro\.redirect\(/);
  });

  it("is not indexed", () => {
    // Transactional and basket-dependent: a crawler only ever sees the empty
    // state, and that is what would land in search results.
    expect(source).toMatch(/noindex=\{true\}/);
  });

  it("loads its own controller beside the form it drives", () => {
    expect(scriptsOf(read(join(SRC_DIR, "theme/components/checkout/CheckoutMain.astro"))).has("checkout")).toBe(true);
  });
});

describe("the thank-you page", () => {
  const source = read(join(PAGES, "thank-you.astro"));

  it("loads its own controller, which marks the checkout converted and clears the basket", () => {
    // Without it the merchant keeps calling a shopper whose order arrived.
    expect(source).toMatch(/<script src="\.\.\/theme\/scripts\/thank-you\.ts"><\/script>/);
    expect(source).toMatch(/data-order-placed data-order-id=\{orderId\} data-order-number=\{orderNumber\}/);
  });
});

describe("the image a shared link shows", () => {
  it("is the page's own on a product, a category and a landing page; the store's share image elsewhere", () => {
    const own: [string, string][] = [
      ["theme/pages/ProductSurface.astro", "ogImage={product?.images[0]?.url}"],
      ["pages/category/[slug].astro", "ogImage={category.image?.url}"],
      ["theme/pages/LandingSurface.astro", "ogImage={cover ? imageSource(cover.url, config.media, 1200) : undefined}"],
    ];
    for (const [file, prop] of own) expect(readFileSync(join(SRC_DIR, file), "utf8"), file).toContain(prop);
    expect(readFileSync(join(SRC_DIR, "theme/layouts/StoreLayout.astro"), "utf8")).toContain("ogImage ?? config.ogImage?.url");
  });
});
