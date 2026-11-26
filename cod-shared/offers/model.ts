/**
 * Offers — promotions the server applies on its own at checkout, unasked
 * (a coupon is the shopper's, applied after them: `coupons/`). Three kinds:
 *
 *   free            Buy X, get Y free: reward lines at no charge.
 *   free_shipping   Buy X, delivery is free.
 *   quantity_price  Quantity pricing — "1 for 2,000 DA, 2 for 3,500 DA, 3 for
 *                   4,500 DA": price tiers by quantity, each optionally with
 *                   free delivery.
 *
 * A product gets at most one offer per order, and a reward is given once per
 * order whatever the quantity. `engine.ts` decides; the database keeps every
 * offer coherent (migration 0051).
 */

export const OFFER_KINDS = ["free", "free_shipping", "quantity_price"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** At most this many tiers in one quantity-pricing offer. */
export const MAX_PRICE_TIERS = 10;
/** A tier's quantity, like an order line's, stays within these bounds. */
export const MAX_TIER_QUANTITY = 1000;

/**
 * One quantity-pricing tier: from `quantity` units, the line costs `price`
 * for that many — the per-unit price of the highest tier reached applies to
 * every unit, the way quantity price breaks work everywhere.
 */
export interface PriceTier {
  quantity: number;
  price: number;
  freeShipping: boolean;
  /** Delivery method earning this tier's free shipping; null or absent inherits the offer's. */
  freeShippingDeliveryType?: "home" | "stop_desk" | null;
}

/** The highest tier `quantity` reaches, or null below the lowest. */
export function tierFor(tiers: readonly PriceTier[], quantity: number): PriceTier | null {
  let reached: PriceTier | null = null;
  for (const tier of tiers) if (tier.quantity <= quantity && (!reached || tier.quantity > reached.quantity)) reached = tier;
  return reached;
}

/**
 * What `quantity` units cost under `tier`, in whole dinars: exactly the tier's
 * price at its own quantity, its per-unit price beyond.
 */
export function tieredTotal(tier: PriceTier, quantity: number): number {
  return Math.round((tier.price * quantity) / tier.quantity);
}

/** What is wrong with a tier list, or null: at least one tier, quantities distinct, within bounds, prices whole. */
export function tiersProblem(tiers: readonly PriceTier[]): "empty" | "too_many_tiers" | "duplicate_quantity" | "invalid_tier" | null {
  if (tiers.length === 0) return "empty";
  if (tiers.length > MAX_PRICE_TIERS) return "too_many_tiers";
  if (new Set(tiers.map((tier) => tier.quantity)).size !== tiers.length) return "duplicate_quantity";
  const valid = (tier: PriceTier) =>
    Number.isInteger(tier.quantity) && tier.quantity >= 1 && tier.quantity <= MAX_TIER_QUANTITY && Number.isInteger(tier.price) && tier.price >= 0;
  return tiers.every(valid) ? null : "invalid_tier";
}

/** An offer as written, whole: what `offerProblem` judges after every create or edit. */
export interface OfferShape {
  discountType: OfferKind;
  triggerProductId: string;
  triggerVariantId: string | null;
  triggerQuantity: number;
  rewardProductId: string | null;
  rewardVariantId: string | null;
  rewardQuantity: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Quantity pricing's tiers; empty for the other kinds. */
  tiers: readonly PriceTier[];
  /** Delivery method earning free shipping; null or absent means both. */
  freeShippingDeliveryType?: "home" | "stop_desk" | null;
}

export type OfferProblem =
  | "reward_required"
  | "reward_not_allowed"
  | "tiers_not_allowed"
  | "schedule_ends_before_start"
  | "trigger_quantity"
  | "empty"
  | "too_many_tiers"
  | "duplicate_quantity"
  | "invalid_tier";

/**
 * What makes an offer incoherent, or null: a Buy X Get Y offer names its reward and
 * gives at least one; the other kinds name none; only quantity pricing has
 * tiers, and it has valid ones; a schedule ends after it starts. The database
 * refuses the same (migration 0051); this says why before it does.
 */
export function offerProblem(offer: OfferShape): OfferProblem | null {
  if (!Number.isInteger(offer.triggerQuantity) || offer.triggerQuantity < 1) return "trigger_quantity";
  if (offer.startsAt && offer.endsAt && offer.endsAt <= offer.startsAt) return "schedule_ends_before_start";
  if (offer.discountType === "free") {
    if (!offer.rewardProductId || offer.rewardQuantity < 1) return "reward_required";
  } else if (offer.rewardProductId || offer.rewardVariantId || offer.rewardQuantity !== 0) {
    return "reward_not_allowed";
  }
  if (offer.discountType === "quantity_price") return tiersProblem(offer.tiers);
  return offer.tiers.length ? "tiers_not_allowed" : null;
}

/**
 * Where an offer stands at `now`, as the merchant reads it: switched off, not
 * started, ended, or live — live being the only state a shopper sees it in.
 */
export type OfferState = "inactive" | "scheduled" | "expired" | "live";

export function offerState(offer: Pick<OfferShape, "startsAt" | "endsAt"> & { status: "active" | "inactive" }, now: string): OfferState {
  if (offer.status === "inactive") return "inactive";
  if (offer.startsAt && now < offer.startsAt) return "scheduled";
  if (offer.endsAt && now >= offer.endsAt) return "expired";
  return "live";
}

/** Whether two schedules share an instant (an open end never ends). */
export function schedulesOverlap(a: Pick<OfferShape, "startsAt" | "endsAt">, b: Pick<OfferShape, "startsAt" | "endsAt">): boolean {
  const startsBeforeOtherEnds = (x: typeof a, y: typeof b) => !x.startsAt || !y.endsAt || x.startsAt < y.endsAt;
  return startsBeforeOtherEnds(a, b) && startsBeforeOtherEnds(b, a);
}
