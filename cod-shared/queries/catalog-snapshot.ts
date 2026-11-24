/**
 * The catalog rows a basket touches, loaded once.
 *
 * Checkout asks the same three questions of the same rows — does every line
 * have a SKU, is every line in stock, what does every line cost — and each
 * used to load its own copy. D1 bills by rows read and serialises on a single
 * thread, so that was paid for and waited on three times per order.
 *
 * Loading once and passing the result down turns those three questions into
 * pure functions over data: no database, no clock, no ordering constraints,
 * and exhaustively testable. The database work stays in one place, here.
 */

import { eq, and, or, inArray, isNull, lte, gte } from "drizzle-orm";
import { products, productVariants, offers, offerPriceTiers } from "../db/schema";
import { applyOffers, type EarnedReward, type EngineOffer, type PlaceReward } from "../offers/engine";
import type { PriceTier } from "../offers/model";
import { priceCoupon } from "../coupons/engine";
import type { CheckoutCoupon, CouponRefusal } from "./checkout-coupon";
import type { AppDb } from "../db/client";
import { chunkIds } from "./d1-limits";
import { productIdsOf, variantIdsOf, type CartLine } from "./cart";
import { variantLabel } from "../i18n/translations";

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  trackInventory: boolean;
  inventory: number;
  status: string;
  visibility: boolean;
  showInStore: boolean;
  /** Stored JSON, read to translate the product's variant labels. */
  variantOptions: string | null;
}

export interface CatalogVariant {
  id: string;
  productId: string;
  price: number;
  sku: string | null;
  inventory: number;
  variations: string;
  active: boolean;
  /** Its place among the product's options: the first active one is the product's default. */
  position: number;
}

/** An offer as the engine reads it (`offers/engine.ts`), with its price tiers. */
/** An offer as pricing reads it, with the name an order keeps of it. */
export type CatalogOffer = EngineOffer & { name: string };

export interface CatalogSnapshot {
  products: Map<string, CatalogProduct>;
  variants: Map<string, CatalogVariant>;
  /** Every scheduled, active offer triggered by something in the basket — and the rows its reward needs, loaded with them. */
  offers: CatalogOffer[];
}

const PRODUCT_COLUMNS = {
  id: products.id,
  name: products.name,
  price: products.price,
  sku: products.sku,
  trackInventory: products.trackInventory,
  inventory: products.inventory,
  status: products.status,
  visibility: products.visibility,
  showInStore: products.showInStore,
  variantOptions: products.variantOptions,
} as const;

const VARIANT_COLUMNS = {
  id: productVariants.id,
  productId: productVariants.productId,
  price: productVariants.price,
  sku: productVariants.sku,
  inventory: productVariants.inventory,
  variations: productVariants.variations,
  active: productVariants.active,
  position: productVariants.position,
} as const;

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/**
 * One batched round trip, whatever the basket size.
 *
 * `now` is passed in rather than read here so offer scheduling is decided by
 * the caller's clock — the same instant the rest of the order is stamped with,
 * and a value a test can pin.
 */
