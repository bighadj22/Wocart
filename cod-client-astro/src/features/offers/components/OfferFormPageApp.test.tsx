// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  getOffer: vi.fn(),
  listProducts: vi.fn(),
  createOffer: vi.fn(),
  updateOffer: vi.fn(),
}));

vi.mock("@/features/auth/components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
  useIdentity: () => ({ role: "admin", scopes: ["offers:read", "offers:manage"], user: { id: "u-0", email: "owner@shop.dz" } }),
  canScope: () => true,
}));
vi.mock("@/features/offers/api", () => seam);
vi.mock("@/features/products/api", () => ({ listProducts: seam.listProducts }));
vi.mock("@/lib/notify", () => ({ notify: { flashSuccess: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/translations/components/TranslationsCard", () => ({
  TranslationsCard: () => null,
}));

import OfferFormPageApp from "./OfferFormPageApp";
import type { Offer } from "@/features/offers/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const offer: Offer = {
  id: "offer/1",
  name: "Free delivery",
  status: "active",
  state: "live",
  triggerQuantity: 2,
  rewardQuantity: 0,
  discountType: "free_shipping",
  tiers: [],
  startsAt: null,
  endsAt: null,
  createdAt: "2026-11-24T08:00:00.000Z",
  updatedAt: "2026-11-24T08:00:00.000Z",
  triggerProduct: null,
  triggerVariant: null,
  rewardProduct: null,
  rewardVariant: null,
  freeShippingDeliveryType: "home",
};

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of Object.values(seam)) fn.mockReset();
  seam.getOffer.mockResolvedValue(offer);
  seam.listProducts.mockResolvedValue({ data: [] });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("editing a free-shipping offer", () => {
  it("shows both icon choices for home delivery and pickup point", async () => {
    await act(async () => root.render(<OfferFormPageApp offerId="offer/1" />));
    await act(async () => { await Promise.resolve(); });

    const choices = [...host.querySelectorAll<HTMLInputElement>('input[name="eligibleDeliveryMethods"]')];
    expect(choices.map((input) => input.value)).toEqual(["home", "stop_desk"]);
    expect(choices.map((input) => input.closest("label")?.textContent?.trim())).toEqual([
      "🏠 Home Delivery",
      "📍 Pickup Point / Stop Desk",
    ]);
    expect(choices.find((input) => input.value === "home")?.checked).toBe(true);
    expect(choices.find((input) => input.value === "stop_desk")?.checked).toBe(false);
  });
});
