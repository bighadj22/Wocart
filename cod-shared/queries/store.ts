/**
 * Store (storefront) Queries
 *
 * Public storefront API — product listing (with review aggregates) and order creation. Taking and listing reviews: ./store-reviews.ts.
 * No server-only error classes here; the handlers translate results to HTTP errors.
 */

import { servedCurrencySymbol } from "../i18n/currency";
import { MAX_ORDER_NUMBER_DRAWS, drawOrderNumber, isOrderNumberCollision } from "../lib/order-number";
import { safeLikeTerm } from "./search";
import {
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  sql,
  getTableColumns,
  lte,
  gte,
  or,
  asc,
  inArray,
} from "drizzle-orm";
import { groupOverrides } from "../i18n/content-overrides";
import {
  OPTION_KEY_PREFIX,
  overlayTranslations,
  parseVariantOptions,
  translateOptions,
  variantLabel,
} from "../i18n/translations";
import type { StoreLocale } from "../i18n/locales";
import { servedLanguageInfo, servedLocale, servedLocales, storeLanguages } from "../stores/settings";
import { getThemeSettings, listContentOverrides, listStoreLocales } from "./stores";
import { listTranslations } from "./translations";
import {
  products,
  productCategories,
  productVariants,
  productImages,
  stores,
  storeOtpConfig,
  storeTurnstileConfig,
  customers,
  orders,
  orderProducts,
  orderAttribution,
  shippingProfiles,
  shippingRules,
  wilayas,
  communes,
  reviews,
  offers,
  stockMovements,
  collections,
  collectionProducts,
  offerPriceTiers,
} from "../db/schema";
import type { AppDb } from "../db/client";
import type { Author } from "../events/actor";
import { recordEvent } from "../events/record";
import { assignedOnCreate, assignmentOnCreate } from "../team/assign";
import { orderSnapshot } from "../events/snapshots";
import { deriveDescriptionPlain } from "./products";
import { resolveDeliveryFee } from "./shipping-resolution";
import { normalizeOrderLines } from "./cart";
import { capturedAttributionRow } from "../attribution/resolve";
import type { CapturedTouches } from "../attribution/model";
import { resolvePublicTracking } from "./tracking-config";
import { chunkIds } from "./d1-limits";
import type { MediaDelivery } from "../media/delivery";
import { categoryView, imageOf, productImageView, productImageViews, servedDescription } from "../media/views";
import { getFooterPages, getPublicContact } from "./store-pages";
import {
  loadCatalogSnapshot,
  priceCartLines,
  earnableOffers,
  settleDelivery,
  variantSelection,
  type CatalogSnapshot,
  type PricedBasket,
  type PricedLine,
} from "./catalog-snapshot";
import { parseCheckoutFormPolicy } from "../checkout-form/policy";
import { CouponNotApplicableError, raisedCouponRefusal, type CheckoutCoupon } from "./checkout-coupon";
import { resolveStorefrontWidget } from "../whatsapp-widget/config";
import {
  serializeCustomFieldAnswers,
  type CustomFieldAnswer,
} from "../checkout-form/apply";

export interface StoreOrderData {
  customerName: string;
  phone: string;
  wilayaId: number;
  communeId: string;
  address?: string;
  deliveryType: "home" | "stop_desk";
  /**
   * The one product a direct order form was rendered for. Absent on a basket
   * order, which has no single representative product — `items[]` carries the
   * truth then, and normalizeOrderLines ignores these outright.
   */
  productId?: string;
  productName?: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  /** Display-only, and absent on a basket order. Pricing comes from the catalog. */
  pricePerUnit?: number;
  notes?: string;
  offerId?: string;
  variantSelections?: Array<{ variantId: string; variantLabel?: string }>;
  /**
   * Cart request shape. When present it supersedes the flat product fields —
   * see normalizeOrderLines, which is the only place the three shapes meet.
   */
  items?: Array<{
    productId: string;
    productName: string;
    variantId?: string | null;
    variantLabel?: string | null;
    quantity: number;
    offerId?: string;
  }>;
  /** Resolved landing page id — set by the caller from landingPageSlug (best-effort). */
  landingPageId?: string | null;
  /**
   * Checkout Form Policy capture. Both are already enforced and normalised by
   * applyCheckoutPolicy in the handler — the engine stores what it is handed
   * and never re-derives them, so there is exactly one place these rules live.
   */
  customerEmail?: string;
  customFieldAnswers?: CustomFieldAnswer[];
  fbc?: string;
  fbp?: string;
  /** The visit's touches, already read by `parseCapturedTouches`: the order's `order_attribution` row comes from them. */
  attribution?: CapturedTouches | null;
  /** When the shopper submitted the order, for one placed later (a Rescue): the ad credit window counts from it. Never from the wire. */
  submittedAt?: string;
  ipAddress?: string;
  userAgent?: string;
  /** The checkout attempt's key: an order already placed with it is never placed again (migration 0062). */
  checkoutKey?: string;
  /** The language the shopper checked out in: the one the storefront was served in. */
  locale: StoreLocale;
}

/** Another request of the same checkout attempt placed its order first; read it with `orderPlacedWith`. */
export class CheckoutAlreadyPlacedError extends Error {
  constructor(readonly checkoutKey: string) {
    super("This checkout's order was already placed");
    this.name = "CheckoutAlreadyPlacedError";
  }
}

const isCheckoutKeyCollision = (error: unknown) =>
  /UNIQUE constraint failed: orders\.checkout_key/.test(`${error instanceof Error ? error.message : String(error)} ${error instanceof Error ? String((error as { cause?: unknown }).cause ?? "") : ""}`);

/** What a checkout attempt placed, as its answer reported it, or null when nothing was. */
export async function orderPlacedWith(db: AppDb, checkoutKey: string) {
  const [placed] = await db.all<{ id: string; orderNumber: string; phone: string; price: number; deliveryFee: number; couponDiscount: number }>(sql`
    SELECT id, order_number AS orderNumber, phone, price, delivery_fee AS deliveryFee, coupon_discount AS couponDiscount FROM orders WHERE checkout_key = ${checkoutKey}
    UNION ALL
    SELECT id, order_number, phone, json_extract(answer_json, '$.price'), json_extract(answer_json, '$.deliveryFee'), json_extract(answer_json, '$.couponDiscount') FROM order_attempts WHERE checkout_key = ${checkoutKey} AND outcome = 'spam'
    LIMIT 1`);
  return placed ?? null;
}

