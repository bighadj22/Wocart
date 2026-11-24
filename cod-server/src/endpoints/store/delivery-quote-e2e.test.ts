/**
 * The delivery quote — real-D1 E2E.
 *
 * POST /store/cart/validate with a `destination` answers what the basket costs
 * delivered there: the fee and the total. It is worth something only if it is
 * the number the order then charges, so each case asks the cart for its quote
 * and then places the same order through POST /store/orders, and the two must
 * agree — across the store default rate, stop-desk delivery, a commune
 * override, a basket spanning two profiles, the free-delivery threshold, a
 * free-shipping offer, and a destination the store does not serve.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import storeRouter from "./routes";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
const NOW = () => new Date().toISOString();
const STORE_ID = "store-delivery-quote";
const WILAYA = 16;
// Real communes from the migrations — orders.commune_id is a foreign key.
const COMMUNE = "c-16-001";
const OTHER_COMMUNE = "c-16-002";
const UNSERVED = { wilayaId: 31, communeId: "c-31-001" };
let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

beforeAll(async () => {
  harness = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: harness.raw } as never;
    c.set("storeId", STORE_ID);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  await harness.db.delete(schema.orderProducts);
  await harness.db.delete(schema.stockMovements);
  await harness.db.delete(schema.orders);
  await harness.db.delete(schema.customers);
  await harness.db.delete(schema.offers);
  await harness.db.delete(schema.productVariants);
  await harness.db.delete(schema.products);
  await harness.db.delete(schema.shippingRuleCommunes);
  await harness.db.delete(schema.shippingRules);
  await harness.db.delete(schema.shippingProfiles);
  await harness.db.delete(schema.stores);
  await harness.db.insert(schema.stores).values({
    id: STORE_ID,
    name: "Quote Store",
    lang: "en",
    createdAt: NOW(),
    updatedAt: NOW(),
  });
});

async function seedProfile(isDefault: boolean, homePrice: number, stopDeskPrice: number) {
  const profileId = uid("prof");
  const ruleId = uid("rule");
  await harness.db.insert(schema.shippingProfiles).values({
    id: profileId,
    name: profileId,
    isDefault,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  await harness.db.insert(schema.shippingRules).values({
    id: ruleId,
    profileId,
    wilayaId: WILAYA,
    homePrice,
    stopDeskPrice,
    homeEnabled: true,
    stopDeskEnabled: true,
    createdAt: NOW(),
  });
  return { profileId, ruleId };
}

async function seedProduct(price: number, shippingProfileId: string | null = null) {
  const id = uid("prod");
  await harness.db.insert(schema.products).values({
    id,
    name: `Product ${id}`,
    handle: `handle-${id}`,
    price,
    sku: `SKU-${id}`,
    status: "ACTIVE",
    trackInventory: false,
    shippingProfileId,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  return id;
}

type Line = { productId: string; quantity: number };
type Destination = { wilayaId: number; communeId?: string; deliveryType: "home" | "stop_desk" };

const asItems = (lines: Line[]) => lines.map((l) => ({ ...l, productName: "Product" }));

async function quote(lines: Line[], destination?: Destination) {
  const items = asItems(lines);
  const res = await app.request("/store/cart/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(destination ? { items, destination } : { items }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function order(lines: Line[], destination: Destination) {
  const res = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Ahmed Benali",
      phone: "0551234567",
      wilayaId: destination.wilayaId,
      communeId: destination.communeId ?? COMMUNE,
      deliveryType: destination.deliveryType,
      items: asItems(lines),
    }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** The quote, then the order it describes: both name the same fee and total. */
async function expectQuoteIsCharged(lines: Line[], destination: Destination, fee: number) {
  const quoted = await quote(lines, destination);
  expect(quoted.status).toBe(200);
  expect(quoted.json.data.delivery).toEqual({
    available: true,
    fee,
    total: quoted.json.data.subtotal + fee,
  });

  const placed = await order(lines, destination);
  expect(placed.status).toBe(201);
  expect(placed.json.data.deliveryFee).toBe(fee);
  expect(placed.json.data.total).toBe(quoted.json.data.delivery.total);
}