export async function loadCatalogSnapshot(
  db: AppDb,
  lines: CartLine[],
  now: string,
): Promise<CatalogSnapshot> {
  const productIds = productIdsOf(lines);
  const variantIds = variantIdsOf(lines);

  const productStatements = chunkIds(productIds).map((chunk) =>
    db.select(PRODUCT_COLUMNS).from(products).where(inArray(products.id, chunk)),
  );

  const variantStatements = chunkIds(variantIds).map((chunk) =>
    db
      .select(VARIANT_COLUMNS)
      .from(productVariants)
      .where(inArray(productVariants.id, chunk)),
  );

  // Selection among these is decided in memory — see offers/engine.ts. The
  // database only narrows to what is active and in schedule right now.
  const live = (chunk: string[]) =>
    and(
      inArray(offers.triggerProductId, chunk),
      eq(offers.status, "active"),
      or(isNull(offers.startsAt), lte(offers.startsAt, now)),
      or(isNull(offers.endsAt), gte(offers.endsAt, now)),
    );
  const offerStatements = chunkIds(productIds).map((chunk) => db.select().from(offers).where(live(chunk)));
  const tierStatements = chunkIds(productIds).map((chunk) =>
    db
      .select({ offerId: offerPriceTiers.offerId, quantity: offerPriceTiers.quantity, price: offerPriceTiers.price, freeShipping: offerPriceTiers.freeShipping, freeShippingDeliveryType: offerPriceTiers.freeShippingDeliveryType })
      .from(offerPriceTiers)
      .innerJoin(offers, eq(offers.id, offerPriceTiers.offerId))
      .where(live(chunk)),
  );

  const statements = [
    ...productStatements,
    ...variantStatements,
    ...offerStatements,
    ...tierStatements,
  ] as unknown as BatchStatement[];

  if (statements.length === 0) {
    return { products: new Map(), variants: new Map(), offers: [] };
  }

  const results = (await db.batch(
    statements as [BatchStatement, ...BatchStatement[]],
  )) as unknown as unknown[][];

  const productEnd = productStatements.length;
  const variantEnd = productEnd + variantStatements.length;
  const offerEnd = variantEnd + offerStatements.length;
  const tiers = results.slice(offerEnd).flat() as Array<PriceTier & { offerId: string }>;

  const snapshot: CatalogSnapshot = {
    products: new Map(
      (results.slice(0, productEnd).flat() as CatalogProduct[]).map((r) => [r.id, r]),
    ),
    variants: new Map(
      (results.slice(productEnd, variantEnd).flat() as CatalogVariant[]).map((r) => [
        r.id,
        r,
      ]),
    ),
    offers: (results.slice(variantEnd, offerEnd).flat() as Array<typeof offers.$inferSelect>).map((row) => ({
      id: row.id,
      name: row.name,
      discountType: row.discountType,
      triggerProductId: row.triggerProductId,
      triggerVariantId: row.triggerVariantId,
      triggerQuantity: row.triggerQuantity,
      rewardProductId: row.rewardProductId,
      rewardVariantId: row.rewardVariantId,
      rewardQuantity: row.rewardQuantity,
      tiers: tiers.filter((tier) => tier.offerId === row.id).map(({ quantity, price, freeShipping, freeShippingDeliveryType }) => ({ quantity, price, freeShipping, freeShippingDeliveryType: freeShippingDeliveryType ?? null })),
      freeShippingDeliveryType: row.freeShippingDeliveryType as "home" | "stop_desk" | null,
    })),
  };

  // Whether a reward can be given is part of pricing (offers/engine.ts rule 2):
  // the rows it needs come with the snapshot — a reward product elsewhere in
  // the catalog, its variant, or the variants a default is chosen among.
  const rewarding = snapshot.offers.filter((offer) => offer.rewardProductId);
  if (rewarding.length > 0) {
    await extendSnapshot(db, snapshot, {
      productIds: rewarding.map((offer) => offer.rewardProductId!),
      variantIds: rewarding.flatMap((offer) => (offer.rewardVariantId ? [offer.rewardVariantId] : [])),
      variantsOfProducts: [
        ...new Set(rewarding.filter((offer) => !offer.rewardVariantId && offer.rewardProductId !== offer.triggerProductId).map((offer) => offer.rewardProductId!)),
      ],
    });
  }
  return snapshot;
}

/**
 * Add rows a basket did not reference — a reward product from another part of
 * the catalog, or the default variant of one. Existing entries are never
 * overwritten, so what the basket loaded stays authoritative.
 */
