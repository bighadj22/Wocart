import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey, foreignKey, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { MENU_DESTINATION_TYPES } from "../navigation/menus";
import { OFFER_KINDS } from "../offers/model";
import { HANDOFF_STATES, SETTLEMENT_COMPONENTS, SHIPMENT_EVENT_SOURCES, SHIPMENT_KINDS } from "../shipments/model";
import { INTERPRETATION_KIND_VALUES, MILESTONES } from "../shipments/interpretation";
import { CARRIER_PROVIDERS } from "../carriers/providers";
import { REVIEW_AUTO_PUBLISH, REVIEW_MEDIA_KINDS, REVIEW_SOURCES, REVIEW_STATUSES } from "../reviews/model";
import { MEDIA_HOSTS, MEDIA_KINDS, MEDIA_STATUSES } from "../media/model";
import { sql } from "drizzle-orm";
import { STORE_LOCALES } from "../i18n/locales";
import { COST_CATEGORIES, COST_CHARGES, CURRENCIES, FOREIGN_CURRENCIES } from "../finance/model";
import { DISTRIBUTIONS, PAY_KINDS } from "../team/model";
import { THEME_DRAFT_PART_KINDS } from "../themes/drafts";
import { ORDER_STATUSES } from "../orders/lifecycle";
import { ATTRIBUTION_METHODS, ATTRIBUTION_PLATFORMS, CLICK_ID_TYPES, ORDER_CHANNELS } from "../attribution/model";
import { RULE_ACTIONS, RULE_MODES } from "../order-screening/conditions";
import { BLOCK_LIST_KINDS, ORDER_ATTEMPT_OUTCOMES } from "../order-screening/signals";
import type { ActorKind, Origin } from "../events/actor";
import type { EventSubject, EventType } from "../events/catalogue";
import { ATTEMPT_OUTCOMES, CONSUMER_DISABLED_REASONS, DELIVERY_STATES } from "../events/deliveries-model";

const authNow = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "staff"] })
    .notNull()
    .default("staff"),
  status: text("status", { enum: ["active", "inactive"] })
    .notNull()
    .default("active"),
  apiKey: text("api_key").unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  /** UI language preference for emails: "ar" | "en" */
  language: text("language").notNull().default("en"),
});

export const userScopes = sqliteTable("user_scopes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  grantedBy: text("granted_by"),
  grantedAt: text("granted_at").notNull(),
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  phone2: text("phone2"),
  /** Wilaya FK — authority for wilaya. Kept in sync with `wilaya` text column. */
  wilayaId: integer("wilaya_id").references(() => wilayas.id),
  /** Commune FK — authority for commune. Kept in sync with `commune` text column. */
  communeId: text("commune_id").references(() => communes.id),
  wilaya: text("wilaya").notNull(),
  commune: text("commune"),
  address: text("address"),
  createdAt: text("created_at").notNull(),
  /** Lower-cased. Typed by the merchant, or taken from the first order that brings one; never overwritten by a later order. Not unique (migration 0069). */
  email: text("email"),
});

// ─── Customer Groups ──────────────────────────────────────────────────────────

/**
 * Named customer segments (e.g. "VIP", "Wholesale", "Problematic").
 * Customers are linked via customer_group_members.
 */
