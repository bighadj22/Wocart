/**
 * Where a reward goes, and when it cannot go anywhere — through
 * `priceCartLines`, pure over a snapshot. Loading the rows a reward needs is
 * proven against real D1 in cod-server's quantity-pricing order tests.
 */
import { describe, expect, it } from "vitest";
import type { CartLine } from "./cart";
import { priceCartLines, type CatalogOffer, type CatalogProduct, type CatalogSnapshot, type CatalogVariant } from "./catalog-snapshot";

const product = (id: string, extra: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id,
  name: id,
  price: 1000,
  sku: id,
  trackInventory: true,
  inventory: 10,
  status: "ACTIVE",
  visibility: true,
  showInStore: true,
  variantOptions: null,
  ...extra,
});

const variant = (id: string, productId: string, extra: Partial<CatalogVariant> = {}): CatalogVariant => ({
  id,
  productId,
  price: 1000,
  sku: id,
  inventory: 10,
  variations: JSON.stringify({ Taille: id }),
  active: true,
  position: 0,
  ...extra,
});

const gift = (id: string, extra: Partial<CatalogOffer> = {}): CatalogOffer => ({
  id,
  name: id,
  discountType: "free",
  triggerProductId: "robe",
  triggerVariantId: null,
  triggerQuantity: 1,
  rewardProductId: "sac",
  rewardVariantId: null,
  rewardQuantity: 1,
  tiers: [],
  freeShippingDeliveryType: null,
  ...extra,
});

const snapshot = (products: CatalogProduct[], variants: CatalogVariant[], offers: CatalogOffer[]): CatalogSnapshot => ({
  products: new Map(products.map((entry) => [entry.id, entry])),
  variants: new Map(variants.map((entry) => [entry.id, entry])),
  offers,
});

const line = (productId: string, quantity: number, variantId: string | null = null): CartLine => ({ productId, variantId, quantity, productName: productId, variantLabel: null });

const placements = (snap: CatalogSnapshot, lines: CartLine[]) => priceCartLines(snap, lines).rewards.map((reward) => ({ offer: reward.offer.id, ...reward.placement }));

describe("a reward's place", () => {
  it("is nowhere when the catalog has no such product, or no such variant: the offer does not apply", () => {
    expect(placements(snapshot([product("robe")], [], [gift("g")]), [line("robe", 1)])).toEqual([]);
    const missingVariant = snapshot([product("robe"), product("sac")], [], [gift("g", { rewardVariantId: "sac-x" })]);
    expect(placements(missingVariant, [line("robe", 1)])).toEqual([]);
    expect(priceCartLines(missingVariant, [line("robe", 1)]).priced[0]!.offerId).toBeNull();
  });

  it("mirrors the size ordered when the reward is the product ordered, and is the first active option otherwise", () => {
    const variants = [variant("robe-s", "robe", { position: 0 }), variant("robe-m", "robe", { position: 1 })];
    const same = snapshot([product("robe")], variants, [gift("g", { rewardProductId: "robe" })]);
    expect(placements(same, [line("robe", 1, "robe-m")])).toEqual([{ offer: "g", productId: "robe", variantId: "robe-m" }]);

    const bags = [variant("sac-old", "sac", { position: 0, active: false }), variant("sac-noir", "sac", { position: 1 }), variant("sac-rouge", "sac", { position: 2 })];
    const other = snapshot([product("robe"), product("sac")], [...variants, ...bags], [gift("g")]);
    expect(placements(other, [line("robe", 1, "robe-s")])).toEqual([{ offer: "g", productId: "sac", variantId: "sac-noir" }]);
  });

  it("needs stock once the paid units of the same item are counted — that size's only, when it is a size", () => {
    const variants = [variant("robe-s", "robe", { inventory: 5 }), variant("robe-m", "robe", { inventory: 1 })];
    const sizeM = snapshot([product("robe")], variants, [gift("g", { rewardProductId: "robe", rewardVariantId: "robe-m" })]);
    expect(placements(sizeM, [line("robe", 5, "robe-s")])).toEqual([{ offer: "g", productId: "robe", variantId: "robe-m" }]);
    expect(placements(sizeM, [line("robe", 1, "robe-m")])).toEqual([]);

    const whole = snapshot([product("robe", { inventory: 3 })], [], [gift("g", { rewardProductId: "robe" })]);
    expect(placements(whole, [line("robe", 2)])).toEqual([{ offer: "g", productId: "robe", variantId: null }]);
    expect(placements(whole, [line("robe", 3)])).toEqual([]);
  });

  it("counts the rewards placed before it: the stock goes to the first", () => {
    const products = [product("robe"), product("bague"), product("sac", { inventory: 1 })];
    const offers = [gift("g1"), gift("g2", { triggerProductId: "bague" })];
    expect(placements(snapshot(products, [], offers), [line("robe", 1), line("bague", 1)])).toEqual([{ offer: "g1", productId: "sac", variantId: null }]);
    const plenty = [product("robe"), product("bague"), product("sac", { inventory: 2 })];
    expect(placements(snapshot(plenty, [], offers), [line("robe", 1), line("bague", 1)])).toHaveLength(2);
  });

  it("needs no stock when the product is not tracked", () => {
    const untracked = snapshot([product("robe"), product("sac", { trackInventory: false, inventory: 0 })], [], [gift("g")]);
    expect(placements(untracked, [line("robe", 1)])).toEqual([{ offer: "g", productId: "sac", variantId: null }]);
  });
});