const HOME: Destination = { wilayaId: WILAYA, communeId: COMMUNE, deliveryType: "home" };

describe("POST /store/cart/validate — the delivery quote is what the order charges", () => {
  it("at the store's default rate", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 600);
  });

  it("for stop-desk delivery", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 1 }], { ...HOME, deliveryType: "stop_desk" }, 300);
  });

  it("with the commune's own override", async () => {
    const { ruleId } = await seedProfile(true, 600, 300);
    await harness.db.insert(schema.shippingRuleCommunes).values({
      id: uid("src"),
      ruleId,
      communeId: OTHER_COMMUNE,
      homePrice: 900,
      stopDeskPrice: null,
      homeEnabled: null,
      stopDeskEnabled: null,
    });
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 1 }], { ...HOME, communeId: OTHER_COMMUNE }, 900);
  });

  it("at the dearest rate of a basket spanning two profiles", async () => {
    await seedProfile(true, 600, 300);
    const { profileId: bulky } = await seedProfile(false, 1200, 800);
    const light = await seedProduct(1000);
    const heavy = await seedProduct(4000, bulky);

    await expectQuoteIsCharged(
      [{ productId: light, quantity: 1 }, { productId: heavy, quantity: 1 }],
      HOME,
      1200,
    );
  });

  it("free once the basket reaches the store's threshold", async () => {
    await harness.db
      .update(schema.stores)
      .set({ freeShippingThreshold: 5000 })
      .where(eq(schema.stores.id, STORE_ID))
      .run();
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 0);
  });

  it("free when a single-product offer gives free shipping", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);
    await harness.db.insert(schema.offers).values({
      id: uid("offer"),
      name: "Two ship free",
      triggerProductId: p,
      triggerQuantity: 2,
      rewardProductId: null,
      rewardQuantity: 0,
      discountType: "free_shipping",
      status: "active",
      createdAt: NOW(),
      updatedAt: NOW(),
    });

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 0);
  });

  it("charges the normal rate when the chosen delivery method is not eligible for a free-shipping offer", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);
    await harness.db.insert(schema.offers).values({
      id: uid("offer"),
      name: "Home delivery ships free",
      triggerProductId: p,
      triggerQuantity: 2,
      rewardProductId: null,
      rewardQuantity: 0,
      discountType: "free_shipping",
      freeShippingDeliveryType: "home",
      status: "active",
      createdAt: NOW(),
      updatedAt: NOW(),
    });

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 0);
    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], { ...HOME, deliveryType: "stop_desk" }, 300);
  });

  it("unavailable where the store does not deliver — and the order is refused", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);
    const destination: Destination = { ...UNSERVED, deliveryType: "home" };

    const quoted = await quote([{ productId: p, quantity: 1 }], destination);
    expect(quoted.status).toBe(200);
    expect(quoted.json.data.delivery).toEqual({ available: false, fee: null, total: null });

    const placed = await order([{ productId: p, quantity: 1 }], destination);
    expect(placed.status).toBe(422);
    expect(placed.json.code).toBe("DELIVERY_NOT_AVAILABLE");
  });

  it("answers no quote when no destination is asked for", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    const quoted = await quote([{ productId: p, quantity: 1 }]);

    expect(quoted.status).toBe(200);
    expect(quoted.json.data).not.toHaveProperty("delivery");
  });

  it("refuses a destination past the last wilaya", async () => {
    const p = await seedProduct(2500);

    const quoted = await quote([{ productId: p, quantity: 1 }], { wilayaId: LAST_WILAYA_ID + 1, deliveryType: "home" });

    expect(quoted.status).toBe(400);
  });
});

// ─── A product page's own form ──────────────────────────────────────────────
//
// The product page posts one product: a quantity, or a variant chosen per unit,
// and an offer tier. The quote takes those same fields and the server builds the
// lines from them, exactly as it does for the order — a theme never rebuilds
// them into a basket of its own.

