import { Context } from "hono";
import { assertOrderAddress } from "@/lib/order-address";
import { storefrontClientIp } from "@/lib/storefront-client-ip";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { mediaDeliveryOf } from "@/lib/media";
import * as queries from "./queries";
import type { StoreProductsParams } from "../../../../cod-shared/queries/store";
import { storeOrderSchema, validateCartSchema } from "./validation";
import { ConflictError, NotFoundError, ValidationError, BusinessLogicError } from "@/lib/errors/classes";
import { meetsFreeDeliveryThreshold } from "../../../../cod-shared/queries/shipping-resolution";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { landingDocumentSurface } from "../../../../cod-shared/queries/page-document-surface";
import { assertOtpVerification } from "./otp-gate";
import { assertTurnstile } from "./turnstile-gate";
import { assertOrderable, commitOrder, orderLines, quoteOrder } from "./place-order";
import { holdOrder, recordAttempt, screenOrderAttempt } from "../../../../cod-shared/order-screening/screening";
// Pure, like normalizeOrderLines: the whole Checkout Form Policy contract is a
// function of (policy, submitted form), with nothing to stub.
import { applyCheckoutPolicy } from "../../../../cod-shared/checkout-form/apply";
import { checkoutPolicyMessage } from "../../../../cod-shared/checkout-form/messages";
import { resolveTrackingConfig } from "../../../../cod-shared/queries/tracking-config";
import {
  normalizeOrderLines,
  CartValidationError,
  type CartLine,
} from "../../../../cod-shared/queries/cart";
import { sanitizeHeaderHtml } from "../../../../cod-shared/stores/appearance";
// Pure, like normalizeOrderLines: imported directly rather than through
// ./queries so there is nothing for a test to stub and no way for the priced
// subtotal to diverge from what the engine charges.
import { resolveStorefrontMenu } from "../../../../cod-shared/queries/menus";
import { getStorefrontCollection } from "../../../../cod-shared/queries/collections";
import { findShopperOrder } from "../../../../cod-shared/queries/store-order-status";
import { conversionEventId, resolveConversionForStage } from "@/lib/meta-conversions";
import { stores, orders } from "../../../../cod-shared/db/schema";
import { LAST_WILAYA_ID, isWilayaId } from "../../../../cod-shared/places";
import { eq } from "drizzle-orm";

/** `?name=` after route validation (or raw, when a test mounts the handler bare). */
function queryParam(c: Context<AppContext>, name: string): string | undefined {
  return (c.req as any).valid?.("query")?.[name] ?? c.req.query(name);
}

/**
 * The language a read is served in (ADR 0005): `?locale=` when the store
 * publishes it, the primary otherwise — announced in `Content-Language`, so a
 * caller always learns which language it got.
 */
async function servedLanguage(c: Context<AppContext>, db: ReturnType<typeof getDb>) {
  const storeId = c.get("storeId")!;
  const served = await queries.resolveStorefrontLocale(db, storeId, queryParam(c, "locale"));
  if (!served) throw new NotFoundError("Store", storeId);
  c.header("Content-Language", served.locale);
  return served;
}

export async function getStoreConfig(c: Context<AppContext>) {
  const storeId = c.get("storeId")!;
  const db = getDb(c.env.DB);
  const store = await queries.getStoreConfig(db, storeId, mediaDeliveryOf(c.env), {
    theme: queryParam(c, "theme"),
    locale: queryParam(c, "locale"),
  });
  if (!store) {
    throw new NotFoundError("Store", storeId);
  }
  c.header("Content-Language", store.locale);
  const themeSettings = store.themeSettings as Record<string, unknown> | undefined;
  const safeSettings =
    themeSettings && typeof themeSettings.headerHtml === "string"
      ? { ...themeSettings, headerHtml: sanitizeHeaderHtml(themeSettings.headerHtml) }
      : themeSettings;
  return c.json({ success: true, data: safeSettings ? { ...store, themeSettings: safeSettings } : store }, 200);
}

