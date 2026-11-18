import { and, eq, notInArray } from "drizzle-orm";
import { storeContentOverrides, storeLocales, storeThemeSettings, stores } from "../db/schema";
import type { AppDb } from "../db/client";
import type { LocaleRow } from "../stores/settings";
import type { StoreLocale } from "../i18n/locales";

type StoreUpdate = Partial<typeof stores.$inferInsert>;
type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Single-tenant: returns the one store in this D1 database. */
export async function getStore(db: AppDb) {
  return db.select().from(stores).get();
}

export async function listStoreLocales(db: AppDb, storeId: string) {
  return db
    .select({ locale: storeLocales.locale, published: storeLocales.published })
    .from(storeLocales)
    .where(eq(storeLocales.storeId, storeId))
    .all();
}

/**
 * Save the store's columns and, when `locales` is given, replace its language
 * list — in one batch, so `stores.lang` and its published row never disagree.
 * A removed language takes its theme text edits with it (FK cascade).
 */
export async function updateStore(
  db: AppDb,
  storeId: string,
  data: StoreUpdate,
  locales: readonly LocaleRow[] | null = null,
) {
  const now = new Date().toISOString();
  const statements: BatchStatement[] = [
    db.update(stores).set({ ...data, updatedAt: now }).where(eq(stores.id, storeId)),
  ];
  if (locales !== null) {
    statements.push(
      db.delete(storeLocales).where(
        and(
          eq(storeLocales.storeId, storeId),
          notInArray(storeLocales.locale, locales.map((row) => row.locale)),
        ),
      ),
      ...locales.map((row) =>
        db
          .insert(storeLocales)
          .values({ storeId, locale: row.locale, published: row.published, createdAt: now })
          .onConflictDoUpdate({
            target: [storeLocales.storeId, storeLocales.locale],
            set: { published: row.published },
          }),
      ),
    );
  }
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return db.select().from(stores).where(eq(stores.id, storeId)).get();
}

/**
 * Every edit a store made to one theme's text, across its languages — the
 * storefront read. The writer is CodFlow Cloud's visual editor, outside this
 * repository.
 */
export async function listContentOverrides(db: AppDb, storeId: string, themeKey: string) {
  return db
    .select({ locale: storeContentOverrides.locale, key: storeContentOverrides.key, value: storeContentOverrides.value })
    .from(storeContentOverrides)
    .where(and(eq(storeContentOverrides.storeId, storeId), eq(storeContentOverrides.themeKey, themeKey)))
    .orderBy(storeContentOverrides.locale, storeContentOverrides.key)
    .all();
}

/**
 * A store's saved values for one theme's settings, as stored — the theme
 * reads them against its own declaration (`resolveThemeSettings` in
 * `@wocart/theme`), so a value it no longer accepts falls back to its
 * default there. `{}` when the store saved none. Written by CodFlow Cloud.
 */
export async function getThemeSettings(db: AppDb, storeId: string, themeKey: string): Promise<Record<string, unknown>> {
  const row = await db
    .select({ values: storeThemeSettings.values })
    .from(storeThemeSettings)
    .where(and(eq(storeThemeSettings.storeId, storeId), eq(storeThemeSettings.themeKey, themeKey)))
    .get();
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.values);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Write one theme's whole settings object for a store. The Appearance editor
 * sends what it read back with the colors it changed, so keys it does not own
 * (page documents, theme declarations) survive the save.
 */
export async function saveThemeSettings(
  db: AppDb,
  storeId: string,
  themeKey: string,
  values: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const serialized = JSON.stringify(values);
  await db
    .insert(storeThemeSettings)
    .values({ storeId, themeKey, values: serialized, updatedAt: now })
    .onConflictDoUpdate({
      target: [storeThemeSettings.storeId, storeThemeSettings.themeKey],
      set: { values: serialized, updatedAt: now },
    });
}

/**
 * Save a store's text edits for one theme and language. An empty value deletes
 * the row so the theme's own copy applies again; everything else is upserted.
 * Batched, so a save lands whole or not at all.
 */
export async function saveContentOverrides(
  db: AppDb,
  storeId: string,
  themeKey: string,
  locale: StoreLocale,
  edits: readonly { key: string; value: string }[],
) {
  if (edits.length === 0) return;
  const now = new Date().toISOString();
  const statements: BatchStatement[] = edits.map(({ key, value }) =>
    value === ""
      ? db
          .delete(storeContentOverrides)
          .where(
            and(
              eq(storeContentOverrides.storeId, storeId),
              eq(storeContentOverrides.themeKey, themeKey),
              eq(storeContentOverrides.locale, locale),
              eq(storeContentOverrides.key, key),
            ),
          )
      : db
          .insert(storeContentOverrides)
          .values({ storeId, themeKey, locale, key, value, updatedAt: now })
          .onConflictDoUpdate({
            target: [
              storeContentOverrides.storeId,
              storeContentOverrides.themeKey,
              storeContentOverrides.locale,
              storeContentOverrides.key,
            ],
            set: { value, updatedAt: now },
          }),
  );
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}