/**
 * The storefront's view of the store, in one language (ADR 0005).
 *
 * `theme` names the theme asking: its text edits ride along as
 * `contentOverrides` and its settings as `themeSettings`; without one there
 * are none — edits belong to the theme
 * that declares their keys. `locale` asks for a language: the store's text
 * and footer links come in it when the store publishes it, and in the primary
 * otherwise. `locale` in the result says which one was served.
 */
export async function getStoreConfig(
  db: AppDb,
  storeId: string,
  delivery: MediaDelivery,
  request: { theme?: string; locale?: string } = {},
) {
  const [store, localeRows] = await Promise.all([
    db
      .select({
        id: stores.id,
        name: stores.name,
        domain: stores.domain,
        logoKey: stores.logoKey,
        lang: stores.lang,
        currency: stores.currency,
        currencySymbol: stores.currencySymbol,
        metaTitle: stores.metaTitle,
        metaDescription: stores.metaDescription,
        ogImageKey: stores.ogImageKey,
        reviewsEnabled: stores.reviewsEnabled,
        cartEnabled: stores.cartEnabled,
        freeShippingThreshold: stores.freeShippingThreshold,
        checkoutFormJson: stores.checkoutFormJson,
        whatsappWidgetJson: stores.whatsappWidgetJson,
      })
      .from(stores)
      .where(eq(stores.id, storeId))
      .get(),
    listStoreLocales(db, storeId),
  ]);
  if (!store) return null;
  const languages = storeLanguages(store.lang, localeRows);
  const served = servedLocale(request.locale, languages);
  const [tracking, otpRow, turnstileRow, pages, contact, overrideRows, themeSettings, storeTranslations, widgetTranslations] = await Promise.all([
    // Which pixel this storefront loads is resolved in one place for every
    // sender — see queries/tracking-config.ts. The public accessor cannot
    // return the Conversions API token, which is what keeps it out of the
    // storefront payload structurally rather than by care.
    resolvePublicTracking(db, { storeId }),
    db
      .select({ enabled: storeOtpConfig.enabled })
      .from(storeOtpConfig)
      .where(eq(storeOtpConfig.storeId, storeId))
      .get(),
    // Safe projection only — the site key is public by design; the siteverify
    // secret must never reach the storefront payload.
    db
      .select({ enabled: storeTurnstileConfig.enabled, siteKey: storeTurnstileConfig.siteKey })
      .from(storeTurnstileConfig)
      .where(eq(storeTurnstileConfig.storeId, storeId))
      .get(),
    // The footer renders on every page, so its link list rides along here
    // rather than costing a second round trip per page view (plan D6/R7).
    getFooterPages(db, storeId, served.locale),
    getPublicContact(db, storeId),
    request.theme === undefined ? [] : listContentOverrides(db, storeId, request.theme),
    request.theme === undefined ? {} : getThemeSettings(db, storeId, request.theme),
    served.translate === null ? [] : listTranslations(db, "store", [storeId], served.translate),
    served.translate === null ? [] : listTranslations(db, "whatsappWidget", [storeId], served.translate),
  ]);
  // What a theme reads, field by field: a column becomes public only by being
  // named here. The raw policy and widget columns, the API key and the
  // server's own settings (shipping mode, review rules) never leave it.
  const [translated] = overlayTranslations("store", [store], storeTranslations);

  return {
    id: store.id,
    name: store.name,
    domain: store.domain,
    logo: imageOf(store.logoKey, delivery),
    lang: store.lang,
    locale: served.locale,
    // The published languages, primary first, with what a theme needs to
    // render each, and only their edits — an unpublished language's drafts
    // never reach a shopper.
    locales: servedLanguageInfo(languages),
    currency: store.currency,
    currencySymbol: servedCurrencySymbol({ currency: store.currency, symbol: store.currencySymbol, translated: translated!.currencySymbol, primary: store.lang, locale: served.locale }),
    metaTitle: translated!.metaTitle,
    metaDescription: translated!.metaDescription,
    ogImage: imageOf(store.ogImageKey, delivery),
    // How the storefront fetches and resizes every image key (ADR 0021).
    media: delivery,
    reviewsEnabled: store.reviewsEnabled,
    cartEnabled: store.cartEnabled,
    freeShippingThreshold: store.freeShippingThreshold,
    contentOverrides: groupOverrides(overrideRows, servedLocales(languages)),
    // The merchant's values for the requesting theme's settings, as saved:
    // the theme resolves them against its declaration and its defaults.
    themeSettings,
    checkoutForm: parseCheckoutFormPolicy(store.checkoutFormJson),
    // Null whenever there is nothing to render — switched off, no number, or a
    // number that no longer normalises. The theme holds one rule about this
    // feature: render it, or don't. Its texts come in the served language.
    whatsapp: resolveStorefrontWidget(
      store.whatsappWidgetJson,
      delivery,
      served.translate === null ? { primary: true } : { primary: false, translations: Object.fromEntries(widgetTranslations.map((row) => [row.key, row.value])) },
    ),
    pixelId: tracking.pixelId,
    pages,
    contact,
    otpEnabled: otpRow?.enabled === true,
    turnstileEnabled: turnstileRow?.enabled === true,
    turnstileSiteKey: turnstileRow?.enabled === true ? turnstileRow.siteKey : null,
  };
}

/**
 * The language a storefront read is served in (`servedLocale`), from the
 * store's own languages; null when the store does not exist.
 */
export async function resolveStorefrontLocale(db: AppDb, storeId: string, requested?: string | null) {
  const [store, rows] = await Promise.all([
    db.select({ lang: stores.lang }).from(stores).where(eq(stores.id, storeId)).get(),
    listStoreLocales(db, storeId),
  ]);
  if (!store) return null;
  return servedLocale(requested, storeLanguages(store.lang, rows));
}

