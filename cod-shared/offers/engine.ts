/**
 * Which offers a basket earns, and what they do to it.
 *
 * Pure: no database, no clock. The catalog snapshot loads the candidates
 * (active, in schedule) with their tiers; the order engine and the cart quote
 * both call `applyOffers`, so what the shopper is shown and what the order
 * charges cannot drift apart.
 *
 * The rules, and why each one is what it is:
 *
 *  1. A product is judged by the units it counts: every line of it, across
 *     variants — two sizes of one shirt are two shirts — or only the variant
 *     an offer is locked to.
 *  2. One offer per product. An offer qualifies when its threshold is
 *     reached and it can give what it promises: a reward the stock covers
 *     (once the units paid for and the rewards placed before are counted),
 *     free delivery only where rule 5 allows it, a tier that changes the
 *     price or brings free delivery the basket can use — a tier at the
 *     catalog price gives nothing, and must not cost the shopper a coupon. Among those, the shopper's
 *     choice (`offerId`) wins when it qualifies on its own; else the highest
 *     threshold reached wins, the id breaking a tie so every run agrees. An
 *     offer that cannot give its benefit never shadows one that can.
 *  3. Quantity pricing prices the counted lines at the highest tier reached:
 *     exactly the tier's price at its quantity, its per-unit price beyond.
 *     The total is shared across the lines by their quantities so the lines
 *     add up to it to the dinar.
 *  4. A reward is given once per order, whatever the quantity. Rewards are output,
 *     never input: a reward unit never counts toward another offer.
 *  5. Free delivery — a free-shipping offer, or a tier that includes it —
 *     applies only to a basket of one product. In a mixed basket free delivery
 *     is the store's threshold's business; otherwise a cheap promoted item
 *     would ship a large basket for free.
 *  6. Only an offer that changed something is reported as applied, and every
 *     line it counted names it — a coupon never covers those lines.
 *  7. Products are judged in basket order, so a basket always comes out the
 *     same.
 */
import { allocate } from "../pricing/allocate";
import { tierFor, tieredTotal, type OfferKind, type PriceTier } from "./model";

/** An offer as the engine reads it. */
export interface EngineOffer {
  id: string;
  discountType: OfferKind;
  triggerProductId: string;
  triggerVariantId: string | null;
  triggerQuantity: number;
  rewardProductId: string | null;
  rewardVariantId: string | null;
  rewardQuantity: number;
  /** Quantity pricing's tiers; empty for the other kinds. */
  tiers: readonly PriceTier[];
  /** Delivery method earning free shipping; null or absent means both. */
  freeShippingDeliveryType?: FreeShippingDeliveryType | null;
}

export const FREE_SHIPPING_DELIVERY_TYPES = ["home", "stop_desk"] as const;
export type FreeShippingDeliveryType = (typeof FREE_SHIPPING_DELIVERY_TYPES)[number];

/** An ineligible delivery method keeps the store's normal shipping rate. */
export function freeShippingAppliesTo(deliveryType: FreeShippingDeliveryType, setting: FreeShippingDeliveryType | null | undefined): boolean {
  return setting == null || setting === deliveryType;
}

export interface OfferLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  /** The offer the shopper picked for this product, if any. */
  offerId?: string;
}

export interface PricedOfferLine {
  /** What the line costs: its catalog price, or the quantity-pricing tier's. */
  lineTotal: number;
  /** The offer applied to this line — the one its product earned and that counted it; null when none. */
  offerId: string | null;
}

/** Where a reward goes: its product and variant, the stock having been found to cover it. */
export interface RewardPlacement {
  productId: string;
  variantId: string | null;
}

export interface EarnedReward<L extends OfferLine = OfferLine> {
  offer: EngineOffer;
  /** The first counted line: a reward of the same product mirrors its variant. */
  line: L;
  placement: RewardPlacement;
}

/**
 * Places a reward for the first counted line, given the rewards placed before
 * it, or answers null when the stock cannot cover it. The catalog knows stock
 * and default variants; the engine only asks.
 */
export type PlaceReward<L extends OfferLine = OfferLine> = (offer: EngineOffer, line: L, placed: readonly EarnedReward<L>[]) => RewardPlacement | null;