function storeProductsParams(c: Context<AppContext>): StoreProductsParams {
  const queryData: any = (c.req as any).valid?.("query");
  const categoryId = queryData?.categoryId ?? c.req.query("categoryId") ?? undefined;
  const collection = queryData?.collection ?? c.req.query("collection") ?? undefined;
  const onSale = (queryData?.onSale ?? c.req.query("onSale")) === "true";
  const sort = queryData?.sort ?? undefined;
  const limit = Math.min(parseInt(String(queryData?.limit ?? c.req.query("limit") ?? "24")), 100);
  const offset = Math.max(parseInt(String(queryData?.offset ?? c.req.query("offset") ?? "0")) || 0, 0);
  return { collection, onSale, categoryId, sort, limit, offset };
}

/** A page of a listing and the listing's size, read together. */
async function productPage(c: Context<AppContext>, params: StoreProductsParams) {
  const db = getDb(c.env.DB);
  const { translate } = await servedLanguage(c, db);
  const [data, total] = await Promise.all([queries.getStoreProducts(db, params, translate, mediaDeliveryOf(c.env)), queries.countStoreProducts(db, params, translate)]);
  return c.json({ success: true, data, count: data.length, total }, 200);
}

export async function listStoreProducts(c: Context<AppContext>) {
  return productPage(c, storeProductsParams(c));
}

export async function searchStoreProducts(c: Context<AppContext>) {
  const { q } = (c.req as any).valid("query") as { q: string };
  return productPage(c, { ...storeProductsParams(c), search: q });
}

export async function getStoreProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const handle = c.req.param("handle")!;
  const { translate } = await servedLanguage(c, db);
  const data = await queries.getStoreProductByHandle(db, handle, { locale: translate, delivery: mediaDeliveryOf(c.env) });
  if (!data) {
    throw new NotFoundError("Product", handle);
  }
  return c.json({ success: true, data }, 200);
}

export async function getStoreLandingPage(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const preview = queryParam(c, "preview") === "1";
  const theme = queryParam(c, "theme");

  // Two round trips total: the row by slug, then ONE batched call carrying
  // images + stats + the product ref.
  const lp = await queries.getLandingPageDetailBySlug(db, slug, mediaDeliveryOf(c.env));
  if (!lp || !(lp.status === "published" || (preview && lp.status === "draft"))) {
    // Unknown, draft, or archived — same answer so nothing leaks. An editor's
    // preview also sees a draft: the store API key that asks is the storefront's own.
    throw new NotFoundError("Landing Page", slug);
  }

  // The page renders the store product exactly like the product page does —
  // same shape (variants, offers, inventory, review stats) so the theme's
  // form + scripts work unmodified. A store-hidden product (showInStore=false)
  // still renders: the merchant published the link deliberately, and the
  // landing page is its sales channel. The other gates (ACTIVE, visibility)
  // still apply, here and when the order is placed (`assertOrderable`).
  const { translate } = await servedLanguage(c, db);
  const [product, document] = await Promise.all([
    lp.product?.handle
      ? queries.getStoreProductByHandle(db, lp.product.handle, {
          locale: translate,
          delivery: mediaDeliveryOf(c.env),
          allowUnlisted: true,
        })
      : null,
    theme === undefined ? null : queries.getPageDocument(db, c.get("storeId")!, landingDocumentSurface(lp.id), theme),
  ]);


  return c.json(
    {
      success: true,
      data: {
        id: lp.id,
        slug: lp.slug,
        name: lp.name,
        status: lp.status,
        imageGap: lp.imageGap,
        metaTitle: lp.metaTitle,
        metaDescription: lp.metaDescription,
        publishedAt: lp.publishedAt,
        images: lp.images,
        product,
        document,
        // Which pixel this page loads and fires at — resolved server-side,
        // inside the batch above, so the browser never works it out for
        // itself and cannot disagree with the Conversions API mirror.
        tracking: lp.tracking,
      },
    },
    200,
  );
}

