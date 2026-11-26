/**
 * Offers: the dashboard's reads and writes. What an offer may be is decided in
 * `offers/model.ts` (and enforced again by the database, migration 0051); how
 * offers apply to a basket, in `offers/engine.ts`.
 *
 * Every write is judged whole — the stored offer with the edit applied — so an
 * edit can never leave an incoherent offer behind, and quantity pricing is
 * never scheduled beside another live offer for the same product: a product
 * gets one offer per order, and a merchant should see which one in advance.
 */
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { offerPriceTiers, offers, productVariants, products } from "../db/schema";
import type { AppDb } from "../db/client";
import { offerProblem, offerState, schedulesOverlap, type OfferKind, type OfferProblem, type OfferShape, type PriceTier } from "../offers/model";

export type OfferStatus = "active" | "inactive";

/** An offer as the dashboard sends it. Reward fields belong to Buy X Get Y offers, tiers to quantity pricing. */
export interface OfferInput {
  name: string;
  discountType: OfferKind;
  triggerProductId: string;
  triggerVariantId?: string | null;
  /** A Buy X Get Y or free-delivery offer's threshold; quantity pricing takes its lowest tier's. */
  triggerQuantity?: number;
  rewardProductId?: string | null;
  rewardVariantId?: string | null;
  rewardQuantity?: number;
  tiers?: PriceTier[];
  startsAt?: string | null;
  endsAt?: string | null;
  status: OfferStatus;
  /** Delivery method earning free shipping; null or absent means both. */
  freeShippingDeliveryType?: "home" | "stop_desk" | null;
}

export type OfferPatch = Partial<OfferInput>;

export type OfferWriteProblem =
  | { reason: OfferProblem }
  | { reason: "unknown_product" | "variant_not_of_product" }
  | { reason: "conflict"; offerId: string; offerName: string };

type OfferRow = typeof offers.$inferSelect;

const variantLabel = (variations: string) => Object.values(JSON.parse(variations) as Record<string, string>).join(" / ");

async function tiersOf(db: AppDb, ids: readonly string[]): Promise<Map<string, PriceTier[]>> {
  const byOffer = new Map<string, PriceTier[]>();
  if (ids.length === 0) return byOffer;
  const rows = await db.select().from(offerPriceTiers).where(inArray(offerPriceTiers.offerId, [...ids])).orderBy(asc(offerPriceTiers.quantity)).all();
  for (const row of rows) byOffer.set(row.offerId, [...(byOffer.get(row.offerId) ?? []), { quantity: row.quantity, price: row.price, freeShipping: row.freeShipping, freeShippingDeliveryType: row.freeShippingDeliveryType as "home" | "stop_desk" | null }]);
  return byOffer;
}

async function detail(db: AppDb, offer: OfferRow, tiers: PriceTier[], now: string) {
  const [triggerProduct, rewardProduct, triggerVariant, rewardVariant] = await Promise.all([
    db.select({ id: products.id, name: products.name, handle: products.handle }).from(products).where(eq(products.id, offer.triggerProductId)).get(),
    offer.rewardProductId
      ? db.select({ id: products.id, name: products.name, handle: products.handle }).from(products).where(eq(products.id, offer.rewardProductId)).get()
      : null,
    offer.triggerVariantId
      ? db.select({ id: productVariants.id, variations: productVariants.variations }).from(productVariants).where(eq(productVariants.id, offer.triggerVariantId)).get()
      : null,
    offer.rewardVariantId
      ? db.select({ id: productVariants.id, variations: productVariants.variations }).from(productVariants).where(eq(productVariants.id, offer.rewardVariantId)).get()
      : null,
  ]);
  return {
    id: offer.id,
    name: offer.name,
    status: offer.status,
    state: offerState(offer, now),
    discountType: offer.discountType,
    triggerQuantity: offer.triggerQuantity,
    rewardQuantity: offer.rewardQuantity,
    tiers,
    startsAt: offer.startsAt ?? null,
    endsAt: offer.endsAt ?? null,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    triggerProduct: triggerProduct ?? null,
    triggerVariant: triggerVariant ? { id: triggerVariant.id, label: variantLabel(triggerVariant.variations) } : null,
    rewardProduct: rewardProduct ?? null,
    rewardVariant: rewardVariant ? { id: rewardVariant.id, label: variantLabel(rewardVariant.variations) } : null,
    freeShippingDeliveryType: offer.freeShippingDeliveryType as "home" | "stop_desk" | null,
  };
}

export type OfferDetail = Awaited<ReturnType<typeof detail>>;

export async function listOffers(db: AppDb, now = new Date().toISOString()): Promise<OfferDetail[]> {
  const rows = await db.select().from(offers).orderBy(desc(offers.createdAt)).all();
  const tiers = await tiersOf(db, rows.map((row) => row.id));
  return Promise.all(rows.map((row) => detail(db, row, tiers.get(row.id) ?? [], now)));
}

export async function getOfferById(db: AppDb, id: string, now = new Date().toISOString()): Promise<OfferDetail | null> {
  const row = await db.select().from(offers).where(eq(offers.id, id)).get();
  if (!row) return null;
  return detail(db, row, (await tiersOf(db, [id])).get(id) ?? [], now);
}

/** The offer a write would leave: the stored one with the edit applied, in the shape the rules judge. */
function shapeOf(input: OfferInput): OfferShape & { name: string; status: OfferStatus } {
  const buyXGetY = input.discountType === "free";
  const tiers = input.discountType === "quantity_price" ? [...(input.tiers ?? [])].sort((a, b) => a.quantity - b.quantity) : (input.tiers ?? []);
  return {
    name: input.name,
    status: input.status,
    discountType: input.discountType,
    triggerProductId: input.triggerProductId,
    triggerVariantId: input.triggerVariantId ?? null,
    triggerQuantity: input.discountType === "quantity_price" ? (tiers[0]?.quantity ?? 1) : (input.triggerQuantity ?? 2),
    rewardProductId: input.rewardProductId ?? null,
    rewardVariantId: input.rewardVariantId ?? null,
    rewardQuantity: input.rewardQuantity ?? (buyXGetY ? 1 : 0),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    tiers,
    freeShippingDeliveryType: input.freeShippingDeliveryType ?? null,
  };
}

