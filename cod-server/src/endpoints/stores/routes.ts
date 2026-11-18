/**
 * Stores (Management) Routes
 *
 * Dashboard endpoints for reading and updating the store's own settings.
 * Single-tenant: the store is resolved from the D1 database, not from the
 * path. Admin-only, except the summary every signed-in member sees in the
 * dashboard frame. What an App sets up is under /api/apps.
 *
 * Not to be confused with /api/store/* — the public storefront API.
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import * as handlers from "./handlers";
import { registerTranslationRoutes } from "../translations/routes";
import { getStore } from "../../../../cod-shared/queries/stores";
import { updateStoreSchema } from "./validation";
import { registerAppearanceRoutes } from "./appearance";
import { StoreSchema, StoreSummarySchema, SuccessResponseSchema } from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

// ─── Request schemas ──────────────────────────────────────────────────────────

// NOTE: the PATCH /me body schema is NOT defined here. It is imported from
// ./validation (updateStoreSchema) — that used to be duplicated in this file,
// which drifted out of sync as settings were added: cartEnabled,
// freeShippingThreshold and cartShippingMode were writable per validation.ts
// but silently stripped by this file's stale copy before the handler ever
// saw them (OpenAPIHono validates the body against the route's `body` schema
// pre-handler; unknown keys are dropped, not rejected, so the save looked
// successful and did nothing). One schema, imported, so this cannot drift
// again.

// ─── Routes ───────────────────────────────────────────────────────────────────

const getMyStoreRoute = defineRoute({
  method: "get",
  path: "/me",
  auth: "admin",
  tags: ["Store Settings"],
  summary: "Get store configuration",
  description:
    "Returns the current store's configuration including branding, theme, localization, SEO, and storefront settings.",
  operationId: "getMyStore",
  responses: {
    200: {
      description: "Store configuration",
      content: jsonContent(SuccessResponseSchema(StoreSchema)),
    },
  },
  handler: handlers.getMyStore,
});

const getStoreSummaryRoute = defineRoute({
  method: "get",
  path: "/me/summary",
  auth: "api-key",
  tags: ["Store Settings"],
  summary: "Get the store's name and logo",
  description:
    "The store's name, storefront domain and logo, for anyone signed in, whatever their permissions: what the dashboard frame shows every member.",
  operationId: "getStoreSummary",
  responses: {
    200: {
      description: "The store's name, domain and logo",
      content: jsonContent(SuccessResponseSchema(StoreSummarySchema)),
    },
  },
  handler: handlers.getStoreSummary,
});

const updateMyStoreRoute = defineRoute({
  method: "patch",
  path: "/me",
  auth: "admin",
  tags: ["Store Settings"],
  summary: "Update store configuration",
  description:
    "Partially updates the store configuration. All fields are optional — only include the fields you want to change. Set nullable fields to `null` to clear them.",
  operationId: "updateMyStore",
  body: updateStoreSchema,
  responses: {
    200: {
      description: "Updated store configuration",
      content: jsonContent(SuccessResponseSchema(StoreSchema)),
    },
  },
  handler: handlers.updateMyStore,
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new OpenAPIHono<AppContext>();

router.openapi(getMyStoreRoute.route, getMyStoreRoute.handler);
router.openapi(getStoreSummaryRoute.route, getStoreSummaryRoute.handler);
router.openapi(updateMyStoreRoute.route, updateMyStoreRoute.handler);

// The Appearance tab: colors and theme text, written from the dashboard.
// Local customization — see `appearance.ts`.
registerAppearanceRoutes(router);

// The store's own translatable text (SEO, the currency symbol) — ADR 0005.
registerTranslationRoutes(router, {
  resource: "store",
  path: "/me/translations",
  read: "admin",
  write: "admin",
  label: "Store",
  tag: "Store Settings",
  load: (db) => getStore(db),
});

export default router;
