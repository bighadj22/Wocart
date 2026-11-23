/**
 * buildToolsForUser — the scope gate. These tests are the canonical proof
 * that a user can ONLY see tools their OAuth scopes authorise.
 *
 * Strategy:
 *   • Mock EVERY ai-tools factory to return distinct, named stubs so
 *     we can assert on tool-name sets directly without DB access.
 *   • Build a few representative sessions (admin, scoped-staff, empty-scope)
 *     and snapshot the tool-name set each one sees.
 *   • Golden tests — if the scope mapping ever drifts, these fail loudly.
 */

import { describe, it, expect, vi } from "vitest";
import type { Tool } from "ai";

// Stubs that are cheap to create and identifiable by name.
const stubTool = (name: string): Tool => ({
  description: name,
  inputSchema: { shape: {} } as unknown as Tool["inputSchema"],
  execute: async () => ({ success: true, name }),
}) as unknown as Tool;

const toolMap = (...names: string[]): Record<string, Tool> =>
  Object.fromEntries(names.map((n) => [n, stubTool(n)]));

// Mock every ai-tools factory BEFORE the registry imports them.
vi.mock("@/endpoints/customers/ai-tools", () => ({
  getCustomerTools: () => toolMap(
    "listCustomers",
    "getCustomerDetails",
    "findCustomerByPhone",
    "createNewCustomer",
    "updateCustomerProfile",
    "getCustomerOrderHistory",
  "getLandingPageDetails",
    "getCustomerMemberships",
    "deleteCustomer",
  ),
}));

vi.mock("@/endpoints/drivers/ai-tools", () => ({
  getDriverTools: () => toolMap(
    "listDrivers",
    "getDriverDetails",
    "createNewDriver",
    "updateDriverProfile",
    "updateDriverStatus",
    "deleteDriver",
  "deleteLandingPage",
  ),
}));

vi.mock("@/endpoints/driver-payments/ai-tools", () => ({
  getDriverPaymentTools: () => toolMap(
    "listDriverPayments",
  "listLandingPages",
    "getPendingSettlements",
    "createDriverSettlement",
  "createLandingPage",
  ),
}));

vi.mock("@/endpoints/products/ai-tools", () => ({
  getProductTools: () => toolMap(
    "listProducts",
    "getProductDetails",
    "createNewProduct",
    "updateProductDetails",
    "updateProductStatus",
    "deleteProduct",
  ),
}));

vi.mock("@/endpoints/product-groups/ai-tools", () => ({
  getProductGroupTools: () => toolMap(
    "listProductGroups",
    "getProductGroupDetails",
    "createProductGroup",
    "updateProductGroup",
    "deleteProductGroup",
    "addCustomerToGroup",
    "removeCustomerFromGroup",
  ),
}));

vi.mock("@/endpoints/offers/ai-tools", () => ({
  getOfferTools: () => toolMap(
    "listOffers",
    "getOfferDetails",
    "createOffer",
    "updateOffer",
    "deleteOffer",
  ),
}));

vi.mock("@/endpoints/coupons/ai-tools", () => ({
  getCouponTools: () => toolMap(
    "listCoupons",
    "getCouponDetails",
    "createCoupon",
    "updateCoupon",
    "deleteCoupon",
  ),
}));

vi.mock("@/endpoints/landing-pages/ai-tools", () => ({
  getLandingPageTools: vi.fn(() =>
    toolMap(
      "listLandingPages",
      "getLandingPageDetails",
      "archiveLandingPage",
      "createLandingPage",
      "deleteLandingPage",
      "duplicateLandingPage",
      "publishLandingPage",
      "removeLandingPageImage",
      "reorderLandingPageImages",
      "unpublishLandingPage",
      "updateLandingPage",
      "uploadLandingPageImage",
    ),
  ),
}));

vi.mock("@/endpoints/variants/ai-tools", () => ({
  getVariantTools: () => toolMap(
    "listProductVariants",
    "getVariantDetails",
    "createProductVariant",
    "updateVariant",
    "deleteProductVariant",
  ),
}));

vi.mock("@/endpoints/wilayas/ai-tools", () => ({
  getWilayaTools: () => toolMap(
    "listWilayas",
    "listWilayaCommunes",
  ),
}));

vi.mock("@/endpoints/stock/ai-tools", () => ({
  getStockTools: () => toolMap(
    "getStockOverview",
    "getStockAlerts",
    "getProductStockHistory",
    "adjustProductStock",
    "adjustVariantStock",
    "updateProductStockThreshold",
    "updateVariantStockThreshold",
  ),
}));

