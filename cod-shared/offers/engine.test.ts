/**
 * applyOffers — every offer rule, exhaustively.
 *
 * Pure: candidates in, decision out. The integration — that the snapshot
 * loads the right candidates, and that prices, rewards and free delivery become
 * a real order with real stock moved — is proven against real D1 in
 * cod-server's offers e2e tests.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyOffers, type EngineOffer, type OfferLine, type PlaceReward } from "./engine";
import { tierFor, tieredTotal, tiersProblem, type PriceTier } from "./model";

const line = (productId: string, quantity: number, extra: Partial<OfferLine> = {}): OfferLine => ({
  productId,
  variantId: null,
  quantity,
  unitPrice: 2000,
  ...extra,
});

let seq = 0;
const offer = (extra: Partial<EngineOffer> & { triggerProductId: string }): EngineOffer => ({
  id: `o${String(++seq).padStart(3, "0")}`,
  discountType: "free",
  triggerVariantId: null,
  triggerQuantity: 2,
  rewardProductId: extra.triggerProductId,
  rewardVariantId: null,
  rewardQuantity: 1,
  tiers: [],
  freeShippingDeliveryType: null,
  ...extra,
});

const tiers = (...entries: Array<[number, number, boolean?, ("home" | "stop_desk" | null)?]>): PriceTier[] =>
  entries.map(([quantity, price, freeShipping = false, freeShippingDeliveryType = null]) => ({ quantity, price, freeShipping, freeShippingDeliveryType }));

const pricing = (productId: string, list: PriceTier[], extra: Partial<EngineOffer> = {}) =>
  offer({ triggerProductId: productId, discountType: "quantity_price", rewardProductId: null, rewardQuantity: 0, triggerQuantity: 1, tiers: list, ...extra });

/** Every reward fits: its own variant, or the counted line's. */
const placeAll: PlaceReward = (offer, line) => ({ productId: offer.rewardProductId!, variantId: offer.rewardVariantId ?? line.variantId });
const apply = (lines: OfferLine[], candidates: EngineOffer[], place: PlaceReward = placeAll, deliveryType: "home" | "stop_desk" = "home") => applyOffers(lines, candidates, place, deliveryType);
const totals = (lines: OfferLine[], candidates: EngineOffer[]) => apply(lines, candidates).lines.map((priced) => priced.lineTotal);

