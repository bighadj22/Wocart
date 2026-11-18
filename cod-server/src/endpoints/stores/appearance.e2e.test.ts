/**
 * The Appearance writers — real-D1 E2E.
 *
 * The tab is a local customization, so these tests pin the parts a future
 * update must not silently break:
 *
 *  1. A theme's settings row is created on first save and replaced on later
 *     saves, keeping the keys the editor does not own.
 *  2. A text edit is upserted, and an empty value removes the row so the
 *     theme's own copy applies again.
 *  3. One language's edits never touch another's.
 *  4. The storefront reads back exactly what the editor wrote.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { getStoreConfig } from "../../../../cod-shared/queries/store";
import {
  getThemeSettings,
  listContentOverrides,
  saveContentOverrides,
  saveThemeSettings,
} from "../../../../cod-shared/queries/stores";
import { APPEARANCE_DEFAULT_SCHEMES } from "../../../../cod-shared/stores/appearance";
import { TEST_DELIVERY } from "@/test-utils/media";

const registry: Miniflare[] = [];
let db: AppDb;

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "appearance-db" },
  });
  registry.push(mf);
  const d1 = await mf.getD1Database("DB");
  const dir = resolve(__dirname, "../../db/migrations");
  const prepared: D1PreparedStatement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(`${dir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((s) => s.split(/;\s*\n/))
      .map((s) => s.replace(/;+\s*$/, "").trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
    for (const statement of statements) prepared.push(d1.prepare(statement));
  }
  for (let i = 0; i < prepared.length; i += 50) {
    await d1.batch(prepared.slice(i, i + 50));
  }
  db = drizzle(d1 as unknown as D1Database, { schema }) as unknown as AppDb;
});

beforeEach(async () => {
  await db.delete(schema.stores);
});

afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

const now = () => new Date().toISOString();
const uid = () => `store-${crypto.randomUUID().slice(0, 8)}`;

async function seedStore(locales: readonly ("ar" | "fr" | "en")[] = ["ar"]) {
  const id = uid();
  await db.run(sql`
    INSERT INTO stores (id, name, theme_id, lang, currency, currency_symbol,
                        reviews_enabled, cart_shipping_mode, created_at, updated_at)
    VALUES (${id}, 'Appearance Store', 'theme-00', 'ar', 'DZD', 'دج',
            1, 'highest', ${now()}, ${now()})
  `);
  for (const locale of locales) {
    await db.insert(schema.storeLocales).values({
      storeId: id,
      locale,
      published: locale === "ar",
      createdAt: now(),
    });
  }
  return id;
}

const scheme = (index: number) => JSON.parse(JSON.stringify(APPEARANCE_DEFAULT_SCHEMES[index]));

// ─── Theme settings ──────────────────────────────────────────────────────────

describe("saveThemeSettings", () => {
  it("creates the row on the first save and reads it back", async () => {
    const id = await seedStore();
    const values = {
      colorSchemes: [scheme(0)],
      pageScheme: "scheme-1",
    };

    await saveThemeSettings(db, id, "theme-00", values);

    expect(await getThemeSettings(db, id, "theme-00")).toEqual(values);
  });

  it("replaces the row on a later save", async () => {
    const id = await seedStore();
    await saveThemeSettings(db, id, "theme-00", { pageScheme: "scheme-1" });

    await saveThemeSettings(db, id, "theme-00", { pageScheme: "scheme-3" });

    expect(await getThemeSettings(db, id, "theme-00")).toEqual({ pageScheme: "scheme-3" });
  });

  it("keeps the keys an appearance save spreads over", async () => {
    const id = await seedStore();
    await saveThemeSettings(db, id, "theme-00", {
      headingFont: "Cairo",
      corners: "round",
      colorSchemes: APPEARANCE_DEFAULT_SCHEMES,
      pageScheme: "scheme-1",
    });

    const stored = await getThemeSettings(db, id, "theme-00");
    await saveThemeSettings(db, id, "theme-00", {
      ...stored,
      colorSchemes: [{ ...scheme(0), colors: { ...scheme(0).colors, button: "#7c3aed" } }],
      pageScheme: "scheme-1",
    });

    const saved = await getThemeSettings(db, id, "theme-00");
    expect(saved).toMatchObject({ headingFont: "Cairo", corners: "round", pageScheme: "scheme-1" });
    expect((saved.colorSchemes as typeof APPEARANCE_DEFAULT_SCHEMES)[0]!.colors.button).toBe("#7c3aed");
  });

  it("keeps one theme's settings apart from another's", async () => {
    const id = await seedStore();
    await saveThemeSettings(db, id, "theme-00", { pageScheme: "scheme-1" });

    await saveThemeSettings(db, id, "theme-99", { pageScheme: "scheme-9" });

    expect(await getThemeSettings(db, id, "theme-00")).toEqual({ pageScheme: "scheme-1" });
    expect(await getThemeSettings(db, id, "theme-99")).toEqual({ pageScheme: "scheme-9" });
  });
});

// ─── Text edits ──────────────────────────────────────────────────────────────

describe("saveContentOverrides", () => {
  it("upserts an edit in place", async () => {
    const id = await seedStore();
    await saveContentOverrides(db, id, "theme-00", "ar", [{ key: "heroTitle", value: "First" }]);

    await saveContentOverrides(db, id, "theme-00", "ar", [{ key: "heroTitle", value: "Second" }]);

    expect(await listContentOverrides(db, id, "theme-00")).toEqual([
      { locale: "ar", key: "heroTitle", value: "Second" },
    ]);
  });

  it("deletes the row when the value is empty, so the theme's copy returns", async () => {
    const id = await seedStore();
    await saveContentOverrides(db, id, "theme-00", "ar", [
      { key: "heroTitle", value: "Custom" },
      { key: "bannerTitle", value: "Kept" },
    ]);

    await saveContentOverrides(db, id, "theme-00", "ar", [{ key: "heroTitle", value: "" }]);

    expect(await listContentOverrides(db, id, "theme-00")).toEqual([
      { locale: "ar", key: "bannerTitle", value: "Kept" },
    ]);
  });

  it("writes one language without touching another", async () => {
    const id = await seedStore(["ar", "fr"]);
    await saveContentOverrides(db, id, "theme-00", "ar", [{ key: "heroTitle", value: "عربي" }]);
    await saveContentOverrides(db, id, "theme-00", "fr", [{ key: "heroTitle", value: "Français" }]);

    await saveContentOverrides(db, id, "theme-00", "fr", [{ key: "heroTitle", value: "" }]);

    expect(await listContentOverrides(db, id, "theme-00")).toEqual([
      { locale: "ar", key: "heroTitle", value: "عربي" },
    ]);
  });

  it("writes nothing for an empty list", async () => {
    const id = await seedStore();
    await saveContentOverrides(db, id, "theme-00", "ar", []);
    expect(await listContentOverrides(db, id, "theme-00")).toEqual([]);
  });
});

// ─── What the storefront reads ───────────────────────────────────────────────

describe("the storefront config", () => {
  it("carries the colours the editor saved", async () => {
    const id = await seedStore();
    const palette = [{ ...scheme(0), colors: { ...scheme(0).colors, background: "#f8f8f8", button: "#7c3aed" } }];
    await saveThemeSettings(db, id, "theme-00", { colorSchemes: palette, pageScheme: "scheme-1" });

    const config = await getStoreConfig(db, id, TEST_DELIVERY, { theme: "theme-00" });

    expect(config!.themeSettings).toEqual({ colorSchemes: palette, pageScheme: "scheme-1" });
  });

  it("carries the text edits the editor saved, in their language", async () => {
    const id = await seedStore();
    await saveContentOverrides(db, id, "theme-00", "ar", [
      { key: "heroTitle", value: "عنوان المتجر" },
      { key: "heroCtaPrimary", value: "اشترِ الآن" },
    ]);

    const config = await getStoreConfig(db, id, TEST_DELIVERY, { theme: "theme-00" });

    expect(config!.contentOverrides).toEqual({
      ar: { heroTitle: "عنوان المتجر", heroCtaPrimary: "اشترِ الآن" },
    });
  });

  it("drops an edit the merchant cleared", async () => {
    const id = await seedStore();
    await saveContentOverrides(db, id, "theme-00", "ar", [{ key: "heroTitle", value: "Custom" }]);
    await saveContentOverrides(db, id, "theme-00", "ar", [{ key: "heroTitle", value: "" }]);

    const config = await getStoreConfig(db, id, TEST_DELIVERY, { theme: "theme-00" });

    expect(config!.contentOverrides).toEqual({});
  });
});
