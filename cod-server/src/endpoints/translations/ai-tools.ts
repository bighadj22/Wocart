import { tool } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db";
import type { Env } from "@/types/env";
import { AppError } from "@/lib/errors/classes";
import { toolId } from "@/lib/tool-input";
import { toolOutput } from "@/lib/tool-output-schema";
import { offers, productCategories, products } from "../../../../cod-shared/db/schema";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";
import type { TranslatableResource } from "../../../../cod-shared/i18n/translations";
import {
  patchResourceTranslations,
  readResourceTranslations,
  translationPatchSchema,
  type TranslationRecord,
} from "./service";

const productPatch = translationPatchSchema("product");
const categoryPatch = translationPatchSchema("category");
const offerPatch = translationPatchSchema("offer");

export const getProductTranslationsSchema = z.object({
  productId: toolId().describe("The ID of the product whose translations to read"),
});

export const updateProductTranslationsSchema = z.object({
  productId: toolId().describe("The ID of the product to translate"),
  locale: productPatch.shape.locale.describe("Target language code (ar, fr, en) — must be an added non-primary store language"),
  values: productPatch.shape.values.describe(
    "JSON Merge Patch of fields to translate: name, description (HTML, sanitised server-side), metaTitle, metaDescription, or variant option keys returned by getProductTranslations (e.g. option:[\"Color\"]). Pass a string to set, null to remove, or omit to leave unchanged.",
  ),
});

export const getProductGroupTranslationsSchema = z.object({
  groupId: toolId().describe("The ID of the product group (category) whose translations to read"),
});

export const updateProductGroupTranslationsSchema = z.object({
  groupId: toolId().describe("The ID of the product group (category) to translate"),
  locale: categoryPatch.shape.locale.describe("Target language code (ar, fr, en) — must be an added non-primary store language"),
  values: categoryPatch.shape.values.describe(
    "JSON Merge Patch of fields to translate: name, description, metaTitle, metaDescription. Pass a string to set, null to remove, or omit to leave unchanged.",
  ),
});

export const getOfferTranslationsSchema = z.object({
  offerId: toolId().describe("The ID of the offer whose translations to read"),
});

export const updateOfferTranslationsSchema = z.object({
  offerId: toolId().describe("The ID of the offer to translate"),
  locale: offerPatch.shape.locale.describe("Target language code (ar, fr, en) — must be an added non-primary store language"),
  values: offerPatch.shape.values.describe(
    "JSON Merge Patch of fields to translate: name. Pass a string to set, null to remove, or omit to leave unchanged.",
  ),
});

export const TRANSLATION_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  getProductTranslations: getProductTranslationsSchema.shape,
  updateProductTranslations: updateProductTranslationsSchema.shape,
  getProductGroupTranslations: getProductGroupTranslationsSchema.shape,
  updateProductGroupTranslations: updateProductGroupTranslationsSchema.shape,
  getOfferTranslations: getOfferTranslationsSchema.shape,
  updateOfferTranslations: updateOfferTranslationsSchema.shape,
};

const translationOutputSchema = toolOutput({
  resource: z.string(),
  id: z.string(),
  sourceLocale: z.enum(STORE_LOCALES).describe("The store's primary language"),
  targetLocales: z.array(z.looseObject({ locale: z.enum(STORE_LOCALES), published: z.boolean() })).describe("Languages this resource can be translated into"),
  source: z.record(z.string(), z.string().nullable()).describe("Source field values in the store's primary language"),
  options: z.array(
    z.looseObject({
      name: z.string(),
      key: z.string(),
      values: z.array(z.looseObject({ value: z.string(), key: z.string() })),
    }),
  ).describe("Translatable variant option keys (for products with variants)"),
  translations: z.record(
    z.string(),
    z.record(z.string(), z.looseObject({ value: z.string(), outdated: z.boolean() })),
  ).describe("Stored translations keyed by locale then field key; outdated=true when source changed since translation"),
});

export const TRANSLATION_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  getProductTranslations: translationOutputSchema,
  updateProductTranslations: translationOutputSchema,
  getProductGroupTranslations: translationOutputSchema,
  updateProductGroupTranslations: translationOutputSchema,
  getOfferTranslations: translationOutputSchema,
  updateOfferTranslations: translationOutputSchema,
};