/**
 * The language a checkout is recorded in: the one the shopper asked for when
 * the store publishes it, the primary otherwise. The primary is the caller's,
 * already read with the checkout's policy; the store's languages are read
 * only when another is asked for.
 */
export async function checkoutLocale(db: AppDb, storeId: string, primary: StoreLocale, requested?: string | null): Promise<StoreLocale> {
  if (!requested || requested === primary) return primary;
  return servedLocale(requested, storeLanguages(primary, await listStoreLocales(db, storeId))).locale;
}

/**
 * Overlay one language's product translations. A translated description is
 * sanitised HTML (written through the same chokepoint as its source), so it
 * carries the `html` format whatever the source's format is. Option names
 * and values are translated in `variantOptions`; `variations` renames a
 * product's variant selections to match, so the two still agree.
 */
async function translateProducts<
  T extends { id: string; description?: string | null; descriptionFormat?: "text" | "html"; variantOptions: string | null },
>(
  db: AppDb,
  records: readonly T[],
  locale: StoreLocale | null,
): Promise<{ products: T[]; variations: (productId: string, variations: Record<string, string>) => Record<string, string> }> {
  const translators = new Map<string, ReturnType<typeof translateOptions>>();
  const variations = (productId: string, selection: Record<string, string>) =>
    translators.get(productId)?.variations(selection) ?? selection;
  if (locale === null || records.length === 0) return { products: [...records], variations };
  const rows = await listTranslations(db, "product", records.map((record) => record.id), locale);
  const fields = new Map<string, Record<string, string>>();
  for (const row of rows) fields.set(row.resourceId, { ...fields.get(row.resourceId), [row.key]: row.value });
  const products = overlayTranslations("product", records, rows).map((record) => {
    const translated = fields.get(record.id) ?? {};
    let product = record;
    if (Object.hasOwn(translated, "description") && record.description && record.descriptionFormat !== undefined) {
      product = { ...product, descriptionFormat: "html" as const };
    }
    if (Object.keys(translated).some((key) => key.startsWith(OPTION_KEY_PREFIX))) {
      const translator = translateOptions(parseVariantOptions(record.variantOptions), translated);
      translators.set(record.id, translator);
      product = { ...product, variantOptions: JSON.stringify(translator.options) };
    }
    return product;
  });
  return { products, variations };
}

/**
 * A basket's names in the served language — each product's name and each
 * variant's label — for the cart to show. An order keeps the catalog's own
 * text (`PricedLine`), whatever language the shopper browsed in.
 */
export async function cartNames(db: AppDb, snapshot: CatalogSnapshot, locale: StoreLocale | null) {
  const [{ products: translated, variations }, offerRows] = await Promise.all([
    translateProducts(db, [...snapshot.products.values()], locale),
    locale === null ? [] : listTranslations(db, "offer", snapshot.offers.map((offer) => offer.id), locale),
  ]);
  const names = new Map(translated.map((product) => [product.id, product.name]));
  const offerNames = new Map(overlayTranslations("offer", snapshot.offers, offerRows).map((offer) => [offer.id, offer.name]));
  return {
    product: (productId: string): string | null => names.get(productId) ?? null,
    /** The offer's name in the shopper's language; null without an offer. */
    offer: (offerId: string | null): string | null => (offerId === null ? null : (offerNames.get(offerId) ?? null)),
    variant: (variantId: string | null): string | null => {
      const variant = variantId ? snapshot.variants.get(variantId) : undefined;
      return variant ? variantLabel(variations(variant.productId, variantSelection(variant))) : null;
    },
    line: (entry: PricedLine): { productName: string; variantLabel: string | null } => {
      const variant = entry.line.variantId ? snapshot.variants.get(entry.line.variantId) : undefined;
      return {
        productName: names.get(entry.line.productId) ?? entry.productName,
        variantLabel: variant ? variantLabel(variations(variant.productId, variantSelection(variant))) : entry.variantLabel,
      };
    },
  };
}

/**
 * A product as a storefront reads it, column by column: a column becomes
 * public only by being named here. What the merchant paid, the shipping
 * profile and the listing gates (always passed by a served product) stay on
 * the server.
 */
const STOREFRONT_PRODUCT_COLUMNS = {
  id: products.id,
  name: products.name,
  description: products.description,
  descriptionFormat: products.descriptionFormat,
  handle: products.handle,
  currency: products.currency,
  price: products.price,
  compareAtPrice: products.compareAtPrice,
  type: products.type,
  hasVariants: products.hasVariants,
  variantOptions: products.variantOptions,
  sku: products.sku,
  inventory: products.inventory,
  trackInventory: products.trackInventory,
  lowStockThreshold: products.lowStockThreshold,
  categoryId: products.categoryId,
  tags: products.tags,
  metaTitle: products.metaTitle,
  metaDescription: products.metaDescription,
};

/** The served product's own fields: its JSON columns parsed, its description in both renderings. */
async function storefrontProduct<T extends { variantOptions: string | null; tags: string | null; description: string | null; descriptionFormat: "text" | "html" }>(
  product: T,
  delivery: MediaDelivery,
) {
  return {
    ...product,
    variantOptions: product.variantOptions ? (JSON.parse(product.variantOptions) as unknown) : null,
    tags: product.tags ? (JSON.parse(product.tags) as string[]) : [],
    description: servedDescription(product.description, product.descriptionFormat, delivery),
    descriptionPlain: await deriveDescriptionPlain(product.description, product.descriptionFormat),
  };
}

/**
 * How a storefront listing is ordered. Absent, a listing keeps its natural
 * order: a collection's own, a search's best match first, else newest.
 */
export const STOREFRONT_PRODUCT_SORTS = ["newest", "price-ascending", "price-descending"] as const;
export type StorefrontProductSort = (typeof STOREFRONT_PRODUCT_SORTS)[number];

/** A search reads at most this many words; each must match. */
export const STOREFRONT_SEARCH_WORDS = 5;

