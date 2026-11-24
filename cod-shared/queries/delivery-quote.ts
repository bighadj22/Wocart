/**
 * What delivery costs on an order the merchant enters — decided by the same
 * rules, from the same code, as the storefront checkout (`checkout-quote.ts`):
 *
 *   1. the store's rate there: every product's shipping profile, the dearest
 *      winning (or the default profile, per the store's basket setting), a
 *      commune's own price or refusal;
 *   2. free at the store's "free delivery above" amount
 *      (`meetsFreeDeliveryThreshold`), judged on the order's subtotal;
 *   3. free when an offer makes it so: a free-delivery offer, or a quantity
 *      tier that includes it, for a basket of its product alone — and only an
 *      offer running now (`loadCatalogSnapshot`).
 *
 * A coupon is the shopper's, typed at checkout; an order the merchant enters
 * has none. The answer says why delivery is free, so the dashboard can show
 * it and the order can record the offer.
 */

import type { AppDb } from "../db/client";
import { stores } from "../db/schema";
import type { CartLine } from "./cart";
import { loadCatalogSnapshot, priceCartLines } from "./catalog-snapshot";
import { meetsFreeDeliveryThreshold, resolveDeliveryFee } from "./shipping-resolution";

export interface OrderDeliveryInput {
  lines: Array<{ productId: string; variantId?: string | null; quantity: number }>;
  /** The order's subtotal, as the merchant priced its lines. */
  subtotal: number;
  wilayaId: number;
  communeId?: string | null;
  deliveryType: "home" | "stop_desk";
  now: string;
}

export type FreeDelivery = { by: "threshold"; threshold: number } | { by: "offer"; offerId: string; offerName: string | null };

export type OrderDeliveryQuote =
  | { available: false }
  | {
      available: true;
      /** The store's rate there, before anything makes it free. */
      rate: number;
      /** What the order charges for delivery. */
      fee: number;
      /** Why delivery is free; null when it is charged at the rate (or the rate is 0). */
      free: FreeDelivery | null;
    };

export async function quoteOrderDelivery(db: AppDb, input: OrderDeliveryInput): Promise<OrderDeliveryQuote> {
  const lines: CartLine[] = input.lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? null,
    variantLabel: null,
    quantity: line.quantity,
    productName: "",
  }));
  const [store, snapshot] = await Promise.all([
    db.select({ id: stores.id, threshold: stores.freeShippingThreshold }).from(stores).limit(1).get(),
    loadCatalogSnapshot(db, lines, input.now),
  ]);
  const rate = await resolveDeliveryFee(db, {
    productIds: [...new Set(lines.map((line) => line.productId))],
    wilayaId: input.wilayaId,
    communeId: input.communeId ?? null,
    deliveryType: input.deliveryType,
    storeId: store?.id,
  });
  if (rate === null) return { available: false };

  const offerId = priceCartLines(snapshot, lines, null, input.deliveryType).freeShippingOfferId;
  if (offerId) {
    const offer = snapshot.offers.find((item) => item.id === offerId);
    return { available: true, rate, fee: 0, free: { by: "offer", offerId, offerName: offer?.name ?? null } };
  }
  if (rate > 0 && meetsFreeDeliveryThreshold(store?.threshold, input.subtotal)) {
    return { available: true, rate, fee: 0, free: { by: "threshold", threshold: store!.threshold! } };
  }
  return { available: true, rate, fee: rate, free: null };
}
