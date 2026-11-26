import { z } from "zod";
import { MAX_PRICE_TIERS, MAX_TIER_QUANTITY, OFFER_KINDS } from "../../../../cod-shared/offers/model";
import { FREE_SHIPPING_DELIVERY_TYPES } from "../../../../cod-shared/offers/engine";

/**
 * The shape of an offer write. Whether the whole offer is coherent — a gift
 * offer names its gift, quantity pricing has tiers — is judged on the offer
 * the write leaves (`offerProblem` in cod-shared), not here, so an edit is
 * judged with the fields it does not touch.
 */
const priceTier = z.object({
  quantity: z.number().int().min(1).max(MAX_TIER_QUANTITY),
  price: z.number().int().min(0),
  freeShipping: z.boolean().default(false),
  freeShippingDeliveryType: z.enum(FREE_SHIPPING_DELIVERY_TYPES).optional().nullable().default(null),
});

export const createOfferSchema = z.object({
  name: z.string().min(2).max(200),
  discountType: z.enum(OFFER_KINDS).default("free"),
  triggerProductId: z.string().min(1),
  triggerVariantId: z.string().min(1).nullish(),
  triggerQuantity: z.number().int().min(1).max(1000).optional(),
  rewardProductId: z.string().min(1).nullish(),
  rewardVariantId: z.string().min(1).nullish(),
  rewardQuantity: z.number().int().min(0).max(1000).optional(),
  tiers: z.array(priceTier).max(MAX_PRICE_TIERS).optional(),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  status: z.enum(["active", "inactive"]).default("active"),
  /** null means both home delivery and pickup point. */
  freeShippingDeliveryType: z.enum(FREE_SHIPPING_DELIVERY_TYPES).optional().nullable(),
});

/** Any field; a field left out keeps its value, null clears one that may be empty. */
export const updateOfferSchema = createOfferSchema.partial().extend({
  discountType: z.enum(OFFER_KINDS).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
