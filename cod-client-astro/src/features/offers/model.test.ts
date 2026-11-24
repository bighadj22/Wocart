import { describe, expect, it } from "vitest";
import {
  deliveryTypeFor,
  eligibleDeliveryMethodsOf,
  filterOffers,
  offerErrorMessage,
  offerRuleLabel,
  offerScheduleLabel,
  paginateOffers,
  parseOfferRoute,
  sortOffers,
} from "./model";
import type { Offer } from "./types";
import { formatMoney } from "@/features/orders/model";

const offer = (overrides: Partial<Offer> = {}): Offer => ({
  id: "offer-1",
  name: "Buy 2 Get 1",
  status: "active",
  state: "live",
  triggerQuantity: 2,
  rewardQuantity: 1,
  discountType: "free",
  tiers: [],
  startsAt: null,
  endsAt: null,
  freeShippingDeliveryType: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  triggerProduct: { id: "prod-1", name: "Chips", handle: "chips" },
  triggerVariant: null,
  rewardProduct: { id: "prod-2", name: "Soda", handle: "soda" },
  rewardVariant: null,
  ...overrides,
});

const t = (key: string) => key;

describe("offers model", () => {
  it("filters by query, state, and discount type", () => {
    const rows = [
      offer(),
      offer({ id: "2", name: "Free Ship", status: "inactive", state: "inactive", discountType: "free_shipping", triggerProduct: { id: "prod-3", name: "Snacks", handle: "snacks" } }),
      offer({ id: "3", name: "Later", state: "scheduled" }),
    ];
    expect(filterOffers(rows, { query: "chips", state: "all", type: "all" }).map((item) => item.id)).toEqual(["offer-1", "3"]);
    expect(filterOffers(rows, { query: "", state: "inactive", type: "all" }).map((item) => item.id)).toEqual(["2"]);
    expect(filterOffers(rows, { query: "", state: "scheduled", type: "all" }).map((item) => item.id)).toEqual(["3"]);
    expect(filterOffers(rows, { query: "", state: "all", type: "free_shipping" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("sorts and paginates offer collections", () => {
    const rows = [offer({ id: "1", name: "Zed" }), offer({ id: "2", name: "Amel" }), offer({ id: "3", name: "Meriem" })];
    expect(sortOffers(rows, "name", "asc").map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(paginateOffers(rows, 2, 2).map((item) => item.id)).toEqual(["3"]);
  });

  it("builds rule and schedule labels", () => {
    expect(offerRuleLabel(offer(), t, "en")).toBe("buy_x_get_y");
    expect(offerRuleLabel(offer({ discountType: "free_shipping", triggerQuantity: 3 }), t, "en")).toBe("buy_x_free_shipping");
    expect(offerScheduleLabel(offer(), "en", t)).toBeNull();
    expect(offerScheduleLabel(offer({ startsAt: "2026-08-26T00:00:00.000Z" }), "en", t)).toBe("schedule_from");
    expect(offerScheduleLabel(offer({ endsAt: "2026-08-30T00:00:00.000Z" }), "en", t)).toBe("schedule_until");
    expect(offerScheduleLabel(offer({ startsAt: "2026-08-26T00:00:00.000Z", endsAt: "2026-08-30T00:00:00.000Z" }), "en", t)).toBe("schedule_range");
  });

});

import { offerBody } from "./model";
import type { OfferFormValues } from "./types";

const FORM: OfferFormValues = {
  name: " Buy 2 ",
  discountType: "free",
  triggerProductId: "p1",
  triggerVariantId: "",
  triggerQuantity: "2",
  rewardProductId: "p2",
  rewardVariantId: "",
  rewardQuantity: "1",
  tiers: [{ quantity: "1", price: "", freeShipping: false, eligibleDeliveryMethods: ["home", "stop_desk"] }],
  startsAt: "",
  endsAt: "",
  status: "active",
  eligibleDeliveryMethods: ["home", "stop_desk"],
};

describe("eligible delivery methods", () => {
  it("maps both, one or none of the methods to the stored setting", () => {
    expect(deliveryTypeFor(["home", "stop_desk"])).toBeNull();
    expect(deliveryTypeFor(["stop_desk", "home"])).toBeNull();
    expect(deliveryTypeFor(["home"])).toBe("home");
    expect(deliveryTypeFor(["stop_desk"])).toBe("stop_desk");
    expect(deliveryTypeFor([])).toBeNull();
  });

  it("reads a stored setting back as the merchant's selection", () => {
    expect(eligibleDeliveryMethodsOf(null)).toEqual(["home", "stop_desk"]);
    expect(eligibleDeliveryMethodsOf("home")).toEqual(["home"]);
    expect(eligibleDeliveryMethodsOf("stop_desk")).toEqual(["stop_desk"]);
  });

  it("sends the selected delivery method with a free-shipping offer", () => {
    expect(offerBody({ ...FORM, discountType: "free_shipping", eligibleDeliveryMethods: ["stop_desk"] }, true).freeShippingDeliveryType).toBe("stop_desk");
    expect(offerBody({ ...FORM, discountType: "free_shipping", eligibleDeliveryMethods: ["home", "stop_desk"] }, true).freeShippingDeliveryType).toBeNull();
  });
});

describe("offer body: a cleared field is sent as null when editing", () => {
  it("clears an emptied start date, end date and variants when editing", () => {
    const body = offerBody(FORM, true);
    expect(body.startsAt).toBeNull();
    expect(body.endsAt).toBeNull();
    expect(body.triggerVariantId).toBeNull();
    expect(body.rewardVariantId).toBeNull();
  });

  it("leaves them out when creating", () => {
    const body = offerBody(FORM, false);
    expect(body.endsAt).toBeUndefined();
    expect(body.triggerVariantId).toBeUndefined();
  });

  it("keeps a filled end date as an ISO string", () => {
    expect(offerBody({ ...FORM, endsAt: "2030-01-01T10:00" }, true).endsAt).toMatch(/^2030-01-01T/);
  });

  it("clears the reward product when an offer becomes free shipping", () => {
    const body = offerBody({ ...FORM, discountType: "free_shipping", rewardVariantId: "v9" }, true);
    expect(body.rewardProductId).toBeNull();
    expect(body.rewardVariantId).toBeNull();
    expect(body.rewardQuantity).toBe(0);
  });

  it("trims the name", () => {
    expect(offerBody(FORM, true).name).toBe("Buy 2");
  });
});

import { formTiersProblem, tierSaving } from "./model";
import { toLocalInput } from "@/lib/datetime-local";

describe("quantity pricing in the form", () => {
  const pricing: OfferFormValues = {
    ...FORM,
    discountType: "quantity_price",
    tiers: [
      { quantity: "1", price: "2000", freeShipping: false, eligibleDeliveryMethods: ["home", "stop_desk"] },
      { quantity: "2", price: "3500", freeShipping: true, eligibleDeliveryMethods: ["home", "stop_desk"] },
    ],
  };

  it("sends the tiers, and no threshold or reward", () => {
    const body = offerBody(pricing, false);
    expect(body.tiers).toEqual([
      { quantity: 1, price: 2000, freeShipping: false, freeShippingDeliveryType: null },
      { quantity: 2, price: 3500, freeShipping: true, freeShippingDeliveryType: null },
    ]);
    expect(body).not.toHaveProperty("triggerQuantity");
    expect(body.rewardProductId).toBeUndefined();
    expect(body.rewardQuantity).toBe(0);
  });

  it("judges the tiers by the platform's own rule", () => {
    expect(formTiersProblem(pricing)).toBeNull();
    expect(formTiersProblem({ tiers: [{ quantity: "2", price: "", freeShipping: false, eligibleDeliveryMethods: [] }, { quantity: "2", price: "1", freeShipping: false, eligibleDeliveryMethods: [] }] })).toBe("duplicate_quantity");
    expect(formTiersProblem({ tiers: [{ quantity: "1.5", price: "100", freeShipping: false, eligibleDeliveryMethods: [] }] })).toBe("invalid_tier");
    expect(formTiersProblem({ tiers: [] })).toBe("empty");
  });

  it("shows what one unit costs in a tier and what it saves", () => {
    expect(tierSaving({ quantity: 2, price: 3500, freeShipping: false }, 2000)).toEqual({ perUnit: 1750, saved: 500 });
    expect(tierSaving({ quantity: 1, price: 2500, freeShipping: false }, 2000)).toEqual({ perUnit: 2500, saved: 0 });
  });

  it("names tiers in the list, and says why a write was refused", () => {
    expect(offerRuleLabel({ discountType: "quantity_price", triggerQuantity: 1, rewardQuantity: 0, tiers: [{ quantity: 2, price: 3500, freeShipping: false }] }, t, "en")).toBe("tier_rule");
    expect(offerErrorMessage({ code: "OFFER_CONFLICT", context: { offerId: "o1", offerName: "Packs" } }, t)).toBe("error_conflict");
    expect(offerErrorMessage({ code: "INVALID_OFFER", context: { reason: "empty" } }, t)).toBe("error_invalid.empty");
  });
});

describe("what the offer copy carries", () => {
  const said = (key: string, values?: Record<string, unknown>) => `${key} ${JSON.stringify(values ?? {})}`;

  it("prices a tier like every other amount in the dashboard", () => {
    const label = offerRuleLabel({ discountType: "quantity_price", triggerQuantity: 1, rewardQuantity: 0, tiers: [{ quantity: 2, price: 3500, freeShipping: false }] }, said, "en");
    expect(label).toBe(`tier_rule ${JSON.stringify({ quantity: 2, price: formatMoney(3500, "en") })}`);
  });

  it("names the live offer a write conflicts with", () => {
    expect(offerErrorMessage({ code: "OFFER_CONFLICT", context: { offerId: "o1", offerName: "Packs" } }, said)).toBe(`error_conflict ${JSON.stringify({ name: "Packs" })}`);
  });
});

describe("the schedule as the merchant's clock shows it", () => {
  it("round-trips an instant without moving it by the time zone", () => {
    for (const iso of ["2026-03-01T10:00:00.000Z", "2026-07-15T23:30:00.000Z"]) {
      expect(new Date(toLocalInput(iso)).toISOString()).toBe(iso);
      expect(offerBody({ ...FORM, startsAt: toLocalInput(iso) }, true).startsAt).toBe(iso);
    }
    expect(toLocalInput(null)).toBe("");
  });
});