vi.mock("@/endpoints/shipping-profiles/ai-tools", () => ({
  getShippingProfileTools: () => toolMap(
    "listShippingProfiles",
    "getShippingProfile",
    "getDefaultShippingRules",
    "listCommuneOverrides",
    "createShippingProfile",
    "updateShippingProfile",
    "deleteShippingProfile",
    "setShippingProfileRules",
    "setShippingCommuneOverride",
    "resetShippingCommuneOverride",
  ),
}));

vi.mock("@/endpoints/reviews/ai-tools", () => ({
  getReviewTools: () => toolMap(
    "listReviews",
    "moderateReview",
    "deleteReview",
  ),
}));

vi.mock("@/endpoints/customer-groups/ai-tools", () => ({
  getCustomerGroupTools: () => toolMap(
    "listCustomerGroups",
    "getCustomerGroupDetails",
    "createCustomerGroup",
    "updateCustomerGroup",
    "deleteCustomerGroup",
    "addCustomerToGroup",
    "removeCustomerFromGroup",
  ),
}));

vi.mock("@/endpoints/customer-tags/ai-tools", () => ({
  getCustomerTagTools: () => toolMap(
    "listCustomerTags",
    "getCustomerTagDetails",
    "createCustomerTag",
    "updateCustomerTag",
    "deleteCustomerTag",
    "assignTagToCustomer",
    "unassignTagFromCustomer",
  ),
}));

vi.mock("@/endpoints/orders/ai-tools", () => ({
  getOrderTools: () => toolMap(
    "listOrders",
    "getOrderDetails",
    "createOrder",
    "updateOrderStatus",
    "recordOrderProductReturn",
    "deleteOrder",
  ),
}));

vi.mock("@/endpoints/shipments/ai-tools", () => ({
  getShipmentTools: () => toolMap("getShipment", "handOffOrderToCarrier", "handOffOrderToDriver", "reportShipmentEvent"),
}));

vi.mock("@/endpoints/delivery-companies/ai-tools", () => ({
  getDeliveryCompanyTools: () => toolMap("listDeliveryCompanies"),
}));

vi.mock("@/endpoints/translations/ai-tools", () => ({
  getTranslationTools: () => toolMap(
    "getProductTranslations",
    "updateProductTranslations",
    "getProductGroupTranslations",
    "updateProductGroupTranslations",
    "getOfferTranslations",
    "updateOfferTranslations",
  ),
}));

// getDb is called by buildToolsForUser but the stub factories ignore it.
vi.mock("@/db", () => ({
  getDb: () => ({} as never),
}));

import { buildToolsForUser } from "./registry";
import { getLandingPageTools } from "@/endpoints/landing-pages/ai-tools";
import { SCOPES } from "../../../cod-shared/rbac/scopes";
import type { McpProps } from "./props";
import type { Env } from "@/types/env";

const env = {} as Env;

function makeProps(overrides: Partial<McpProps>): McpProps {
  return {
    userId: "u",
    role: "staff",
    scopes: [],
    name: "",
    email: "",
    ...overrides,
  };
}

function names(props: McpProps): string[] {
  return Object.keys(buildToolsForUser(env, props)).sort();
}