const invalid = (error: z.ZodError) => ({
  success: false as const,
  error: `Invalid arguments: ${error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`,
});

function formatError(error: unknown): { success: false; error: string } {
  if (error instanceof AppError) return { success: false, error: error.message };
  console.error("[mcp:translations] unexpected error", error);
  return { success: false, error: "Failed to process translations" };
}

async function runRead(
  db: AppDb,
  env: Env,
  resource: TranslatableResource,
  label: string,
  id: string,
  load: (db: AppDb, id: string) => Promise<TranslationRecord | undefined>,
) {
  try {
    const record = await load(db, id);
    if (!record) return { success: false as const, error: `${label} '${id}' not found` };
    const view = await readResourceTranslations(db, env, { resource, record });
    return { success: true as const, ...view };
  } catch (error) {
    return formatError(error);
  }
}

async function runUpdate(
  db: AppDb,
  env: Env,
  resource: TranslatableResource,
  label: string,
  id: string,
  locale: (typeof STORE_LOCALES)[number],
  values: Record<string, string | null | undefined>,
  load: (db: AppDb, id: string) => Promise<TranslationRecord | undefined>,
) {
  try {
    const record = await load(db, id);
    if (!record) return { success: false as const, error: `${label} '${id}' not found` };
    const view = await patchResourceTranslations(db, env, { resource, record, label, locale, values });
    return { success: true as const, ...view };
  } catch (error) {
    return formatError(error);
  }
}

const loadProduct = (db: AppDb, id: string) => db.select().from(products).where(eq(products.id, id)).get();
const loadCategory = (db: AppDb, id: string) => db.select().from(productCategories).where(eq(productCategories.id, id)).get();
const loadOffer = (db: AppDb, id: string) => db.select().from(offers).where(eq(offers.id, id)).get();

export const getTranslationTools = (db: AppDb, env: Env) => ({
  getProductTranslations: tool({
    description:
      "Read a product's primary-language source fields (name, description, SEO, variant options), target store languages, and every stored translation with its outdated flag.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = getProductTranslationsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      return runRead(db, env, "product", "Product", parsed.data.productId, loadProduct);
    },
  }),

  updateProductTranslations: tool({
    description:
      "Translate a product into one non-primary store language (JSON Merge Patch: string sets a field, null removes it, omitted fields stay unchanged). Call getProductTranslations first to inspect source fields, targetLocales, and variant option keys.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = updateProductTranslationsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      return runUpdate(db, env, "product", "Product", parsed.data.productId, parsed.data.locale, parsed.data.values, loadProduct);
    },
  }),

  getProductGroupTranslations: tool({
    description:
      "Read a product group's (category's) primary-language source fields (name, description, SEO), target store languages, and every stored translation with its outdated flag.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = getProductGroupTranslationsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      return runRead(db, env, "category", "Category", parsed.data.groupId, loadCategory);
    },
  }),

  updateProductGroupTranslations: tool({
    description:
      "Translate a product group (category) into one non-primary store language (JSON Merge Patch: string sets a field, null removes it, omitted fields stay unchanged). Call getProductGroupTranslations first to see targetLocales and source fields.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = updateProductGroupTranslationsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      return runUpdate(db, env, "category", "Category", parsed.data.groupId, parsed.data.locale, parsed.data.values, loadCategory);
    },
  }),

  getOfferTranslations: tool({
    description:
      "Read an offer's primary-language name, target store languages, and every stored translation with its outdated flag.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = getOfferTranslationsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      return runRead(db, env, "offer", "Offer", parsed.data.offerId, loadOffer);
    },
  }),

  updateOfferTranslations: tool({
    description:
      "Translate an offer's name into one non-primary store language (JSON Merge Patch: string sets name, null removes the translation). Call getOfferTranslations first to see targetLocales and source name.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = updateOfferTranslationsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);
      return runUpdate(db, env, "offer", "Offer", parsed.data.offerId, parsed.data.locale, parsed.data.values, loadOffer);
    },
  }),
});
