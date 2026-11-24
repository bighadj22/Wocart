import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-24T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const OFFER_COLUMNS = "id, name, trigger_product_id, trigger_quantity, reward_quantity, discount_type, status, created_at, updated_at";
const TIER_COLUMNS = "offer_id, quantity, price, free_shipping";
let offersBefore: Array<Record<string, unknown>>;
let tiersBefore: Array<Record<string, unknown>>;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0092_offer_free_shipping_delivery_type.sql" });
  await d1.raw.batch(
    [
      `INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 2000, '${T}', '${T}')`,
      `INSERT INTO offers (${OFFER_COLUMNS}) VALUES ('o1', 'Existing offer', 'p1', 2, 0, 'free_shipping', 'active', '${T}', '${T}')`,
      `INSERT INTO offer_price_tiers (${TIER_COLUMNS}) VALUES ('o1', 1, 2000, 1)`,
    ].map((sql) => d1.raw.prepare(sql)),
  );
  offersBefore = await all(`SELECT ${OFFER_COLUMNS} FROM offers ORDER BY id`);
  tiersBefore = await all(`SELECT ${TIER_COLUMNS} FROM offer_price_tiers ORDER BY offer_id, quantity`);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0092", () => {
  it("keeps every existing offer and tier, with the new setting null", async () => {
    expect(await all(`SELECT ${OFFER_COLUMNS} FROM offers ORDER BY id`)).toEqual(offersBefore);
    expect(await all(`SELECT ${TIER_COLUMNS} FROM offer_price_tiers ORDER BY offer_id, quantity`)).toEqual(tiersBefore);
    expect(await all("SELECT id, free_shipping_delivery_type FROM offers ORDER BY id")).toEqual([{ id: "o1", free_shipping_delivery_type: null }]);
    expect(await all("SELECT offer_id, quantity, free_shipping_delivery_type FROM offer_price_tiers ORDER BY offer_id, quantity")).toEqual([
      { offer_id: "o1", quantity: 1, free_shipping_delivery_type: null },
    ]);
  });

  it("stores one eligible delivery method per offer and tier", async () => {
    await d1.raw.prepare("UPDATE offers SET free_shipping_delivery_type = 'stop_desk' WHERE id = 'o1'").run();
    await d1.raw.prepare("UPDATE offer_price_tiers SET free_shipping_delivery_type = 'home' WHERE offer_id = 'o1'").run();
    expect(await all("SELECT free_shipping_delivery_type AS setting FROM offers WHERE id = 'o1'")).toEqual([{ setting: "stop_desk" }]);
    expect(await all("SELECT free_shipping_delivery_type AS setting FROM offer_price_tiers WHERE offer_id = 'o1'")).toEqual([{ setting: "home" }]);
  });
});