export const customerGroups = sqliteTable("customer_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Hex color for UI display, e.g. "#6366f1" */
  color: text("color").notNull().default("#6366f1"),
  /** Denormalised count — incremented/decremented on member add/remove. */
  memberCount: integer("member_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Junction table linking customers to groups.
 * A customer can belong to multiple groups.
 */
export const customerGroupMembers = sqliteTable("customer_group_members", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  groupId: text("group_id")
    .notNull()
    .references(() => customerGroups.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull(),
}, (t) => ({
  customerGroupUnique: uniqueIndex("customer_group_members_customer_group_unique").on(t.customerId, t.groupId),
}));

/**
 * Named labels for customers (e.g. "vip", "returner", "wholesale").
 * Lighter than groups — no description, just name + color.
 * assignmentCount is denormalised for fast display.
 */
export const customerTags = sqliteTable("customer_tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#64748b"),
  assignmentCount: integer("assignment_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Junction table linking customers to tags.
 * A customer can have multiple tags.
 */
export const customerTagAssignments = sqliteTable("customer_tag_assignments", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  tagId: text("tag_id")
    .notNull()
    .references(() => customerTags.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull(),
}, (t) => ({
  customerTagUnique: uniqueIndex("customer_tag_assignments_customer_tag_unique").on(t.customerId, t.tagId),
}));

// ─── Algeria Reference Data ───────────────────────────────────────────────────

/**
 * Algeria's 69 wilayas (law 26-06, 2026), numbered as the decrees number them.
 * The list lives in cod-shared/places; these rows exist for foreign keys and
 * are held to it by a test.
 */
export const wilayas = sqliteTable("wilayas", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
});

/**
 * Algeria's 1541 communes, each under its wilaya today. Same as `wilayas`:
 * the list lives in cod-shared/places. An id names a place, not a wilaya — a
 * commune keeps its id when the law moves it.
 */
export const communes = sqliteTable("communes", {
  id: text("id").primaryKey(),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
});

/**
 * Where a delivery company delivers, in its own terms: one row per commune
 * of ours the carrier's list names, with the carrier's own ids and
 * spellings, built from that list (cod-shared/places `communeNamed`) on
 * connect, on demand and by the hourly sync. A parcel is addressed from this
 * row alone; a commune without one is refused before anything is sent.
 */
export const carrierPlaces = sqliteTable("carrier_places", {
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id, { onDelete: "cascade" }),
  communeId: text("commune_id")
    .notNull()
    .references(() => communes.id),
  /** The carrier's id for the wilaya it files the commune under (a number, or ZR's territory UUID). */
  wilayaRef: text("wilaya_ref").notNull(),
  /** That wilaya's number on the carrier's map (1–58 today; carriers have not moved to 2026). */
  wilayaNumber: integer("wilaya_number").notNull(),
  wilayaName: text("wilaya_name").notNull(),
  communeRef: text("commune_ref").notNull(),
  communeName: text("commune_name").notNull(),
  /** The carrier delivers to the door in this commune (a stop-desk parcel goes to a desk the merchant picks). */
  home: integer("home", { mode: "boolean" }).notNull(),
  /** Its Carrier Rate here (DZD), as its API states it for the merchant's account: null where it gives none. */
  homeRate: real("home_rate"),
  stopDeskRate: real("stop_desk_rate"),
  /** Its Return Fee here (DZD) for a parcel sent each way that comes back. */
  homeReturnFee: real("home_return_fee"),
  stopDeskReturnFee: real("stop_desk_return_fee"),
}, (t) => ({
  pk: primaryKey({ columns: [t.companyId, t.communeId] }),
}));

// ─── Shipping Profiles ────────────────────────────────────────────────────────

/**
 * Customer shipping rate cards.
 *
 * Defines what the CUSTOMER pays (deliveryFee on orders) per wilaya/commune.
 * Used by: store default (isDefault=true) and product-level overrides
 * (products.shippingProfileId). Drivers and delivery companies do NOT
 * reference these profiles — driver pay lives in driver_compensations.
 */
export const shippingProfiles = sqliteTable("shipping_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** When true, rates from this profile are auto-applied on order creation. */
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Per-wilaya customer delivery rates within a shipping profile.
 *
 * homePrice/stopDeskPrice = what the customer pays for home / stop-desk delivery.
 * homeEnabled / stopDeskEnabled control whether orders can be placed for this
 * wilaya in that delivery mode. Defaults: home=true (open), stopDesk=false
 * (must be explicitly enabled once a carrier with stop desks is connected).
 *
 * Commune-level price + availability overrides live in shipping_rule_communes
 * (sparse — only exceptions; NULL = inherit from wilaya rule).
 *
 * Driver payroll is NOT stored here — see driver_compensations.
 */
export const shippingRules = sqliteTable("shipping_rules", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => shippingProfiles.id, { onDelete: "cascade" }),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  homePrice: real("home_price").notNull().default(0),
  stopDeskPrice: real("stop_desk_price").notNull().default(0),
  /** Whether home delivery is offered to this wilaya under this profile. */
  homeEnabled: integer("home_enabled", { mode: "boolean" }).notNull().default(true),
  /** Whether stop-desk pickup is offered to this wilaya under this profile. */
  stopDeskEnabled: integer("stop_desk_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

/**
 * Commune-level delivery mode + price overrides within a shipping rule.
 *
 * SPARSE table — only rows where a commune differs from its wilaya rule default.
 * NULL in any column = "inherit from the wilaya rule".
 *
 * Resolution logic:
 *   effective.homeEnabled     = commune.homeEnabled     ?? wilayaRule.homeEnabled
 *   effective.stopDeskEnabled = commune.stopDeskEnabled ?? wilayaRule.stopDeskEnabled
 *   effective.homePrice       = commune.homePrice       ?? wilayaRule.homePrice
 *   effective.stopDeskPrice   = commune.stopDeskPrice   ?? wilayaRule.stopDeskPrice
 */
export const shippingRuleCommunes = sqliteTable("shipping_rule_communes", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id")
    .notNull()
    .references(() => shippingRules.id, { onDelete: "cascade" }),
  communeId: text("commune_id")
    .notNull()
    .references(() => communes.id, { onDelete: "cascade" }),
  /** null = inherit from wilaya rule. */
  homeEnabled: integer("home_enabled", { mode: "boolean" }),
  /** null = inherit from wilaya rule. */
  stopDeskEnabled: integer("stop_desk_enabled", { mode: "boolean" }),
  /** null = inherit price from wilaya rule. */
  homePrice: real("home_price"),
  /** null = inherit price from wilaya rule. */
  stopDeskPrice: real("stop_desk_price"),
}, (t) => ({
  ruleCommuneUnique: uniqueIndex("shipping_rule_communes_unique").on(t.ruleId, t.communeId),
}));

// ─── Drivers ─────────────────────────────────────────────────────────────────

/**
 * In-house delivery drivers managed by the store.
 * Per-wilaya payroll lives in driver_compensations — what the driver earns
 * per delivery in each wilaya (independent of what the customer was charged).
 */
export const drivers = sqliteTable("drivers", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  phone2: text("phone2"),
  vehicleType: text("vehicle_type", { enum: ["motorcycle", "car", "van"] }),
  status: text("status", { enum: ["available", "busy", "inactive"] })
    .notNull()
    .default("available"),
  /** Cumulative deliveries completed (incremented on status → delivered). */
  totalDelivered: integer("total_delivered").notNull().default(0),
  /** Cumulative delivery fees earned (incremented on status → delivered). */
  totalEarnings: real("total_earnings").notNull().default(0),
  /** COD cash collected by driver but not yet remitted to the business. */
  pendingCash: real("pending_cash").notNull().default(0),
  /** Total COD cash remitted to the business. */
  totalPaid: real("total_paid").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Driver payroll: per-wilaya delivery fee the store pays the driver.
 *
 * Completely independent of what the customer was charged (shipping_rules).
 * When a driver is assigned to an order, the system looks up the matching
 * (driverId, wilayaId) row here to set orders.driverFee.
 *
 * Sparse: no row = the store doesn't pay this driver for deliveries in that wilaya
 * (assignment still works with driverFee = 0; admin should fill the row).
 */
export const driverCompensations = sqliteTable("driver_compensations", {
  id: text("id").primaryKey(),
  driverId: text("driver_id")
    .notNull()
    .references(() => drivers.id, { onDelete: "cascade" }),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  /** What the store pays this driver per delivery in this wilaya. */
  feePerDelivery: real("fee_per_delivery").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  driverWilayaUnique: uniqueIndex("driver_compensations_driver_wilaya_unique").on(t.driverId, t.wilayaId),
}));

// ─── Driver Payments ─────────────────────────────────────────────────────────

/**
 * Tracks COD remittances and fee payments for in-house drivers.
 * Each record represents one payment event (settled for a batch of orders).
 * Types:
 *   cod_remittance  — driver hands collected COD cash back to shop
 *   fee_payment     — shop pays driver his earned delivery fees
 *   net_settlement  — hybrid: driver hands (COD − fees) net; both settled together
 */
export const driverPayments = sqliteTable("driver_payments", {
  id: text("id").primaryKey(),
  driverId: text("driver_id")
    .notNull()
    .references(() => drivers.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["cod_remittance", "fee_payment", "net_settlement"],
  }).notNull(),
  /** Settled amount (COD total, fee total, or net COD−fees depending on type). */
  amount: real("amount").notNull(),
  /** Number of orders included in this payment batch. */
  orderCount: integer("order_count").notNull().default(0),
  notes: text("notes"),
  /** User ID of the team member who recorded this payment. */
  createdBy: text("created_by").notNull(),
  /** Denormalised display name for audit trail. */
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});

// ─── Delivery Companies ───────────────────────────────────────────────────────

/**
 * Third-party delivery companies (Yalidine, NOEST, ZR Express, etc.).
 *
 * Stores API credentials + capabilities only — no pricing. What the customer
 * pays always comes from shipping_rules; what the store pays the carrier is
 * whatever the carrier invoices out-of-band.
 */
export const deliveryCompanies = sqliteTable("delivery_companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),       // "Yalidine"
  nameAr: text("name_ar").notNull(),  // "ياليدين"
  /** Short unique code used in API calls and display. e.g. "yalidine" */
  code: text("code").notNull().unique(),
  website: text("website"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),

  // ── API Integration ──────────────────────────────────────────────────────
  /** Base URL of the company's REST API. */
  apiEndpoint: text("api_endpoint"),
  /** Bearer token or API key for authentication. */
  apiToken: text("api_token"),
  /** NOEST-specific user GUID required for shipment creation. */
  apiUserGuid: text("api_user_guid"),

  // ── Capabilities ─────────────────────────────────────────────────────────
  supportsHomeDelivery: integer("supports_home_delivery", { mode: "boolean" })
    .notNull()
    .default(true),
  supportsStopDesk: integer("supports_stop_desk", { mode: "boolean" })
    .notNull()
    .default(true),

  // ── Webhook Integration ───────────────────────────────────────────────────
  /**
   * ZR Express: "whsec_xxx" Svix secret fetched from ZR webhook endpoint API.
   * Yalidine: secret key from Yalidine Webhooks Dashboard.
   * null = signature verification skipped (warn in logs).
   */
  webhookSecret: text("webhook_secret"),
  /**
   * ZR Express only: registered endpoint UUID returned by ZR webhook registration API.
   * Used for unregister calls. null for Yalidine (manual setup, no endpoint ID).
   */
  webhookEndpointId: text("webhook_endpoint_id"),

  /**
   * If true, a created parcel is sent to the courier at once (default).
   * If false, the team validates each one (POST /shipments/{id}/validate) —
   * the default for EcoTrack companies, whose parcels lock when validated.
   */
  autoValidate: integer("auto_validate", { mode: "boolean" }).notNull().default(true),

  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // ── Appended by migration 0038 — keep last (mock-db maps columns by position) ──
  /** Which carrier adapter serves this company. Null = no adapter: it cannot take parcels. */
  provider: text("provider", { enum: CARRIER_PROVIDERS }),
  /** The adapter's own settings as JSON, validated by its schema. Secrets inside are masked in responses. */
  providerConfig: text("provider_config"),
  /** When the carrier's list of places was last read into carrier_places. */
  placesSyncedAt: text("places_synced_at"),
  /** JSON: the carrier's places that name no commune of ours, from that sync — `[{ wilaya, commune }]`. */
  placesUnmatched: text("places_unmatched"),
});

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  /** The wilaya (cod-shared/places) — authority for wilaya. Names derived at query/dispatch time. */
  wilayaId: integer("wilaya_id").references(() => wilayas.id),
  /** Commune FK — authority for commune. Names derived at query/dispatch time. */
  communeId: text("commune_id").references(() => communes.id),
  city: text("city"),
  address: text("address"),
  price: real("price").notNull(),
  notes: text("notes"),
  status: text("status", {
    enum: ORDER_STATUSES,
  }).notNull().default("new"),
  orderType: text("order_type", { enum: ["online", "offline"] })
    .notNull()
    .default("online"),

  // ── Delivery specifics ────────────────────────────────────────────────────
  deliveryType: text("delivery_type", { enum: ["home", "stop_desk"] })
    .notNull()
    .default("home"),
  /**
   * Stop-desk / pickup-point station code.
   * Required when deliveryType = "stop_desk".
   * NOEST: alphanumeric station code (e.g. "16A").
   * ZR Express: territory UUID of the pickup-point (detected by UUID format in adapter).
   * Both providers use this single field — adapter auto-detects the format.
   */
  stationCode: text("station_code"),
  /**
   * Delivery fee charged to the customer (from the store's shipping profile).
   * Set at order creation and NEVER changed after that.
   */
  deliveryFee: real("delivery_fee").notNull().default(0),
  /** What the customer owes on delivery: the price and the delivery fee, set at creation. */
  codAmount: real("cod_amount").notNull().default(0),

  // ── Meta Pixel / CAPI attribution ────────────────────────────────────────
  /** _fbc cookie captured at placement — links the sale back to the ad click. */
  fbc: text("fbc"),
  /** _fbp cookie captured at placement — browser identity for EMQ. */
  fbp: text("fbp"),
  /** CF-Connecting-IP at placement — sent as client_ip_address in CAPI event. */
  ipAddress: text("ip_address"),
  /** User-Agent at placement — sent as client_user_agent in CAPI event. */
  userAgent: text("user_agent"),

  // ── Landing page attribution (appended by migration 0019 — keep last) ────
  /** Landing page the order was placed from (best-effort attribution — never blocks an order). */
  landingPageId: text("landing_page_id"),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // ── Checkout form capture (appended by migration 0031) ────────────────────
  //
  // These sit after createdAt/updatedAt deliberately. cod-server's mock db maps
  // a full-table select positionally by SCHEMA order (src/test-utils/mock-db.ts),
  // so a column inserted mid-table silently shifts every fixture after it.
  // Appending keeps every existing fixture valid and makes the rule simple for
  // the next column too: new columns go last.
  /**
   * The shopper's email as captured at order time, when the merchant enabled
   * the field on the Checkout Form page. A snapshot like customerName/phone —
   * the order keeps what was true when it was placed. Never sent to carriers.
   */
  customerEmail: text("customer_email"),
  /**
   * Answers to the merchant's custom checkout fields:
   * JSON `[{ id, label, type, value }]`, in policy order.
   *
   * The label is stored with the answer because the merchant may rename or
   * delete the field later, and an order must keep reading the way it read when
   * it was placed. The dashboard renders this snapshot and never re-resolves it
   * against the live policy. Carriers and pricing never read it.
   */
  customFieldsJson: text("custom_fields_json"),
  /**
   * When the merchant archived the finished order (migration 0042): it leaves
   * the working lists and their counts, and still counts everywhere else —
   * sales, the customer's history and spend. Null while it is not archived.
   */
  archivedAt: text("archived_at"),
  /** The offer that made delivery free (a free-shipping offer, or a quantity-pricing tier); null when none did (migration 0051). */
  deliveryOfferId: text("delivery_offer_id").references((): AnySQLiteColumn => offers.id, { onDelete: "set null" }),
  /** The coupon the order was placed with; null when none, or once the coupon is deleted (migration 0052). */
  couponId: text("coupon_id").references((): AnySQLiteColumn => coupons.id, { onDelete: "set null" }),
  /** The code as the order used it — kept when the coupon is deleted. */
  couponCode: text("coupon_code"),
  /** What the coupon took off, carried by the lines' `discount`; `price` is already net of it. */
  couponDiscount: integer("coupon_discount").notNull().default(0),
  /** The name `deliveryOfferId` had when the order was placed — kept when the offer is renamed or deleted (migration 0053). */
  deliveryOfferName: text("delivery_offer_name"),
  /** The storefront's key for the checkout attempt that placed it: the same key places no second order (migration 0062). */
  checkoutKey: text("checkout_key"),
  /** The language it was placed in: the shopper's storefront language, the primary for a dashboard or agent order; null before migration 0063. */
  locale: text("locale", { enum: STORE_LOCALES }),
  /** A fresh random token per status change: the claim that makes its effects apply once (migration 0075). */
  revision: text("revision"),
  // ── Confirmation team (appended by migration 0086 — keep last) ───────────
  /** The team member the order is with now; null while it is with nobody. */
  assigneeId: text("assignee_id").references((): AnySQLiteColumn => users.id, { onDelete: "set null" }),
  /** When it was given to that member. */
  assignedAt: text("assigned_at"),
  /** How many times it was taken back from a member who did not act on it in time. */
  takeBacks: integer("take_backs").notNull().default(0),
  /** When the customer asked to be called back; cleared once the order is confirmed or cancelled. */
  callbackAt: text("callback_at"),
  /** Its first move away from `new`, and the member who made it (null for the system). Kept on the order: the Event Log is pruned. */
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  /** Its first confirmation, and the member credited with it. */
  confirmedAt: text("confirmed_at"),
  confirmedBy: text("confirmed_by"),
  // ── Calls without an answer (appended by migration 0088 — keep last) ─────
  /** How many calls had no answer — Call 1, Call 2, Call 3 while it waits — kept once it is confirmed or cancelled. Kept on the order: the Event Log is pruned. */
  unansweredCalls: integer("unanswered_calls").notNull().default(0),
}, (t) => ({
  checkoutKeyUnique: uniqueIndex("orders_checkout_key").on(t.checkoutKey).where(sql`checkout_key IS NOT NULL`),
}));

// ─── Product Catalog ─────────────────────────────────────────────────────────

export const productCategories = sqliteTable("product_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  parentId: text("parent_id"), // self-reference at app level
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  metaKeywords: text("meta_keywords"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** The image's Media Key (migration 0068). */
  imageKey: text("image_key"),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  descriptionFormat: text("description_format", { enum: ["text", "html"] })
    .notNull()
    .default("text"), // 'text' renders literally (legacy rows); 'html' is sanitised at write
  handle: text("handle").notNull().unique(), // URL slug (was "slug")
  currency: text("currency").notNull().default("DZD"),
  price: integer("price").notNull(), // base price in DZD (whole number)
  compareAtPrice: integer("compare_at_price"),
  costPrice: integer("cost_price"),
  type: text("type", { enum: ["PHYSICAL", "DIGITAL"] }).notNull().default("PHYSICAL"),
  hasVariants: integer("has_variants", { mode: "boolean" }).notNull().default(false),
  variantOptions: text("variant_options"), // JSON: [{name: string, values: [{value: string, hexColor?: string}]}]
  sku: text("sku").unique(), // only for simple products (hasVariants=false)
  inventory: integer("inventory").notNull().default(0), // only for simple products
  /**
   * Master inventory toggle. When false, the product is excluded from stock
   * tracking entirely:
   *   - Simple: products.inventory is ignored; orders never deduct it.
   *   - Variant parent: ALL of its variants are excluded — orders never deduct
   *     from any variant, and stock alerts/overview hide the whole product.
   * Variant rows do not have their own toggle; the parent flag governs them.
   */
  trackInventory: integer("track_inventory", { mode: "boolean" }).notNull().default(true),
  /** Alert when inventory drops to or below this number (0 = disabled). */
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  categoryId: text("category_id").references(() => productCategories.id, { onDelete: "set null" }),
  tags: text("tags"), // JSON string[]
  visibility: integer("visibility", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["DRAFT", "ACTIVE", "ARCHIVED"] }).notNull().default("ACTIVE"),
  showInStore: integer("show_in_store", { mode: "boolean" }).notNull().default(true),
  publishedAt: text("published_at"),
  /**
   * Product-level shipping profile override.
   * When set: orders of this product use this profile for deliveryFee resolution.
   * When null: store default profile (isDefault=true) is used.
   */
  shippingProfileId: text("shipping_profile_id")
    .references(() => shippingProfiles.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** The title search engines and shared links show; null: the product's name. */
  metaTitle: text("meta_title"),
  /** The description search engines and shared links show; null: the product's own description, shortened. */
  metaDescription: text("meta_description"),
});