/** Why this offer cannot be written, or null: its own rules, its products and variants, and the live offers beside it. */
async function writeProblem(db: AppDb, id: string | null, shape: ReturnType<typeof shapeOf>): Promise<OfferWriteProblem | null> {
  const own = offerProblem(shape);
  if (own) return { reason: own };

  const productIds = [shape.triggerProductId, ...(shape.rewardProductId ? [shape.rewardProductId] : [])];
  const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, productIds)).all();
  if (new Set(found.map((row) => row.id)).size !== new Set(productIds).size) return { reason: "unknown_product" };
  for (const [variantId, productId] of [
    [shape.triggerVariantId, shape.triggerProductId],
    [shape.rewardVariantId, shape.rewardProductId],
  ] as const) {
    if (!variantId) continue;
    const variant = await db.select({ productId: productVariants.productId }).from(productVariants).where(eq(productVariants.id, variantId)).get();
    if (variant?.productId !== productId) return { reason: "variant_not_of_product" };
  }

  if (shape.status !== "active") return null;
  const others = await db
    .select({ id: offers.id, name: offers.name, discountType: offers.discountType, startsAt: offers.startsAt, endsAt: offers.endsAt })
    .from(offers)
    .where(and(eq(offers.triggerProductId, shape.triggerProductId), eq(offers.status, "active"), ...(id ? [ne(offers.id, id)] : [])))
    .all();
  const clash = others.find(
    (other) => (shape.discountType === "quantity_price" || other.discountType === "quantity_price") && schedulesOverlap(shape, other),
  );
  return clash ? { reason: "conflict", offerId: clash.id, offerName: clash.name } : null;
}

function rowOf(shape: ReturnType<typeof shapeOf>) {
  const { tiers: _tiers, ...row } = shape;
  return row;
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

const tierRows = (offerId: string, tiers: readonly PriceTier[]) =>
  tiers.map((tier) => ({ offerId, quantity: tier.quantity, price: tier.price, freeShipping: tier.freeShipping, freeShippingDeliveryType: tier.freeShippingDeliveryType ?? null }));

export async function createOffer(db: AppDb, input: OfferInput): Promise<{ ok: true; id: string } | ({ ok: false } & OfferWriteProblem)> {
  const shape = shapeOf(input);
  const problem = await writeProblem(db, null, shape);
  if (problem) return { ok: false, ...problem };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: BatchStatement[] = [
    db.insert(offers).values({ id, ...rowOf(shape), createdAt: now, updatedAt: now }),
    ...(shape.tiers.length ? [db.insert(offerPriceTiers).values(tierRows(id, shape.tiers))] : []),
  ];
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return { ok: true, id };
}

export async function updateOffer(
  db: AppDb,
  id: string,
  patch: OfferPatch,
): Promise<{ ok: true } | { ok: false; reason: "not_found" } | ({ ok: false } & OfferWriteProblem)> {
  const stored = await getOfferById(db, id);
  if (!stored) return { ok: false, reason: "not_found" };
  const kindChanges = patch.discountType !== undefined && patch.discountType !== stored.discountType;
  const shape = shapeOf({
    name: patch.name ?? stored.name,
    status: patch.status ?? stored.status,
    discountType: patch.discountType ?? stored.discountType,
    triggerProductId: patch.triggerProductId ?? stored.triggerProduct?.id ?? "",
    triggerVariantId: patch.triggerVariantId !== undefined ? patch.triggerVariantId : (stored.triggerVariant?.id ?? null),
    triggerQuantity: patch.triggerQuantity ?? stored.triggerQuantity,
    // A change of kind starts the kind's own fields afresh: a Buy X Get Y offer turned
    // into free delivery drops its reward rather than being refused for it.
    rewardProductId: patch.rewardProductId !== undefined ? patch.rewardProductId : kindChanges ? null : (stored.rewardProduct?.id ?? null),
    rewardVariantId: patch.rewardVariantId !== undefined ? patch.rewardVariantId : kindChanges ? null : (stored.rewardVariant?.id ?? null),
    ...(patch.rewardQuantity !== undefined ? { rewardQuantity: patch.rewardQuantity } : kindChanges ? {} : { rewardQuantity: stored.rewardQuantity }),
    tiers: patch.tiers ?? (kindChanges ? [] : stored.tiers),
    freeShippingDeliveryType: patch.freeShippingDeliveryType !== undefined ? patch.freeShippingDeliveryType : stored.freeShippingDeliveryType,
    startsAt: patch.startsAt !== undefined ? patch.startsAt : stored.startsAt,
    endsAt: patch.endsAt !== undefined ? patch.endsAt : stored.endsAt,
  });
  const problem = await writeProblem(db, id, shape);
  if (problem) return { ok: false, ...problem };
  const statements: BatchStatement[] = [
    db.update(offers).set({ ...rowOf(shape), updatedAt: new Date().toISOString() }).where(eq(offers.id, id)),
    db.delete(offerPriceTiers).where(eq(offerPriceTiers.offerId, id)),
    ...(shape.tiers.length ? [db.insert(offerPriceTiers).values(tierRows(id, shape.tiers))] : []),
  ];
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return { ok: true };
}

export async function deleteOffer(db: AppDb, id: string) {
  await db.delete(offers).where(eq(offers.id, id));
}
