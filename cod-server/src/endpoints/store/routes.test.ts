/**
 * Route-level integration tests for Store API OpenAPIHono router
 * (public storefront surface behind X-Store-API-Key).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { deliveredAt } from "@/test-utils/checkout-quote";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { DEFAULT_CHECKOUT_FORM_POLICY } from "../../../../cod-shared/checkout-form/policy";
import storeRouter from "./routes";
import * as queries from "./queries";
import { TEST_MEDIA_VARS, TEST_DELIVERY } from "@/test-utils/media";

// The address rule is tested against the real reference tables
// (store.queries-e2e); this file's mocked database cannot answer it.
vi.mock("@/lib/order-address", () => ({ assertOrderAddress: vi.fn(async () => undefined) }));

vi.mock("@/db", () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock("./queries");
vi.mock("@/lib/capi", () => ({ sendCapiEvent: vi.fn(async () => ({ success: true })) }));
// OTP verification defaults to disabled in these fixtures — the gate must be
// inert (no config row), exactly like a store that never enabled the feature.
vi.mock("../../../../cod-shared/queries/otp-config");
// Same for the Turnstile gate — no config row = feature inert.
vi.mock("../../../../cod-shared/queries/turnstile-config");

const NOW = new Date().toISOString();

let mockDb: any;

function listProductRow(overrides: Record<string, any> = {}) {
  return {
    id: "prod_1",
    name: "Samsung Galaxy A54",
    description: null,
    handle: "samsung-galaxy-a54",
    currency: "DZD",
    price: 45000,
    compareAtPrice: null,
    costPrice: null,
    type: "PHYSICAL",
    hasVariants: false,
    variantOptions: null,
    sku: "A54",
    inventory: 10,
    trackInventory: true,
    lowStockThreshold: 5,
    categoryId: null,
    tags: null,
    visibility: true,
    status: "ACTIVE",
    showInStore: true,
    deletedAt: null,
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    coverImage: { id: "img_1", key: "products/a.jpg", url: `${TEST_DELIVERY.origin}/products/a.jpg`, width: null, height: null, altText: null, position: 1 },
    reviewStats: { avgRating: 4.5, reviewCount: 12 },
    ...overrides,
  };
}

function detailRow(overrides: Record<string, any> = {}) {
  return {
    ...listProductRow(overrides),
    variantOptions: [{ name: "Color", values: [{ value: "Red" }] }],
    tags: ["sale"],
    category: {
      id: "cat_1", name: "Electronics", slug: "electronics", description: null,
      parentId: null, image: null, position: 0, createdAt: NOW, updatedAt: NOW,
    },
    variants: [],
    images: [],
    offers: [
      {
        id: "off_1",
        name: "Buy 2 Get 1",
        discountType: "free",
        triggerQuantity: 2,
        triggerVariantId: null,
        rewardQuantity: 1,
        rewardProductId: "prod_2",
        rewardProductName: "Galaxy Buds",
        rewardVariantId: null,
        rewardVariantLabel: null,
      },
    ],
  };
}

describe("Store API routes (OpenAPIHono)", () => {
  let app: OpenAPIHono<AppContext>;

  beforeEach(() => {
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: mockDb, ...TEST_MEDIA_VARS } as any;
      c.set("storeId", "store_1");
      await next();
    });
    app.onError(errorHandler);
    app.route("/store", storeRouter);
    mockDb = {};
    vi.clearAllMocks();
    // No `?locale=`: every read is served in the store's primary, untranslated.
    vi.mocked(queries.resolveStorefrontLocale).mockResolvedValue({ locale: "ar", primary: "ar", translate: null });
    // Every order goes through the store's Checkout Form Policy. The defaults
    // are the storefront's behaviour before that feature existed, so these
    // route tests keep asserting exactly what they always asserted.
    vi.mocked(queries.getCheckoutFormPolicy).mockResolvedValue({
      policy: DEFAULT_CHECKOUT_FORM_POLICY,
      lang: "ar",
    } as any);
  });

  describe("GET /store/config", () => {
    it("returns 200 with storefront configuration", async () => {
      vi.mocked(queries.getStoreConfig).mockResolvedValue({
        id: "store_1",
        name: "متجري",
        lang: "ar",
        reviewsEnabled: true,
      } as any);

      const res = await app.request("/store/config");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.name).toBe("متجري");
    });

    it("sanitizes the header strip before the storefront reads it", async () => {
      vi.mocked(queries.getStoreConfig).mockResolvedValue({
        id: "store_1",
        name: "متجري",
        lang: "ar",
        themeSettings: { pageScheme: "scheme-6", headerHtml: '<strong>Sale</strong><script>alert(1)</script>' },
      } as any);

      const res = await app.request("/store/config");
      const body: any = await res.json();

      expect(body.data.themeSettings.headerHtml).toBe("<strong>Sale</strong>&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("returns 404 when the store is missing", async () => {
      vi.mocked(queries.getStoreConfig).mockResolvedValue(null as any);

      const res = await app.request("/store/config");

      expect(res.status).toBe(404);
      expect((await res.json() as any).code).toBe("STORE_NOT_FOUND");
    });
  });

  describe("GET /store/products", () => {
    it("refuses a page size below 1 — SQLite reads LIMIT -1 as no limit", async () => {
      for (const limit of ["-1", "0"]) {
        const res = await app.request(`/store/products?limit=${limit}`);
        expect(res.status).toBe(400);
      }
      expect(queries.getStoreProducts).not.toHaveBeenCalled();
    });

    it("returns 200 with catalog and count", async () => {
      vi.mocked(queries.getStoreProducts).mockResolvedValue([listProductRow()] as any);

      const res = await app.request("/store/products?collection=featured&limit=12");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.count).toBe(1);
      expect(body.data[0].coverImage).toBeDefined();
      expect(body.data[0].reviewStats.avgRating).toBe(4.5);
      expect(queries.getStoreProducts).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({ collection: "featured", limit: 12 }),
        null,
        TEST_DELIVERY,
      );
      expect(res.headers.get("Content-Language")).toBe("ar");
    });
  });

  describe("GET /store/products/{handle}", () => {
    it("returns 200 with parsed detail incl. offers", async () => {
      vi.mocked(queries.getStoreProductByHandle).mockResolvedValue(detailRow() as any);

      const res = await app.request("/store/products/samsung-galaxy-a54");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(Array.isArray(body.data.variantOptions)).toBe(true);
      expect(Array.isArray(body.data.tags)).toBe(true);
      expect(body.data.offers[0].rewardProductName).toBe("Galaxy Buds");
    });

    it("returns 404 for an unknown handle", async () => {
      vi.mocked(queries.getStoreProductByHandle).mockResolvedValue(null as any);

      const res = await app.request("/store/products/unknown");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /store/communes/{wilayaId}", () => {
    it("returns 400 for an out-of-range wilaya", async () => {
      const res = await app.request("/store/communes/99");

      // Route-level param validation now rejects before the handler's
      // VALUE_OUT_OF_RANGE fallback can fire.
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it("returns communes for a valid wilaya", async () => {
      vi.mocked(queries.getStoreCommunes).mockResolvedValue([
        { id: "c-16-001", name: "Bab El Oued", nameAr: "باب الوادي" },
      ] as any);

      const res = await app.request("/store/communes/16");

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data[0].id).toBe("c-16-001");
    });
  });

  describe("POST /store/orders", () => {
    const validOrder = {
      customerName: "أحمد بن علي",
      phone: "0551234567",
      wilayaId: 16,
      communeId: "16001",
      address: "Algiers",
      productId: "prod_1",
      productName: "Galaxy A54",
      quantity: 2,
      pricePerUnit: 4500,
    };

    it("creates an order and returns totals with 201", async () => {
      vi.mocked(queries.loadCatalogSnapshot).mockResolvedValue({
        products: new Map(), variants: new Map(), offers: [],
      } as any);
      vi.mocked(queries.findMissingSku).mockReturnValue(null as any);
      vi.mocked(queries.findStockShortfall).mockReturnValue(null as any);
      vi.mocked(queries.findOrCreateCustomer).mockResolvedValue({
        id: "cust_1",
        name: "أحمد بن علي",
      } as any);
      vi.mocked(queries.quoteCheckout).mockResolvedValue(deliveredAt(600));
      vi.mocked(queries.createStoreOrder).mockResolvedValue({
        id: "ord_1",
        orderNumber: "ORD-20260821-0001",
        price: 9000,
        deliveryFee: 600,
      } as any);

      const pending: Promise<unknown>[] = [];
      const res = await app.request(
        "/store/orders",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validOrder),
        },
        undefined,
        { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {}, props: {} as Record<string, unknown> }
      );
      await Promise.allSettled(pending);

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.data.total).toBe(9600);
    });

    it("surfaces insufficient stock as 422", async () => {
      vi.mocked(queries.loadCatalogSnapshot).mockResolvedValue({
        products: new Map(), variants: new Map(), offers: [],
      } as any);
      vi.mocked(queries.findMissingSku).mockReturnValue(null as any);
      vi.mocked(queries.findStockShortfall).mockReturnValue({ message: "Not enough stock", productId: "prod_1", variantId: null });

      const res = await app.request("/store/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validOrder),
      });

      expect(res.status).toBe(422);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.INSUFFICIENT_STOCK);
      expect(body.context).toEqual({ productId: "prod_1" });
    });

    it("rejects a cart over the line cap with 4xx, not a 500", async () => {
      // 21 distinct lines. The schema caps `items` at 20, so this is refused
      // at the edge — a shopper (or a script) must never get a 500 for it.
      const res = await app.request("/store/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validOrder,
          items: Array.from({ length: 21 }, (_, i) => ({
            productId: `prod_${i}`,
            productName: `P${i}`,
            quantity: 1,
          })),
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it("rejects duplicate lines that SUM past the quantity cap with 4xx", async () => {
      // 60 + 60 of the same product is 120 units. The schema sees two legal
      // lines; only the engine's post-merge check catches it, and it must
      // surface as a client error rather than an unhandled throw.
      vi.mocked(queries.loadCatalogSnapshot).mockResolvedValue({
        products: new Map(), variants: new Map(), offers: [],
      } as any);
      vi.mocked(queries.findMissingSku).mockReturnValue(null as any);
      vi.mocked(queries.findStockShortfall).mockReturnValue(null as any);

      const res = await app.request("/store/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validOrder,
          items: [
            { productId: "prod_1", productName: "P", quantity: 60 },
            { productId: "prod_1", productName: "P", quantity: 60 },
          ],
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const body: any = await res.json();
      expect(body.code).toBe(ERROR_CODES.VALUE_OUT_OF_RANGE);
    });

    it("rejects a missing phone with 400", async () => {
      const { phone, ...withoutPhone } = validOrder;

      const res = await app.request("/store/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withoutPhone),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /store/page-documents/{surface}", () => {
    it("returns the saved document", async () => {
      const doc = { version: 1, surface: "home", sections: [{ type: "hero" }] };
      vi.mocked(queries.getPageDocument).mockResolvedValue(doc);

      const res = await app.request("/store/page-documents/home");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: doc });
    });

    it("answers 200 with null when the store has none — absence is not an error", async () => {
      vi.mocked(queries.getPageDocument).mockResolvedValue(null);

      const res = await app.request("/store/page-documents/home");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: null });
    });

    it("refuses a malformed surface name with 400", async () => {
      const res = await app.request("/store/page-documents/Home%20Page!");

      expect(res.status).toBe(400);
      expect(vi.mocked(queries.getPageDocument)).not.toHaveBeenCalled();
    });

    it("reads the requesting theme's document, or the latest when no theme is named", async () => {
      vi.mocked(queries.getPageDocument).mockResolvedValue(null);

      await app.request("/store/page-documents/home?theme=aurora");
      await app.request("/store/page-documents/home");

      expect(vi.mocked(queries.getPageDocument).mock.calls.map((call) => call.slice(2))).toEqual([
        ["home", "aurora"],
        ["home", undefined],
      ]);
    });

    it("refuses a theme that is not a theme key with 400", async () => {
      const res = await app.request("/store/page-documents/home?theme=Not%20A%20Key");

      expect(res.status).toBe(400);
      expect(vi.mocked(queries.getPageDocument)).not.toHaveBeenCalled();
    });
  });

});