type ProductForm = {
  productId: string;
  productName: string;
  quantity?: number;
  variantId?: string;
  offerId?: string;
  variantSelections?: Array<{ variantId: string; variantLabel?: string }>;
};

async function quoteForm(form: ProductForm, destination?: Destination) {
  const res = await app.request("/store/cart/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(destination ? { ...form, destination } : form),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function orderForm(form: ProductForm, destination: Destination) {
  const res = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Ahmed Benali",
      phone: "0551234567",
      wilayaId: destination.wilayaId,
      communeId: destination.communeId ?? COMMUNE,
      deliveryType: destination.deliveryType,
      pricePerUnit: 1,
      ...form,
    }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function seedVariant(productId: string, price: number, colour: string) {
  const id = uid("var");
  await harness.db.insert(schema.productVariants).values({
    id,
    productId,
    variations: JSON.stringify({ colour }),
    currency: "DZD",
    price,
    sku: `SKU-${id}`,
    inventory: 50,
    isDefault: false,
    active: true,
    position: seq,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  return id;
}

async function expectFormQuoteIsCharged(form: ProductForm, subtotal: number, fee: number) {
  const quoted = await quoteForm(form, HOME);
  expect(quoted.status).toBe(200);
  expect(quoted.json.data.subtotal).toBe(subtotal);
  expect(quoted.json.data.delivery).toEqual({ available: true, fee, total: subtotal + fee });

  const placed = await orderForm(form, HOME);
  expect(placed.status).toBe(201);
  expect(placed.json.data.price).toBe(subtotal);
  expect(placed.json.data.deliveryFee).toBe(fee);
  expect(placed.json.data.total).toBe(subtotal + fee);
}

describe("POST /store/cart/validate — a product form's quote is what its order charges", () => {
  it("for a quantity of one product", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectFormQuoteIsCharged({ productId: p, productName: "Shirt", quantity: 3 }, 7500, 600);
  });

  it("for a variant chosen per unit, each at its own price", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2000);
    const black = await seedVariant(p, 2000, "black");
    const gold = await seedVariant(p, 2600, "gold");

    await expectFormQuoteIsCharged(
      {
        productId: p,
        productName: "Watch",
        quantity: 3,
        variantSelections: [{ variantId: black }, { variantId: gold }, { variantId: gold }],
      },
      2000 + 2 * 2600,
      600,
    );
  });

  it("for an offer tier that ships free", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);
    const offerId = uid("offer");
    await harness.db.insert(schema.offers).values({
      id: offerId,
      name: "Two ship free",
      triggerProductId: p,
      triggerQuantity: 2,
      rewardProductId: null,
      rewardQuantity: 0,
      discountType: "free_shipping",
      status: "active",
      createdAt: NOW(),
      updatedAt: NOW(),
    });

    await expectFormQuoteIsCharged({ productId: p, productName: "Shirt", quantity: 2, offerId }, 5000, 0);
  });

  it("refuses a request that names neither a basket nor a product", async () => {
    const quoted = await quoteForm({ quantity: 1 } as unknown as ProductForm, HOME);

    expect(quoted.status).toBe(400);
  });

  it("refuses more per-unit selections than a line may hold, for the quote and the order", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2000);
    const v = await seedVariant(p, 2000, "black");
    const form: ProductForm = {
      productId: p,
      productName: "Watch",
      quantity: 1,
      variantSelections: Array.from({ length: 101 }, () => ({ variantId: v })),
    };

    expect((await quoteForm(form, HOME)).status).toBe(400);
    expect((await orderForm(form, HOME)).status).toBe(400);
  });
});

// ─── A product on its own shipping profile ──────────────────────────────────
//
// A merchant keeps a second profile with a carrier's prices (ZR Express, say)
// and sets it on a product. That product is quoted and charged the profile's
// prices — from its own page, in a basket, home and stop desk — and only where
// that profile delivers, whatever the store's default profile says.