async function extendSnapshot(
  db: AppDb,
  snapshot: CatalogSnapshot,
  extra: { productIds?: string[]; variantIds?: string[]; variantsOfProducts?: string[] },
): Promise<void> {
  const missingProducts = (extra.productIds ?? []).filter(
    (id) => !snapshot.products.has(id),
  );
  const missingVariants = (extra.variantIds ?? []).filter(
    (id) => !snapshot.variants.has(id),
  );
  const variantsOf = extra.variantsOfProducts ?? [];

  const productStatements = chunkIds(missingProducts).map((chunk) =>
    db.select(PRODUCT_COLUMNS).from(products).where(inArray(products.id, chunk)),
  );
  const variantStatements = chunkIds(missingVariants).map((chunk) =>
    db
      .select(VARIANT_COLUMNS)
      .from(productVariants)
      .where(inArray(productVariants.id, chunk)),
  );
  const siblingStatements = chunkIds(variantsOf).map((chunk) =>
    db
      .select(VARIANT_COLUMNS)
      .from(productVariants)
      .where(
        and(
          inArray(productVariants.productId, chunk),
          eq(productVariants.active, true),
        ),
      ),
  );

  const statements = [
    ...productStatements,
    ...variantStatements,
    ...siblingStatements,
  ] as unknown as BatchStatement[];
  if (statements.length === 0) return;

  const results = (await db.batch(
    statements as [BatchStatement, ...BatchStatement[]],
  )) as unknown as unknown[][];

  const productEnd = productStatements.length;
  for (const row of results.slice(0, productEnd).flat() as CatalogProduct[]) {
    if (!snapshot.products.has(row.id)) snapshot.products.set(row.id, row);
  }
  for (const row of results.slice(productEnd).flat() as CatalogVariant[]) {
    if (!snapshot.variants.has(row.id)) snapshot.variants.set(row.id, row);
  }
}

// ─── Pure questions over the snapshot ────────────────────────────────────────

/** A product orders when it is active and visible. One hidden from the store still sells: a landing page links it deliberately. */
function productSells(product: CatalogProduct | undefined): product is CatalogProduct {
  return product != null && product.status === "ACTIVE" && product.visibility;
}

/** A line's variant, when it names one, is an active option of the line's product. */
function variantSells(snapshot: CatalogSnapshot, line: CartLine): boolean {
  if (line.variantId == null) return true;
  const variant = snapshot.variants.get(line.variantId);
  return variant != null && variant.productId === line.productId && variant.active;
}

/** The first line that can no longer be ordered, in basket order: its product, or its variant when only the variant is the reason. */
export function findUnorderableLine(
  snapshot: CatalogSnapshot,
  lines: CartLine[],
): { productId: string; variantId?: string } | null {
  for (const line of lines) {
    if (!productSells(snapshot.products.get(line.productId))) return { productId: line.productId };
    if (!variantSells(snapshot, line)) return { productId: line.productId, variantId: line.variantId! };
  }
  return null;
}

/**
 * The first line whose SKU is missing, in basket order.
 *
 * A missing SKU is a merchant configuration error, not a shopper error: the
 * order is refused because carriers and stock movements key off it.
 */
export function findMissingSku(
  snapshot: CatalogSnapshot,
  lines: CartLine[],
): { missing: "variant" | "product"; id: string } | null {
  for (const line of lines) {
    if (line.variantId) {
      if (!snapshot.variants.get(line.variantId)?.sku) {
        return { missing: "variant", id: line.variantId };
      }
    } else if (!snapshot.products.get(line.productId)?.sku) {
      return { missing: "product", id: line.productId };
    }
  }
  return null;
}

/** A line the stock cannot cover: the shopper's sentence, and which line it is. */
export interface StockShortfall {
  message: string;
  productId: string;
  variantId: string | null;
}

/**
 * The first line the stock cannot cover, or null when the whole basket can:
 * an Arabic sentence naming it, and the line, so a theme can name it in the
 * shopper's language.
 *
 * This is a *pre-flight* courtesy so the shopper gets a clear message instead
 * of a rollback. It is NOT the safety net: two shoppers can pass it at the
 * same instant for the last unit. The real guarantee is the guarded deduction
 * in the commit batch, which is race-free.
 *
 * A line that cannot be ordered at all is `findUnorderableLine`'s to refuse.
 */
