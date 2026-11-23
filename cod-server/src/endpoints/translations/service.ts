import { z } from "@hono/zod-openapi";
import type { AppDb } from "@/db";
import type { Env } from "@/types/env";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import { mediaDeliveryOf } from "@/lib/media";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { STORE_LOCALES, type StoreLocale } from "../../../../cod-shared/i18n/locales";
import {
  OPTION_KEY_PREFIX,
  OPTION_TEXT,
  TRANSLATABLE,
  indistinctOptions,
  parseVariantOptions,
  sourceDigest,
  translatableSources,
  translationView,
  type TranslatableResource,
} from "../../../../cod-shared/i18n/translations";
import { storedRichText, toServedHtml } from "../../../../cod-shared/media/rich-text";
import { getStore, listStoreLocales } from "../../../../cod-shared/queries/stores";
import { listResourceTranslations, writeTranslations } from "../../../../cod-shared/queries/translations";
import { storeLanguages } from "../../../../cod-shared/stores/settings";

const translationValue = (maxLength: number) => z.string().trim().min(1).max(maxLength).nullable();
const MAX_PATCH_KEYS = 80;

export function translationPatchSchema(resource: TranslatableResource) {
  const fields = TRANSLATABLE[resource];
  const values = z.object(
    Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, translationValue(field.maxLength).optional()]),
    ),
  );
  return z.object({
    locale: z.enum(STORE_LOCALES),
    values: resource === "product" ? values.catchall(translationValue(OPTION_TEXT.maxLength)) : values.strict(),
  });
}

export const TranslationViewSchema = z.object({
  resource: z.string(),
  id: z.string(),
  sourceLocale: z.enum(STORE_LOCALES),
  targetLocales: z.array(z.object({ locale: z.enum(STORE_LOCALES), published: z.boolean() })),
  source: z.record(z.string(), z.string().nullable()),
  options: z.array(
    z.object({
      name: z.string(),
      key: z.string(),
      values: z.array(z.object({ value: z.string(), key: z.string() })),
    }),
  ),
  translations: z.partialRecord(
    z.enum(STORE_LOCALES),
    z.record(z.string(), z.object({ value: z.string(), outdated: z.boolean() })),
  ),
});

export type TranslationViewData = z.infer<typeof TranslationViewSchema>;

export interface TranslationRecord extends Record<string, unknown> {
  id: string;
}

export async function readResourceTranslations(
  db: AppDb,
  env: Env,
  input: {
    resource: TranslatableResource;
    record: TranslationRecord;
    store?: { id: string; lang: StoreLocale };
  },
): Promise<TranslationViewData> {
  const store = input.store ?? (await getStore(db));
  if (!store) throw new NotFoundError("Store");

  const [rows, localeRows] = await Promise.all([
    listResourceTranslations(db, input.resource, input.record.id),
    listStoreLocales(db, store.id),
  ]);
  const view = await translationView(input.resource, input.record, rows);
  const sources = translatableSources(input.resource, input.record);
  const hasHtml = sources.some(({ field }) => field.kind === "html");
  if (hasHtml) {
    const delivery = mediaDeliveryOf(env);
    for (const { key, field } of sources) {
      if (field.kind !== "html") continue;
      const source = view.source[key];
      if (source) view.source[key] = toServedHtml(source, delivery);
      for (const fields of Object.values(view.translations)) {
        const translated = fields?.[key];
        if (translated) translated.value = toServedHtml(translated.value, delivery);
      }
    }
  }
  const targetLocales = storeLanguages(store.lang, localeRows)
    .filter((language) => !language.primary)
    .map(({ locale, published }) => ({ locale, published }));

  return {
    resource: input.resource,
    id: input.record.id,
    sourceLocale: store.lang,
    targetLocales,
    ...view,
  };
}

export async function patchResourceTranslations(
  db: AppDb,
  env: Env,
  input: {
    resource: TranslatableResource;
    record: TranslationRecord;
    label: string;
    locale: StoreLocale;
    values: Record<string, string | null | undefined>;
    store?: { id: string; lang: StoreLocale };
  },
): Promise<TranslationViewData> {
  const store = input.store ?? (await getStore(db));
  if (!store) throw new NotFoundError("Store");

  const { resource, record, label, locale, values } = input;
  const languages = storeLanguages(store.lang, await listStoreLocales(db, store.id));
  if (locale === store.lang) {
    throw new ValidationError(
      `${locale} is the store's primary language — edit the ${label.toLowerCase()} itself`,
      ERROR_CODES.VALIDATION_FAILED,
    );
  }
  if (!languages.some((language) => language.locale === locale)) {
    throw new ValidationError(`Add ${locale} to the store's languages before translating into it`, ERROR_CODES.VALIDATION_FAILED);
  }

  const entries = Object.entries(values);
  if (entries.length > MAX_PATCH_KEYS) {
    throw new ValidationError(`At most ${MAX_PATCH_KEYS} fields can be updated in a single request`, ERROR_CODES.VALIDATION_FAILED);
  }

  const sources = new Map(translatableSources(resource, record).map((field) => [field.key, field]));
  const set: { key: string; value: string; sourceDigest: string }[] = [];
  const remove: string[] = [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const target = sources.get(key);
    if (!target && !(value === null && key.startsWith(OPTION_KEY_PREFIX))) {
      throw new ValidationError(`${key} is not a translatable field of this ${label.toLowerCase()}`, ERROR_CODES.VALIDATION_FAILED, { field: key });
    }
    if (value === null) {
      remove.push(key);
      continue;
    }
    if (!target!.source) {
      throw new ValidationError(`The ${label.toLowerCase()} has no ${key} to translate — write it in the primary language first`, ERROR_CODES.VALIDATION_FAILED, { field: key });
    }
    const stored = target!.field.kind === "html" ? await storedRichText(value, mediaDeliveryOf(env)) : value;
    set.push({ key, value: stored, sourceDigest: await sourceDigest(target!.source) });
  }

  const options = parseVariantOptions(record.variantOptions);
  if (options.length > 0 && set.length + remove.length > 0) {
    const merged: Record<string, string> = {};
    for (const row of await listResourceTranslations(db, resource, record.id)) {
      if (row.locale === locale) merged[row.key] = row.value;
    }
    for (const key of remove) delete merged[key];
    for (const { key, value } of set) merged[key] = value;
    const [indistinct] = indistinctOptions(options, merged);
    if (indistinct !== undefined) {
      throw new ValidationError(
        indistinct === null
          ? "Two options would read the same in this language — give each its own name"
          : `Two values of "${indistinct}" would read the same in this language — give each its own text`,
        ERROR_CODES.VALIDATION_FAILED,
        { option: indistinct },
      );
    }
  }

  await writeTranslations(db, { resource, resourceId: record.id, locale }, { set, remove });
  return readResourceTranslations(db, env, { resource, record, store });
}