/**
 * GET /store/orders/{id}/tracking
 *
 * Which pixel this order belongs to, and which browser event to fire for it.
 *
 * The thank-you page fires the sale event but has no idea which landing page
 * the shopper came from — the redirect carries the order number, the total and
 * the order id, nothing else. It cannot be told by the URL either: landing-page
 * attribution is best-effort, so an unknown, draft or archived slug leaves the
 * order unattributed, and a browser trusting that slug would fire at a pixel
 * the server never recorded. Asking is the only way the two sides cannot drift.
 *
 * Returns the DECISION, not the configuration: `event` is null whenever no
 * browser event should fire, which deletes the copy of the conversion-stage
 * rule that used to live in the theme.
 *
 * Deliberately narrow: an unguessable order id in, a public pixel id and an
 * event name out. No customer, no total, no contents, and never a token.
 */
export async function getStoreOrderTracking(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id")!;

  const order = await db
    .select({ id: orders.id, landingPageId: orders.landingPageId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .get();
  if (!order) throw new NotFoundError("Order", orderId);

  const config = await resolveTrackingConfig(db, {
    storeId: c.get("storeId")!,
    landingPageId: order.landingPageId,
  });

  if (!config?.enabled || !config.pixelId) {
    return c.json({ success: true, data: { pixelId: null, event: null, eventId: conversionEventId(order.id) } }, 200);
  }

  const decision = resolveConversionForStage(config.conversionEvent, "checkout");

  return c.json(
    {
      success: true,
      data: {
        pixelId: config.pixelId,
        event: decision.shouldFire ? decision.eventName ?? null : null,
        eventId: conversionEventId(order.id),
      },
    },
    200,
  );
}

/**
 * A published legal or custom page in the served language (`?locale=`, else
 * the store's own) — falling back to the primary, then any translation. The
 * page's `locale` says which one it is. Draft, unknown, and foreign-store
 * slugs all answer the same 404, so nothing about a page's existence leaks.
 */
export async function getStorePage(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const storeId = c.get("storeId")!;
  const slug = c.req.param("slug")!;
  const served = await servedLanguage(c, db);

  const page = await queries.resolvePublishedPage(db, storeId, slug, mediaDeliveryOf(c.env), served.locale, served.primary);
  if (!page) throw new NotFoundError("Store Page", slug);

  return c.json({ success: true, data: page }, 200);
}

export async function getStoreCollection(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const storeId = c.get("storeId")!;
  const served = await servedLanguage(c, db);
  const handle = c.req.param("handle")!;
  const collection = await getStorefrontCollection(db, storeId, handle, served.translate);
  if (!collection) throw new NotFoundError("Collection", handle);
  const [productCount, image] = await Promise.all([queries.countStoreProducts(db, { collection: handle }, served.translate), queries.collectionCover(db, handle, mediaDeliveryOf(c.env))]);
  return c.json({ success: true, data: { ...collection, productCount, image } }, 200);
}

export async function getStoreMenu(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const storeId = c.get("storeId")!;
  const handle = c.req.param("handle")!;
  const served = await servedLanguage(c, db);
  const menu = await resolveStorefrontMenu(db, storeId, handle, served.translate);
  if (!menu) throw new NotFoundError("Menu", handle);
  return c.json({ success: true, data: menu }, 200);
}

export async function getStorePageDocument(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const storeId = c.get("storeId")!;
  const surface = c.req.param("surface")!;
  const document = await queries.getPageDocument(db, storeId, surface, queryParam(c, "theme"));
  return c.json({ success: true, data: document }, 200);
}

export async function listStoreCategories(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { translate } = await servedLanguage(c, db);
  const data = await queries.getStoreCategories(db, translate, mediaDeliveryOf(c.env));
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function getShippingRates(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const data = await queries.getShippingRates(db);
  return c.json({ success: true, data }, 200);
}

export async function listStoreCommunes(c: Context<AppContext>) {
  const wilayaId = parseInt(c.req.param("wilayaId")!);
  if (!isWilayaId(wilayaId)) {
    throw new ValidationError(
      `Invalid wilaya ID — must be an integer between 1 and ${LAST_WILAYA_ID}`,
      ERROR_CODES.VALUE_OUT_OF_RANGE,
      { wilayaId, min: 1, max: LAST_WILAYA_ID }
    );
  }
  const db = getDb(c.env.DB);
  const data = await queries.getStoreCommunes(db, wilayaId);
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function createStoreOrder(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const bodyData: any = (c.req as any).valid?.("json");
  const submitted: import("./validation").StoreOrderInput =
    bodyData ?? storeOrderSchema.parse(await c.req.json());

  // The same checkout attempt again answers with its order, before any gate:
  // its Turnstile token was spent by the first request.
  if (submitted.checkoutKey) {
    const placed = await queries.orderPlacedWith(db, submitted.checkoutKey);
    if (placed) return checkoutReplay(c, placed, submitted.phone);
  }

  // Turnstile bot gate — runs before the SKU/stock lookups so bot traffic is
  // rejected before spending D1 reads. No-op when the store has it disabled.
  await assertTurnstile(c, db, submitted);

  // The destination exists and the commune is in the wilaya, before anything is priced.
  await assertOrderAddress(db, { wilayaId: submitted.wilayaId, communeId: submitted.communeId });

  // ── Checkout Form Policy ─────────────────────────────────────────────────
  //
  // The merchant decides which fields the form asks for and how strictly each
  // is enforced. The storefront renders that policy, but the storefront is not
  // the trust boundary — this is, exactly like the OTP and Turnstile gates
  // above. A page the CDN cached before the policy changed, or a script posting
  // straight at the API, both land here.
  //
  // Position is load-bearing: after the bot gate, so bots never pay for the
  // read, and before the delivery fee is resolved, because a delivery type the
  // merchant turned off must never reach pricing.
  const { policy, lang } = await queries.getCheckoutFormPolicy(db, c.get("storeId")!);
  const applied = applyCheckoutPolicy(policy, submitted);
  if (!applied.ok) {
    throw new ValidationError(
      // Answered in the store's own language: by this point the request has
      // left the storefront, and the theme has no say in why it was refused.
      checkoutPolicyMessage(lang, applied.rejection),
      ERROR_CODES.VALIDATION_FAILED,
      { field: applied.rejection.field, reason: applied.rejection.code }
    );
  }

  // Everything downstream reads the APPLIED values, never the wire: a hidden
  // field is gone by here, and an email is already trimmed and lowercased.
  const data: import("./validation").StoreOrderInput = {
    ...submitted,
    deliveryType: applied.value.deliveryType,
    address: applied.value.address,
    notes: applied.value.notes,
    email: applied.value.email,
  };
  const customFieldAnswers = applied.value.customFieldAnswers;

  const lines = orderLines(data);

  // ONE catalog read for the whole checkout. The SKU check, the stock check and
  // the order engine all answer their questions from this same snapshot, so a
  // product row is fetched once per order instead of once per question. The
  // language the storefront was served in is the one the order records.
  const now = new Date().toISOString();
  const storeId = c.get("storeId")!;
  const [snapshot, locale] = await Promise.all([
    queries.loadCatalogSnapshot(db, lines, now),
    queries.checkoutLocale(db, storeId, lang, queryParam(c, "locale")),
  ]);
  c.header("Content-Language", locale);

  assertOrderable(snapshot, lines);

  await assertOtpVerification(c, db, data);

  const quote = await quoteOrder(db, { storeId, now, snapshot, lines, data });

  const ipAddress = storefrontClientIp(c);
  const userAgent = c.req.header("User-Agent") ?? undefined;

  const screening = await screenOrderAttempt(
    db,
    {
      storeId,
      phone: data.phone,
      ip: ipAddress,
      name: data.customerName,
      address: data.address,
      wilayaId: data.wilayaId,
      productIds: lines.map((line) => line.productId),
      pieces: lines.reduce((total, line) => total + line.quantity, 0),
      deliveryType: data.deliveryType,
      checkoutContext: data.checkoutContext,
      visitorNetwork: c.req.header("X-Visitor-Network"),
      userAgent,
      attribution: data.attribution ?? null,
    },
    { limiter: c.env.REVIEW_RATE_LIMITER },
    now,
  );

  if (screening?.verdict === "spam") {
    const { turnstileToken: _turnstile, otpToken: _otp, checkoutContext: _context, ...kept } = data;
    const held = await holdOrder(
      db,
      screening,
      {
        checkoutKey: data.checkoutKey,
        submission: { data: kept, customFieldAnswers, locale, ipAddress, userAgent },
        answer: {
          price: quote.basket.subtotal,
          deliveryFee: quote.delivery.fee,
          couponDiscount: quote.couponOutcome?.applied ? quote.couponOutcome.discount : 0,
          deliveryType: data.deliveryType,
          lines: queries.orderLineNames(snapshot, quote.basket),
        },
      },
      now,
    );
    if (held) return c.json({ success: true, data: held }, 201);
  }

  const order = await commitOrder(db, {
    data,
    customFieldAnswers,
    rate: quote.delivery.rate,
    coupon: quote.coupon,
    snapshot,
    locale,
    ipAddress,
    userAgent,
  });
  if ("replay" in order) {
    if (!order.replay) throw new Error("The checkout's order was placed by another request, then removed before it could be read");
    return checkoutReplay(c, order.replay, submitted.phone);
  }

  if (screening) await recordAttempt(db, screening, order, now);

  return c.json(
    {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        price: order.price,
        deliveryFee: order.deliveryFee,
        total: order.price + order.deliveryFee,
        couponDiscount: order.couponDiscount,
      },
    },
    201
  );
}

/** The order a checkout attempt already placed, answered as it was the first time — for the same phone only. */
function checkoutReplay(c: Context<AppContext>, placed: NonNullable<Awaited<ReturnType<typeof queries.orderPlacedWith>>>, phone: string) {
  if (placed.phone !== phone) {
    throw new ConflictError("This checkout already placed an order for another phone", ERROR_CODES.CHECKOUT_KEY_IN_USE);
  }
  return c.json(
    {
      success: true,
      data: {
        orderId: placed.id,
        orderNumber: placed.orderNumber,
        price: placed.price,
        deliveryFee: placed.deliveryFee,
        total: placed.price + placed.deliveryFee,
        couponDiscount: placed.couponDiscount,
      },
    },
    201,
  );
}

/** A code's outcome as the storefront reads it. */
function couponAnswer(outcome: queries.CouponOutcome | null) {
  if (!outcome) return null;
  return outcome.applied
    ? { code: outcome.code, applied: true as const, discount: outcome.discount, freeShipping: outcome.freeShipping }
    : { code: outcome.code, applied: false as const, ...outcome.refusal };
}

/**
 * POST /store/cart/validate
 *
 * Re-prices and re-checks a basket so the cart drawer can tell the truth
 * before the shopper commits. Read-only: nothing is written and no stock is
 * reserved.
 *
 * It answers from the SAME snapshot, the SAME pricing function and the SAME
 * offer rules the order engine uses, which is what makes the displayed total
 * and the charged total identical by construction rather than by agreement.
 *
 * The free-delivery figure is subtotal-based, so it can be answered before the
 * shopper has typed an address. With a `destination`, the answer also carries
 * `delivery`: the fee and total the order would charge there, from the same
 * quote the order uses.
 */
export async function validateCart(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const bodyData: any = (c.req as any).valid?.("json");
  const data: import("./validation").ValidateCartInput =
    bodyData ?? validateCartSchema.parse(await c.req.json());

  let lines: CartLine[];
  try {
    lines = normalizeOrderLines(data);
  } catch (err) {
    if (err instanceof CartValidationError) {
      throw new ValidationError(err.message, ERROR_CODES.VALUE_OUT_OF_RANGE, err.detail);
    }
    throw err;
  }

  const now = new Date().toISOString();
  const [snapshot, served] = await Promise.all([
    queries.loadCatalogSnapshot(db, lines, now),
    servedLanguage(c, db),
  ]);
  const resolved = queries.resolveCartLines(snapshot, lines);
  const names = await queries.cartNames(db, snapshot, served.translate);

  // Only orderable lines count toward the subtotal, the offers and the coupon.
  // A line the shopper must fix should not inflate a promise it cannot keep.
  const orderable = resolved.filter((entry) => entry.blocker === null);
  const storeId = c.get("storeId");
  const quote = await queries.quoteCheckout(db, {
    storeId: storeId ?? undefined,
    now,
    snapshot,
    lines: orderable.map((entry) => entry.line),
    destination: data.destination,
    couponCode: data.couponCode,
    phone: data.phone ?? null,
  });
  const basket = quote.basket;
  const pricedLine = new Map(basket.priced.map((entry) => [entry.line, entry]));
  const subtotal = basket.subtotal;

  const store = storeId
    ? await db
        .select({ freeShippingThreshold: stores.freeShippingThreshold })
        .from(stores)
        .where(eq(stores.id, storeId))
        .get()
    : undefined;
  const threshold = store?.freeShippingThreshold ?? null;
  const thresholdActive = threshold != null && threshold > 0;
  // Why delivery is free for this basket, wherever it goes: one answer, so a
  // basket already free by an offer or a coupon is never told to spend more.
  const freeBy: "offer" | "coupon" | "threshold" | null = basket.freeShippingOfferId
    ? "offer"
    : quote.couponOutcome?.applied && quote.couponOutcome.freeShipping
      ? "coupon"
      : meetsFreeDeliveryThreshold(threshold, subtotal)
        ? "threshold"
        : null;


  return c.json(
    {
      success: true,
      data: {
        lines: resolved.map((entry) => ({
          productId: entry.line.productId,
          variantId: entry.line.variantId,
          ...names.line(entry),
          quantity: entry.line.quantity,
          unitPrice: entry.unitPrice,
          lineTotal: pricedLine.get(entry.line)?.lineTotal ?? entry.lineTotal,
          offerId: pricedLine.get(entry.line)?.offerId ?? null,
          offerName: names.offer(pricedLine.get(entry.line)?.offerId ?? null),
          discount: pricedLine.get(entry.line)?.discount ?? 0,
          maxQuantity: entry.maxQuantity,
          blocker: entry.blocker,
        })),
        subtotal,
        rewards: basket.rewards.map((item) => ({
          offerId: item.offer.id,
          offerName: names.offer(item.offer.id),
          productId: item.placement.productId,
          productName: names.product(item.placement.productId),
          variantId: item.placement.variantId,
          variantLabel: names.variant(item.placement.variantId),
          quantity: item.offer.rewardQuantity,
        })),
        freeDelivery: {
          /** Earned by an offer: a single-product basket's free-shipping offer, or a quantity tier that includes it. */
          fromOffer: basket.freeShippingOfferId !== null,
          threshold: thresholdActive ? threshold : null,
          /** Delivery is free for this basket — by an offer, the coupon or the store's amount. */
          qualified: freeBy !== null,
          /** How much more to spend for the store's free delivery. 0 once delivery is free, or with no amount set. */
          remaining: freeBy === null && thresholdActive ? threshold - subtotal : 0,
          by: freeBy,
        },
        coupon: couponAnswer(quote.couponOutcome),
        ...(quote.delivery === undefined
          ? {}
          : {
              delivery:
                quote.delivery === null
                  ? { available: false, fee: null, total: null }
                  : { available: true, fee: quote.delivery.fee, total: subtotal + quote.delivery.fee },
            }),
      },
    },
    200,
  );
}


/** Look-ups are limited per order and per shopper, so neither a phone nor an order number can be guessed. */
async function limitOrderLookups(c: Context<AppContext>, orderNumber: string): Promise<void> {
  const limiter = c.env.REVIEW_RATE_LIMITER;
  if (!limiter) return;
  const ip = storefrontClientIp(c);
  const keys = [`order-status:${orderNumber.trim().toUpperCase()}`, ...(ip ? [`order-status-ip:${ip}`] : [])];
  for (const key of keys) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key })).success;
    } catch {
      continue;
    }
    if (!allowed) throw new BusinessLogicError("Too many look-ups — try again in a minute", ERROR_CODES.ORDER_LOOKUP_RATE_LIMITED, { windowSeconds: 60 });
  }
}

export async function getShopperOrderStatus(c: Context<AppContext>) {
  const { orderNumber, phone } = (c.req as any).valid("json") as { orderNumber: string; phone: string };
  await limitOrderLookups(c, orderNumber);
  const status = await findShopperOrder(getDb(c.env.DB), { orderNumber, phone });
  if (!status) throw new NotFoundError("Order");
  return c.json({ success: true, data: status }, 200);
}