export function findStockShortfall(
  snapshot: CatalogSnapshot,
  lines: CartLine[],
): StockShortfall | null {
  const basket = lines.length > 1;

  for (const line of lines) {
    const product = snapshot.products.get(line.productId);
    // trackInventory is the parent's master switch: false exempts the product
    // AND every one of its variants.
    if (!product?.trackInventory) continue;

    if (line.variantId) {
      const available = snapshot.variants.get(line.variantId)?.inventory ?? 0;
      if (available < line.quantity) {
        const message = basket
          ? `"${product.name}" غير متوفر بالكمية المطلوبة بالخيار المحدد.`
          : "هذا المنتج غير متوفر بالخيار المطلوب. يرجى اختيار خياراً آخر.";
        return { message, productId: line.productId, variantId: line.variantId };
      }
    } else if (product.inventory < line.quantity) {
      const message = basket
        ? `"${product.name}" غير متوفر بالكمية المطلوبة.`
        : "هذا المنتج غير متوفر حالياً.";
      return { message, productId: line.productId, variantId: null };
    }
  }

  return null;
}

/** A variant's option selection, `{ Color: "Red" }`; empty when its stored JSON is unreadable. */
export function variantSelection(variant: Pick<CatalogVariant, "variations">): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(variant.variations);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** A cart line priced from the catalog and its offers, ready to become an order line. */
export interface PricedLine {
  line: CartLine;
  /** Catalog unit price in DZD. Never the client's claim. */
  unitPrice: number;
  /** What the line costs, offers and coupon applied: what the shopper pays for it. */
  lineTotal: number;
  /** The offer applied to the line; null when none. */
  offerId: string | null;
  /** The line's share of the coupon's discount, already out of `lineTotal`. */
  discount: number;
  sku: string | null;
  /**
   * The catalog's own names, in the store's primary language — what the order
   * records, so the merchant and the carrier read one language whatever the
   * shopper browsed in. The storefront's text is a fallback for a row the
   * catalog no longer has.
   */
  productName: string;
  variantLabel: string | null;
}

/** Every line at its catalog price — what a line is worth before any offer. */
function catalogPrices(snapshot: CatalogSnapshot, lines: CartLine[]): PricedLine[] {
  return lines.map((line) => {
    const product = snapshot.products.get(line.productId);
    const variant = line.variantId ? snapshot.variants.get(line.variantId) : undefined;
    const unitPrice = variant ? variant.price : (product?.price ?? 0);
    return {
      line,
      unitPrice,
      lineTotal: unitPrice * line.quantity,
      offerId: null,
      discount: 0,
      sku: variant ? variant.sku : (product?.sku ?? null),
      productName: product?.name ?? line.productName,
      variantLabel:
        line.variantId === null ? null : variant ? variantLabel(variantSelection(variant)) : line.variantLabel,
    };
  });
}

/** A product's default variant: its first active option. */
function defaultVariant(snapshot: CatalogSnapshot, productId: string): CatalogVariant | undefined {
  return [...snapshot.variants.values()]
    .filter((variant) => variant.productId === productId && variant.active)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0];
}

type OfferedLine = CartLine & { unitPrice: number };

/**
 * Where the catalog puts a reward, or null when it cannot. An unset reward
 * variant mirrors the shopper's choice when the reward is the product ordered,
 * and is the product's default variant otherwise. A tracked reward needs stock
 * for itself once the units the order already takes of the same item — the
 * paid lines and the rewards placed before it — are counted.
 */
