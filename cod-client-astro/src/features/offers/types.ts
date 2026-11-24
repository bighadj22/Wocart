import type { OfferKind, OfferState, PriceTier } from "../../../../cod-shared/offers/model";

export type OfferDiscountType = OfferKind;
export type { OfferState, PriceTier };
export type OfferStatus = "active" | "inactive";
export type FreeShippingDeliveryMethod = "home" | "stop_desk";

export interface OfferProduct {
  id: string;
  name: string;
  handle: string;
}

export interface OfferVariant {
  id: string;
  label: string;
}

export interface Offer {
  id: string;
  name: string;
  status: OfferStatus;
  /** Where the offer stands now, as the server judges it: only a live offer reaches shoppers. */
  state: OfferState;
  triggerQuantity: number;
  rewardQuantity: number;
  discountType: OfferDiscountType;
  /** Quantity pricing's tiers, in increasing quantity; empty for the other kinds. */
  tiers: PriceTier[];
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  triggerProduct: OfferProduct | null;
  triggerVariant: OfferVariant | null;
  rewardProduct: OfferProduct | null;
  rewardVariant: OfferVariant | null;
  /** null means both delivery methods earn free shipping. */
  freeShippingDeliveryType: FreeShippingDeliveryMethod | null;
}

export interface OfferFormValues {
  name: string;
  discountType: OfferDiscountType;
  triggerProductId: string;
  triggerVariantId: string;
  triggerQuantity: string;
  rewardProductId: string;
  rewardVariantId: string;
  rewardQuantity: string;
  /** Quantity pricing's tiers as typed: quantity and total price for that many. */
  tiers: Array<{
    quantity: string;
    price: string;
    freeShipping: boolean;
    eligibleDeliveryMethods: FreeShippingDeliveryMethod[];
  }>;
  startsAt: string;
  endsAt: string;
  status: OfferStatus;
  eligibleDeliveryMethods: FreeShippingDeliveryMethod[];
}

export interface CreateOfferData {
  name: string;
  discountType: OfferKind;
  triggerProductId: string;
  triggerVariantId?: string | null;
  triggerQuantity?: number;
  rewardProductId?: string | null;
  rewardVariantId?: string | null;
  rewardQuantity: number;
  tiers?: PriceTier[];
  startsAt?: string | null;
  endsAt?: string | null;
  status: OfferStatus;
  /** null means both delivery methods earn free shipping. */
  freeShippingDeliveryType?: FreeShippingDeliveryMethod | null;
}