describe("a product on its own shipping profile is quoted and charged that profile's prices", () => {
  async function zrExpressProduct() {
    const { profileId: defaultProfile } = await seedProfile(true, 600, 300);
    await harness.db.insert(schema.shippingRules).values({ id: uid("rule"), profileId: defaultProfile, wilayaId: UNSERVED.wilayaId, homePrice: 700, stopDeskPrice: 400, homeEnabled: true, stopDeskEnabled: true, createdAt: NOW() });
    const { profileId: zr } = await seedProfile(false, 950, 550);
    return { zr, product: await seedProduct(2500, zr) };
  }

  it("from its own page, home and stop desk", async () => {
    const { product } = await zrExpressProduct();
    await expectFormQuoteIsCharged({ productId: product, productName: "Robe", quantity: 1 }, 2500, 950);
    const quoted = await quoteForm({ productId: product, productName: "Robe" }, { ...HOME, deliveryType: "stop_desk" });
    expect(quoted.json.data.delivery).toEqual({ available: true, fee: 550, total: 3050 });
    const placed = await orderForm({ productId: product, productName: "Robe" }, { ...HOME, deliveryType: "stop_desk" });
    expect(placed.json.data.deliveryFee).toBe(550);
  });

  it("in a basket", async () => {
    const { product } = await zrExpressProduct();
    await expectQuoteIsCharged([{ productId: product, quantity: 2 }], HOME, 950);
  });

  it("only where its profile delivers, even where the default profile does", async () => {
    const { product } = await zrExpressProduct();
    const other = await seedProduct(2500);
    const there: Destination = { ...UNSERVED, deliveryType: "home" };
    expect((await quote([{ productId: other, quantity: 1 }], there)).json.data.delivery).toEqual({ available: true, fee: 700, total: 3200 });
    expect((await quote([{ productId: product, quantity: 1 }], there)).json.data.delivery).toEqual({ available: false, fee: null, total: null });
    const placed = await orderForm({ productId: product, productName: "Robe" }, there);
    expect(placed.status).toBe(422);
    expect(placed.json.code).toBe("DELIVERY_NOT_AVAILABLE");
  });

  it("back at the default prices once the product leaves the profile, or the profile is deleted", async () => {
    const { zr, product } = await zrExpressProduct();
    await harness.db.update(schema.products).set({ shippingProfileId: null }).where(eq(schema.products.id, product)).run();
    expect((await quoteForm({ productId: product, productName: "Robe" }, HOME)).json.data.delivery.fee).toBe(600);
    await harness.db.update(schema.products).set({ shippingProfileId: zr }).where(eq(schema.products.id, product)).run();
    expect((await quoteForm({ productId: product, productName: "Robe" }, HOME)).json.data.delivery.fee).toBe(950);
    await harness.db.delete(schema.shippingRules).where(eq(schema.shippingRules.profileId, zr)).run();
    await harness.db.delete(schema.shippingProfiles).where(eq(schema.shippingProfiles.id, zr)).run();
    expect((await quoteForm({ productId: product, productName: "Robe" }, HOME)).json.data.delivery.fee).toBe(600);
  });
});

describe("GET /store/shipping-rates — the default profile's list of prices", () => {
  it("leaves out a wilaya the default profile does not deliver to, and lists the others with their prices", async () => {
    const { profileId } = await seedProfile(true, 600, 300);
    await harness.db.insert(schema.shippingRules).values([
      { id: uid("rule"), profileId, wilayaId: 31, homePrice: 700, stopDeskPrice: 400, homeEnabled: false, stopDeskEnabled: false, createdAt: NOW() },
      { id: uid("rule"), profileId, wilayaId: 9, homePrice: 500, stopDeskPrice: 350, homeEnabled: false, stopDeskEnabled: true, createdAt: NOW() },
    ]);
    const res = await app.request("/store/shipping-rates");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ "9": { home: 500, stopDesk: 350 }, "16": { home: 600, stopDesk: 300 } });
  });
});
