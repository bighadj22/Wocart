/**
 * Offers on real orders — real D1, real migrations, the real order engine and
 * the real cart quote.
 *
 *  1. Quantity pricing charges the tier the order reaches, records the offer
 *     on its lines, keeps every line reading quantity × unit = total, and makes
 *     delivery free on a tier that includes it — and the cart quote shows the
 *     shopper exactly what the order then charges.
 *  2. A gift is recorded as a gift, and a gift the stock cannot cover — once
 *     the units the shopper pays for are counted — is left out while the order
 *     goes through.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import { createStoreOrder, findOrCreateCustomer } from "../../../../cod-shared/queries/store";
import storeRoutes from "./routes";
import { TEST_MEDIA_VARS } from "@/test-utils/media";

const T = "2026-10-01T00:00:00.000Z";
const STORE = "s1";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw, ...TEST_MEDIA_VARS } as AppContext["Bindings"];
    c.set("storeId", STORE);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRoutes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of ["stock_movements", "order_products", "orders", "offer_price_tiers", "offers", "product_variants", "products", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Boutique", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.products).values([
    { id: "robe", name: "Robe", handle: "robe", sku: "ROBE", price: 2000, inventory: 50, hasVariants: true, createdAt: T, updatedAt: T },
    { id: "sac", name: "Sac", handle: "sac", sku: "SAC", price: 1500, inventory: 50, createdAt: T, updatedAt: T },
  ]);
  await d1.db.insert(schema.productVariants).values([
    { id: "robe-s", productId: "robe", variations: '{"Taille":"S"}', price: 2000, sku: "R-S", inventory: 20, position: 0, createdAt: T, updatedAt: T },
    { id: "robe-m", productId: "robe", variations: '{"Taille":"M"}', price: 2000, sku: "R-M", inventory: 20, position: 1, createdAt: T, updatedAt: T },
  ]);
});

async function quantityPricing(tiers: Array<[number, number, boolean?]>) {
  await d1.db.insert(schema.offers).values({ id: "packs", name: "Packs", discountType: "quantity_price", triggerProductId: "robe", triggerQuantity: tiers[0]![0], rewardQuantity: 0, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.offerPriceTiers).values(tiers.map(([quantity, price, freeShipping = false]) => ({ offerId: "packs", quantity, price, freeShipping })));
}

let phone = 0;
async function place(items: Array<{ productId: string; variantId?: string; quantity: number }>, deliveryFee = 600) {
  const customer = await findOrCreateCustomer(d1.db, { phone: `06600000${String(++phone).padStart(2, "0")}`, name: "Client", wilayaId: 16 });
  const order = await createStoreOrder(d1.db, {
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone,
    wilayaId: 16,
    communeId: "c-16-001",
    deliveryType: "home",
    deliveryFee,
    items: items.map((item) => ({ productName: "x", variantId: null, ...item })),
  } as never);
  const [row, lines] = await Promise.all([
    d1.db.select().from(schema.orders).where(eq(schema.orders.id, order.id)).get(),
    d1.db.select().from(schema.orderProducts).where(eq(schema.orderProducts.orderId, order.id)).all(),
  ]);
  return { order: row!, lines };
}

async function quote(items: Array<{ productId: string; variantId?: string; quantity: number }>) {
  const response = await app.request("/store/cart/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: items.map((item) => ({ productName: "x", ...item })) }),
  });
  return (await response.json() as {
    data: {
      subtotal: number;
      lines: Array<{ lineTotal: number; offerId: string | null; offerName: string | null }>;
      rewards: Array<{ offerId: string; offerName: string | null; productId: string | null; productName: string | null; variantId: string | null; variantLabel: string | null; quantity: number }>;
      freeDelivery: { fromOffer: boolean };
    };
  }).data;
}

describe("quantity pricing on an order", () => {
  it("charges the tier reached, beyond it at its per-unit price, and names the offer on the line — not where the tier is the catalog price", async () => {
    await quantityPricing([[1, 2000], [2, 3500], [3, 4500]]);
    for (const [quantity, price, offerId] of [[1, 2000, null], [2, 3500, "packs"], [3, 4500, "packs"], [4, 6000, "packs"]] as const) {
      const { order, lines } = await place([{ productId: "robe", variantId: "robe-s", quantity }]);
      expect(order.price).toBe(price);
      expect(order.codAmount).toBe(price + 600);
      expect(lines).toEqual([expect.objectContaining({ quantity, lineTotal: price, pricePerUnit: price / quantity, offerId, reward: false })]);
    }
  });

  it("counts every size, and shares the tier's price so the lines add up to it", async () => {
    await quantityPricing([[3, 4000]]);
    const { order, lines } = await place([{ productId: "robe", variantId: "robe-s", quantity: 2 }, { productId: "robe", variantId: "robe-m", quantity: 1 }]);
    expect(order.price).toBe(4000);
    expect(lines.map((line) => line.lineTotal).sort()).toEqual([1333, 2667]);
    for (const line of lines) expect(line.pricePerUnit * line.quantity).toBeCloseTo(line.lineTotal, 6);
  });

  it("makes delivery free on a tier that includes it, and records the offer that did", async () => {
    await quantityPricing([[1, 2000], [2, 3500, true]]);
    expect((await place([{ productId: "robe", variantId: "robe-s", quantity: 1 }])).order).toMatchObject({ deliveryFee: 600, deliveryOfferId: null });
    expect((await place([{ productId: "robe", variantId: "robe-s", quantity: 2 }])).order).toMatchObject({ price: 3500, deliveryFee: 0, codAmount: 3500, deliveryOfferId: "packs" });
    const mixed = await place([{ productId: "robe", variantId: "robe-s", quantity: 2 }, { productId: "sac", quantity: 1 }]);
    expect(mixed.order).toMatchObject({ price: 5000, deliveryFee: 600, deliveryOfferId: null });
  });

  it("is what the cart quote shows before the order is placed", async () => {
    await quantityPricing([[1, 2000], [2, 3500, true], [3, 4500]]);
    for (const items of [
      [{ productId: "robe", variantId: "robe-s", quantity: 3 }],
      [{ productId: "robe", variantId: "robe-s", quantity: 2 }],
      [{ productId: "robe", variantId: "robe-s", quantity: 1 }, { productId: "robe", variantId: "robe-m", quantity: 1 }, { productId: "sac", quantity: 2 }],
    ]) {
      const [shown, placed] = [await quote(items), await place(items)];
      expect(shown.subtotal).toBe(placed.order.price);
      expect(shown.lines.map((line) => line.offerId)).toEqual(placed.lines.filter((line) => !line.reward).map((line) => line.offerId));
      expect(shown.freeDelivery.fromOffer).toBe(placed.order.deliveryOfferId !== null);
    }
  });
});

describe("quantity pricing on the product page", () => {
  it("travels as its own field, tiers in order, in the shopper's language — never inside offers", async () => {
    await quantityPricing([[3, 4500], [1, 2000], [2, 3500, true]]);
    await d1.db.insert(schema.offers).values({ id: "later-gift", name: "Gift", triggerProductId: "robe", triggerQuantity: 2, rewardProductId: "sac", rewardQuantity: 1, status: "inactive", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.storeLocales).values([{ storeId: STORE, locale: "ar", published: true, createdAt: T }, { storeId: STORE, locale: "fr", published: true, createdAt: T }]);
    await d1.db.insert(schema.translations).values({ resourceType: "offer", resourceId: "packs", locale: "fr", key: "name", value: "Packs malins", sourceDigest: "d", updatedAt: T });
    const response = await app.request("/store/products/robe?locale=fr");
    const { data } = (await response.json()) as { data: { quantityPricing: unknown; offers: unknown[] } };
    expect(data.quantityPricing).toEqual({
      offerId: "packs",
      name: "Packs malins",
      triggerVariantId: null,
      tiers: [
        { quantity: 1, price: 2000, freeShipping: false, freeShippingDeliveryType: null },
        { quantity: 2, price: 3500, freeShipping: true, freeShippingDeliveryType: null },
        { quantity: 3, price: 4500, freeShipping: false, freeShippingDeliveryType: null },
      ],
    });
    expect(data.offers).toEqual([]);
  });

  it("is shown while one of its tiers gives something, even when the first is the catalog price", async () => {
    await quantityPricing([[1, 2000], [2, 3500]]);
    const { data } = (await (await app.request("/store/products/robe")).json()) as { data: { quantityPricing: { tiers: unknown[] } | null } };
    expect(data.quantityPricing?.tiers).toHaveLength(2);
  });

  it("never promises a reward the stock cannot give: the offer comes back with the stock", async () => {
    await d1.db.insert(schema.offers).values({ id: "gift", name: "Gift", triggerProductId: "robe", triggerQuantity: 2, rewardProductId: "sac", rewardQuantity: 1, createdAt: T, updatedAt: T });
    const offersShown = async () => ((await (await app.request("/store/products/robe")).json()) as { data: { offers: Array<{ id: string }> } }).data.offers.map((offer) => offer.id);
    expect(await offersShown()).toEqual(["gift"]);
    await d1.db.update(schema.products).set({ inventory: 0 }).where(eq(schema.products.id, "sac"));
    expect(await offersShown()).toEqual([]);
    await d1.db.update(schema.products).set({ inventory: 3 }).where(eq(schema.products.id, "sac"));
    expect(await offersShown()).toEqual(["gift"]);
  });

  it("shows a same-product reward when one size can give it, and hides it when none can", async () => {
    await d1.db.insert(schema.offers).values({ id: "gift", name: "Gift", triggerProductId: "robe", triggerQuantity: 2, rewardProductId: "robe", rewardQuantity: 1, createdAt: T, updatedAt: T });
    const offersShown = async () => ((await (await app.request("/store/products/robe")).json()) as { data: { offers: Array<{ id: string }> } }).data.offers.map((offer) => offer.id);
    await d1.db.update(schema.productVariants).set({ inventory: 2 }).where(eq(schema.productVariants.id, "robe-s"));
    expect(await offersShown()).toEqual(["gift"]);
    await d1.db.update(schema.productVariants).set({ inventory: 2 }).where(eq(schema.productVariants.id, "robe-m"));
    expect(await offersShown()).toEqual([]);
  });

  it("is null for a product without it", async () => {
    const { data } = (await (await app.request("/store/products/sac")).json()) as { data: { quantityPricing: unknown } };
    expect(data.quantityPricing).toBeNull();
  });
});

describe("gifts on an order", () => {
  async function gift(rewardVariantId: string | null = null) {
    await d1.db.insert(schema.offers).values({ id: "gift", name: "Gift", triggerProductId: "robe", triggerQuantity: 2, rewardProductId: "robe", rewardVariantId, rewardQuantity: 1, createdAt: T, updatedAt: T });
  }

  it("are recorded as gifts, named by their variant, given by their offer — which the lines that earned it name too", async () => {
    await gift();
    const { order, lines } = await place([{ productId: "robe", variantId: "robe-m", quantity: 2 }]);
    expect(order.price).toBe(4000);
    expect(lines.find((line) => line.reward)).toMatchObject({ variantId: "robe-m", variantLabel: "M", quantity: 1, pricePerUnit: 0, lineTotal: 0, offerId: "gift" });
    expect(lines.find((line) => !line.reward)).toMatchObject({ quantity: 2, lineTotal: 4000, offerId: "gift" });
  });

  it("keep the offer's name as it was, through a rename and the offer's deletion — lines and free delivery alike", async () => {
    await gift();
    const gifted = await place([{ productId: "robe", variantId: "robe-m", quantity: 2 }]);
    await d1.db.delete(schema.offers).where(eq(schema.offers.id, "gift"));
    await quantityPricing([[2, 3500, true]]);
    const packed = await place([{ productId: "robe", variantId: "robe-s", quantity: 2 }]);
    expect(packed.lines.map((line) => line.offerName)).toEqual(["Packs"]);
    await d1.db.update(schema.offers).set({ name: "Packs renamed" }).where(eq(schema.offers.id, "packs"));
    await d1.db.delete(schema.offers).where(eq(schema.offers.id, "packs"));

    const kept = async (orderId: string) => ({
      order: await d1.db.select({ id: schema.orders.deliveryOfferId, name: schema.orders.deliveryOfferName }).from(schema.orders).where(eq(schema.orders.id, orderId)).get(),
      lines: await d1.db.select({ id: schema.orderProducts.offerId, name: schema.orderProducts.offerName, reward: schema.orderProducts.reward }).from(schema.orderProducts).where(eq(schema.orderProducts.orderId, orderId)).all(),
    });
    expect(await kept(gifted.order.id)).toEqual({
      order: { id: null, name: null },
      lines: expect.arrayContaining([{ id: null, name: "Gift", reward: false }, { id: null, name: "Gift", reward: true }]),
    });
    expect(await kept(packed.order.id)).toEqual({ order: { id: null, name: "Packs" }, lines: [{ id: null, name: "Packs", reward: false }] });
  });

  it("are left out, and the order goes through, when the stock left after the paid units cannot cover them", async () => {
    await gift();
    await d1.db.update(schema.productVariants).set({ inventory: 2 }).where(eq(schema.productVariants.id, "robe-s"));
    const { order, lines } = await place([{ productId: "robe", variantId: "robe-s", quantity: 2 }]);
    expect(order.price).toBe(4000);
    expect(lines.filter((line) => line.reward)).toEqual([]);
    expect((await d1.db.select().from(schema.productVariants).where(eq(schema.productVariants.id, "robe-s")).get())?.inventory).toBe(0);
    expect(lines.map((line) => line.offerId)).toEqual([null]);
  });

  it("that the stock cannot cover leave the product to its next offer, and the quote says so before the order", async () => {
    await d1.db.insert(schema.offers).values([
      { id: "gift", name: "Gift", triggerProductId: "robe", triggerQuantity: 2, rewardProductId: "sac", rewardQuantity: 1, createdAt: T, updatedAt: T },
      { id: "ship", name: "Ship", discountType: "free_shipping", triggerProductId: "robe", triggerQuantity: 2, rewardQuantity: 0, createdAt: T, updatedAt: T },
    ]);
    const items = [{ productId: "robe", variantId: "robe-s", quantity: 2 }];
    expect(await quote(items)).toMatchObject({ rewards: [{ offerId: "gift" }], freeDelivery: { fromOffer: false } });

    await d1.db.update(schema.products).set({ inventory: 0 }).where(eq(schema.products.id, "sac"));
    const shown = await quote(items);
    expect(shown).toMatchObject({ rewards: [], freeDelivery: { fromOffer: true }, lines: [{ offerId: "ship" }] });
    const { order, lines } = await place(items);
    expect(order).toMatchObject({ deliveryFee: 0, deliveryOfferId: "ship" });
    expect(lines).toEqual([expect.objectContaining({ offerId: "ship", reward: false })]);
  });

  it("bring their own size from elsewhere in the catalog when the offer names one", async () => {
    await d1.db.insert(schema.offers).values({ id: "gift", name: "Gift", triggerProductId: "sac", triggerQuantity: 1, rewardProductId: "robe", rewardVariantId: "robe-m", rewardQuantity: 1, createdAt: T, updatedAt: T });
    const { lines } = await place([{ productId: "sac", quantity: 1 }]);
    expect(lines.find((line) => line.reward)).toMatchObject({ productId: "robe", variantId: "robe-m", variantLabel: "M", offerId: "gift" });
    expect((await d1.db.select().from(schema.productVariants).where(eq(schema.productVariants.id, "robe-m")).get())?.inventory).toBe(19);
  });

  it("take the product's first option when the gift is another product with sizes", async () => {
    await d1.db.insert(schema.offers).values({ id: "gift", name: "Gift", triggerProductId: "sac", triggerQuantity: 1, rewardProductId: "robe", rewardQuantity: 1, createdAt: T, updatedAt: T });
    // First by id is robe-m; first by position is robe-s — position decides.
    await d1.db.update(schema.productVariants).set({ position: 5 }).where(eq(schema.productVariants.id, "robe-m"));
    const { lines } = await place([{ productId: "sac", quantity: 1 }]);
    expect(lines.find((line) => line.reward)?.variantId).toBe("robe-s");
  });

  it("are quoted as they will be given — the variant, its label and the offer's name — before the order", async () => {
    await gift();
    const items = [{ productId: "robe", variantId: "robe-m", quantity: 2 }];
    const shown = await quote(items);
    const { lines } = await place(items);
    const given = lines.find((line) => line.reward)!;
    expect(given).toMatchObject({ variantId: "robe-m", variantLabel: "M" });
    expect(shown.rewards).toEqual([{ offerId: "gift", offerName: "Gift", productId: "robe", productName: "Robe", variantId: given.variantId, variantLabel: given.variantLabel, quantity: 1 }]);
    expect(shown.lines).toEqual([expect.objectContaining({ offerId: "gift", offerName: "Gift" })]);
  });
});