function rewardPlacer(snapshot: CatalogSnapshot, lines: readonly CartLine[]): PlaceReward<OfferedLine> {
  return (offer, line, placed) => {
    const productId = offer.rewardProductId!;
    const product = snapshot.products.get(productId);
    if (!product) return null;
    const variantId = offer.rewardVariantId ?? (productId === line.productId ? line.variantId : (defaultVariant(snapshot, productId)?.id ?? null));
    const variant = variantId ? snapshot.variants.get(variantId) : undefined;
    if (variantId && !variant) return null;
    if (product.trackInventory) {
      const taken = [
        ...lines.map((entry) => ({ productId: entry.productId, variantId: entry.variantId, quantity: entry.quantity })),
        ...placed.map((reward) => ({ ...reward.placement, quantity: reward.offer.rewardQuantity })),
      ]
        .filter((entry) => entry.productId === productId && (variantId === null || entry.variantId === variantId))
        .reduce((sum, entry) => sum + entry.quantity, 0);
      if ((variant ? variant.inventory : product.inventory) - taken < offer.rewardQuantity) return null;
    }
    return { productId, variantId };
  };
}

/**
 * What a code did to the basket: applied (what it took off the lines, whether
 * it makes delivery free), or refused with the reason the shopper is told.
 */
export type CouponOutcome =
  | { code: string; applied: true; couponId: string; discount: number; freeShipping: boolean }
  | { code: string; applied: false; refusal: CouponRefusal };

/** A basket priced: its lines, their sum, and what its offers and coupon give besides. */
export interface PricedBasket {
  priced: PricedLine[];
  /** What the lines cost together, offers and coupon applied — the order's price. */
  subtotal: number;
  /** Buy X Get Y rewards earned, each placed: the stock covers it. */
  rewards: EarnedReward<OfferedLine>[];
  /** The offer that made delivery free, or null. */
  freeShippingOfferId: string | null;
  /** The coupon priced with the basket; null without one. Before delivery: `settleDelivery` may still refuse a free-delivery coupon. */
  coupon: CouponOutcome | null;
}

/**
 * Price every line from the catalog snapshot, the basket's offers, then the
 * coupon (ADR 0007): it covers the paid lines in its scope that no offer
 * applied to, and its discount comes off those lines.
 *
 * Server-authoritative pricing lives here and nowhere else: the client's
 * `pricePerUnit` is display-only and is never consulted. The storefront's
 * cart quote (which shows the shopper the total and tests the free-delivery
 * threshold) and the order engine (which writes the lines) both call this, so
 * what the shopper is shown and what they are charged cannot drift apart.
 *
 * A soft-deleted product prices at 0 rather than throwing — the order engine
 * refuses it separately, and pricing is not the place to decide sellability.
 */
export function priceCartLines(snapshot: CatalogSnapshot, lines: CartLine[], coupon: CheckoutCoupon | null = null, deliveryType: "home" | "stop_desk" = "home"): PricedBasket {
  const atCatalog = catalogPrices(snapshot, lines);
  const applied = applyOffers(
    atCatalog.map((entry) => ({ ...entry.line, unitPrice: entry.unitPrice })),
    snapshot.offers,
    rewardPlacer(snapshot, lines),
    deliveryType,
  );
  const offered = atCatalog.map((entry, index) => ({ ...entry, ...applied.lines[index]! }));
  const pricing = coupon && priceCoupon(offered.map((entry) => ({ productId: entry.line.productId, quantity: entry.line.quantity, lineTotal: entry.lineTotal, offerId: entry.offerId })), coupon);

  let outcome: CouponOutcome | null = null;
  let priced = offered;
  if (coupon && pricing) {
    if (!pricing.applied) {
      outcome = { code: coupon.code, applied: false, refusal: "shortBy" in pricing ? { reason: pricing.reason, shortBy: pricing.shortBy } : { reason: pricing.reason } };
    } else {
      outcome = { code: coupon.code, applied: true, couponId: coupon.id, discount: pricing.discount, freeShipping: pricing.freeShipping };
      priced = offered.map((entry, index) => ({ ...entry, lineTotal: entry.lineTotal - pricing.discounts[index]!, discount: pricing.discounts[index]! }));
    }
  }

  return {
    priced,
    subtotal: priced.reduce((sum, entry) => sum + entry.lineTotal, 0),
    rewards: applied.rewards,
    freeShippingOfferId: applied.freeShippingOfferId,
    coupon: outcome,
  };
}