export interface StoreProductsParams {
  /** Only this collection's products (by handle), in the merchant's order. */
  collection?: string;
  /** Only products priced below their compare-at price. */
  onSale?: boolean;
  categoryId?: string;
  /** Only products whose name — the catalog's or the served language's — or tags hold every word. */
  search?: string;
  sort?: StorefrontProductSort;
  limit?: number;
  offset?: number;
}

/**
 * The words a search matches: LIKE's own wildcards and escape dropped, each
 * cut to what D1 takes inside `%…%`, the first few distinct ones kept.
 */
export function searchWords(text: string): string[] {
  const words = text.replace(/[%_\\]/g, " ").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).map(safeLikeTerm);
  return [...new Set(words)].slice(0, STOREFRONT_SEARCH_WORDS);
}

/** A product's name — the catalog's or its translation in `locale` — contains `pattern`. */
function nameLike(pattern: string, locale: StoreLocale | null) {
  const translated =
    locale === null
      ? sql`0`
      : sql`EXISTS (SELECT 1 FROM translations t WHERE t.resource_type = 'product' AND t.resource_id = ${products.id} AND t.locale = ${locale} AND t.key = 'name' AND t.value LIKE ${pattern})`;
  return sql`(${products.name} LIKE ${pattern} OR ${translated})`;
}

/** The gates every storefront listing applies: active, shown in the store, visible. */
const listable = () => [eq(products.showInStore, true), eq(products.status, "ACTIVE"), eq(products.visibility, true)];

/** What a storefront listing selects, joins and orders by, shared by its page and its count. */
function storeProductsQuery(params: StoreProductsParams, locale: StoreLocale | null) {
  const conditions: any[] = listable();
  const collection = params.collection;
  if (params.categoryId) conditions.push(eq(products.categoryId, params.categoryId));
  if (params.onSale) conditions.push(sql`${products.compareAtPrice} IS NOT NULL AND ${products.compareAtPrice} > ${products.price}`);
  if (collection !== undefined) conditions.push(eq(collections.handle, collection));
  const words = params.search === undefined ? [] : searchWords(params.search);
  if (params.search !== undefined && words.length === 0) conditions.push(sql`0`);
  for (const word of words) conditions.push(sql`(${nameLike(`%${word}%`, locale)} OR ${products.tags} LIKE ${`%${word}%`})`);

  // The id breaks every tie, so paging with `offset` never repeats or skips a
  // product that shares a position, a price or a creation time with another.
  const order =
    params.sort === "newest"
      ? [desc(products.createdAt), asc(products.id)]
      : params.sort === "price-ascending"
        ? [asc(products.price), asc(products.id)]
        : params.sort === "price-descending"
          ? [desc(products.price), asc(products.id)]
          : collection !== undefined
            ? [asc(collectionProducts.position), desc(products.createdAt), asc(products.id)]
            : words.length > 0
              ? [sql`CASE WHEN ${and(...words.map((word) => nameLike(`%${word}%`, locale)))} THEN 0 ELSE 1 END`, desc(products.createdAt), asc(products.id)]
              : [desc(products.createdAt), asc(products.id)];
  return { where: and(...conditions), collection, order };
}

/** How many products a storefront listing holds, across all its pages. */
export async function countStoreProducts(db: AppDb, params: StoreProductsParams, locale: StoreLocale | null = null): Promise<number> {
  const { where, collection } = storeProductsQuery(params, locale);
  const query = db.select({ count: sql<number>`count(*)` }).from(products).$dynamic();
  const joined =
    collection === undefined
      ? query
      : query
          .innerJoin(collectionProducts, eq(collectionProducts.productId, products.id))
          .innerJoin(collections, eq(collections.id, collectionProducts.collectionId));
  const row = await joined.where(where).get();
  return Number(row?.count ?? 0);
}

/**
 * The photo a collection shows until a merchant can pick one: the first
 * image of the first product it lists, in the merchant's order, that has one.
 */
export async function collectionCover(db: AppDb, handle: string, delivery: MediaDelivery) {
  const row = await db
    .select(getTableColumns(productImages))
    .from(collectionProducts)
    .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .innerJoin(productImages, eq(productImages.productId, products.id))
    .where(and(eq(collections.handle, handle), isNotNull(productImages.mediaKey), ...listable()))
    .orderBy(asc(collectionProducts.position), desc(products.createdAt), asc(products.id), asc(productImages.position), asc(productImages.id))
    .limit(1)
    .get();
  return row ? productImageView(row, delivery) : null;
}