export const productVariants = sqliteTable("product_variants", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variations: text("variations").notNull(), // JSON: {"Color": "Red", "Size": "M"}
  currency: text("currency").notNull().default("DZD"),
  price: integer("price").notNull(), // price in DZD
  compareAtPrice: integer("compare_at_price"),
  sku: text("sku").notNull().unique(),
  barcode: text("barcode"),
  inventory: integer("inventory").notNull().default(0),
  /** Alert when variant inventory drops to or below this number (0 = disabled). */
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  weightKg: real("weight_kg"),
  imageId: text("image_id"), // reference to productImages.id
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** What one unit costs the merchant (DZD); null falls back to the product's cost (migration 0085). */
  costPrice: integer("cost_price"),
});

export const productImages = sqliteTable("product_images", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  altText: text("alt_text"),
  width: integer("width"),
  height: integer("height"),
  type: integer("type").notNull().default(1), // 1=image, 2=video
  position: integer("position").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** The image's Media Key (migration 0068); null only for an image of another site, which the API does not show. */
  mediaKey: text("media_key"),
});

/** Status lifecycle value for orders — derived from the column enum. */
export type OrderStatus = (typeof orders.$inferSelect)["status"];

export const orderProducts = sqliteTable("order_products", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  /** Null once the product was removed: the line keeps what was sold (name, label, SKU, price). */
  productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  variantId: text("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  variantLabel: text("variant_label"), // denormalized: "أحمر / XL"
  sku: text("sku"), // denormalized from products.sku / product_variants.sku at creation time
  quantity: integer("quantity").notNull(),
  pricePerUnit: real("price_per_unit").notNull(),
  lineTotal: real("line_total").notNull(),
  /**
   * Per-line fulfilment outcome — supports Algerian box-opening returns.
   *   fulfilled           — customer kept all units (returnedQuantity = 0)
   *   partially_returned  — customer kept some, returned some (0 < returnedQuantity < quantity)
   *   returned            — every unit went back to stock: refused at the door, or
   *                         put back when the order was cancelled or its parcel came back
   *                         (returnedQuantity = quantity)
   */
  status: text("status", { enum: ["fulfilled", "partially_returned", "returned"] })
    .notNull()
    .default("fulfilled"),
  /**
   * Units back in stock: refused at the door on a delivered order, or every
   * unit once the order is cancelled or its parcel comes back (for a product
   * that tracks stock). 0 when status = fulfilled.
   */
  returnedQuantity: integer("returned_quantity").notNull().default(0),
  createdAt: text("created_at").notNull(),
  /**
   * The offer that shaped this line (migration 0051): a quantity-pricing offer
   * that set its price, or the gift offer it was given by. Null for a line at
   * the catalog price.
   */
  offerId: text("offer_id").references((): AnySQLiteColumn => offers.id, { onDelete: "set null" }),
  /** A gift: given by `offerId`, at no charge. */
  reward: integer("reward", { mode: "boolean" }).notNull().default(false),
  /** The line's share of the order's coupon discount; `lineTotal` is already net of it (migration 0052). */
  discount: integer("discount").notNull().default(0),
  /** The name `offerId` had when the order was placed — kept when the offer is renamed or deleted (migration 0053). */
  offerName: text("offer_name"),
  /**
   * What one unit cost the merchant (DZD), frozen when the line was written:
   * the variant's cost, else the product's (a trigger, migration 0085). Null
   * when it is not known; a later catalog change never rewrites it.
   */
  unitCost: integer("unit_cost"),
  /** Where `unitCost` came from: the catalog when the line was written, or the merchant's correction. */
  unitCostSource: text("unit_cost_source", { enum: ["catalog", "manual"] }),
});

/**
 * An order line whose product was deleted, and the product it was of: kept
 * by a trigger when the product goes (the line's `productId` becomes null),
 * so what a product's per-order costs counted still counts (migration 0087).
 */
export const removedProductLines = sqliteTable("removed_product_lines", {
  orderProductId: text("order_product_id")
    .primaryKey()
    .references(() => orderProducts.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
}, (t) => ({
  product: index("removed_product_lines_product").on(t.productId),
}));

// ─── Order attribution (migration 0083) ──────────────────────────────────────

/**
 * Where an order came from (ADR 0026, attribution v2): captured from the
 * shopper's visit (`captured`), or the staff surface that entered it
 * (`entered`). `merchant` rows were chosen by hand before v2 and are only
 * read. Written in the order's own batch, never after it; no row means
 * nothing is known (an order before tracking, a theme on an older SDK).
 *
 * The touch columns describe the credited ad (the last ad click at most seven
 * days before the order), else this visit; `captured_at` is that touch's
 * time. The `visit_*` columns always describe this visit. The values
 * are kept as the storefront sent them, already validated
 * (`cod-shared/attribution`); an id that is not digits never becomes `ad_id`
 * and stays readable in `utm_content`. No CHECK on `platform` or `method`: a
 * new ad platform is a new value, not a table rebuild.
 */
export const orderAttribution = sqliteTable("order_attribution", {
  orderId: text("order_id")
    .primaryKey()
    .references(() => orders.id, { onDelete: "cascade" }),
  method: text("method", { enum: ATTRIBUTION_METHODS }).notNull(),
  /** Where the order came from: the credited ad's channel, else this visit's, else the staff surface that entered it. Null when nothing is known (rows before v2). */
  channel: text("channel", { enum: ORDER_CHANNELS }),
  capturedAt: text("captured_at"),
  platform: text("platform", { enum: ATTRIBUTION_PLATFORMS }).notNull(),
  clickId: text("click_id"),
  clickIdType: text("click_id_type", { enum: CLICK_ID_TYPES }),
  campaignId: text("campaign_id"),
  adsetId: text("adset_id"),
  adId: text("ad_id"),
  placement: text("placement"),
  siteSource: text("site_source"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  /** The readable names the ad URL carried (`wc_cn`, `wc_an`), shown until a sync names the ids. */
  namesJson: text("names_json"),
  landingPath: text("landing_path"),
  landingPageType: text("landing_page_type"),
  referrerHost: text("referrer_host"),
  firstTouchAt: text("first_touch_at"),
  /** The first touch as captured, kept whole for other attribution models. */
  firstTouchJson: text("first_touch_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** This visit: the latest arrival before the order, an ad or not, direct included. */
  visitAt: text("visit_at"),
  visitChannel: text("visit_channel", { enum: ORDER_CHANNELS }),
  visitPlatform: text("visit_platform", { enum: ATTRIBUTION_PLATFORMS }),
  visitSiteSource: text("visit_site_source"),
  visitReferrerHost: text("visit_referrer_host"),
  visitLandingPath: text("visit_landing_path"),
  visitLandingPageType: text("visit_landing_page_type"),
  visitUtmSource: text("visit_utm_source"),
  visitUtmMedium: text("visit_utm_medium"),
  visitUtmCampaign: text("visit_utm_campaign"),
}, (table) => [index("order_attribution_channel_idx").on(table.channel)]);

// ─── Delivery Provider Integration ───────────────────────────────────────────

/**
 * Carrier stop-desk / pickup-point cache and admin control table.
 *
 * Populated by POST /delivery-companies/:id/sync-stop-desks (calls provider.getStopDesks()).
 * The `active` flag survives re-syncs for desks still listed at the carrier — only the
 * admin can toggle it. A desk removed at the carrier is hard-deleted on sync (its flag
 * goes with it); if it reappears later it comes back active by default. This allows
 * the admin to deactivate specific communes for their account.
 *
 * `code` maps to what is sent as stationCode in the carrier API:
 *   EcoTrack/Packers → code_postal string (e.g. "16001")
 *   NOEST            → station code string (e.g. "16A")
 *   Yalidine         → center_id as string (e.g. "42")
 *   ZR Express       → territory UUID
 */
export const companyStopDesks = sqliteTable("company_stop_desks", {
  id:        text("id").primaryKey(),
  companyId: text("company_id")
               .notNull()
               .references(() => deliveryCompanies.id, { onDelete: "cascade" }),
  code:      text("code").notNull(),
  name:      text("name").notNull(),
  commune:   text("commune"),
  wilayaId:  integer("wilaya_id").references(() => wilayas.id),
  address:   text("address"),
  phones:    text("phones"),   // JSON: string[]
  /** Admin-controlled: false = hidden from dispatch dialog. Never reset by sync. */
  active:    integer("active", { mode: "boolean" }).notNull().default(true),
  syncedAt:  text("synced_at").notNull(),
  /** Our commune for the desk, read through the company's carrier_places; its wilaya is the one shoppers know. */
  communeId: text("commune_id").references(() => communes.id),
}, (t) => ({
  companyCodeUnique: uniqueIndex("company_stop_desks_company_code_unique")
                       .on(t.companyId, t.code),
}));

/**
 * Audit log for every outbound API call to delivery company APIs.
 */
export const companyApiLogs = sqliteTable("company_api_logs", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id),
  /** The order this call was related to, if any. */
  orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
  /** Short action name: "create_shipment", "validate", "track", "delete", "get_fees" */
  action: text("action").notNull(),
  method: text("method").notNull(), // "GET" | "POST" | "PATCH" | "DELETE"
  endpoint: text("endpoint").notNull(), // relative path, e.g. "/api/public/create/order"
  /** Serialised request payload (sensitive fields stripped). */
  requestBody: text("request_body"), // JSON
  httpStatus: integer("http_status"),
  /** Serialised response body (truncated if large). */
  responseBody: text("response_body"), // JSON
  success: integer("success", { mode: "boolean" }).notNull().default(false),
  errorMessage: text("error_message"),
  /** Round-trip time in milliseconds. */
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull(),
});

// ─── Shipments (ADR 0006; migration 0039) ──────────────────────────────────────

/**
 * One delivery execution of one order — by an integrated carrier or the
 * store's own driver. An order has at most one. The carrier's raw status is
 * kept as reported; CodFlow's conclusions are set-once milestone timestamps
 * (see cod-shared/shipments/interpretation.ts), never a status column.
 */
export const shipments = sqliteTable("shipments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: SHIPMENT_KINDS }).notNull(),
  companyId: text("company_id").references(() => deliveryCompanies.id),
  driverId: text("driver_id").references(() => drivers.id),
  handoffState: text("handoff_state", { enum: HANDOFF_STATES }).notNull(),
  /** The carrier's stable id for the parcel — what its updates are matched by. */
  carrierParcelId: text("carrier_parcel_id"),
  trackingNumber: text("tracking_number"),
  /** Opaque to CodFlow: the adapter's own data, handed back on every call. */
  carrierData: text("carrier_data"),
  labelUrl: text("label_url"),
  /** What was shipped (the order keeps what the customer asked for). */
  deliveryType: text("delivery_type", { enum: ["home", "stop_desk"] }).notNull(),
  stationCode: text("station_code"),
  /** The cash the courier or driver collects, as declared at handoff. */
  codAmount: real("cod_amount").notNull(),
  /** A driver's pay for this delivery, frozen at handoff. */
  driverFee: real("driver_fee").notNull().default(0),
  weight: real("weight"),
  isFragile: integer("is_fragile", { mode: "boolean" }),
  providerStatus: text("provider_status"),
  providerStatusLabel: text("provider_status_label"),
  providerStatusKind: text("provider_status_kind", { enum: INTERPRETATION_KIND_VALUES }),
  providerStatusAt: text("provider_status_at"),
  validatedAt: text("validated_at"),
  outForDeliveryAt: text("out_for_delivery_at"),
  deliveredAt: text("delivered_at"),
  returnStartedAt: text("return_started_at"),
  returnedAt: text("returned_at"),
  cancelledAt: text("cancelled_at"),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  attentionSince: text("attention_since"),
  lastSyncedAt: text("last_synced_at"),
  createdBy: text("created_by"),
  /** A fresh random token per write: the guard that makes concurrent writers apply effects once. */
  revision: text("revision").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** A carrier shipment's Shipping Cost (DZD): its company's rate for where and how it went, frozen at handoff. Null when the company gives no price there; a driver shipment's cost is its driverFee. */
  shippingCost: real("shipping_cost"),
  /** What the company charges if the parcel comes back (DZD), frozen with the Shipping Cost. */
  returnFee: real("return_fee"),
});

