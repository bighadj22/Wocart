/**
 * The storefront's appearance — its color schemes and its theme text — as the
 * dashboard's Appearance tab reads and writes them.
 *
 * Local customization: the contract in AGENTS.md says theme settings are
 * written by Wocart Cloud's editor. This file is the one deliberate exception,
 * kept apart from the rest of the stores endpoints so a future update can drop
 * it and reapply it.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import type { Env } from "@/types/env";
import { mediaDeliveryOf } from "@/lib/media";
import { defineRoute } from "@/lib/route-builder";
import { getDb } from "@/db";
import * as queries from "./queries";
import {
  getThemeSettings,
  listContentOverrides,
  saveContentOverrides,
  saveThemeSettings,
} from "../../../../cod-shared/queries/stores";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import {
  APPEARANCE_DEFAULT_SCHEMES,
  APPEARANCE_HEADER_HTML_MAX,
  APPEARANCE_HEX,
  APPEARANCE_HOME_SECTIONS,
  APPEARANCE_LOGO_ALIGNMENTS,
  APPEARANCE_MAX_SCHEMES,
  APPEARANCE_MEDIA_KEY,
  APPEARANCE_SCHEME_ID,
  APPEARANCE_TEXT_KEYS,
  appearanceLocaleProblem,
  appearanceSettingsToRemove,
  appearanceSettingsToTheme,
  appearanceTextProblem,
  appearanceThemeSettingsOf,
  mergeAppearance,
  sanitizeHeaderHtml,
  type AppearanceColorScheme,
  type AppearanceHomeSectionKey,
  type AppearanceLogoAlignment,
  type AppearanceSectionEdits,
} from "../../../../cod-shared/stores/appearance";
import { imageOf } from "../../../../cod-shared/media/views";
import { SuccessResponseSchema } from "@/openapi/schemas";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const colorSchemeSchema = z.object({
  id: z.string().regex(APPEARANCE_SCHEME_ID),
  name: z.union([z.string().min(1), z.record(z.string(), z.string())]),
  colors: z.object({
    background: z.string().regex(APPEARANCE_HEX),
    text: z.string().regex(APPEARANCE_HEX),
    heading: z.string().regex(APPEARANCE_HEX),
    accent: z.string().regex(APPEARANCE_HEX),
    button: z.string().regex(APPEARANCE_HEX),
    buttonText: z.string().regex(APPEARANCE_HEX),
    border: z.string().regex(APPEARANCE_HEX),
  }),
});

const SECTION_KEYS = APPEARANCE_HOME_SECTIONS.map((section) => section.key) as [
  AppearanceHomeSectionKey,
  ...AppearanceHomeSectionKey[],
];
const logoAlignmentSchema = z.enum(
  APPEARANCE_LOGO_ALIGNMENTS as unknown as [AppearanceLogoAlignment, ...AppearanceLogoAlignment[]],
);

const appearanceImageSchema = z.object({
  key: z.string().regex(APPEARANCE_MEDIA_KEY),
  alt: z.string().max(200).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  focal: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .optional(),
});

const sectionEditSchema = z.object({
  hidden: z.boolean().nullable().optional(),
  image: appearanceImageSchema.nullable().optional(),
});

const sectionStateSchema = z.object({
  hidden: z.boolean(),
  image: z
    .object({
      key: z.string(),
      url: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
    })
    .nullable(),
});

const appearanceSchema = z.object({
  themeKey: z.string(),
  primaryLocale: z.enum(STORE_LOCALES),
  locales: z.array(z.enum(STORE_LOCALES)),
  colorSchemes: z.array(colorSchemeSchema),
  pageScheme: z.string(),
  hideLogo: z.boolean(),
  searchEnabled: z.boolean(),
  headerHtml: z.string(),
  logoAlignment: logoAlignmentSchema,
  sections: z.record(z.enum(SECTION_KEYS), sectionStateSchema),
  texts: z.record(z.string(), z.record(z.string(), z.string())),
});

const saveAppearanceSchema = z.object({
  colorSchemes: z.array(colorSchemeSchema).min(1).max(APPEARANCE_MAX_SCHEMES),
  pageScheme: z.string(),
  hideLogo: z.boolean().optional(),
  searchEnabled: z.boolean().optional(),
  headerHtml: z.string().max(APPEARANCE_HEADER_HTML_MAX).optional(),
  logoAlignment: logoAlignmentSchema.optional(),
  sections: z.record(z.enum(SECTION_KEYS), sectionEditSchema).optional(),
  texts: z
    .object({
      locale: z.enum(STORE_LOCALES),
      values: z.record(z.string(), z.string().max(400)),
    })
    .optional(),
});

type StoreRow = NonNullable<Awaited<ReturnType<typeof queries.getStore>>>;

async function appearanceOf(db: ReturnType<typeof getDb>, store: StoreRow, env: Env) {
  const stored = await getThemeSettings(db, store.id, store.themeId);
  const saved = appearanceThemeSettingsOf(stored);
  const colorSchemes = saved?.colorSchemes ?? APPEARANCE_DEFAULT_SCHEMES;
  const pageScheme = saved?.pageScheme ?? colorSchemes[0]!.id;
  const [localeRows, overrides] = await Promise.all([
    queries.listStoreLocales(db, store.id),
    listContentOverrides(db, store.id, store.themeId),
  ]);
  const locales = localeRows.map((row) => row.locale);
  const texts: Record<string, Record<string, string>> = {};
  for (const row of overrides) {
    if (!locales.includes(row.locale)) continue;
    if (!(APPEARANCE_TEXT_KEYS as readonly string[]).includes(row.key)) continue;
    (texts[row.locale] ??= {})[row.key] = row.value;
  }
  const delivery = mediaDeliveryOf(env);
  const sections = Object.fromEntries(
    APPEARANCE_HOME_SECTIONS.map((section) => {
      const edit = saved?.sections?.[section.key];
      const source = edit?.image;
      return [
        section.key,
        {
          hidden: edit?.hidden === true,
          image: source
            ? imageOf(source.key, delivery, { width: source.width, height: source.height })
            : null,
        },
      ];
    }),
  );
  return {
    themeKey: store.themeId,
    primaryLocale: store.lang,
    locales,
    colorSchemes,
    pageScheme,
    hideLogo: saved?.hideLogo ?? false,
    searchEnabled: saved?.searchEnabled ?? true,
    headerHtml: saved?.headerHtml ?? "",
    logoAlignment: saved?.logoAlignment ?? "right",
    sections,
    texts,
  };
}

export async function getAppearance(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");
  return c.json({ success: true, data: await appearanceOf(db, store, c.env) }, 200);
}

export async function saveAppearance(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await queries.getStore(db);
  if (!store) throw new NotFoundError("Store");

  const body = ((c.req as any).valid?.("json") ??
    saveAppearanceSchema.parse(await c.req.json())) as z.infer<typeof saveAppearanceSchema>;
  const stored = await getThemeSettings(db, store.id, store.themeId);
  const saved = appearanceThemeSettingsOf(stored);
  const merged = mergeAppearance(saved, {
    colorSchemes: body.colorSchemes as AppearanceColorScheme[],
    pageScheme: body.pageScheme,
    hideLogo: body.hideLogo ?? saved?.hideLogo ?? false,
    searchEnabled: body.searchEnabled ?? saved?.searchEnabled ?? true,
    headerHtml: sanitizeHeaderHtml(body.headerHtml ?? saved?.headerHtml ?? ""),
    logoAlignment: body.logoAlignment ?? saved?.logoAlignment ?? "right",
    sections: body.sections as AppearanceSectionEdits | undefined,
  });
  if (merged.error || !merged.settings) {
    throw new ValidationError(merged.error ?? "The colors cannot be saved", ERROR_CODES.VALIDATION_FAILED);
  }

  if (body.texts) {
    const localeRows = await queries.listStoreLocales(db, store.id);
    const localeProblem = appearanceLocaleProblem(
      body.texts.locale,
      localeRows.map((row) => row.locale),
    );
    if (localeProblem) throw new ValidationError(localeProblem, ERROR_CODES.VALIDATION_FAILED);
    for (const [key, value] of Object.entries(body.texts.values)) {
      const problem = appearanceTextProblem(key, value);
      if (problem) throw new ValidationError(problem, ERROR_CODES.VALIDATION_FAILED);
    }
  }

  const flat = {
    ...stored,
    ...appearanceSettingsToTheme(merged.settings),
  } as Record<string, unknown>;
  for (const key of appearanceSettingsToRemove(merged.settings)) delete flat[key];
  await saveThemeSettings(db, store.id, store.themeId, flat);
  if (body.texts) {
    await saveContentOverrides(
      db,
      store.id,
      store.themeId,
      body.texts.locale,
      Object.entries(body.texts.values).map(([key, value]) => ({ key, value })),
    );
  }

  return c.json({ success: true, data: await appearanceOf(db, store, c.env) }, 200);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const getAppearanceRoute = defineRoute({
  method: "get",
  path: "/me/appearance",
  auth: "admin",
  tags: ["Store Settings"],
  summary: "Get the storefront's appearance",
  description:
    "Returns the store's color schemes, the scheme its page wears, its storefront switches and a safe header HTML strip, and the theme text it edited, per language.",
  operationId: "getStoreAppearance",
  responses: {
    200: {
      description: "The storefront's appearance",
      content: jsonContent(SuccessResponseSchema(appearanceSchema)),
    },
  },
  handler: getAppearance,
});

const saveAppearanceRoute = defineRoute({
  method: "put",
  path: "/me/appearance",
  auth: "admin",
  tags: ["Store Settings"],
  summary: "Save the storefront's appearance",
  description:
    "Replaces the colors of the store's existing schemes, the scheme the page wears, its storefront switches and a safe header HTML strip, and (optionally) one language's theme text edits. An empty text deletes the edit.",
  operationId: "saveStoreAppearance",
  body: saveAppearanceSchema,
  responses: {
    200: {
      description: "The storefront's appearance after the save",
      content: jsonContent(SuccessResponseSchema(appearanceSchema)),
    },
  },
  handler: saveAppearance,
});

export function registerAppearanceRoutes(router: OpenAPIHono<AppContext>) {
  router.openapi(getAppearanceRoute.route, getAppearanceRoute.handler);
  router.openapi(saveAppearanceRoute.route, saveAppearanceRoute.handler);
}