export async function getStoreProducts(
  db: AppDb,
  params: StoreProductsParams,
  locale: StoreLocale | null,
  delivery: MediaDelivery,
) {
  const { where, collection, order } = storeProductsQuery(params, locale);
  const query = db
    .select({
      ...STOREFRONT_PRODUCT_COLUMNS,
      avgRating: sql<number | null>`(SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = products.id AND r.status = 'approved')`,
      reviewCount: sql<number>`COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.product_id = products.id AND r.status = 'approved'), 0)`,
    })
    .from(products)
    .$dynamic();
  const joined =
    collection === undefined
      ? query
      : query
          .innerJoin(collectionProducts, eq(collectionProducts.productId, products.id))
          .innerJoin(collections, eq(collections.id, collectionProducts.collectionId));
  const ordered = joined.where(where).orderBy(...order);
  const sourceRows = await ordered
    .limit(params.limit ?? 24)
    .offset(params.offset ?? 0)
    .all();

  if (sourceRows.length === 0) return [];
  const { products: rows } = await translateProducts(db, sourceRows, locale);

  const ids = rows.map((p) => p.id);

  const imageStatements = chunkIds(ids).map((chunk) =>
    db
      .select()
      .from(productImages)
      .where(and(inArray(productImages.productId, chunk), isNotNull(productImages.mediaKey)))
      .orderBy(productImages.productId, productImages.position),
  );
  const inventoryStatements = chunkIds(ids).map((chunk) =>
    db
      .select({
        productId: productVariants.productId,
        total: sql<number>`COALESCE(SUM(${productVariants.inventory}), 0)`,
      })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, chunk), eq(productVariants.active, true)))
      .groupBy(productVariants.productId),
  );

  type ImageRow = typeof productImages.$inferSelect;
  type InventoryRow = { productId: string; total: number };
  type BatchStatement = Parameters<AppDb["batch"]>[0][number];

  const statements: BatchStatement[] = [...imageStatements, ...inventoryStatements];
  const batchResults = (await db.batch(
    statements as [BatchStatement, ...BatchStatement[]],
  )) as unknown as Array<Array<ImageRow | InventoryRow>>;

  const imageRows = batchResults.slice(0, imageStatements.length).flat() as ImageRow[];
  const inventoryRows = batchResults.slice(imageStatements.length).flat() as InventoryRow[];

  const coverImageByProduct = new Map<string, typeof productImages.$inferSelect>();
  for (const image of imageRows) {
    if (!coverImageByProduct.has(image.productId)) {
      coverImageByProduct.set(image.productId, image);
    }
  }
  const variantInventoryByProduct = new Map<string, number>();
  for (const row of inventoryRows) {
    variantInventoryByProduct.set(row.productId, Number(row.total));
  }

  return Promise.all(rows.map(async (p) => {
    const { avgRating, reviewCount, ...productData } = p;
    const inventory = productData.hasVariants
      ? variantInventoryByProduct.get(p.id) ?? 0
      : productData.inventory;
    return {
      ...(await storefrontProduct(productData, delivery)),
      inventory,
      coverImage: productImageView(coverImageByProduct.get(p.id) ?? null, delivery),
      reviewStats:
        reviewCount > 0 ? { avgRating: avgRating ?? 0, reviewCount } : null,
    };
  }));
}

/**
 * Resolve a product by handle in its full store-product shape.
 *
 * The three catalog green lights apply by default (status=ACTIVE, visibility,
 * showInStore). `allowUnlisted` drops ONLY the showInStore gate — landing
 * pages link their product deliberately, so a store-hidden (unlisted) product
 * still renders there; the other gates still apply.
 */
export async function getStoreProductByHandle(
  db: AppDb,
  handle: string,
  opts: { delivery: MediaDelivery; allowUnlisted?: boolean; locale?: StoreLocale | null },
) {
  const { delivery } = opts;
  const locale = opts.locale ?? null;
  const conditions = [
    eq(products.handle, handle),
    eq(products.status, "ACTIVE"),
    eq(products.visibility, true),
  ];
  if (!opts.allowUnlisted) conditions.push(eq(products.showInStore, true));

  const source = await db
    .select(STOREFRONT_PRODUCT_COLUMNS)
    .from(products)
    .where(and(...conditions))
    .get();

  if (!source) return null;
  const translated = await translateProducts(db, [source], locale);
  const product = translated.products[0]!;

  const [category, variants, images, reviewStatsRow] = await Promise.all([
    product.categoryId
      ? db
          .select()
          .from(productCategories)
          .where(eq(productCategories.id, product.categoryId))
          .get()
      : null,
    db
      .select()
      .from(productVariants)
      .where(
        and(eq(productVariants.productId, product.id), eq(productVariants.active, true)),
      )
      .orderBy(productVariants.position)
      .all(),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(productImages.position)
      .all(),
    db
      .select({
        avgRating: sql<number | null>`ROUND(AVG(${reviews.rating}), 1)`,
        reviewCount: sql<number>`COUNT(*)`,
      })
      .from(reviews)
      .where(and(eq(reviews.productId, product.id), eq(reviews.status, "approved")))
      .get(),
  ]);

  const now = new Date().toISOString();
  // The live offers, kept to those a shopper can earn: the pricing path says,
  // so an offer whose reward is out of stock is never promised here.
  const triggerVariants = product.hasVariants ? variants.map((variant) => variant.id) : [null];
  const snapshot = await loadCatalogSnapshot(db, triggerVariants.map((variantId) => ({ productId: product.id, variantId, variantLabel: null, productName: product.name, quantity: 1 })), now);
  const earnable = earnableOffers(snapshot, product, triggerVariants);
  const offerRows = (
    await db
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.triggerProductId, product.id),
          eq(offers.status, "active"),
          or(isNull(offers.startsAt), lte(offers.startsAt, now)),
          or(isNull(offers.endsAt), gte(offers.endsAt, now)),
        ),
      )
      .orderBy(offers.createdAt)
      .all()
  ).filter((offer) => earnable.has(offer.id));

  // The offers' names and their reward products' names and options, in the served language.
  const rewardIds = [...new Set(offerRows.flatMap((offer) => (offer.rewardProductId ? [offer.rewardProductId] : [])))];
  // Every offer's reward variant in one read: a product with N offers pays for
  // one lookup, not N, on the storefront's most-read page.
  const rewardVariantIds = [...new Set(offerRows.flatMap((offer) => (offer.rewardVariantId ? [offer.rewardVariantId] : [])))];
  const [offerTranslations, categoryTranslations, rewardSources, rewardVariantRows] = await Promise.all([
    locale === null ? [] : listTranslations(db, "offer", offerRows.map((offer) => offer.id), locale),
    locale === null || !category ? [] : listTranslations(db, "category", [category.id], locale),
    rewardIds.length === 0
      ? []
      : db
          .select({ id: products.id, name: products.name, price: products.price, variantOptions: products.variantOptions })
          .from(products)
          .where(inArray(products.id, rewardIds))
          .all(),
    rewardVariantIds.length === 0
      ? []
      : db
          .select({
            id: productVariants.id,
            productId: productVariants.productId,
            variations: productVariants.variations,
            price: productVariants.price,
          })
          .from(productVariants)
          .where(inArray(productVariants.id, rewardVariantIds))
          .all(),
  ]);
  const rewardVariants = new Map(rewardVariantRows.map((variant) => [variant.id, variant]));
  const rewards = await translateProducts(db, rewardSources, locale);
  const rewardProducts = new Map(rewards.products.map((reward) => [reward.id, reward]));
  const translatedCategory = category ? overlayTranslations("category", [category], categoryTranslations)[0]! : null;

  const translatedOffers = overlayTranslations("offer", offerRows, offerTranslations);
  // Quantity pricing travels apart from `offers`: published SDKs validate the
  // kinds in that list, and the write rules keep at most one live per product.
  const pricingOffer = translatedOffers.find((offer) => offer.discountType === "quantity_price") ?? null;
  const pricingTiers = pricingOffer
    ? await db.select().from(offerPriceTiers).where(eq(offerPriceTiers.offerId, pricingOffer.id)).orderBy(asc(offerPriceTiers.quantity)).all()
    : [];
  const quantityPricing = pricingOffer
    ? {
        offerId: pricingOffer.id,
        name: pricingOffer.name,
        triggerVariantId: pricingOffer.triggerVariantId ?? null,
        tiers: pricingTiers.map((tier) => ({ quantity: tier.quantity, price: tier.price, freeShipping: tier.freeShipping, freeShippingDeliveryType: tier.freeShippingDeliveryType ?? null })),
      }
    : null;

  const resolvedOffers = await Promise.all(
    translatedOffers.filter((offer) => offer.discountType !== "quantity_price").map(async (offer) => {
      const rewardProduct = offer.rewardProductId ? rewardProducts.get(offer.rewardProductId) : undefined;
      const rewardVariant = offer.rewardVariantId ? rewardVariants.get(offer.rewardVariantId) : undefined;

      return {
        id: offer.id,
        name: offer.name,
        discountType: offer.discountType as "free" | "free_shipping",
        triggerQuantity: offer.triggerQuantity,
        triggerVariantId: offer.triggerVariantId ?? null,
        rewardQuantity: offer.rewardQuantity,
        rewardProductId: offer.rewardProductId ?? null,
        rewardProductName: rewardProduct?.name ?? "",
        rewardVariantId: offer.rewardVariantId ?? null,
        rewardVariantLabel: rewardVariant
          ? variantLabel(rewards.variations(rewardVariant.productId, variantSelection(rewardVariant)))
          : null,
        // What one reward unit is worth: its variant's price, or its product's.
        rewardUnitPrice: rewardVariant?.price ?? rewardProduct?.price ?? null,
        freeShippingDeliveryType: offer.freeShippingDeliveryType ?? null,
      };
    }),
  );

  const totalInventory = product.hasVariants
    ? variants.reduce((sum, v) => sum + v.inventory, 0)
    : product.inventory;

  return {
    ...(await storefrontProduct(product, delivery)),
    inventory: totalInventory,
    category: translatedCategory ? categoryView(translatedCategory, delivery) : null,
    variants: variants.map((v) => ({
      id: v.id,
      variations: translated.variations(product.id, JSON.parse(v.variations)),
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      sku: v.sku,
      inventory: v.inventory,
      lowStockThreshold: v.lowStockThreshold,
      imageId: v.imageId,
      isDefault: v.isDefault,
    })),
    images: productImageViews(images, delivery),
    quantityPricing,
    offers: resolvedOffers,
    reviewStats:
      (reviewStatsRow?.reviewCount ?? 0) > 0
        ? {
            avgRating: reviewStatsRow!.avgRating ?? 0,
            reviewCount: reviewStatsRow!.reviewCount,
          }
        : null,
  };
}

