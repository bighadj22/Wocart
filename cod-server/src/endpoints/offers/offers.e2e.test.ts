/**
 * Offers — real D1, real migrations, real routes.
 *
 *  1. Migration 0051 keeps every offer, repairs the ones the old code let
 *     through (switched off for the merchant to review), and moves gift lines
 *     off their "🎁 مجاني" label onto a field of their own.
 *  2. Every write is judged whole: an edit can never leave an incoherent offer,
 *     a variant must be of its product, and the database refuses the same.
 *  3. Quantity pricing is written with its tiers and is never live beside
 *     another offer for the same product.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { signIn } from "@/test-utils/sign-in";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import offersRouter from "./routes";

const T = "2026-10-01T00:00:00.000Z";

describe("migration 0051", () => {
  let legacy: TestD1;
  const run = (query: string) => legacy.raw.prepare(query).run();

  beforeAll(async () => {
    legacy = await createTestD1({ before: "0051_offer_kinds_and_order_offers.sql" });
    await run(`INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'B', 'ar', '${T}', '${T}')`);
    for (const id of ["p1", "p2"]) await run(`INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('${id}', '${id}', '${id}', 1000, '${T}', '${T}')`);
    const offer = (id: string, values: string) =>
      run(`INSERT INTO offers (id, name, trigger_product_id, trigger_quantity, reward_product_id, reward_quantity, discount_type, starts_at, ends_at, status, created_at, updated_at) VALUES ('${id}', '${id}', 'p1', ${values}, '${T}', '${T}')`);
    await offer("good", "2, 'p2', 1, 'free', NULL, NULL, 'active'");
    await offer("no-gift", "2, NULL, 1, 'free', NULL, NULL, 'active'");
    await offer("stray-gift", "2, 'p2', 1, 'free_shipping', NULL, NULL, 'active'");
    await offer("backwards", "2, 'p2', 1, 'free', '2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z', 'active'");
    await run(`INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('offer', 'good', 'fr', 'name', 'Bon', 'd', '${T}')`);
    await run(`INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'C', '0550000000', 'Alger', '${T}')`);
    await run(`INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('o1', 'N1', 'c1', 'C', '0550000000', 2000, '${T}', '${T}')`);
    const line = (id: string, label: string | null, total: number) =>
      run(`INSERT INTO order_products (id, order_id, product_id, product_name, variant_label, quantity, price_per_unit, line_total, created_at) VALUES ('${id}', 'o1', 'p1', 'P', ${label === null ? "NULL" : `'${label}'`}, 1, ${total}, ${total}, '${T}')`);
    await line("paid", "أحمر", 2000);
    await line("gift-plain", "🎁 مجاني", 0);
    await line("gift-variant", "أحمر — 🎁 مجاني", 0);
    await legacy.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await legacy?.dispose();
  });

  it("keeps every offer, and switches off the incoherent ones repaired", async () => {
    const rows = (await legacy.raw.prepare("SELECT id, discount_type, reward_product_id, reward_quantity, ends_at, status FROM offers ORDER BY id").all()).results;
    expect(rows).toEqual([
      { id: "backwards", discount_type: "free", reward_product_id: "p2", reward_quantity: 1, ends_at: null, status: "inactive" },
      { id: "good", discount_type: "free", reward_product_id: "p2", reward_quantity: 1, ends_at: null, status: "active" },
      { id: "no-gift", discount_type: "free", reward_product_id: "p1", reward_quantity: 1, ends_at: null, status: "inactive" },
      { id: "stray-gift", discount_type: "free_shipping", reward_product_id: null, reward_quantity: 0, ends_at: null, status: "active" },
    ]);
    expect(await legacy.raw.prepare("SELECT value FROM translations WHERE resource_id = 'good'").first()).toEqual({ value: "Bon" });
  });

  it("marks the old gift lines as gifts and gives them their label back", async () => {
    const lines = (await legacy.raw.prepare("SELECT id, variant_label, reward FROM order_products ORDER BY id").all()).results;
    expect(lines).toEqual([
      { id: "gift-plain", variant_label: null, reward: 1 },
      { id: "gift-variant", variant_label: "أحمر", reward: 1 },
      { id: "paid", variant_label: "أحمر", reward: 0 },
    ]);
  });

  it("makes the database refuse an incoherent offer", async () => {
    const insert = (values: string) =>
      run(`INSERT INTO offers (id, name, trigger_product_id, trigger_quantity, reward_product_id, reward_quantity, discount_type, status, created_at, updated_at) VALUES (${values}, 'active', '${T}', '${T}')`);
    await expect(insert("'x1', 'x', 'p1', 2, NULL, 1, 'free'")).rejects.toThrow();
    await expect(insert("'x2', 'x', 'p1', 2, 'p2', 1, 'free_shipping'")).rejects.toThrow();
    await expect(insert("'x3', 'x', 'p1', 0, 'p2', 1, 'free'")).rejects.toThrow();
    await expect(insert("'x4', 'x', 'p1', 1, NULL, 0, 'bogus'")).rejects.toThrow();
    await insert("'x5', 'x', 'p1', 1, NULL, 0, 'quantity_price'");
    await expect(run(`INSERT INTO offer_price_tiers (offer_id, quantity, price) VALUES ('x5', 0, 100)`)).rejects.toThrow();
    await run(`INSERT INTO offer_price_tiers (offer_id, quantity, price) VALUES ('x5', 2, 3500)`);
    await run("DELETE FROM offers WHERE id = 'x5'");
    expect(await legacy.raw.prepare("SELECT count(*) AS n FROM offer_price_tiers").first()).toEqual({ n: 0 });
  });
});

describe("migration 0053", () => {
  let legacy: TestD1;
  const run = (query: string) => legacy.raw.prepare(query).run();

  beforeAll(async () => {
    legacy = await createTestD1({ before: "0053_order_offer_names.sql" });
    await run(`INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'P', 'p1', 1000, '${T}', '${T}')`);
    await run(`INSERT INTO offers (id, name, trigger_product_id, trigger_quantity, reward_product_id, reward_quantity, discount_type, created_at, updated_at) VALUES ('gift', 'Buy 2, one free', 'p1', 2, 'p1', 1, 'free', '${T}', '${T}')`);
    await run(`INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'C', '0550000000', 'Alger', '${T}')`);
    const order = (id: string, deliveryOffer: string | null) =>
      run(`INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, delivery_offer_id, created_at, updated_at) VALUES ('${id}', '${id}', 'c1', 'C', '0550000000', 2000, ${deliveryOffer ? `'${deliveryOffer}'` : "NULL"}, '${T}', '${T}')`);
    await order("o1", "gift");
    await order("o2", null);
    const line = (id: string, orderId: string, offerId: string | null, reward: number) =>
      run(`INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, offer_id, reward, created_at) VALUES ('${id}', '${orderId}', 'p1', 'P', 1, 1000, 1000, ${offerId ? `'${offerId}'` : "NULL"}, ${reward}, '${T}')`);
    await line("paid", "o1", "gift", 0);
    await line("given", "o1", "gift", 1);
    await line("plain", "o2", null, 0);
    await legacy.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await legacy?.dispose();
  });

  it("names each line and free delivery by the offer that still exists, and leaves the rest without a name", async () => {
    expect((await legacy.raw.prepare("SELECT id, offer_name FROM order_products ORDER BY id").all()).results).toEqual([
      { id: "given", offer_name: "Buy 2, one free" },
      { id: "paid", offer_name: "Buy 2, one free" },
      { id: "plain", offer_name: null },
    ]);
    expect((await legacy.raw.prepare("SELECT id, delivery_offer_name FROM orders ORDER BY id").all()).results).toEqual([
      { id: "o1", delivery_offer_name: "Buy 2, one free" },
      { id: "o2", delivery_offer_name: null },
    ]);
  });
});

describe("offers through the real routes", () => {
  let d1: TestD1;
  let app: OpenAPIHono<AppContext>;

  beforeAll(async () => {
    d1 = await createTestD1();
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: d1.raw } as AppContext["Bindings"];
      signIn(c, { id: "admin", name: "Admin", role: "admin", status: "active", scopes: ["*"] } as never);
      await next();
    });
    app.onError(errorHandler);
    app.route("/api/offers", offersRouter);
  }, 120_000);

  afterAll(async () => {
    await d1?.dispose();
  });

  beforeEach(async () => {
    for (const table of ["offer_price_tiers", "offers", "product_variants", "products"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
    await d1.db.insert(schema.products).values([
      { id: "robe", name: "Robe", handle: "robe", price: 2000, createdAt: T, updatedAt: T },
      { id: "sac", name: "Sac", handle: "sac", price: 1500, createdAt: T, updatedAt: T },
    ]);
    await d1.db.insert(schema.productVariants).values([
      { id: "robe-red", productId: "robe", variations: '{"Couleur":"Rouge"}', price: 2000, sku: "R-R", createdAt: T, updatedAt: T },
      { id: "sac-black", productId: "sac", variations: '{"Couleur":"Noir"}', price: 1500, sku: "S-N", createdAt: T, updatedAt: T },
    ]);
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const quantityPricing = { name: "Packs", discountType: "quantity_price", triggerProductId: "robe", tiers: [{ quantity: 3, price: 4500 }, { quantity: 1, price: 2000 }, { quantity: 2, price: 3500, freeShipping: true }] };

  it("write quantity pricing with its tiers, in order, from its lowest tier", async () => {
    const created = await call("POST", "/api/offers", quantityPricing);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      discountType: "quantity_price",
      triggerQuantity: 1,
      rewardQuantity: 0,
      rewardProduct: null,
      tiers: [
        { quantity: 1, price: 2000, freeShipping: false },
        { quantity: 2, price: 3500, freeShipping: true },
        { quantity: 3, price: 4500, freeShipping: false },
      ],
    });
    const edited = await call("PATCH", `/api/offers/${created.body.data.id}`, { tiers: [{ quantity: 2, price: 3000 }] });
    expect(edited.body.data).toMatchObject({ triggerQuantity: 2, tiers: [{ quantity: 2, price: 3000, freeShipping: false }] });
  });

  it("save and keep the eligible delivery method of a free-shipping offer and its tiers", async () => {
    const created = await call("POST", "/api/offers", {
      name: "Pickup ships free",
      discountType: "free_shipping",
      triggerProductId: "robe",
      triggerQuantity: 2,
      freeShippingDeliveryType: "stop_desk",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.freeShippingDeliveryType).toBe("stop_desk");

    const edited = await call("PATCH", `/api/offers/${created.body.data.id}`, { name: "Pickup only" });
    expect(edited.body.data.freeShippingDeliveryType).toBe("stop_desk");
    const both = await call("PATCH", `/api/offers/${created.body.data.id}`, { freeShippingDeliveryType: null });
    expect(both.body.data.freeShippingDeliveryType).toBeNull();

    const tiers = await call("POST", "/api/offers", {
      ...quantityPricing,
      status: "inactive",
      tiers: [{ quantity: 2, price: 3500, freeShipping: true, freeShippingDeliveryType: "home" }],
    });
    expect(tiers.status).toBe(201);
    expect(tiers.body.data.tiers).toEqual([{ quantity: 2, price: 3500, freeShipping: true, freeShippingDeliveryType: "home" }]);
    const tierEdit = await call("PATCH", `/api/offers/${tiers.body.data.id}`, { name: "Home packs" });
    expect(tierEdit.body.data.tiers).toEqual([{ quantity: 2, price: 3500, freeShipping: true, freeShippingDeliveryType: "home" }]);
  });

  it("refuse tiers that are empty, doubled, or on another kind", async () => {
    const refused = async (body: unknown) => (await call("POST", "/api/offers", body)).body;
    expect(await refused({ ...quantityPricing, tiers: [] })).toMatchObject({ code: "INVALID_OFFER", context: { reason: "empty" } });
    expect(await refused({ ...quantityPricing, tiers: [{ quantity: 2, price: 1 }, { quantity: 2, price: 2 }] })).toMatchObject({ context: { reason: "duplicate_quantity" } });
    expect(await refused({ name: "Gift", triggerProductId: "robe", rewardProductId: "sac", tiers: [{ quantity: 2, price: 1 }] })).toMatchObject({ context: { reason: "tiers_not_allowed" } });
  });

  it("judge an edit with the fields it does not touch", async () => {
    const gift = (await call("POST", "/api/offers", { name: "Gift", triggerProductId: "robe", triggerQuantity: 2, rewardProductId: "sac" })).body.data;
    expect(await call("PATCH", `/api/offers/${gift.id}`, { rewardProductId: null })).toMatchObject({ status: 400, body: { context: { reason: "reward_required" } } });
    expect(await call("PATCH", `/api/offers/${gift.id}`, { startsAt: "2026-05-01T00:00:00Z", endsAt: "2026-04-01T00:00:00Z" })).toMatchObject({ status: 400, body: { context: { reason: "schedule_ends_before_start" } } });
    const freeShipping = await call("PATCH", `/api/offers/${gift.id}`, { discountType: "free_shipping" });
    expect(freeShipping.status).toBe(200);
    expect(freeShipping.body.data).toMatchObject({ discountType: "free_shipping", rewardProduct: null, rewardQuantity: 0 });
  });

  it("refuse a variant of another product, and a product that does not exist", async () => {
    expect((await call("POST", "/api/offers", { name: "Gift", triggerProductId: "robe", triggerVariantId: "sac-black", rewardProductId: "sac" })).body).toMatchObject({ context: { reason: "variant_not_of_product" } });
    expect((await call("POST", "/api/offers", { name: "Gift", triggerProductId: "robe", rewardProductId: "sac", rewardVariantId: "robe-red" })).body).toMatchObject({ context: { reason: "variant_not_of_product" } });
    expect((await call("POST", "/api/offers", { name: "Gift", triggerProductId: "ghost", rewardProductId: "sac" })).body).toMatchObject({ context: { reason: "unknown_product" } });
  });

  it("say where each offer stands now — what the shopper sees, not only the merchant's switch", async () => {
    const gift = { triggerProductId: "robe", rewardProductId: "sac" };
    await call("POST", "/api/offers", { ...gift, name: "Live" });
    await call("POST", "/api/offers", { ...gift, name: "Later", startsAt: "2099-01-01T00:00:00Z" });
    await call("POST", "/api/offers", { ...gift, name: "Over", endsAt: "2020-01-01T00:00:00Z" });
    await call("POST", "/api/offers", { ...gift, name: "Off", status: "inactive" });
    const listed = (await call("GET", "/api/offers")).body.data as Array<{ id: string; name: string; status: string; state: string }>;
    expect(Object.fromEntries(listed.map((offer) => [offer.name, [offer.status, offer.state]]))).toEqual({
      Live: ["active", "live"],
      Later: ["active", "scheduled"],
      Over: ["active", "expired"],
      Off: ["inactive", "inactive"],
    });
    const later = listed.find((offer) => offer.name === "Later")!;
    expect((await call("GET", `/api/offers/${later.id}`)).body.data.state).toBe("scheduled");
  });

  it("never let quantity pricing be live beside another offer for the product, at the same time", async () => {
    const gift = (await call("POST", "/api/offers", { name: "Gift", triggerProductId: "robe", rewardProductId: "sac", endsAt: "2026-06-01T00:00:00Z" })).body.data;
    expect(await call("POST", "/api/offers", quantityPricing)).toMatchObject({ status: 409, body: { code: "OFFER_CONFLICT", context: { offerId: gift.id, offerName: "Gift" } } });
    expect((await call("POST", "/api/offers", { ...quantityPricing, startsAt: "2026-06-01T00:00:00Z" })).status).toBe(201);
    expect((await call("POST", "/api/offers", { ...quantityPricing, status: "inactive" })).status).toBe(201);
    expect((await call("POST", "/api/offers", { ...quantityPricing, triggerProductId: "sac" })).status).toBe(201);
    expect((await call("POST", "/api/offers", { name: "Gift 2", triggerProductId: "robe", rewardProductId: "sac", startsAt: "2026-07-01T00:00:00Z" })).status).toBe(409);
  });
});