/** Every status reported for a shipment: raw, as interpreted, with its reason, time and source. */
export const shipmentEvents = sqliteTable("shipment_events", {
  id: text("id").primaryKey(),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  source: text("source", { enum: SHIPMENT_EVENT_SOURCES }).notNull(),
  /** The fact's identity (vocabulary, status, time) — the same fact arriving twice is one row. */
  eventKey: text("event_key").notNull(),
  vocabulary: text("vocabulary"),
  providerStatus: text("provider_status"),
  providerStatusLabel: text("provider_status_label"),
  /** Null only for rows carried over from the old order history. */
  interpretation: text("interpretation", { enum: INTERPRETATION_KIND_VALUES }),
  milestone: text("milestone", { enum: MILESTONES }),
  attention: integer("attention", { mode: "boolean" }).notNull().default(false),
  /** A report that contradicted the shipment, recorded and not applied. */
  anomaly: text("anomaly"),
  reason: text("reason"),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
  actorId: text("actor_id"),
  webhookEventId: text("webhook_event_id").references(() => webhookEvents.id),
  raw: text("raw"),
}, (t) => ({
  dedupe: uniqueIndex("shipment_events_shipment_id_event_key_unique").on(t.shipmentId, t.eventKey),
}));

/** Which driver shipment a driver payment settles, and for which part. Settlement owns the link. */
export const driverPaymentLines = sqliteTable("driver_payment_lines", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull().references(() => driverPayments.id, { onDelete: "cascade" }),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id),
  component: text("component", { enum: SETTLEMENT_COMPONENTS }).notNull(),
  amount: real("amount").notNull(),
}, (t) => ({
  oncePerPart: uniqueIndex("driver_payment_lines_shipment_id_component_unique").on(t.shipmentId, t.component),
}));

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * One store per deployment. Holds branding, theme, and SEO settings
 * editable from the dashboard.
 */
export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain"),

  // ── Theme ─────────────────────────────────────────────────────────────────
  /** The storefront theme's slug, e.g. "theme-00". A label: nothing in the platform branches on it. */
  themeId: text("theme_id").notNull().default("theme-00"),

  // ── Locale ────────────────────────────────────────────────────────────────
  /**
   * The store's primary language (`i18n/locales.ts`): the language its
   * storefront is served in, and the first fallback for every translated
   * value. Always a published row of `store_locales` (ADR 0005).
   */
  lang: text("lang", { enum: STORE_LOCALES }).notNull().default("ar"),
  currency: text("currency").notNull().default("DZD"),
  currencySymbol: text("currency_symbol").notNull().default("دج"),

  // ── SEO ───────────────────────────────────────────────────────────────────
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),

  // ── Optional features ─────────────────────────────────────────────────────
  /** When false, reviews are hidden on the storefront and submission is disabled. */
  reviewsEnabled: integer("reviews_enabled", { mode: "boolean" }).notNull().default(true),
  /**
   * Shopping cart opt-in. False (the default) keeps the storefront exactly as
   * it is: the direct one-click order form, no cart. True adds "Add to cart"
   * alongside it — the direct form is never replaced.
   */
  cartEnabled: integer("cart_enabled", { mode: "boolean" }).notNull().default(false),

  // ── Delivery pricing ──────────────────────────────────────────────────────
  /**
   * Order subtotal (DZD) at or above which delivery is free.
   * NULL = feature off. Distinct from 0, which would make EVERY order free.
   * Applies to every order — cart or single product.
   */
  freeShippingThreshold: integer("free_shipping_threshold"),
  /**
   * Which rate a basket spanning several shipping profiles pays.
   *   "highest"         — the dearest applicable rate (default)
   *   "default_profile" — always the store default profile's rate
   * A single-product order resolves identically under both.
   */
  cartShippingMode: text("cart_shipping_mode", { enum: ["highest", "default_profile"] })
    .notNull()
    .default("highest"),

  /** Plaintext storefront API key — written on every provision so the merchant can view it in settings. */
  storeApiKey: text("store_api_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // ── Checkout form policy (appended by migration 0031) ─────────────────────
  //
  // Placed last for the same reason as the orders columns above: the mock db
  // maps full-table selects positionally by schema order.
  /**
   * The Checkout Form Policy — which controllable fields the storefront order
   * form renders, how strictly each is enforced, and the merchant's own custom
   * fields. Shape: CheckoutFormPolicy (cod-shared/checkout-form).
   *
   * NULL means "the defaults", and the defaults are today's form exactly, so a
   * store that never opens the Checkout Form page is untouched by this feature.
   * Rollback for the whole feature is `UPDATE stores SET checkout_form_json = NULL`.
   *
   * Never exposed raw to the storefront: getStoreConfig replaces it with the
   * parsed `checkoutForm` projection.
   */
  checkoutFormJson: text("checkout_form_json"),

  // ── WhatsApp widget (appended by migration 0032) ──────────────────────────
  /**
   * The WhatsApp Widget configuration — the merchant's number, the identity
   * shown in the chat panel, the message texts, the appearance, and which
   * storefront surfaces the launcher appears on. Shape: WhatsAppWidgetConfig
   * (cod-shared/whatsapp-widget).
   *
   * NULL means "no widget", so a store that never opens the WhatsApp page
   * ships no widget markup at all. Rollback for the whole feature is
   * `UPDATE stores SET whatsapp_widget_json = NULL`.
   *
   * Never exposed raw to the storefront: getStoreConfig replaces it with the
   * resolved `whatsapp` projection, which is null whenever the widget cannot
   * render.
   *
   * Last for the same positional reason as the columns above.
   */
  whatsappWidgetJson: text("whatsapp_widget_json"),

  // ── Reviews (appended by migration 0043) ──────────────────────────────────
  /** Photos a shopper may add to a review: 0 (none) to 6. */
  reviewMaxPhotos: integer("review_max_photos").notNull().default(3),
  /** Longest voice note a shopper may add, in seconds; NULL = no voice notes. */
  reviewVoiceMaxSeconds: integer("review_voice_max_seconds"),
  /** What a shopper's review publishes without the merchant checking it. */
  reviewAutoPublish: text("review_auto_publish", { enum: REVIEW_AUTO_PUBLISH }).notNull().default("text_only"),

  // ── Shipping labels (appended by migration 0057) ──────────────────────────
  /**
   * The labels the store prints for its own drivers, as one JSON blob
   * (cod-shared/shipping-label/config.ts). NULL = the defaults. Last for the
   * positional mock-db reason above.
   */
  shippingLabelJson: text("shipping_label_json"),

  // ── Media keys (appended by migration 0068, ADR 0021) ─────────────────────
  /** The logo's Media Key. */
  logoKey: text("logo_key"),
  /** The share image's Media Key. */
  ogImageKey: text("og_image_key"),
});

/**
 * The languages a store has added (ADR 0005, migration 0036) — Shopify's
 * shop locales. A language is added unpublished, translated, then published;
 * only published languages reach shoppers. The primary (`stores.lang`) always
 * has a published row: the write path (`stores/languages.ts`) refuses
 * anything else, and readers serve the primary regardless.
 */
export const storeLocales = sqliteTable("store_locales", {
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  locale: text("locale", { enum: STORE_LOCALES }).notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.storeId, t.locale] }),
}));

/**
 * A store's edits to a theme's storefront text, one row per theme, language
 * and key (`i18n/content-overrides.ts`). Removing a language from the store
 * removes its edits; unpublishing it only hides them.
 *
 * Read here for the storefront (`/store/config?theme=`); written by CodFlow
 * Cloud's visual editor, outside this repository. A writer must make sure the
 * language has its `store_locales` row first (the foreign key below).
 */
export const storeContentOverrides = sqliteTable("store_content_overrides", {
  storeId: text("store_id").notNull(),
  /** The theme that declares `key` (`@wocart/theme` `defineTheme({ key })`). */
  themeKey: text("theme_key").notNull(),
  locale: text("locale", { enum: STORE_LOCALES }).notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.storeId, t.themeKey, t.locale, t.key] }),
  language: foreignKey({
    columns: [t.storeId, t.locale],
    foreignColumns: [storeLocales.storeId, storeLocales.locale],
  }).onDelete("cascade"),
}));

/**
 * Translations of merchant data (ADR 0005, phase C; `i18n/translations.ts`):
 * one row per resource, language and key — Shopify's Translations API model.
 * `resource_type` names a `TRANSLATABLE` entry; the source (the resource's own
 * column) stays in the primary language. `source_digest` is the SHA-256 of the
 * source text the translation was written against: a different digest today
 * means the translation is outdated. Triggers (migration 0037) delete a
 * resource's translations with it, and a language's with its `store_locales`
 * row.
 */
/**
 * A store's saved composition for one theme and storefront surface
 * (migrations 0033, 0054) — the PageData JSON verbatim, parsed (never
 * evaluated) at read time. Written by CodFlow Cloud's editor only; this
 * repository never writes it.
 */
export const pageDocuments = sqliteTable("page_documents", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  /** The theme the document was composed for (`@wocart/theme` `defineTheme({ key })`). */
  themeKey: text("theme_key").notNull(),
  surface: text("surface").notNull(),
  document: text("document").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  themeSurfaceUnique: uniqueIndex("idx_page_documents_theme_surface").on(t.storeId, t.themeKey, t.surface),
}));

/**
 * One working copy of one theme's state (ADR 0010, `themes/drafts.ts`):
 * what it changes is in `themeDraftParts`. `revision` is its optimistic lock.
 * Written by CodFlow Cloud's editor only.
 */
export const themeDrafts = sqliteTable("theme_drafts", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  themeKey: text("theme_key").notNull(),
  /** The theme version whose manifest the draft was last checked against. */
  themeVersion: text("theme_version").notNull(),
  name: text("name"),
  revision: integer("revision").notNull().default(0),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  storeTheme: index("idx_theme_drafts_store_theme").on(t.storeId, t.themeKey, t.updatedAt),
}));

/**
 * What a draft changes, one whole value per part: a surface's document
 * (`null` = the theme's default), the settings object, or one language's
 * edit map. An absent part shows as live.
 */
export const themeDraftParts = sqliteTable("theme_draft_parts", {
  draftId: text("draft_id").notNull().references(() => themeDrafts.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: THEME_DRAFT_PART_KINDS }).notNull(),
  /** The surface (`document`), `""` (`settings`) or the language (`content`). */
  key: text("key").notNull(),
  /** JSON object, or null for a document part that returns to the theme's default. */
  value: text("value"),
  /** The live row's `updated_at` the part started from; null when there was none. */
  baseUpdatedAt: text("base_updated_at"),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.draftId, t.kind, t.key] }),
}));

/**
 * A theme's whole live state after one publish — a restore point, as a JSON
 * array of `ThemePart`. The newest `THEME_PUBLICATIONS_KEPT` per store and
 * theme are kept (trigger).
 */
export const themePublications = sqliteTable("theme_publications", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  themeKey: text("theme_key").notNull(),
  themeVersion: text("theme_version").notNull(),
  /** The published draft's id; the draft itself is removed when it is published. */
  draftId: text("draft_id"),
  state: text("state").notNull(),
  publishedBy: text("published_by"),
  publishedAt: text("published_at").notNull(),
}, (t) => ({
  storeTheme: index("idx_theme_publications_store_theme").on(t.storeId, t.themeKey, t.publishedAt),
}));

export const translations = sqliteTable("translations", {
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  locale: text("locale", { enum: STORE_LOCALES }).notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  sourceDigest: text("source_digest").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.resourceType, t.resourceId, t.locale, t.key] }),
}));