export async function getStoreCategories(db: AppDb, locale: StoreLocale | null, delivery: MediaDelivery) {
  const rows = await db.select().from(productCategories).orderBy(productCategories.position).all();
  const served = locale === null ? rows : overlayTranslations("category", rows, await listTranslations(db, "category", rows.map((row) => row.id), locale));
  return served.map((row) => categoryView(row, delivery));
}

export async function getStoreCommunes(db: AppDb, wilayaId: number) {
  return db
    .select({ id: communes.id, name: communes.name, nameAr: communes.nameAr })
    .from(communes)
    .where(eq(communes.wilayaId, wilayaId))
    .all();
}

/**
 * The shopper's customer, by phone: created on their first order, refreshed
 * with the name and destination of each later one. Their email is filled
 * only while they have none, never overwritten.
 */
export async function findOrCreateCustomer(
  db: AppDb,
  data: { phone: string; name: string; email?: string; wilayaId: number; communeId?: string },
) {
  const [wilayaRecord, communeRecord] = await Promise.all([
    db
      .select({ nameAr: wilayas.nameAr })
      .from(wilayas)
      .where(eq(wilayas.id, data.wilayaId))
      .get(),
    data.communeId
      ? db
          .select({ nameAr: communes.nameAr })
          .from(communes)
          .where(eq(communes.id, data.communeId))
          .get()
      : Promise.resolve(null),
  ]);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const wilayaName = wilayaRecord?.nameAr ?? `ولاية ${data.wilayaId}`;
  const communeName = communeRecord?.nameAr ?? null;

  const [row] = await db
    .insert(customers)
    .values({
      id,
      name: data.name,
      phone: data.phone,
      wilayaId: data.wilayaId,
      communeId: data.communeId ?? null,
      wilaya: wilayaName,
      commune: communeName,
      email: data.email ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: customers.phone,
      set: {
        name: data.name,
        wilayaId: data.wilayaId,
        communeId: data.communeId ?? null,
        wilaya: wilayaName,
        commune: communeName,
        email: sql`coalesce(${customers.email}, excluded.email)`,
      },
    })
    .returning();

  return row;
}

/**
 * Wilaya-only delivery fee against the store's DEFAULT profile.
 *
 * Narrow adapter over resolveDeliveryFee for callers with no product or
 * commune context. Order placement must NOT use this: it cannot see a
 * product's own shipping profile or a commune-level override, both of which
 * change what the customer is charged. Use resolveDeliveryFee there.
 *
 * Returns:
 *  - the fee (DZD, may be 0 for a legitimately-free price) when available
 *  - null when delivery is NOT available: a default profile exists but the
 *    wilaya has no rule, or the rule disables the requested delivery type.
 *    Callers must refuse the order — charging 0 silently would ship for free.
 *  - 0 when NO shipping profile exists at all (fresh store, no config) —
 *    mirrors the dashboard resolve-fee semantics (step 3: no profile, no
 *    restriction).
 */
