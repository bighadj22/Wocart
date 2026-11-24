/**
 * The checkout's one answer: what the lines cost — offers, then the coupon —
 * and what delivering them there costs. The cart quote shows it and the
 * storefront order is checked against it before anything is written, so what
 * the shopper is shown is what the order charges.
 *
 * Order of the stages (ADR 0007): catalog prices → offers → coupon →
 * delivery. Delivery's rate is judged on the subtotal after the coupon, so a
 * discount can take a basket back under the free-delivery threshold, and a
 * free-delivery coupon with nothing to give — delivery already free — is
 * refused rather than spending a use.
 */
import type { AppDb } from "../db/client";
import type { CartLine } from "./cart";
import { priceCartLines, settleDelivery, type CatalogSnapshot, type CouponOutcome, type PricedBasket } from "./catalog-snapshot";
import { findCheckoutCoupon, type CheckoutCoupon } from "./checkout-coupon";
import { resolveDeliveryFee } from "./shipping-resolution";
import { normalizeCouponCode } from "../coupons/model";

export interface CheckoutDestination {
  wilayaId: number;
  communeId?: string | null;
  deliveryType: "home" | "stop_desk";
}

export interface CheckoutQuote {
  basket: PricedBasket;
  /** The coupon the code named, when this shopper may use it now — what the order is priced with; null otherwise. Whether it then applies is `couponOutcome`. */
  coupon: CheckoutCoupon | null;
  /** The code's outcome, after delivery; null without a code. */
  couponOutcome: CouponOutcome | null;
  /** Without a destination: undefined. Otherwise the store's rate there (null where it does not deliver) and the fee the order charges. */
  delivery?: { rate: number; fee: number } | null;
}

export async function quoteCheckout(
  db: AppDb,
  input: {
    storeId: string | undefined;
    now: string;
    snapshot: CatalogSnapshot;
    lines: CartLine[];
    destination?: CheckoutDestination;
    /** The code as typed; an empty box arrives as none (the request schemas). */
    couponCode?: string | null;
    /** The order's phone; null before the shopper has typed one. */
    phone?: string | null;
  },
): Promise<CheckoutQuote> {
  const code = input.couponCode ?? null;
  const lookup = code === null ? null : await findCheckoutCoupon(db, { code, phone: input.phone ?? null, now: input.now });
  const coupon = lookup?.ok ? lookup.coupon : null;
  const basket = priceCartLines(input.snapshot, input.lines, coupon, input.destination?.deliveryType ?? "home");
  // A code the lookup refused stays refused; one it found is judged by pricing, then by delivery.
  // Named in its stored form when it is one, as an applied code is.
  const refused: CouponOutcome | null = lookup && !lookup.ok ? { code: normalizeCouponCode(code!) ?? code!.trim(), applied: false, refusal: lookup.refusal } : null;
  const answer = (outcome: CouponOutcome | null, delivery?: CheckoutQuote["delivery"]): CheckoutQuote => ({
    basket,
    coupon,
    couponOutcome: outcome,
    ...(delivery === undefined ? {} : { delivery }),
  });

  if (!input.destination) return answer(refused ?? basket.coupon);
  const rate = await resolveDeliveryFee(db, {
    productIds: [...new Set(input.lines.map((line) => line.productId))],
    wilayaId: input.destination.wilayaId,
    communeId: input.destination.communeId ?? null,
    deliveryType: input.destination.deliveryType,
    storeId: input.storeId,
    subtotal: basket.subtotal,
  });
  if (rate === null) return answer(refused ?? basket.coupon, null);
  const settled = settleDelivery(basket, rate);
  return answer(refused ?? settled.coupon, { rate, fee: settled.fee });
}