// The full union of every tool in TOOL_REGISTRY, alpha-sorted.
const ALL_TOOLS = [
  "addCustomerToGroup",
  "adjustProductStock",
  "adjustVariantStock",
  "archiveLandingPage",
  "assignTagToCustomer",
  "createCoupon",
  "createCustomerGroup",
  "createCustomerTag",
  "createDriverSettlement",
  "createLandingPage",
  "createNewCustomer",
  "createNewDriver",
  "createNewProduct",
  "createOffer",
  "createOrder",
  "createProductGroup",
  "createProductVariant",
  "createShippingProfile",
  "deleteCoupon",
  "deleteCustomer",
  "deleteCustomerGroup",
  "deleteCustomerTag",
  "deleteDriver",
  "deleteLandingPage",
  "deleteOffer",
  "deleteOrder",
  "deleteProduct",
  "deleteProductGroup",
  "deleteProductVariant",
  "deleteReview",
  "deleteShippingProfile",
  "duplicateLandingPage",
  "findCustomerByPhone",
  "getCouponDetails",
  "getCustomerDetails",
  "getCustomerGroupDetails",
  "getCustomerMemberships",
  "getCustomerOrderHistory",
  "getCustomerTagDetails",
  "getDefaultShippingRules",
  "getDriverDetails",
  "getLandingPageDetails",
  "getOfferDetails",
  "getOfferTranslations",
  "getOrderDetails",
  "getPendingSettlements",
  "getProductDetails",
  "getProductGroupDetails",
  "getProductGroupTranslations",
  "getProductStockHistory",
  "getProductTranslations",
  "getShipment",
  "getShippingProfile",
  "getStockAlerts",
  "getStockOverview",
  "getVariantDetails",
  "handOffOrderToCarrier",
  "handOffOrderToDriver",
  "listBusinessEvents",
  "listCommuneOverrides",
  "listCoupons",
  "listCustomerGroups",
  "listCustomerTags",
  "listCustomers",
  "listDeliveryCompanies",
  "listDriverPayments",
  "listDrivers",
  "listEventConsumers",
  "listEventDeliveries",
  "listLandingPages",
  "listOffers",
  "listOrders",
  "listProductGroups",
  "listProductVariants",
  "listProducts",
  "listReviews",
  "listShippingProfiles",
  "listWilayaCommunes",
  "listWilayas",
  "moderateReview",
  "publishLandingPage",
  "recordOrderProductReturn",
  "removeCustomerFromGroup",
  "removeLandingPageImage",
  "reorderLandingPageImages",
  "reportShipmentEvent",
  "resetShippingCommuneOverride",
  "setShippingCommuneOverride",
  "setShippingProfileRules",
  "unassignTagFromCustomer",
  "unpublishLandingPage",
  "updateCoupon",
  "updateCustomerGroup",
  "updateCustomerProfile",
  "updateCustomerTag",
  "updateDriverProfile",
  "updateDriverStatus",
  "updateLandingPage",
  "updateOffer",
  "updateOfferTranslations",
  "updateOrderStatus",
  "updateProductDetails",
  "updateProductGroup",
  "updateProductGroupTranslations",
  "updateProductStatus",
  "updateProductStockThreshold",
  "updateProductTranslations",
  "updateShippingProfile",
  "updateVariant",
  "updateVariantStockThreshold",
  "uploadLandingPageImage",
];