export async function getDeliveryFee(
  db: AppDb,
  wilayaId: number,
  deliveryType: "home" | "stop_desk",
): Promise<number | null> {
  return resolveDeliveryFee(db, {
    productIds: [],
    wilayaId,
    communeId: null,
    deliveryType,
  });
}

/**
 * The default profile's price per wilaya, for a page that lists delivery
 * prices. Never a product's or an order's price: a product may have its own
 * profile and a commune its own price, so a theme prices from the quote
 * (`resolveDeliveryFee` behind /store/cart/validate). A wilaya the default
 * profile does not deliver to is left out.
 */
export async function getShippingRates(db: AppDb) {
  const profile = await db
    .select()
    .from(shippingProfiles)
    .where(eq(shippingProfiles.isDefault, true))
    .get();
  if (!profile) return {};

  const rules = await db
    .select()
    .from(shippingRules)
    .where(eq(shippingRules.profileId, profile.id))
    .all();

  return Object.fromEntries(
    rules
      .filter((r) => r.homeEnabled || r.stopDeskEnabled)
      .map((r) => [r.wilayaId, { home: r.homePrice, stopDesk: r.stopDeskPrice }]),
  );
}

// ─── Stock deduction + movement log ──────────────────────────────────────────

interface DeductStockInput {
  productId: string;
  variantId: string | null;
  quantity: number;
  orderId: string;
  customerId: string;
  customerName: string;
  now: string;
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/**
 * Build the write pair (movement log + atomic deduction) for a batch.
 *
 * The guard lives in the movement INSERT, not just the UPDATE: qtyBefore and
 * qtyAfter are subselects with the availability predicate
 * `inventory >= quantity` baked in. When stock cannot cover the deduction,
 * the subselects return NULL, the NOT NULL constraint on stock_movements
 * fails, and D1 rolls back the ENTIRE batch — order, lines, stats, and all.
 * One round trip, race-free, and the movement log values come from the
 * database itself rather than a racy pre-read.
 */
function buildDeductStatements(
  db: AppDb,
  input: DeductStockInput,
): BatchStatement[] {
  const { productId, variantId, quantity, orderId, customerId, customerName, now } = input;

  const guard =
    variantId !== null
      ? sql`FROM ${productVariants} WHERE ${productVariants.id} = ${variantId} AND ${productVariants.inventory} >= ${quantity}`
      : sql`FROM ${products} WHERE ${products.id} = ${productId} AND ${products.inventory} >= ${quantity}`;
  const inventoryColumn =
    variantId !== null ? productVariants.inventory : products.inventory;

  const guardedUpdate =
    variantId !== null
      ? db
          .update(productVariants)
          .set({ inventory: sql`${productVariants.inventory} - ${quantity}`, updatedAt: now })
          .where(
            and(
              eq(productVariants.id, variantId),
              sql`${productVariants.inventory} >= ${quantity}`,
            ),
          )
      : db
          .update(products)
          .set({ inventory: sql`${products.inventory} - ${quantity}`, updatedAt: now })
          .where(
            and(
              eq(products.id, productId),
              sql`${products.inventory} >= ${quantity}`,
            ),
          );

  return [
    db.insert(stockMovements).values({
      id: crypto.randomUUID(),
      productId,
      variantId,
      type: "ORDER_DEDUCTED",
      delta: -quantity,
      qtyBefore: sql`(SELECT ${inventoryColumn} ${guard})`,
      qtyAfter: sql`(SELECT ${inventoryColumn} - ${quantity} ${guard})`,
      reason: null,
      reference: orderId,
      createdBy: customerId,
      createdByName: customerName,
      createdAt: now,
    }),
    guardedUpdate,
  ];
}

/** Every storefront order is a shopper's, through the storefront. */
const CHECKOUT: Author = { actor: { kind: "shopper", id: null, name: null }, origin: "storefront" };

/** What an order would list: its priced lines, then the rewards offers placed. */
export function orderLineNames(snapshot: CatalogSnapshot, basket: PricedBasket): { name: string; variantLabel: string | null; quantity: number }[] {
  return [
    ...basket.priced.map((entry) => ({ name: entry.productName, variantLabel: entry.variantLabel, quantity: entry.line.quantity })),
    ...basket.rewards.map(({ offer, placement }) => {
      const variant = placement.variantId ? snapshot.variants.get(placement.variantId) : undefined;
      return { name: snapshot.products.get(placement.productId)!.name, variantLabel: variant ? variantLabel(variantSelection(variant)) : null, quantity: offer.rewardQuantity };
    }),
  ];
}

export async function createStoreOrder(
  db: AppDb,
  data: StoreOrderData & {
    customerId: string;
    customerName: string;
    /** The store's delivery rate for the order; an offer or the coupon may make it free. */
    deliveryFee: number;
    /** The coupon the order's code named (`findCheckoutCoupon`); it must apply, or the order is refused. */
    coupon?: CheckoutCoupon | null;
    /** The number to try first, when the shopper already holds one. */
    orderNumber?: string;
  },
  /**
   * Catalog rows already loaded by the caller. The storefront handler loads
   * them once for the SKU and stock checks and passes the same snapshot here,
   * so a checkout reads each product row once rather than once per question.
   * Omitted (tests, other callers) the engine loads its own.
   */
  preloaded?: CatalogSnapshot,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Every accepted request shape becomes one list here. The engine below knows
  // nothing about legacy fields, variantSelections, or carts.
  const lines = normalizeOrderLines(data);

  // ── Resolve phase (reads — one batched round trip, or none when shared) ───
  const snapshot = preloaded ?? (await loadCatalogSnapshot(db, lines, now));

  // Server-authoritative pricing: the catalog row is the ONLY source of a unit
  // price. The client's pricePerUnit is display-only and NEVER trusted — it
  // arrives over plain HTTP and is trivially editable.
  const basket = priceCartLines(snapshot, lines, data.coupon ?? null, data.deliveryType);
  const { priced, subtotal: price, rewards, freeShippingOfferId } = basket;
  const delivery = settleDelivery(basket, data.deliveryFee);
  const coupon = delivery.coupon;
  if (coupon && !coupon.applied) throw new CouponNotApplicableError(coupon.refusal);
  const offerName = (offerId: string | null) => snapshot.offers.find((offer) => offer.id === offerId)?.name ?? null;
  const lineRows: Array<typeof orderProducts.$inferInsert> = priced.map((p) => ({
    id: crypto.randomUUID(),
    orderId: id,
    productId: p.line.productId,
    productName: p.productName,
    variantId: p.line.variantId,
    variantLabel: p.variantLabel,
    sku: p.sku,
    quantity: p.line.quantity,
    // The price the shopper pays per unit: the catalog's, or the quantity
    // tier's share, so a line always reads quantity × unit = total.
    pricePerUnit: p.lineTotal / p.line.quantity,
    discount: p.discount,
    lineTotal: p.lineTotal,
    offerId: p.offerId,
    offerName: offerName(p.offerId),
    createdAt: now,
  }));

  const finalDeliveryFee = delivery.fee;
  const attribution = capturedAttributionRow(id, data.attribution ?? null, { now, orderedAt: data.submittedAt });

  // ── Reward lines ───────────────────────────────────────────────────────────
  //
  // Pricing placed every reward it reports — product, variant, stock covered
  // once the paid units are counted — so each one is written as placed. An
  // offer whose reward the stock could not cover was never applied.
  const rewardLines: Array<typeof orderProducts.$inferInsert> = [];
  const rewardDeducts: DeductStockInput[] = [];
  for (const { offer, placement } of rewards) {
    const rewardProduct = snapshot.products.get(placement.productId)!;
    const rewardVariant = placement.variantId ? snapshot.variants.get(placement.variantId) : undefined;
    rewardLines.push({
      id: crypto.randomUUID(),
      orderId: id,
      productId: placement.productId,
      productName: rewardProduct.name,
      variantId: placement.variantId,
      variantLabel: rewardVariant ? variantLabel(variantSelection(rewardVariant)) : null,
      sku: rewardVariant ? rewardVariant.sku : rewardProduct.sku,
      quantity: offer.rewardQuantity,
      pricePerUnit: 0,
      lineTotal: 0,
      offerId: offer.id,
      offerName: offerName(offer.id),
      reward: true,
      createdAt: now,
    });
    if (rewardProduct.trackInventory) {
      rewardDeducts.push({
        productId: placement.productId,
        variantId: placement.variantId,
        quantity: offer.rewardQuantity,
        orderId: id,
        customerId: data.customerId,
        customerName: data.customerName,
        now,
      });
    }
  }

  // ── Stock deductions ─────────────────────────────────────────────────────
  //
  // trackInventory is the parent product's master switch: false excludes the
  // product AND all of its variants from stock entirely.
  const deductions: DeductStockInput[] = [];
  for (const line of lines) {
    const product = snapshot.products.get(line.productId);
    if (!product?.trackInventory) continue;
    deductions.push({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      orderId: id,
      customerId: data.customerId,
      customerName: data.customerName,
      now,
    });
  }
  deductions.push(...rewardDeducts);

  // ── Commit phase (one atomic batch) ──────────────────────────────────────

  // The number is random, so two orders can draw the same one. The unique column
  // refuses the second and the batch rolls back whole, so the commit is built
  // again with a new number. Only that collision is retried.
  let orderNumber = data.orderNumber ?? drawOrderNumber(now);
  for (let attempt = 1; ; attempt += 1) {
    const statements: BatchStatement[] = [
      db.insert(orders).values({
        id,
        orderNumber,
        customerId: data.customerId,
        customerName: data.customerName,
        phone: data.phone,
        wilayaId: data.wilayaId,
        communeId: data.communeId,
        address: data.address ?? null,
        price,
        notes: data.notes ?? null,
        status: "new",
        orderType: "online",
        deliveryType: data.deliveryType,
        deliveryFee: finalDeliveryFee,
        deliveryOfferId: freeShippingOfferId,
        deliveryOfferName: offerName(freeShippingOfferId),
        couponId: coupon?.couponId ?? null,
        couponCode: coupon?.code ?? null,
        couponDiscount: coupon?.discount ?? 0,
        codAmount: price + finalDeliveryFee,
        fbc: data.fbc ?? null,
        fbp: data.fbp ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        landingPageId: data.landingPageId ?? null,
        createdAt: now,
        updatedAt: now,
        // Ride the existing insert rather than adding statements: the commit is
        // one atomic batch and D1 caps how many statements it may carry.
        customerEmail: data.customerEmail ?? null,
        checkoutKey: data.checkoutKey ?? null,
        locale: data.locale,
        customFieldsJson: serializeCustomFieldAnswers(data.customFieldAnswers ?? []),
        ...assignmentOnCreate(CHECKOUT, now),
      }),
    ];

    for (const line of [...lineRows, ...rewardLines]) {
      statements.push(db.insert(orderProducts).values(line));
    }

    for (const input of deductions) {
      statements.push(...buildDeductStatements(db, input));
    }

    if (attribution) statements.push(db.insert(orderAttribution).values(attribution));

    statements.push(recordEvent(db, { type: "order.created", subjectId: id, orderId: id, occurredAt: now, ...CHECKOUT, data: { order: orderSnapshot(id) } }));
    statements.push(assignedOnCreate(db, id, now, CHECKOUT));

    try {
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
      break;
    } catch (error) {
      const raised = raisedCouponRefusal(error);
      if (raised) throw new CouponNotApplicableError(raised);
      if (data.checkoutKey && isCheckoutKeyCollision(error)) throw new CheckoutAlreadyPlacedError(data.checkoutKey);
      if (attempt >= MAX_ORDER_NUMBER_DRAWS || !isOrderNumberCollision(error)) throw error;
      orderNumber = drawOrderNumber(now);
    }
  }

  return {
    id,
    orderNumber,
    customerId: data.customerId,
    customerName: data.customerName,
    price,
    deliveryFee: finalDeliveryFee,
    couponDiscount: coupon?.discount ?? 0,
  };
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

