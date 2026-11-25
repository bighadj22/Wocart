import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { bundleWorker, createTestD1, type TestD1 } from "@/test-utils/d1";

const NOW = "2026-11-23T12:00:00.000Z";
const STORE_ID = "store-1";
const PRODUCT_ID = "store-1:starter:product:handbag";
const GROUP_ID = "store-1:starter:category:bags";
const OFFER_ID = "store-1:starter:offer:bundle";

const WORKER = `
import { buildToolsForUser } from "@/mcp/registry";
import { TOOL_OUTPUT_SCHEMAS } from "@/mcp/schemas";
const PROPS = { userId: "u1", role: "admin", scopes: [], name: "Nadia", email: "nadia@example.com" };
export default {
  async fetch(request, env) {
    const name = new URL(request.url).pathname.slice(1);
    const tool = buildToolsForUser(env, PROPS)[name];
    if (!tool) return Response.json({ missing: true });
    const result = await tool.execute(await request.json(), { toolCallId: "t", messages: [] });
    const schema = TOOL_OUTPUT_SCHEMAS[name];
    const issues = schema ? (schema.safeParse(result).error?.issues ?? []).map((i) => i.path.join(".") + ": " + i.message) : [];
    return Response.json({ result, issues });
  },
};
`;

let d1: TestD1;

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await d1.fetch(`http://mcp.test/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  return (await res.json()) as {
    missing?: boolean;
    result: Record<string, any>;
    issues: string[];
  };
}

beforeAll(async () => {
  d1 = await createTestD1({ worker: await bundleWorker(WORKER, __dirname, { external: ["fs", "path", "os"] }) });
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  await d1.db.delete(schema.translations);
  await d1.db.delete(schema.storeLocales);
  await d1.db.delete(schema.offers);
  await d1.db.delete(schema.products);
  await d1.db.delete(schema.productCategories);
  await d1.db.delete(schema.stores);

  await d1.db.insert(schema.stores).values({
    id: STORE_ID,
    name: "DZ Kids",
    lang: "ar",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await d1.db.insert(schema.storeLocales).values({
    storeId: STORE_ID,
    locale: "fr",
    published: true,
    createdAt: NOW,
  });
  await d1.db.insert(schema.productCategories).values({
    id: GROUP_ID,
    name: "حقائب",
    slug: "bags",
    description: "حقائب جلدية",
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await d1.db.insert(schema.products).values({
    id: PRODUCT_ID,
    name: "حقيبة يد",
    handle: "handbag",
    description: "<p>وصف أصلي</p>",
    descriptionFormat: "html",
    price: 4500,
    hasVariants: true,
    variantOptions: JSON.stringify([
      { name: "اللون", values: [{ value: "أحمر" }, { value: "أزرق" }] },
    ]),
    inventory: 10,
    trackInventory: true,
    categoryId: GROUP_ID,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await d1.db.insert(schema.offers).values({
    id: OFFER_ID,
    name: "عرض القطعتين",
    triggerProductId: PRODUCT_ID,
    rewardProductId: PRODUCT_ID,
    createdAt: NOW,
    updatedAt: NOW,
  });
});

describe("Translation MCP tools (workerd E2E)", () => {
  it("reads and updates product translations, sanitises HTML, handles variant options and flags outdated after source edit", async () => {
    const initial = await callTool("getProductTranslations", { productId: PRODUCT_ID });
    expect(initial.issues).toEqual([]);
    expect(initial.result.success).toBe(true);
    expect(initial.result.sourceLocale).toBe("ar");
    expect(initial.result.targetLocales).toEqual([{ locale: "fr", published: true }]);
    expect(initial.result.options).toEqual([
      {
        name: "اللون",
        key: 'option:["اللون"]',
        values: [
          { value: "أحمر", key: 'option:["اللون","أحمر"]' },
          { value: "أزرق", key: 'option:["اللون","أزرق"]' },
        ],
      },
    ]);

    const updated = await callTool("updateProductTranslations", {
      productId: PRODUCT_ID,
      locale: "fr",
      values: {
        name: "Sac à main",
        description: '<p>Beau sac</p><script>alert(1)</script>',
        'option:["اللون"]': "Couleur",
        'option:["اللون","أحمر"]': "Rouge",
        'option:["اللون","أزرق"]': "Bleu",
      },
    });
    expect(updated.issues).toEqual([]);
    expect(updated.result.success).toBe(true);
    expect(updated.result.translations.fr.name).toEqual({ value: "Sac à main", outdated: false });
    expect(updated.result.translations.fr.description.value).toContain("Beau sac");
    expect(updated.result.translations.fr.description.value).not.toContain("<script>");
    expect(updated.result.translations.fr['option:["اللون","أحمر"]']).toEqual({ value: "Rouge", outdated: false });

    const removed = await callTool("updateProductTranslations", {
      productId: PRODUCT_ID,
      locale: "fr",
      values: { description: null },
    });
    expect(removed.issues).toEqual([]);
    expect(removed.result.success).toBe(true);
    expect(removed.result.translations.fr.description).toBeUndefined();
    expect(removed.result.translations.fr.name).toEqual({ value: "Sac à main", outdated: false });

    await d1.db.update(schema.products).set({ name: "حقيبة يد جلدية" }).where(eq(schema.products.id, PRODUCT_ID));
    const afterSourceChange = await callTool("getProductTranslations", { productId: PRODUCT_ID });
    expect(afterSourceChange.issues).toEqual([]);
    expect(afterSourceChange.result.translations.fr.name).toEqual({ value: "Sac à main", outdated: true });
  });

  it("refuses primary language, unadded locales, indistinct option values, and missing records", async () => {
    const primary = await callTool("updateProductTranslations", {
      productId: PRODUCT_ID,
      locale: "ar",
      values: { name: "Test" },
    });
    expect(primary.issues).toEqual([]);
    expect(primary.result.success).toBe(false);
    expect(primary.result.error).toMatch(/primary language/i);

    const unadded = await callTool("updateProductTranslations", {
      productId: PRODUCT_ID,
      locale: "en",
      values: { name: "Handbag" },
    });
    expect(unadded.issues).toEqual([]);
    expect(unadded.result.success).toBe(false);
    expect(unadded.result.error).toMatch(/Add en/i);

    const collision = await callTool("updateProductTranslations", {
      productId: PRODUCT_ID,
      locale: "fr",
      values: {
        'option:["اللون","أحمر"]': "Même",
        'option:["اللون","أزرق"]': "Même",
      },
    });
    expect(collision.issues).toEqual([]);
    expect(collision.result.success).toBe(false);
    expect(collision.result.error).toMatch(/read the same/i);

    const missing = await callTool("getProductTranslations", { productId: "does-not-exist" });
    expect(missing.issues).toEqual([]);
    expect(missing.result.success).toBe(false);
    expect(missing.result.error).toMatch(/not found/i);

    const oversizedValues = Object.fromEntries(
      Array.from({ length: 81 }, (_, i) => [`option:["fake-${i}"]`, null]),
    );
    const oversized = await callTool("updateProductTranslations", {
      productId: PRODUCT_ID,
      locale: "fr",
      values: oversizedValues,
    });
    expect(oversized.issues).toEqual([]);
    expect(oversized.result.success).toBe(false);
    expect(oversized.result.error).toMatch(/At most 80/i);
  });

  it("reads and updates product group (category) and offer translations", async () => {
    const groupUpdated = await callTool("updateProductGroupTranslations", {
      groupId: GROUP_ID,
      locale: "fr",
      values: { name: "Sacs", description: "Sacs en cuir" },
    });
    expect(groupUpdated.issues).toEqual([]);
    expect(groupUpdated.result.success).toBe(true);
    expect(groupUpdated.result.translations.fr.name).toEqual({ value: "Sacs", outdated: false });
    expect(groupUpdated.result.translations.fr.description).toEqual({ value: "Sacs en cuir", outdated: false });

    const groupRead = await callTool("getProductGroupTranslations", { groupId: GROUP_ID });
    expect(groupRead.issues).toEqual([]);
    expect(groupRead.result.translations.fr.name).toEqual({ value: "Sacs", outdated: false });

    const offerUpdated = await callTool("updateOfferTranslations", {
      offerId: OFFER_ID,
      locale: "fr",
      values: { name: "Pack 2 pièces" },
    });
    expect(offerUpdated.issues).toEqual([]);
    expect(offerUpdated.result.success).toBe(true);
    expect(offerUpdated.result.translations.fr.name).toEqual({ value: "Pack 2 pièces", outdated: false });

    const offerRead = await callTool("getOfferTranslations", { offerId: OFFER_ID });
    expect(offerRead.issues).toEqual([]);
    expect(offerRead.result.translations.fr.name).toEqual({ value: "Pack 2 pièces", outdated: false });
  });
});