describe("quantity pricing", () => {
  const robe = pricing("robe", tiers([1, 2000], [2, 3500], [3, 4500]));

  it("charges exactly a tier's price at its quantity", () => {
    expect(totals([line("robe", 1)], [robe])).toEqual([2000]);
    expect(totals([line("robe", 2)], [robe])).toEqual([3500]);
    expect(totals([line("robe", 3)], [robe])).toEqual([4500]);
  });

  it("charges the highest tier's per-unit price beyond it", () => {
    expect(totals([line("robe", 4)], [robe])).toEqual([6000]);
    expect(totals([line("robe", 5)], [robe])).toEqual([7500]);
  });

  it("does not apply where its tier changes nothing: the catalog price, and no delivery the basket can use", () => {
    const fromOne = pricing("robe", tiers([1, 2000], [2, 3500]));
    expect(apply([line("robe", 1)], [fromOne]).lines).toEqual([{ lineTotal: 2000, offerId: null }]);
    expect(apply([line("robe", 2)], [fromOne]).lines).toEqual([{ lineTotal: 3500, offerId: fromOne.id }]);

    const deliveredFromOne = pricing("robe", tiers([1, 2000, true]));
    expect(apply([line("robe", 1)], [deliveredFromOne])).toMatchObject({ lines: [{ lineTotal: 2000, offerId: deliveredFromOne.id }], freeShippingOfferId: deliveredFromOne.id });
    expect(apply([line("robe", 1), line("sac", 1)], [deliveredFromOne]).lines[0]).toEqual({ lineTotal: 2000, offerId: null });
  });

  it("leaves the catalog price below the lowest tier", () => {
    const fromTwo = pricing("robe", tiers([2, 3500], [3, 4500]));
    expect(apply([line("robe", 1)], [fromTwo]).lines).toEqual([{ lineTotal: 2000, offerId: null }]);
  });

  it("names the offer on the lines it priced", () => {
    expect(apply([line("robe", 2)], [robe]).lines).toEqual([{ lineTotal: 3500, offerId: robe.id }]);
  });

  it("counts every variant, and shares the total so the lines add up to it to the dinar", () => {
    const threeFor4000 = pricing("robe", tiers([3, 4000]));
    const priced = apply(
      [line("robe", 1, { variantId: "s" }), line("robe", 1, { variantId: "m" }), line("robe", 1, { variantId: "l" })],
      [threeFor4000],
    ).lines;
    expect(priced.reduce((sum, entry) => sum + entry.lineTotal, 0)).toBe(4000);
    expect(priced.map((entry) => entry.lineTotal).sort()).toEqual([1333, 1333, 1334]);
  });

  it("prices only the variant it is locked to", () => {
    const redOnly = pricing("robe", tiers([2, 3000]), { triggerVariantId: "red" });
    expect(totals([line("robe", 2, { variantId: "red" }), line("robe", 1, { variantId: "blue" })], [redOnly])).toEqual([3000, 2000]);
    expect(totals([line("robe", 1, { variantId: "red" }), line("robe", 1, { variantId: "blue" })], [redOnly])).toEqual([2000, 2000]);
  });

  it("makes delivery free on a tier that includes it, for a basket of that product alone", () => {
    const withDelivery = pricing("robe", tiers([1, 2000], [2, 3500, true]));
    expect(apply([line("robe", 1)], [withDelivery]).freeShippingOfferId).toBeNull();
    expect(apply([line("robe", 2)], [withDelivery]).freeShippingOfferId).toBe(withDelivery.id);
    expect(apply([line("robe", 2), line("sac", 1)], [withDelivery]).freeShippingOfferId).toBeNull();
  });

  it("honours the tier's delivery method, or inherits the offer's", () => {
    const pickupOnly = pricing("robe", tiers([2, 3500, true, "stop_desk"]));
    expect(apply([line("robe", 2)], [pickupOnly], placeAll, "stop_desk").freeShippingOfferId).toBe(pickupOnly.id);
    expect(apply([line("robe", 2)], [pickupOnly], placeAll, "home").freeShippingOfferId).toBeNull();

    const homeOffer = pricing("robe", tiers([2, 3500, true]), { freeShippingDeliveryType: "home" });
    expect(apply([line("robe", 2)], [homeOffer], placeAll, "home").freeShippingOfferId).toBe(homeOffer.id);
    expect(apply([line("robe", 2)], [homeOffer], placeAll, "stop_desk").freeShippingOfferId).toBeNull();
  });
});