/**
 * API keys issued to Astro storefronts.
 * The raw key is never stored — only a SHA-256 hex digest.
 */
export const storeApiKeys = sqliteTable("store_api_keys", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  /** SHA-256 hex digest of the raw key */
  keyHash: text("key_hash").notNull().unique(),
  name: text("name").notNull().default("default"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

// ─── Theme settings and navigation menus (migration 0045) ──────────────────────

/**
 * A store's values for the settings a theme declares, one row per theme.
 * Written by CodFlow Cloud; read here for `/store/config`.
 */
export const storeThemeSettings = sqliteTable("store_theme_settings", {
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  themeKey: text("theme_key").notNull(),
  /** JSON object: setting key → value. */
  values: text("values").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.storeId, t.themeKey] }),
}));

/** A list of products the merchant curates by hand, read by themes by handle (`catalog/collections.ts`). */
export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  handleUnique: uniqueIndex("idx_collections_handle").on(t.storeId, t.handle),
}));

/** A product in a collection, at its place in the merchant's order. */
export const collectionProducts = sqliteTable("collection_products", {
  collectionId: text("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  addedAt: text("added_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.collectionId, t.productId] }),
  orderIdx: index("idx_collection_products_order").on(t.collectionId, t.position),
  productIdx: index("idx_collection_products_product").on(t.productId),
}));

/** A navigation menu: store data, read by themes by handle. */
export const storeMenus = sqliteTable("store_menus", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  handleUnique: uniqueIndex("idx_store_menus_handle").on(t.storeId, t.handle),
}));

/**
 * One item of a menu: a label (primary language; others in `translations`,
 * resource `menuItem`) and where it goes — a page type, by the id of its
 * resource when it names one, or a URL. Up to three levels (`parentId`).
 */
export const storeMenuItems = sqliteTable("store_menu_items", {
  id: text("id").primaryKey(),
  menuId: text("menu_id").notNull().references(() => storeMenus.id, { onDelete: "cascade" }),
  parentId: text("parent_id").references((): AnySQLiteColumn => storeMenuItems.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  label: text("label").notNull(),
  destinationType: text("destination_type", { enum: MENU_DESTINATION_TYPES }).notNull(),
  destinationRef: text("destination_ref"),
  url: text("url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  menuIdx: index("idx_store_menu_items_menu").on(t.menuId, t.parentId, t.position),
  parentIdx: index("idx_store_menu_items_parent").on(t.parentId).where(sql`parent_id IS NOT NULL`),
}));

// ─── Reviews ──────────────────────────────────────────────────────────────────

/**
 * A rating and a few words about one product (migration 0043). A shopper's
 * rests on their order — one review per product of it; a review the store
 * enters may name a customer and, optionally, one of their orders. `verified`
 * is set once, when it is entered: it rests on a delivered order.
 */
export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
  customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
  /** Snapshot of the order's number, shown with the review. */
  orderNumber: text("order_number"),
  /** Snapshot of the name shown with the review, immune to later edits. */
  customerName: text("customer_name").notNull(),
  /** Whole stars, 1–5 (database CHECK). */
  rating: integer("rating").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  status: text("status", { enum: REVIEW_STATUSES }).notNull().default("pending"),
  source: text("source", { enum: REVIEW_SOURCES }).notNull().default("storefront"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  /** Photos or voice notes received but not kept (unreadable, too long). */
  mediaDropped: integer("media_dropped").notNull().default(0),
  /** The staff member who entered a merchant review. */
  createdBy: text("created_by"),
  helpfulCount: integer("helpful_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  orderProductUnique: uniqueIndex("reviews_order_product").on(t.orderId, t.productId).where(sql`order_id IS NOT NULL`),
  productStatusIdx: index("idx_reviews_product_status").on(t.productId, t.status, t.createdAt),
  statusCreatedIdx: index("idx_reviews_status_created").on(t.status, t.createdAt),
  customerIdx: index("idx_reviews_customer").on(t.customerId).where(sql`customer_id IS NOT NULL`),
}));

/**
 * A photo or the voice note of a review, stored in R2 under `reviews/`. A
 * photo keeps a small `thumbKey` for lists; a voice note its `durationMs`.
 * Goes with its review; its files are deleted after the row (cod-server
 * `lib/review-media`).
 */
export const reviewMedia = sqliteTable("review_media", {
  id: text("id").primaryKey(),
  reviewId: text("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: REVIEW_MEDIA_KINDS }).notNull(),
  thumbKey: text("thumb_key").unique(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
  /** The file's Media Key (migration 0068). */
  mediaKey: text("media_key").notNull().unique(),
}, (t) => ({
  reviewIdx: index("idx_review_media_review").on(t.reviewId, t.position),
}));

// ─── Activity Logs ────────────────────────────────────────────────────────────

/**
 * Audit trail of all write actions performed by staff and admin users.
 * Only admins can query this table.
 */
export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey(),
  /** ID of the user who performed the action. */
  actorId: text("actor_id").notNull(),
  /** Denormalised name — preserved even if user is later deleted. */
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role", { enum: ["admin", "staff"] }).notNull(),
  /** Dot-notation action: "order.created", "user.role_changed", etc. */
  action: text("action").notNull(),
  /** Entity category: "order", "customer", "driver", "product", "user". */
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  /** Human-readable label at the time of action (order number, name, etc.). */
  entityLabel: text("entity_label"),
  /** Extra context as JSON (e.g. status transitions, amounts). */
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
});

// ─── Stock Movements ──────────────────────────────────────────────────────────

/**
 * Every inventory change — regardless of source — creates one row here.
 * This is the audit trail and the backbone of all stock reporting.
 *
 * Movement types:
 *   PURCHASE          — stock received from supplier (delta > 0)
 *   ADJUSTMENT_ADD    — manual correction / count adjustment upward (delta > 0)
 *   ADJUSTMENT_REMOVE — manual correction / damage / loss (delta < 0)
 *   ORDER_DEDUCTED    — stock reserved when an order is confirmed (delta < 0)
 *   ORDER_CANCELLED   — stock restored when an order is cancelled (delta > 0)
 *   ORDER_RETURNED    — stock restored when a delivered order is returned (delta > 0)
 *   OFFLINE_SALE      — direct sale not via the online order system (delta < 0)
 */
export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  /** NULL for simple products (hasVariants = false). */
  variantId: text("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: [
      "PURCHASE",
      "ADJUSTMENT_ADD",
      "ADJUSTMENT_REMOVE",
      "ORDER_DEDUCTED",
      "ORDER_CANCELLED",
      "ORDER_RETURNED",
      "OFFLINE_SALE",
    ],
  }).notNull(),
  /** Signed quantity change. Positive = stock in, negative = stock out. Never zero. */
  delta: integer("delta").notNull(),
  /** Inventory level immediately before this movement was applied. */
  qtyBefore: integer("qty_before").notNull(),
  /** Inventory level immediately after this movement was applied. */
  qtyAfter: integer("qty_after").notNull(),
  /** Human note explaining the reason (required for manual adjustments and offline sales). */
  reason: text("reason"),
  /** External reference — orderId for ORDER_* types, null otherwise. */
  reference: text("reference"),
  /** User ID of the team member who triggered this movement. */
  createdBy: text("created_by").notNull(),
  /** Denormalised name — preserved even if the user is later deleted. */
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});


// ─── Webhook Events ───────────────────────────────────────────────────────────

/**
 * The webhook inbox: every delivery from ZR Express or Yalidine, stored before
 * it is answered and processed after (cod-server/src/inbound). UNIQUE(provider,
 * event_id) stores the same event once. `result` says what processing made of
 * it (cod-shared/inbound/inbox.ts); a matched event links its shipment.
 */
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  /** 'zr_express' | 'yalidine' */
  provider: text("provider").notNull(),
  /** svix-id header (ZR) or event_id field (Yalidine) — idempotency key */
  eventId: text("event_id").notNull(),
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id),
  /** raw tracking number from the provider payload */
  tracking: text("tracking"),
  /** 'parcel.state.updated' / 'parcel_status_updated' / etc. */
  eventType: text("event_type").notNull(),
  /** full JSON body for debugging and future reprocessing */
  rawPayload: text("raw_payload").notNull(),
  /** pending | ok | ignored | unmatched | unknown_status | deferred_settlement | error | dead (`unmapped` on older rows) */
  result: text("result").notNull().default("pending"),
  /** Yalidine reason field / ZR situation name */
  reason: text("reason"),
  errorMsg: text("error_msg"),
  processedAt: text("processed_at"),
  createdAt: text("created_at").notNull(),
  /** The shipment the event was matched to; null until matched, or once the shipment is voided. */
  shipmentId: text("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
  /** Times processing was tried. */
  attempts: integer("attempts").notNull().default(0),
  /** When processing may be tried (again); null once settled. */
  nextAttemptAt: text("next_attempt_at"),
}, (t) => ({
  providerEventUnique: uniqueIndex("webhook_events_provider_event_unique").on(t.provider, t.eventId),
  due: index("webhook_events_due").on(t.nextAttemptAt).where(sql`result IN ('pending', 'error')`),
  byShipment: index("webhook_events_shipment").on(t.shipmentId).where(sql`shipment_id IS NOT NULL`),
}));

// ─── Offers ───────────────────────────────────────────────────────────────────

/**
 * Buy X Get Y promotional offers.
 * Automatically applied server-side on storefront order creation.
 * No coupon code required — Algerian COD market.
 *
 * Trigger: customer orders >= triggerQuantity of triggerProduct
 *          (optionally restricted to a specific triggerVariant; null = any variant)
 *
 * Reward:  server auto-adds rewardQuantity of rewardProduct at pricePerUnit = 0
 *          (optionally a specific rewardVariant; null behaviour depends on whether
 *           rewardProduct === triggerProduct — see store/queries.ts for resolution logic)
 *
 * Scheduling: null startsAt = active immediately; null endsAt = never expires.
 * Quantity pricing (`quantity_price`): price tiers in `offer_price_tiers`;
 * `triggerQuantity` is its lowest tier's quantity.
 *
 * One offer per product per order — the highest threshold reached wins; the
 * rules are `offers/engine.ts`'s. createdAt ASC ordering applies only to the
 * storefront display list. The database keeps each kind coherent (migration
 * 0051).
 */