export interface AppliedOffers<L extends OfferLine = OfferLine> {
  /** One per input line, in order. */
  lines: PricedOfferLine[];
  rewards: EarnedReward<L>[];
  /** The offer that made delivery free, or null. */
  freeShippingOfferId: string | null;
}

function counted<L extends OfferLine>(lines: readonly L[], offer: EngineOffer): L[] {
  return lines.filter((line) => line.productId === offer.triggerProductId && (!offer.triggerVariantId || line.variantId === offer.triggerVariantId));
}

/** The threshold an offer reaches with `quantity` units, or null when it does not qualify. */
function reached(offer: EngineOffer, quantity: number): number | null {
  if (offer.discountType === "quantity_price") return tierFor(offer.tiers, quantity)?.quantity ?? null;
  return quantity >= offer.triggerQuantity ? offer.triggerQuantity : null;
}

export function applyOffers<L extends OfferLine>(lines: readonly L[], candidates: readonly EngineOffer[], placeReward: PlaceReward<L>, deliveryType: FreeShippingDeliveryType): AppliedOffers<L> {
  const priced: PricedOfferLine[] = lines.map((line) => ({ lineTotal: line.unitPrice * line.quantity, offerId: null }));
  const rewards: EarnedReward<L>[] = [];
  let freeShippingOfferId: string | null = null;

  const products = [...new Set(lines.map((line) => line.productId))];
  const singleProductBasket = products.length === 1;

  for (const productId of products) {
    const choice = lines.find((line) => line.productId === productId && line.offerId)?.offerId;
    const reaching = candidates
      .filter((offer) => offer.triggerProductId === productId)
      .map((offer) => {
        const counting = counted(lines, offer);
        const units = counting.reduce((sum, line) => sum + line.quantity, 0);
        const atCatalog = counting.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
        return { offer, threshold: reached(offer, units), units, atCatalog, first: counting[0]! };
      })
      .filter((entry): entry is { offer: EngineOffer; threshold: number; units: number; atCatalog: number; first: L } => entry.threshold !== null)
      .sort((a, b) => b.threshold - a.threshold || a.offer.id.localeCompare(b.offer.id));
    const ordered = [...reaching.filter((entry) => entry.offer.id === choice), ...reaching.filter((entry) => entry.offer.id !== choice)];

    let reward: EarnedReward<L> | null = null;
    const chosen = ordered.find(({ offer, first, units, atCatalog }) => {
      if (offer.discountType === "free_shipping") return singleProductBasket && freeShippingAppliesTo(deliveryType, offer.freeShippingDeliveryType);
      if (offer.discountType === "quantity_price") {
        const tier = tierFor(offer.tiers, units)!;
        const tierSetting = tier.freeShippingDeliveryType ?? offer.freeShippingDeliveryType;
        return tieredTotal(tier, units) !== atCatalog || (tier.freeShipping && singleProductBasket && freeShippingAppliesTo(deliveryType, tierSetting));
      }
      if (offer.discountType === "free") {
        const placement = placeReward(offer, first, rewards);
        reward = placement && { offer, line: first, placement };
        return reward !== null;
      }
      return false;
    });
    if (!chosen) continue;
    const { offer, units } = chosen;
    const lineIndexes = lines.flatMap((line, index) => (counted([line], offer).length ? [index] : []));

    if (offer.discountType === "quantity_price") {
      const tier = tierFor(offer.tiers, units)!;
      const shares = allocate(tieredTotal(tier, units), lineIndexes.map((index) => lines[index]!.quantity));
      lineIndexes.forEach((index, at) => {
        priced[index] = { lineTotal: shares[at]!, offerId: offer.id };
      });
      const tierSetting = tier.freeShippingDeliveryType ?? offer.freeShippingDeliveryType;
      if (tier.freeShipping && singleProductBasket && freeShippingAppliesTo(deliveryType, tierSetting)) freeShippingOfferId = offer.id;
    } else {
      for (const index of lineIndexes) priced[index] = { ...priced[index]!, offerId: offer.id };
      if (offer.discountType === "free") rewards.push(reward!);
      else if (freeShippingAppliesTo(deliveryType, offer.freeShippingDeliveryType)) freeShippingOfferId = offer.id;
    }
  }

  return { lines: priced, rewards, freeShippingOfferId };
}