describe("Buy X Get Y offers", () => {
  it("fire at the trigger, not below, counting every variant", () => {
    const buy2 = offer({ triggerProductId: "p1" });
    expect(apply([line("p1", 1)], [buy2]).rewards).toEqual([]);
    expect(apply([line("p1", 2)], [buy2]).rewards.map((reward) => reward.offer.id)).toEqual([buy2.id]);
    expect(apply([line("p1", 1, { variantId: "a" }), line("p1", 1, { variantId: "b" })], [buy2]).rewards).toHaveLength(1);
  });

  it("count only the variant an offer is locked to", () => {
    const red2 = offer({ triggerProductId: "p1", triggerVariantId: "red" });
    expect(apply([line("p1", 1, { variantId: "red" }), line("p1", 1, { variantId: "blue" })], [red2]).rewards).toEqual([]);
    const reward = apply([line("p1", 1, { variantId: "blue" }), line("p1", 2, { variantId: "red" })], [red2]).rewards[0]!;
    expect(reward.line.variantId).toBe("red");
  });

  it("are given once per order, whatever the quantity", () => {
    const buy2 = offer({ triggerProductId: "p1" });
    expect(apply([line("p1", 8)], [buy2]).rewards).toHaveLength(1);
  });

  it("never borrow another product's quantity", () => {
    expect(apply([line("p1", 1), line("p2", 5)], [offer({ triggerProductId: "p1" })]).rewards).toEqual([]);
  });

  it("leave line prices alone, and name the offer on the lines they counted", () => {
    const buy2 = offer({ triggerProductId: "p1", triggerVariantId: "red" });
    expect(apply([line("p1", 2, { variantId: "red" }), line("p1", 1, { variantId: "blue" })], [buy2]).lines).toEqual([
      { lineTotal: 4000, offerId: buy2.id },
      { lineTotal: 2000, offerId: null },
    ]);
  });

  it("place their reward where the catalog says, and pass on what was placed before", () => {
    const seen: string[][] = [];
    const place: PlaceReward = (o, l, placed) => {
      seen.push(placed.map((reward) => reward.offer.id));
      return { productId: o.rewardProductId!, variantId: "gift-variant" };
    };
    const first = offer({ triggerProductId: "p1", rewardProductId: "g" });
    const second = offer({ triggerProductId: "p2", rewardProductId: "g" });
    const applied = apply([line("p1", 2), line("p2", 2)], [first, second], place);
    expect(applied.rewards.map((reward) => reward.placement)).toEqual([
      { productId: "g", variantId: "gift-variant" },
      { productId: "g", variantId: "gift-variant" },
    ]);
    expect(seen).toEqual([[], [first.id]]);
  });

  it("do not apply when the reward cannot be placed, and leave the product to its next offer", () => {
    const none: PlaceReward = () => null;
    const gift = offer({ triggerProductId: "p1", triggerQuantity: 3 });
    const shipping = offer({ triggerProductId: "p1", discountType: "free_shipping", rewardProductId: null, rewardQuantity: 0, triggerQuantity: 2 });
    expect(apply([line("p1", 3)], [gift], none)).toEqual({ lines: [{ lineTotal: 6000, offerId: null }], rewards: [], freeShippingOfferId: null });
    const fallen = apply([line("p1", 3, { offerId: gift.id })], [gift, shipping], none);
    expect(fallen).toMatchObject({ rewards: [], freeShippingOfferId: shipping.id, lines: [{ offerId: shipping.id }] });
  });
});

describe("free-shipping offers", () => {
  const free = (productId: string) => offer({ triggerProductId: productId, discountType: "free_shipping", rewardProductId: null, rewardQuantity: 0 });

  it("make delivery free for a basket of that product alone, in any variants", () => {
    const fs = free("p1");
    expect(apply([line("p1", 2)], [fs]).freeShippingOfferId).toBe(fs.id);
    expect(apply([line("p1", 2)], [fs], placeAll, "stop_desk").freeShippingOfferId).toBe(fs.id);
    expect(apply([line("p1", 1, { variantId: "a" }), line("p1", 1, { variantId: "b" })], [fs]).freeShippingOfferId).toBe(fs.id);
  });

  it("leave the store's rate standing for a delivery method the offer does not cover", () => {
    const homeOnly = offer({ triggerProductId: "p1", discountType: "free_shipping", rewardProductId: null, rewardQuantity: 0, freeShippingDeliveryType: "home" });
    expect(apply([line("p1", 2)], [homeOnly], placeAll, "home").freeShippingOfferId).toBe(homeOnly.id);
    expect(apply([line("p1", 2)], [homeOnly], placeAll, "stop_desk").freeShippingOfferId).toBeNull();

    const pickupOnly = offer({ triggerProductId: "p1", discountType: "free_shipping", rewardProductId: null, rewardQuantity: 0, freeShippingDeliveryType: "stop_desk" });
    expect(apply([line("p1", 2)], [pickupOnly], placeAll, "stop_desk").freeShippingOfferId).toBe(pickupOnly.id);
    expect(apply([line("p1", 2)], [pickupOnly], placeAll, "home").freeShippingOfferId).toBeNull();
  });

  it("do nothing — and are not reported, nor named on a line — once another product joins", () => {
    expect(apply([line("p1", 2), line("p2", 1)], [free("p1")])).toMatchObject({ freeShippingOfferId: null, lines: [{ offerId: null }, { offerId: null }] });
  });

  it("never shadow, in a mixed basket, an offer of the product that can apply", () => {
    const fs = offer({ triggerProductId: "p1", discountType: "free_shipping", rewardProductId: null, rewardQuantity: 0, triggerQuantity: 3 });
    const gift = offer({ triggerProductId: "p1", triggerQuantity: 2 });
    expect(apply([line("p1", 3), line("p2", 1)], [fs, gift]).rewards.map((reward) => reward.offer.id)).toEqual([gift.id]);
    expect(apply([line("p1", 3)], [fs, gift]).freeShippingOfferId).toBe(fs.id);
  });
});