export const offers = sqliteTable("offers", {
  id: text("id").primaryKey(),

  /** Human-readable name shown in dashboard, e.g. "اشترِ 2 واحصل على 1 مجاناً" */
  name: text("name").notNull(),

  // ── Trigger ──────────────────────────────────────────────────────────────────
  /** Product the customer must buy to trigger this offer. */
  triggerProductId: text("trigger_product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  /**
   * Optional: restrict trigger to a specific variant.
   * null = any variant (or simple product) of triggerProduct triggers the offer.
   */
  triggerVariantId: text("trigger_variant_id")
    .references(() => productVariants.id, { onDelete: "set null" }),
  /** Minimum quantity the customer must order to trigger the offer. */
  triggerQuantity: integer("trigger_quantity").notNull().default(2),

  // ── Reward ───────────────────────────────────────────────────────────────────
  /**
   * Product given as reward.
   * NULL when discountType = 'free_shipping' (no product reward — shipping is free instead).
   */
  rewardProductId: text("reward_product_id")
    .references(() => products.id, { onDelete: "cascade" }),
  /**
   * Optional: specific variant to give as reward.
   * null + rewardProductId === triggerProductId → same variantId the customer ordered.
   * null + rewardProductId !== triggerProductId → default/first active variant.
   * Set explicitly when rewardProduct has variants and differs from triggerProduct.
   */
  rewardVariantId: text("reward_variant_id")
    .references(() => productVariants.id, { onDelete: "set null" }),
  /** Quantity of reward items to add for free. 0 when discountType = 'free_shipping'. */
  rewardQuantity: integer("reward_quantity").notNull().default(1),

  // ── Discount ─────────────────────────────────────────────────────────────────
  /**
   * "free"          = reward items at pricePerUnit = 0 (Buy X Get Y free product).
   * "free_shipping" = delivery fee overridden to 0 (no reward product inserted).
   */
  discountType: text("discount_type", { enum: OFFER_KINDS }).notNull().default("free"),

  // ── Schedule ─────────────────────────────────────────────────────────────────
  /** ISO 8601 datetime. null = active immediately. */
  startsAt: text("starts_at"),
  /** ISO 8601 datetime. null = never expires. */
  endsAt: text("ends_at"),

  status: text("status", { enum: ["active", "inactive"] })
    .notNull()
    .default("active"),

  /** Delivery method earning free shipping; null means both. */
  freeShippingDeliveryType: text("free_shipping_delivery_type", { enum: ["home", "stop_desk"] }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A quantity-pricing offer's tiers (migration 0051): from `quantity` units, the
 * line costs `price` for that many — the per-unit price of the highest tier
 * reached applies to every unit — with free delivery when `freeShipping`.
 */
export const offerPriceTiers = sqliteTable("offer_price_tiers", {
  offerId: text("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
  price: integer("price").notNull(),
  freeShipping: integer("free_shipping", { mode: "boolean" }).notNull().default(false),
  /** Delivery method earning this tier's free shipping; null inherits the offer's. */
  freeShippingDeliveryType: text("free_shipping_delivery_type", { enum: ["home", "stop_desk"] }),
}, (t) => ({
  pk: primaryKey({ columns: [t.offerId, t.quantity] }),
}));

// ─── Coupons ──────────────────────────────────────────────────────────────────

/**
 * A code a shopper enters at checkout, applied after offers to the lines no
 * offer applied to (`cod-shared/coupons/`, ADR 0007). The database keeps it
 * coherent and counts its uses (migration 0052).
 */
export const coupons = sqliteTable("coupons", {
  id: text("id").primaryKey(),
  /** Stored in its one form: upper case, A–Z 0–9 - _, 3 to 32 (`normalizeCouponCode`). */
  code: text("code").notNull().unique(),
  kind: text("kind", { enum: ["percentage", "fixed_amount", "free_shipping"] }).notNull(),
  /** Percent for `percentage`, dinars for `fixed_amount`, 0 for `free_shipping`. */
  value: integer("value").notNull(),
  maxDiscount: integer("max_discount"),
  minSubtotal: integer("min_subtotal"),
  minQuantity: integer("min_quantity"),
  scope: text("scope", { enum: ["store", "products", "collections"] }).notNull().default("store"),
  audience: text("audience", { enum: ["everyone", "selected"] }).notNull().default("everyone"),
  usageLimit: integer("usage_limit"),
  oncePerCustomer: integer("once_per_customer", { mode: "boolean" }).notNull().default(false),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const couponProducts = sqliteTable("coupon_products", {
  couponId: text("coupon_id").notNull().references(() => coupons.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.couponId, t.productId] }),
}));

export const couponCollections = sqliteTable("coupon_collections", {
  couponId: text("coupon_id").notNull().references(() => coupons.id, { onDelete: "cascade" }),
  collectionId: text("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.couponId, t.collectionId] }),
}));

export const couponCustomers = sqliteTable("coupon_customers", {
  couponId: text("coupon_id").notNull().references(() => coupons.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.couponId, t.customerId] }),
}));

export const couponCustomerGroups = sqliteTable("coupon_customer_groups", {
  couponId: text("coupon_id").notNull().references(() => coupons.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => customerGroups.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.couponId, t.groupId] }),
}));

// ─── Landing Pages ────────────────────────────────────────────────────────────

/**
 * A one-product marketing page: an ordered image stack with the COD order
 * form at the bottom. Merchants create several per product, run ads to each,
 * and compare which one converts. All marketing copy lives inside the images;
 * the engine charges the catalog price (no price override — see PR #90).
 */
export const landingPages = sqliteTable("landing_pages", {
  id: text("id").primaryKey(),
  /** Public URL identifier: [a-z0-9-]{3,60}. Auto-generated `lp-<8char>` default. */
  slug: text("slug").notNull().unique(),
  /** Internal label, e.g. "Zinc v3 — carousel ad". Never rendered publicly. */
  name: text("name").notNull(),
  /** The single product this page sells. */
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  status: text("status", { enum: ["draft", "published", "archived"] })
    .notNull()
    .default("draft"),

  // ── Spacing settings (the entire Studio right sidebar) ────────────────────
  /** Pixels between stacked images. 0 = flush stack. */
  imageGap: integer("image_gap").notNull().default(0),
  /** Pixels of page side padding. 0 = full-bleed. */
  sidePadding: integer("side_padding").notNull().default(0),
  /** Max content width in pixels. 0 = full width (mobile-first default). */
  contentMaxWidth: integer("content_max_width").notNull().default(0),

  // ── SEO ───────────────────────────────────────────────────────────────────
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),

  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One row of the landing page image stack. Mirrors product_images:
 * R2 object + alt text + position. `source` anticipates the AI-generation
 * future phase (upload | ai) without carrying any v1 behavior.
 * `width`/`height` (px, captured client-side at upload) let the storefront
 * reserve layout space before the bytes arrive — no form-jumping CLS.
 * Nullable: legacy rows and failed client measurements render without dims.
 */
export const landingPageImages = sqliteTable("landing_page_images", {
  id: text("id").primaryKey(),
  landingPageId: text("landing_page_id")
    .notNull()
    .references(() => landingPages.id, { onDelete: "cascade" }),
  altText: text("alt_text"),
  source: text("source", { enum: ["upload", "ai"] }).notNull().default("upload"),
  position: integer("position").notNull().default(1),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at").notNull(),
  /** The image's Media Key (migration 0068). */
  mediaKey: text("media_key").notNull(),
});

// ─── Media (migration 0068, ADR 0021) ────────────────────────────────────────

/**
 * One file the store keeps to show (cod-shared/media). Tables and documents
 * that show it hold only its `key`; its bytes are on `host`. Pending until the
 * host confirms the upload; nothing attaches a pending key. No foreign key
 * points here: keys also live in JSON and HTML, so every reference is checked
 * one way (`media/references.ts`).
 */
export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  host: text("host", { enum: MEDIA_HOSTS }).notNull(),
  /** The host's own id for the file (ImageKit's `fileId`); null on R2. */
  hostRef: text("host_ref"),
  kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes"),
  width: integer("width"),
  height: integer("height"),
  status: text("status", { enum: MEDIA_STATUSES }).notNull(),
  createdAt: text("created_at").notNull(),
  readyAt: text("ready_at"),
  /** A voice note's length (migration 0091); null for an image. */
  durationMs: integer("duration_ms"),
}, (t) => ({
  statusIdx: index("idx_media_status_created").on(t.status, t.createdAt),
}));

// `dashboard_brand` (migrations 0000 and 0008) is dropped by migration 0064:
// the dashboard never showed its values.

// ─── Meta Pixel / CAPI ───────────────────────────────────────────────────────

/**
 * Per-store Meta Pixel + Conversions API configuration.
 * One row per store. No row = tracking disabled (safe default).
 * Kept separate from `stores` — analytics config is a distinct concern.
 */