describe("buildToolsForUser — scope gating", () => {
  it("admin sees every registered tool (bypasses scope checks)", () => {
    expect(names(makeProps({ role: "admin" }))).toEqual(ALL_TOOLS);
  });

  it("COUPONS_READ alone → the coupon read tools; COUPONS_MANAGE adds the writes", () => {
    expect(names(makeProps({ scopes: [SCOPES.COUPONS_READ] }))).toEqual(["getCouponDetails", "listCoupons"]);
    expect(names(makeProps({ scopes: [SCOPES.COUPONS_MANAGE] }))).toEqual(["createCoupon", "deleteCoupon", "updateCoupon"]);
  });

  it("empty-scope staff sees zero tools", () => {
    expect(names(makeProps({ scopes: [] }))).toEqual([]);
  });

  it("CUSTOMERS_READ alone → read-tier customer + wilaya tools", () => {
    expect(names(makeProps({ scopes: [SCOPES.CUSTOMERS_READ] }))).toEqual([
      "findCustomerByPhone",
      "getCustomerDetails",
      "getCustomerMemberships",
      "getCustomerOrderHistory",
      "listCustomers",
      "listWilayaCommunes",
      "listWilayas",
    ]);
  });

  it("CUSTOMERS_READ + CUSTOMERS_CREATE stacks properly", () => {
    expect(names(makeProps({ scopes: [SCOPES.CUSTOMERS_READ, SCOPES.CUSTOMERS_CREATE] }))).toEqual([
      "createNewCustomer",
      "findCustomerByPhone",
      "getCustomerDetails",
      "getCustomerMemberships",
      "getCustomerOrderHistory",
      "listCustomers",
      "listWilayaCommunes",
      "listWilayas",
    ]);
  });

  it("DELIVERY_READ + DELIVERY_UPDATE grants driver/shipping/wilaya tools + payment reads", () => {
    expect(names(makeProps({ scopes: [SCOPES.DELIVERY_READ, SCOPES.DELIVERY_UPDATE] }))).toEqual([
      "getDefaultShippingRules",
      "getDriverDetails",
      "getPendingSettlements",
      "getShippingProfile",
      "listCommuneOverrides",
      "listDeliveryCompanies",
      "listDriverPayments",
      "listDrivers",
      "listShippingProfiles",
      "listWilayaCommunes",
      "listWilayas",
      "updateDriverProfile",
      "updateDriverStatus",
    ]);
  });

  it("DELIVERY_MANAGE grants the payment write + shipping-write suite", () => {
    expect(names(makeProps({ scopes: [SCOPES.DELIVERY_MANAGE] }))).toEqual([
      "createDriverSettlement",
      "createShippingProfile",
      "deleteShippingProfile",
      "resetShippingCommuneOverride",
      "setShippingCommuneOverride",
      "setShippingProfileRules",
      "updateShippingProfile",
    ]);
  });

  it("a shipment's tools follow its kind: a carrier's is dispatch work, a driver's assignment work", () => {
    expect(names(makeProps({ scopes: [SCOPES.DELIVERY_DISPATCH] }))).toEqual(["handOffOrderToCarrier", "reportShipmentEvent"]);
    expect(names(makeProps({ scopes: [SCOPES.ORDERS_ASSIGN] }))).toEqual(["handOffOrderToDriver", "reportShipmentEvent"]);
    expect(names(makeProps({ scopes: [SCOPES.ORDERS_READ] }))).toContain("getShipment");
  });

  it("the Event Log is read with orders; who receives it, with its owner's permission", () => {
    expect(names(makeProps({ scopes: [SCOPES.ORDERS_READ] }))).toContain("listBusinessEvents");
    expect(names(makeProps({ scopes: [SCOPES.ORDERS_READ] }))).not.toContain("listEventDeliveries");
    expect(names(makeProps({ scopes: [SCOPES.INTEGRATIONS_READ] }))).toEqual(["listEventConsumers", "listEventDeliveries"]);
    expect(names(makeProps({ scopes: [SCOPES.META_READ] }))).toEqual(["listEventConsumers", "listEventDeliveries"]);
  });

  it("wildcard '*' in scopes acts like admin (matches hasPermission semantics)", () => {
    const tools = names(makeProps({ scopes: ["*"] }));
    // Should include at least one tool from every domain
    expect(tools).toContain("listCustomers");
    expect(tools).toContain("listDrivers");
    expect(tools).toContain("listDriverPayments");
    expect(tools).toContain("deleteCustomer");
  });

  it("LANDING_PAGES_MANAGE grants the full landing-page write suite incl. image upload", () => {
    expect(names(makeProps({ scopes: [SCOPES.LANDING_PAGES_MANAGE] }))).toEqual([
      "archiveLandingPage",
      "createLandingPage",
      "deleteLandingPage",
      "duplicateLandingPage",
      "publishLandingPage",
      "removeLandingPageImage",
      "reorderLandingPageImages",
      "unpublishLandingPage",
      "updateLandingPage",
      "uploadLandingPageImage",
    ]);
  });

  it("passes (env, props) through to factory build calls — identity and bindings reach tool domains", () => {
    const props = makeProps({ scopes: [SCOPES.LANDING_PAGES_MANAGE] });
    buildToolsForUser(env, props);

    expect(vi.mocked(getLandingPageTools)).toHaveBeenCalledWith(
      expect.anything(),
      env,
      props,
    );
  });

  it("gates translation tools by each resource's own read and manage scopes", () => {
    expect(names(makeProps({ scopes: [SCOPES.PRODUCTS_READ] }))).toContain("getProductTranslations");
    expect(names(makeProps({ scopes: [SCOPES.PRODUCTS_READ] }))).not.toContain("updateProductTranslations");
    expect(names(makeProps({ scopes: [SCOPES.PRODUCTS_MANAGE] }))).toContain("updateProductTranslations");
    expect(names(makeProps({ scopes: [SCOPES.PRODUCTS_MANAGE] }))).not.toContain("updateProductGroupTranslations");
    expect(names(makeProps({ scopes: [SCOPES.PRODUCT_GROUPS_READ] }))).toEqual([
      "getProductGroupDetails",
      "getProductGroupTranslations",
      "listProductGroups",
    ]);
    expect(names(makeProps({ scopes: [SCOPES.PRODUCT_GROUPS_MANAGE] }))).toEqual([
      "createProductGroup",
      "deleteProductGroup",
      "updateProductGroup",
      "updateProductGroupTranslations",
    ]);
    expect(names(makeProps({ scopes: [SCOPES.OFFERS_READ] }))).toEqual([
      "getOfferDetails",
      "getOfferTranslations",
      "listOffers",
    ]);
    expect(names(makeProps({ scopes: [SCOPES.OFFERS_MANAGE] }))).toEqual([
      "createOffer",
      "deleteOffer",
      "updateOffer",
      "updateOfferTranslations",
    ]);
  });
});