describe("one offer per product", () => {
  it("takes the highest threshold reached, the same way every run", () => {
    const low = offer({ triggerProductId: "p1", triggerQuantity: 2 });
    const high = offer({ triggerProductId: "p1", triggerQuantity: 4 });
    expect(apply([line("p1", 4)], [low, high]).rewards.map((reward) => reward.offer.id)).toEqual([high.id]);
    expect(apply([line("p1", 3)], [low, high]).rewards.map((reward) => reward.offer.id)).toEqual([low.id]);
    const twin = offer({ triggerProductId: "p1", triggerQuantity: 2 });
    expect(apply([line("p1", 2)], [twin, low]).rewards[0]!.offer.id).toBe([twin.id, low.id].sort()[0]);
  });

  it("honours the shopper's choice only when it qualifies on its own", () => {
    const low = offer({ triggerProductId: "p1", triggerQuantity: 2 });
    const high = offer({ triggerProductId: "p1", triggerQuantity: 4 });
    expect(apply([line("p1", 4, { offerId: low.id })], [low, high]).rewards[0]!.offer.id).toBe(low.id);
    expect(apply([line("p1", 3, { offerId: high.id })], [low, high]).rewards[0]!.offer.id).toBe(low.id);
    expect(apply([line("p1", 3, { offerId: "nope" })], [low, high]).rewards[0]!.offer.id).toBe(low.id);
  });

  it("never gives quantity pricing and a gift to the same product", () => {
    const price = pricing("p1", tiers([2, 3000]));
    const gift = offer({ triggerProductId: "p1", triggerQuantity: 3 });
    const applied = apply([line("p1", 3)], [price, gift]);
    expect(applied.rewards.map((entry) => entry.offer.id)).toEqual([gift.id]);
    expect(applied.lines).toEqual([{ lineTotal: 6000, offerId: gift.id }]);
  });

  it("applies one offer to each of several products", () => {
    const applied = apply([line("p1", 2), line("p2", 2)], [offer({ triggerProductId: "p1" }), pricing("p2", tiers([2, 3000]))]);
    expect(applied.rewards).toHaveLength(1);
    expect(applied.lines.map((entry) => entry.lineTotal)).toEqual([4000, 3000]);
  });
});

describe("tiers", () => {
  it("are found by the highest quantity reached", () => {
    const list = tiers([3, 4500], [1, 2000], [2, 3500]);
    expect(tierFor(list, 0)).toBeNull();
    expect(tierFor(list, 2)?.price).toBe(3500);
    expect(tierFor(list, 9)?.quantity).toBe(3);
    expect(tieredTotal({ quantity: 3, price: 4000, freeShipping: false }, 4)).toBe(5333);
  });

  it("are refused empty, doubled, out of bounds or fractional", () => {
    expect(tiersProblem(tiers([1, 2000]))).toBeNull();
    expect(tiersProblem([])).toBe("empty");
    expect(tiersProblem(tiers([2, 1], [2, 3]))).toBe("duplicate_quantity");
    expect(tiersProblem(tiers([0, 100]))).toBe("invalid_tier");
    expect(tiersProblem(tiers([2, 10.5]))).toBe("invalid_tier");
    expect(tiersProblem(Array.from({ length: 11 }, (_, index) => ({ quantity: index + 1, price: 1, freeShipping: false })))).toBe("too_many_tiers");
  });
});