export const storePixelConfig = sqliteTable("store_pixel_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  pixelId: text("pixel_id").notNull(),
  /** Merchant's label for the Meta ad account this pixel belongs to — reference only, never sent to Meta. */
  adAccountName: text("ad_account_name"),
  accessToken: text("access_token").notNull(),
  /** Meta test event code — used during integration testing only. Set to null in production. */
  testEventCode: text("test_event_code"),
  /** Which CAPI event the merchant optimizes for — chosen explicitly in the dashboard, never defaulted by the UI. */
  conversionEvent: text("conversion_event", { enum: ["Lead", "Purchase", "Purchase_Confirmed", "Purchase_Delivered"] }).notNull().default("Purchase"),
  /** When true, CAPI events carry test_event_code to Meta's test stream instead of production measurement. */
  testMode: integer("test_mode", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /**
   * The master switch for per-landing-page tracking.
   *
   * While false, `landing_page_pixel_config` rows are ignored entirely and
   * every page reports to this pixel — which is both the default for every
   * store and the feature's rollback. It is honoured inside
   * `resolveTrackingConfig` and nowhere else, so the browser and the
   * Conversions API can never disagree about whether the feature is on.
   */
  perPageTrackingEnabled: integer("per_page_tracking_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A landing page's own Meta Pixel + Conversions API configuration, which
 * REPLACES the store's for that page's visitors and for the orders attributed
 * to it. No row = inherit the store, which is every landing page today.
 *
 * Deliberately a mirror of `store_pixel_config`: the identical shape is what
 * lets one resolver serve both sources, so precedence is the only thing this
 * feature adds rather than a second set of rules.
 *
 * Kept off `landing_pages` on purpose. That table is read with a full-table
 * `select()` on the public storefront path, where an `access_token` column
 * would be one careless spread away from shipping a credential to every
 * visitor's browser.
 */
export const landingPagePixelConfig = sqliteTable("landing_page_pixel_config", {
  id: text("id").primaryKey(),
  landingPageId: text("landing_page_id")
    .notNull()
    .unique()
    .references(() => landingPages.id, { onDelete: "cascade" }),
  pixelId: text("pixel_id").notNull(),
  /** Merchant's label for the Meta ad account this pixel belongs to — reference only, never sent to Meta. */
  adAccountName: text("ad_account_name"),
  accessToken: text("access_token").notNull(),
  /** Meta test event code — used during integration testing only. */
  testEventCode: text("test_event_code"),
  /** This page's own conversion choice: a product with a 40% confirmation rate may deserve a different optimisation event from one at 80%. */
  conversionEvent: text("conversion_event", { enum: ["Lead", "Purchase", "Purchase_Confirmed", "Purchase_Delivered"] }).notNull().default("Purchase"),
  testMode: integer("test_mode", { mode: "boolean" }).notNull().default(false),
  /** Switched off = fall back to the store pixel, without losing what was configured. */
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Per-store WhatsApp OTP verification configuration (dzverify provider).
 * One row per store. No row = verification disabled (safe default).
 * Kept separate from `stores` — checkout verification is a distinct concern,
 * and the API key is merchant integration config (like carrier tokens), never
 * a worker secret.
 */
export const storeOtpConfig = sqliteTable("store_otp_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  /** WhatsApp message language for OTP sends: en | fr | ar. */
  language: text("language", { enum: ["en", "fr", "ar"] }).notNull().default("ar"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Per-store Sendili transactional email configuration.
 * One row per store. No row = email sending disabled (safe default).
 * Kept separate from `stores` — outbound email is a distinct concern, and
 * the API key is merchant integration config (like carrier tokens and the
 * dzverify key), never a worker secret.
 */
export const storeEmailConfig = sqliteTable("store_email_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  /** Verified sender address — its domain must be verified in the Sendili workspace. */
  fromEmail: text("from_email").notNull(),
  /** Optional sender display name (e.g. the store name). */
  fromName: text("from_name"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Per-store Cloudflare Turnstile configuration (checkout bot protection).
 * One row per store. No row = Turnstile disabled (safe default).
 * Kept separate from `stores` — checkout bot protection is a distinct concern,
 * and the secret key is merchant integration config (like the dzverify/Sendili
 * keys), never a worker secret. The site key is public by design (it is
 * rendered into storefront HTML); the secret key never leaves the server.
 */
export const storeTurnstileConfig = sqliteTable("store_turnstile_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  /** Public widget site key — safe to expose to the storefront. */
  siteKey: text("site_key").notNull(),
  /** Server-side siteverify secret — never returned to any client. */
  secretKey: text("secret_key").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Audit log for every CAPI event attempt sent by CodCapiWorkflow.
 * status: 'sent' | 'failed' | 'skipped'
 * metaEventId: fbtrace_id from Meta response (present on success only).
 */
/**
 * Merchant-owned content pages: Terms, Privacy, Refund/Return, Shipping, and
 * any custom page the merchant adds later.
 *
 * These exist because Meta Ads rejects a storefront with no policy pages, which
 * blocks an Algerian COD merchant from advertising at all. They are seeded from
 * the template pack in `cod-shared/legal/` at store provision, then owned
 * outright by the merchant — the storefront renders these rows and holds no
 * copy of its own.
 *
 * The page row is identity and publication state; the words live in
 * `storePageTranslations`, one row per locale.
 */
export const storePages = sqliteTable("store_pages", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  /**
   * What this page *is*, independent of what it is called or where it lives.
   * The storefront resolves Terms by kind, never by slug, so a merchant may
   * rename `/pages/terms` to `/pages/conditions-generales` freely.
   */
  kind: text("kind", {
    enum: ["terms", "privacy", "refund", "shipping", "custom"],
  }).notNull(),
  /** Public URL segment under `/pages/`: [a-z0-9-]{3,60}, unique per store. */
  slug: text("slug").notNull(),
  /** Draft pages 404 on the storefront and are never indexed. */
  status: text("status", { enum: ["published", "draft"] })
    .notNull()
    .default("published"),
  showInFooter: integer("show_in_footer", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
  /** Which template revision seeded this page; null for merchant-created pages. */
  templateVersion: integer("template_version"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  slugUnique: uniqueIndex("idx_store_pages_slug").on(t.storeId, t.slug),
  footerIdx: index("idx_store_pages_footer").on(t.storeId, t.status, t.position),
}));

/**
 * One locale of one page. Composite primary key `(pageId, locale)`.
 *
 * Legal pages are seeded in every supported language, so adding or publishing
 * a store language never reveals a blank policy page. The storefront serves a
 * page in the requested published language, else the primary.
 */
export const storePageTranslations = sqliteTable("store_page_translations", {
  pageId: text("page_id")
    .notNull()
    .references(() => storePages.id, { onDelete: "cascade" }),
  locale: text("locale", { enum: STORE_LOCALES }).notNull(),
  title: text("title").notNull(),
  /**
   * Sanitised at the write chokepoint (`cod-shared/queries/store-pages.ts`).
   * Rendered with `set:html` and never re-parsed downstream — the same
   * contract as a product's rich-text description.
   */
  bodyHtml: text("body_html").notNull(),
  /** Derived from bodyHtml via toPlainText(): meta-description fallback. */
  bodyPlain: text("body_plain").notNull(),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  /**
   * 'template' = still the untouched seed, 'merchant' = edited at least once.
   * Flipped by the write chokepoint, so the dashboard can tell a merchant
   * which pages still need five minutes of their attention without parsing
   * any HTML.
   */
  source: text("source", { enum: ["template", "merchant"] })
    .notNull()
    .default("template"),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.pageId, t.locale] }),
}));

/**
 * The merchant facts a legal document cannot be written without.
 *
 * Substituted into the templates at seed time; a clause whose fact is missing
 * is omitted rather than rendered with a placeholder, so a seeded page is
 * always publishable as-is. The public subset (contact + windows) is exposed
 * through `/store/config` because Meta requires visible contact details on the
 * storefront as well as the policy pages themselves. Legal identity (RC, NIF)
 * appears only inside the documents.
 */
export const storeLegalProfile = sqliteTable("store_legal_profile", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  legalName: text("legal_name"),
  /** Registre de Commerce number. */
  rcNumber: text("rc_number"),
  /** Numéro d'Identification Fiscale. */
  nif: text("nif"),
  address: text("address"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  /** 0 = no post-delivery return window offered; the clause is then omitted. */
  returnWindowDays: integer("return_window_days").notNull().default(0),
  deliveryMinDays: integer("delivery_min_days").notNull().default(2),
  deliveryMaxDays: integer("delivery_max_days").notNull().default(7),
  updatedAt: text("updated_at").notNull(),
});

export const capiEventLog = sqliteTable(
  "capi_event_log",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    stage: text("stage").notNull().default("delivered"),
    status: text("status").notNull(),
    /**
     * Which Meta pixel this event was sent to — the first question asked when
     * a merchant running several pixels says an event is missing. Nullable:
     * rows written before migration 0029 genuinely do not know.
     */
    pixelId: text("pixel_id"),
    metaEventId: text("meta_event_id"),
    error: text("error"),
    sentAt: text("sent_at").notNull(),
  },
  (t) => ({
    orderIdx: index("idx_capi_event_log_order").on(t.orderId),
    claimUnique: uniqueIndex("idx_capi_event_log_claim").on(t.orderId, t.stage, t.eventName),
  })
);

// ─── better-auth tables ──────────────────────────────────────────────────────
// Declared so the dashboard's auth code can reference them via Drizzle. The D1
// schema itself is created by cod-server migrations (0000_complete.sql).

export const sessions = sqliteTable("sessions", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token:     text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
}, (t) => ({
  userIdIdx: index("sessions_user_id_idx").on(t.userId),
}));

export const accounts = sqliteTable("accounts", {
  id:                    text("id").primaryKey(),
  userId:                text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId:             text("account_id").notNull(),
  providerId:            text("provider_id").notNull(),
  issuer:                text("issuer"),
  accessToken:           text("access_token"),
  refreshToken:          text("refresh_token"),
  idToken:               text("id_token"),
  accessTokenExpiresAt:  integer("access_token_expires_at",  { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope:                 text("scope"),
  password:              text("password"),
  createdAt:             integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  updatedAt:             integer("updated_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
}, (t) => ({
  userIdIdx: index("accounts_user_id_idx").on(t.userId),
}));

export const verifications = sqliteTable("verifications", {
  id:         text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value:      text("value").notNull(),
  expiresAt:  integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt:  integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  updatedAt:  integer("updated_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
}, (t) => ({
  identifierIdx: index("verifications_identifier_idx").on(t.identifier),
}));

// ─── better-auth jwt() plugin ─────────────────────────────────────────────────
// RSA keypair storage for signing OAuth access tokens. The public half is
// exposed via /api/auth/jwks so cod-server can verify tokens offline.
// Added by the MCP rollout (MCP-5).
export const jwkss = sqliteTable("jwkss", {
  id:         text("id").primaryKey(),
  publicKey:  text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt:  integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  expiresAt:  integer("expires_at", { mode: "timestamp_ms" }),
  alg:        text("alg"),
  crv:        text("crv"),
});

// ─── @better-auth/oauth-provider (LEGACY — no longer written) ────────────────
// These tables backed the decommissioned Better Auth OAuth 2.1 Authorization
// Server plugin that used to issue MCP tokens from the dashboards. MCP OAuth
// moved to `@cloudflare/workers-oauth-provider` on cod-server (clients, grants,
// tokens, and props now live in the OAUTH_KV namespace, not D1). The tables are
// kept for historical data; nothing writes to them anymore. Do not drop without
// confirming no deployment still references them.
//
// Array columns (`string[]` in Better Auth's model) are stored as JSON text.
// Better Auth's Drizzle adapter serialises/deserialises automatically.
//
// `plural` mode is ON globally so Better Auth maps `oauthClient` → `oauthClients`
// in queries — table names below must match.

export const oauthClients = sqliteTable("oauthClients", {
  id:                      text("id").primaryKey(),
  clientId:                text("client_id").notNull().unique(),
  clientSecret:            text("client_secret"),
  disabled:                integer("disabled", { mode: "boolean" }).default(false),
  skipConsent:             integer("skip_consent", { mode: "boolean" }),
  enableEndSession:        integer("enable_end_session", { mode: "boolean" }),
  subjectType:             text("subject_type"),
  scopes:                  text("scopes"),                   // JSON string[]
  userId:                  text("user_id").references(() => users.id, { onDelete: "cascade" }),
  name:                    text("name"),
  uri:                     text("uri"),
  icon:                    text("icon"),
  contacts:                text("contacts"),                 // JSON string[]
  tos:                     text("tos"),
  policy:                  text("policy"),
  softwareId:              text("software_id"),
  softwareVersion:         text("software_version"),
  softwareStatement:       text("software_statement"),
  redirectUris:            text("redirect_uris").notNull(),  // JSON string[]
  postLogoutRedirectUris:  text("post_logout_redirect_uris"),// JSON string[]
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  grantTypes:              text("grant_types"),              // JSON string[]
  responseTypes:           text("response_types"),           // JSON string[]
  type:                    text("type"),
  public:                  integer("public", { mode: "boolean" }),
  clientIdIssuedAt:        integer("client_id_issued_at",     { mode: "timestamp_ms" }),
  clientSecretExpiresAt:   integer("client_secret_expires_at",{ mode: "timestamp_ms" }),
  requirePkce:             integer("require_pkce", { mode: "boolean" }),
  referenceId:             text("reference_id"),
  metadata:                text("metadata"),                 // JSON
  createdAt:               integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  updatedAt:               integer("updated_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
}, (t) => ({
  userIdIdx: index("oauthClients_user_id_idx").on(t.userId),
}));

export const oauthRefreshTokens = sqliteTable("oauthRefreshTokens", {
  id:          text("id").primaryKey(),
  token:       text("token").notNull(),
  clientId:    text("client_id").notNull().references(() => oauthClients.clientId),
  sessionId:   text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  expiresAt:   integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt:   integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  revoked:     integer("revoked",    { mode: "timestamp_ms" }),
  authTime:    integer("auth_time",  { mode: "timestamp_ms" }),
  scopes:      text("scopes").notNull(),                     // JSON string[]
}, (t) => ({
  tokenIdx:    index("oauthRefreshTokens_token_idx").on(t.token),
  userIdIdx:   index("oauthRefreshTokens_user_id_idx").on(t.userId),
  clientIdIdx: index("oauthRefreshTokens_client_id_idx").on(t.clientId),
}));

export const oauthAccessTokens = sqliteTable("oauthAccessTokens", {
  id:          text("id").primaryKey(),
  token:       text("token").unique(),
  clientId:    text("client_id").notNull().references(() => oauthClients.clientId),
  sessionId:   text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId:      text("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  refreshId:   text("refresh_id").references(() => oauthRefreshTokens.id, { onDelete: "set null" }),
  expiresAt:   integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt:   integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  scopes:      text("scopes").notNull(),                     // JSON string[]
}, (t) => ({
  userIdIdx:   index("oauthAccessTokens_user_id_idx").on(t.userId),
  clientIdIdx: index("oauthAccessTokens_client_id_idx").on(t.clientId),
}));

export const oauthConsents = sqliteTable("oauthConsents", {
  id:          text("id").primaryKey(),
  clientId:    text("client_id").notNull().references(() => oauthClients.clientId),
  userId:      text("user_id").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  scopes:      text("scopes").notNull(),                     // JSON string[]
  createdAt:   integer("created_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
  updatedAt:   integer("updated_at", { mode: "timestamp_ms" }).default(authNow).notNull(),
}, (t) => ({
  userClientIdx: index("oauthConsents_user_client_idx").on(t.userId, t.clientId),
}));

// ─── Abandoned Orders ────────────────────────────────────────────────────────
// Recorded when a visitor fills name + phone in the storefront but never places an order.
// One record per browser session (sessionId UNIQUE). Status lifecycle:
//   pending  → created, < 30 min old (may still convert)
//   abandoned → 30+ min old with no order (Cron Trigger flips this)
//   converted → visitor placed an order (markConverted called synchronously)
//   contacted → merchant manually marked outreach done
export const abandonedOrders = sqliteTable("abandoned_orders", {
  id:                    text("id").primaryKey(),
  sessionId:             text("session_id").notNull().unique(),

  customerName:          text("customer_name").notNull(),
  phone:                 text("phone").notNull(),

  wilayaId:              integer("wilaya_id").references(() => wilayas.id),
  communeId:             text("commune_id").references(() => communes.id),
  wilayaName:            text("wilaya_name"),
  communeName:           text("commune_name"),

  /**
   * The first line of the basket, or the only product of a single-product
   * checkout. Always populated, so every existing reader — the dashboard
   * column, the search, the analytics query — works for both shapes.
   */
  productId:             text("product_id"),
  productName:           text("product_name"),
  variantId:             text("variant_id"),
  variantLabel:          text("variant_label"),
  /** Cart value at abandonment: the basket subtotal, or one unit's price. */
  price:                 real("price"),

  /** The whole basket. NULL for a single-product checkout. See migration 0028. */
  itemsJson:             text("items_json"),
  /** Distinct lines in the basket, so the list can say "and 4 more" cheaply. */
  itemCount:             integer("item_count"),

  deliveryType: text("delivery_type", { enum: ["home", "stop_desk"] }),

  fbc:                   text("fbc"),
  fbp:                   text("fbp"),
  ipAddress:             text("ip_address"),
  userAgent:             text("user_agent"),

  status: text("status", {
    enum: ["pending", "abandoned", "contacted", "converted"],
  }).notNull().default("pending"),

  convertedOrderId:      text("converted_order_id"),
  convertedOrderNumber:  text("converted_order_number"),

  recoveryAttempts:      integer("recovery_attempts").notNull().default(0),
  lastRecoveryAt:        text("last_recovery_at"),

  createdAt:             text("created_at").notNull(),
  updatedAt:             text("updated_at").notNull(),

  /** The visit's touches as captured (`cod-shared/attribution`), for the order a recovery creates (migration 0083). */
  attributionJson:       text("attribution_json"),
}, (t) => ({
  statusIdx:    index("abandoned_orders_status_idx").on(t.status),
  phoneIdx:     index("abandoned_orders_phone_idx").on(t.phone),
  createdAtIdx: index("abandoned_orders_created_at_idx").on(t.createdAt),
}));

// ─── Business Events (ADR 0016; migration 0059) ───────────────────────────────

/**
 * The Event Log: every Business Event the store records, written in the same
 * batch as its change (`cod-shared/events/record.ts`). No foreign keys: an
 * event outlives its subject and keeps the facts as they were.
 */
export const businessEvents = sqliteTable("business_events", {
  /** The Sequence: commit order. */
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  /** The public event id — the same on every delivery of the event. */
  id: text("id").notNull().unique(),
  type: text("type").$type<EventType>().notNull(),
  version: integer("version").notNull(),
  subjectType: text("subject_type").$type<EventSubject>().notNull(),
  subjectId: text("subject_id").notNull(),
  orderId: text("order_id").notNull(),
  actorKind: text("actor_kind").$type<ActorKind>().notNull(),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  origin: text("origin").$type<Origin>().notNull(),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
  /** The type's data, as `cod-server/src/events/catalogue.ts` promises it. */
  data: text("data").notNull(),
  /** When its Deliveries were created; null while it waits to be fanned out (migration 0060). */
  fannedOutAt: text("fanned_out_at"),
}, (t) => ({
  unfanned: index("business_events_unfanned").on(t.seq).where(sql`fanned_out_at IS NULL`),
  byOrder: index("business_events_order").on(t.orderId, t.seq),
}));

// ─── Event Deliveries (ADR 0017; migration 0060) ──────────────────────────────

/** Who receives the store's Business Events: a webhook, a chat, an inbox, the customer, Meta. */
export const eventConsumers = sqliteTable("event_consumers", {
  id: text("id").primaryKey(),
  /** The Consumer Kind: how it is reached (`cod-server/src/events/consumers`). */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** JSON: the Subscription's patterns (`cod-shared/events/subscription.ts`). */
  subscription: text("subscription").notNull(),
  /** The catalogue version its Deliveries are written in, pinned when it was created. */
  catalogueVersion: integer("catalogue_version").notNull().default(1),
  /** JSON: the kind's own settings. */
  settings: text("settings").notNull().default("{}"),
  /** A webhook's Signing Secret, and the previous one while a rotation settles. Never sent to the browser in full (ADR 0001). */
  signingSecret: text("signing_secret"),
  previousSigningSecret: text("previous_signing_secret"),
  secretRotatedAt: text("secret_rotated_at"),
  /** Since when every Attempt has failed; null once one succeeds. */
  failingSince: text("failing_since"),
  /** Why the store stopped delivering to it, when it did. */
  disabledReason: text("disabled_reason", { enum: CONSUMER_DISABLED_REASONS }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** One Business Event on its way to one Consumer. */
export const eventDeliveries = sqliteTable("event_deliveries", {
  id: text("id").primaryKey(),
  eventSeq: integer("event_seq").notNull().references(() => businessEvents.seq, { onDelete: "cascade" }),
  consumerId: text("consumer_id").notNull().references(() => eventConsumers.id, { onDelete: "cascade" }),
  state: text("state", { enum: DELIVERY_STATES }).notNull().default("due"),
  attempts: integer("attempts").notNull().default(0),
  /** When it may be tried (again) — also its lease while an Attempt runs; null once settled. */
  nextAttemptAt: text("next_attempt_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  settledAt: text("settled_at"),
}, (t) => ({
  once: uniqueIndex("event_deliveries_event_seq_consumer_id_unique").on(t.eventSeq, t.consumerId),
  due: index("event_deliveries_due").on(t.nextAttemptAt).where(sql`state = 'due'`),
  byConsumer: index("event_deliveries_consumer").on(t.consumerId, t.createdAt),
}));

/** One try at a Delivery, with what the Consumer answered. */
export const eventDeliveryAttempts = sqliteTable("event_delivery_attempts", {
  id: text("id").primaryKey(),
  deliveryId: text("delivery_id").notNull().references(() => eventDeliveries.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  attemptedAt: text("attempted_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  outcome: text("outcome", { enum: ATTEMPT_OUTCOMES }).notNull(),
  httpStatus: integer("http_status"),
  /** The first kilobyte of what the Consumer answered. */
  responseExcerpt: text("response_excerpt"),
  error: text("error"),
}, (t) => ({
  byDelivery: index("event_delivery_attempts_delivery").on(t.deliveryId, t.attempt),
}));

/**
 * The Telegram App's bot, beside the Telegram Consumer it sends through
 * (ADR 0020). `botToken` and `webhookSecret` are secrets: never sent to the
 * browser. `chatId` is null until the merchant presses Start on the pairing
 * link; the pairing code is kept only as its SHA-256.
 */
export const storeTelegramConfig = sqliteTable("store_telegram_config", {
  consumerId: text("consumer_id").primaryKey().references(() => eventConsumers.id, { onDelete: "cascade" }),
  botToken: text("bot_token").notNull(),
  botId: integer("bot_id").notNull(),
  botUsername: text("bot_username").notNull(),
  /** The `secret_token` Telegram sends back on every update, in `X-Telegram-Bot-Api-Secret-Token`. */
  webhookSecret: text("webhook_secret").notNull(),
  chatId: integer("chat_id"),
  chatName: text("chat_name"),
  connectedAt: text("connected_at"),
  pairingCodeHash: text("pairing_code_hash"),
  pairingExpiresAt: text("pairing_expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Order Protection (cod-shared/order-screening; migration 0080) ────────────

/** A member of the confirmation team: takes orders, and receives new ones automatically while `receiving` (migration 0086). */
export const teamAgents = sqliteTable("team_agents", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  receiving: integer("receiving", { mode: "boolean" }).notNull().default(false),
  /** Their place in turn: grows each time any member gets an order, so the lowest (or none) is next. Kept by a trigger. */
  turn: integer("turn"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Each time someone is on the confirmation team, joined to left; kept by triggers on team_agents (migration 0086). */
export const teamMemberships = sqliteTable("team_memberships", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
  /** Null while they are on the team. */
  leftAt: text("left_at"),
});

/** A member's pay, each rate from a date: a past month keeps the rates it had (migration 0086). */
export const teamPay = sqliteTable("team_pay", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: PAY_KINDS }).notNull(),
  /** In DZD: a month's salary, or the amount per order. */
  amount: integer("amount").notNull(),
  /** YYYY-MM-DD; a salary from the first of a month. */
  validFrom: text("valid_from").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
}, (t) => ({
  from: uniqueIndex("team_pay_from").on(t.userId, t.kind, t.validFrom),
}));

/** How the store shares its orders out; no row is `DEFAULT_TEAM_CONFIG` (migration 0086). */
export const storeTeamConfig = sqliteTable("store_team_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().unique().references(() => stores.id, { onDelete: "cascade" }),
  distribution: text("distribution", { enum: DISTRIBUTIONS }).notNull().default("manual"),
  /** Minutes a member has to act on a new order before it moves on; null = never. */
  takeBackMinutes: integer("take_back_minutes"),
  /** How many times an order moves on before it waits for a manager. */
  takeBackLimit: integer("take_back_limit").notNull().default(2),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storeOrderProtectionConfig = sqliteTable("store_order_protection_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const orderRules = sqliteTable("order_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode", { enum: RULE_MODES }).notNull(),
  action: text("action", { enum: RULE_ACTIONS }).notNull(),
  conditionsJson: text("conditions_json").notNull(),
  templateKey: text("template_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** The template rule this rule came from while it keeps the template's name: shown in each reader's language. */
  templateRule: text("template_rule"),
});

export const orderBlockList = sqliteTable("order_block_list", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: BLOCK_LIST_KINDS }).notNull(),
  value: text("value").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  entry: uniqueIndex("order_block_list_entry").on(t.kind, t.value),
}));

/** One row per screened submission; counts read only from here. A Spam Order is a row with `outcome = 'spam'`. */
export const orderAttempts = sqliteTable("order_attempts", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  phone: text("phone").notNull(),
  ipKey: text("ip_key"),
  deviceKey: text("device_key"),
  outcome: text("outcome", { enum: ORDER_ATTEMPT_OUTCOMES }).notNull(),
  orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  checkoutKey: text("checkout_key"),
  matchesJson: text("matches_json").notNull().default("[]"),
  signalsJson: text("signals_json").notNull().default("{}"),
  submissionJson: text("submission_json"),
  answerJson: text("answer_json"),
}, (t) => ({
  phone: index("order_attempts_phone").on(t.phone, t.createdAt),
  ip: index("order_attempts_ip").on(t.ipKey, t.createdAt).where(sql`ip_key IS NOT NULL`),
  device: index("order_attempts_device").on(t.deviceKey, t.createdAt).where(sql`device_key IS NOT NULL`),
  outcome: index("order_attempts_outcome").on(t.outcome, t.createdAt),
  order: index("order_attempts_order").on(t.orderId).where(sql`order_id IS NOT NULL`),
  spamNumber: uniqueIndex("order_attempts_spam_number").on(t.orderNumber).where(sql`outcome = 'spam'`),
  spamCheckout: uniqueIndex("order_attempts_spam_checkout").on(t.checkoutKey).where(sql`outcome = 'spam' AND checkout_key IS NOT NULL`),
}));

/**
 * The store's own costs (migration 0087): one row per version; the versions
 * of one cost share `series_id`, each running from `valid_from` to
 * `valid_to` (store days, both included; null while it runs). See
 * finance/model.ts for the charges and how each one counts.
 */
export const costs = sqliteTable("costs", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull(),
  name: text("name").notNull(),
  category: text("category", { enum: COST_CATEGORIES }).notNull(),
  charge: text("charge", { enum: COST_CHARGES }).notNull(),
  /** In the currency's minor unit (centimes, cents). */
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency", { enum: CURRENCIES }).notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
  /** The product it is for; null for the whole store. Not a foreign key: it stays when the product is deleted, so its orders still count. */
  productId: text("product_id"),
  /** Set only for a product's cost: the product's name, set to its last one when the product is deleted. */
  productName: text("product_name"),
  createdBy: text("created_by"),
  /** A fresh random token per write, the same on every version of the cost: the guard that keeps two changes at once from both applying. */
  revision: text("revision").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  series: uniqueIndex("costs_series").on(t.seriesId, t.validFrom),
}));

/** What one dollar or euro costs the merchant in dinar centimes, from a store day on (migration 0087). */
export const exchangeRates = sqliteTable("exchange_rates", {
  id: text("id").primaryKey(),
  currency: text("currency", { enum: FOREIGN_CURRENCIES }).notNull(),
  centimesPerUnit: integer("centimes_per_unit").notNull(),
  validFrom: text("valid_from").notNull(),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  from: uniqueIndex("exchange_rates_from").on(t.currency, t.validFrom),
}));