/**
 * What delivery costs once the basket is priced: the store's `rate` there
 * (judged on the subtotal after the coupon), or nothing when an offer or the
 * coupon makes it free. A free-delivery coupon is refused when the delivery
 * would cost nothing anyway (the store's threshold, a zero rate) — a use is
 * never spent on nothing.
 */
export function settleDelivery(basket: PricedBasket, rate: number): { fee: number; coupon: CouponOutcome | null } {
  const coupon = basket.coupon;
  if (coupon?.applied && coupon.freeShipping) {
    return rate > 0 ? { fee: 0, coupon } : { fee: 0, coupon: { code: coupon.code, applied: false, refusal: { reason: "delivery_already_free" } } };
  }
  // An offer's free delivery covers a basket of its product alone, whose lines it names: no coupon applies beside it.
  return { fee: basket.freeShippingOfferId ? 0 : rate, coupon };
}

/**
 * The offers of a product a shopper could earn: those the pricing path would
 * apply to a basket of their threshold (for quantity pricing, any tier) in one
 * of `variantIds`, the variants the page sells. An offer whose reward the
 * stock cannot cover, or locked to a variant the page does not sell, earns
 * nothing — so a product page never promises it.
 */
export function earnableOffers(snapshot: CatalogSnapshot, product: { id: string; name: string }, variantIds: readonly (string | null)[]): Set<string> {
  const earnable = new Set<string>();
  for (const offer of snapshot.offers.filter((candidate) => candidate.triggerProductId === product.id)) {
    const quantities = offer.discountType === "quantity_price" ? offer.tiers.map((tier) => tier.quantity) : [offer.triggerQuantity];
    const earns = variantIds.some((variantId) =>
      quantities.some((quantity) =>
        priceCartLines({ ...snapshot, offers: [offer] }, [{ productId: product.id, variantId, variantLabel: null, productName: product.name, quantity }]).priced.some(
          (line) => line.offerId === offer.id,
        ),
      ),
    );
    if (earns) earnable.add(offer.id);
  }
  return earnable;
}

/** Why a line cannot be ordered, or null when it can. */
export type LineBlocker = "missing" | "unlisted" | "out_of_stock";

/** A cart line as the storefront should display it right now. */
export interface ResolvedLine extends PricedLine {
  /** Units the shopper may order. null when the product is not stock-tracked. */
  maxQuantity: number | null;
  /** null when the line is orderable as requested. */
  blocker: LineBlocker | null;
}

/**
 * The catalog's current answer for every line in a basket: real price, real
 * availability, and whether it can still be ordered at all.
 *
 * This is what lets the cart drawer tell the truth before the shopper commits.
 * It is the same data the order engine will use, derived from the same
 * snapshot, so the drawer cannot promise something checkout then refuses.
 *
 * `unlisted` covers every catalog gate at once (draft, hidden, invisible,
 * soft-deleted) on purpose: a shopper does not need to know which one, and
 * distinguishing them would leak the merchant's catalog state.
 */
export function resolveCartLines(
  snapshot: CatalogSnapshot,
  lines: CartLine[],
): ResolvedLine[] {
  return catalogPrices(snapshot, lines).map((entry) => {
    const { line } = entry;
    const product = snapshot.products.get(line.productId);
    const variant = line.variantId ? snapshot.variants.get(line.variantId) : undefined;

    const sellable = productSells(product) && product.showInStore && variantSells(snapshot, line);

    const maxQuantity = !product?.trackInventory
      ? null
      : line.variantId
        ? (variant?.inventory ?? 0)
        : product.inventory;

    const blocker: LineBlocker | null =
      product == null
        ? "missing"
        : !sellable
          ? "unlisted"
          : maxQuantity != null && maxQuantity < line.quantity
            ? "out_of_stock"
            : null;

    return {
      ...entry,
      maxQuantity,
      blocker,
    };
  });
}