describe("properties", () => {
  const basket = fc.array(
    fc.record({
      productId: fc.constantFrom("p1", "p2", "p3"),
      variantId: fc.constantFrom(null, "a", "b"),
      quantity: fc.integer({ min: 1, max: 12 }),
      unitPrice: fc.integer({ min: 0, max: 9000 }),
    }),
    { minLength: 1, maxLength: 6 },
  );
  const candidates = [
    offer({ triggerProductId: "p1", triggerQuantity: 2 }),
    offer({ triggerProductId: "p1", triggerQuantity: 3, triggerVariantId: "a" }),
    pricing("p2", tiers([1, 1900], [3, 5000, true], [5, 7500])),
    pricing("p2", tiers([2, 3000]), { triggerVariantId: "b" }),
    offer({ triggerProductId: "p3", discountType: "free_shipping", rewardProductId: null, rewardQuantity: 0, triggerQuantity: 2 }),
  ];

  const pricingOffer = (id: string | null) => candidates.find((candidate) => candidate.id === id && candidate.discountType === "quantity_price");

  it("prices a quantity-priced product at exactly its tier's total, and leaves every other line at catalog", () => {
    fc.assert(
      fc.property(basket, (lines) => {
        const applied = apply(lines, candidates);
        for (const [index, entry] of applied.lines.entries()) {
          if (!pricingOffer(entry.offerId)) expect(entry.lineTotal).toBe(lines[index]!.unitPrice * lines[index]!.quantity);
          expect(Number.isInteger(entry.lineTotal) && entry.lineTotal >= 0).toBe(true);
        }
        for (const id of new Set(applied.lines.flatMap((entry) => (pricingOffer(entry.offerId) ? [entry.offerId!] : [])))) {
          const used = candidates.find((candidate) => candidate.id === id)!;
          const indexes = applied.lines.flatMap((entry, index) => (entry.offerId === id ? [index] : []));
          const units = indexes.reduce((sum, index) => sum + lines[index]!.quantity, 0);
          const sum = indexes.reduce((total, index) => total + applied.lines[index]!.lineTotal, 0);
          expect(sum).toBe(tieredTotal(tierFor(used.tiers, units)!, units));
        }
      }),
    );
  });

  it("gives each product one offer at most, and free delivery only to a single-product basket", () => {
    fc.assert(
      fc.property(basket, (lines) => {
        const applied = apply(lines, candidates);
        const byProduct = new Map<string, Set<string>>();
        for (const id of [...applied.rewards.map((reward) => reward.offer.id), ...applied.lines.flatMap((entry) => (entry.offerId ? [entry.offerId] : [])), ...(applied.freeShippingOfferId ? [applied.freeShippingOfferId] : [])]) {
          const productId = candidates.find((candidate) => candidate.id === id)!.triggerProductId;
          byProduct.set(productId, (byProduct.get(productId) ?? new Set()).add(id));
        }
        for (const ids of byProduct.values()) expect(ids.size).toBe(1);
        if (applied.freeShippingOfferId) expect(new Set(lines.map((entry) => entry.productId)).size).toBe(1);
      }),
    );
  });

  it("names on a line exactly the offer its product was given, and only on lines that offer counts", () => {
    fc.assert(
      fc.property(basket, (lines) => {
        const applied = apply(lines, candidates);
        const given = new Set([...applied.rewards.map((reward) => reward.offer.id), ...(applied.freeShippingOfferId ? [applied.freeShippingOfferId] : [])]);
        applied.lines.forEach((entry, index) => {
          if (entry.offerId === null) return;
          const named = candidates.find((candidate) => candidate.id === entry.offerId)!;
          expect(named.triggerProductId).toBe(lines[index]!.productId);
          if (named.triggerVariantId) expect(lines[index]!.variantId).toBe(named.triggerVariantId);
          if (named.discountType !== "quantity_price") expect(given.has(named.id)).toBe(true);
        });
      }),
    );
  });

  it("comes out the same for the same basket", () => {
    fc.assert(
      fc.property(basket, (lines) => {
        expect(apply(lines, candidates)).toEqual(apply(lines, candidates));
      }),
    );
  });
});
