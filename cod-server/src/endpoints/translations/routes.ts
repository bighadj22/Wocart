/**
 * Translation routes for merchant data (ADR 0005, phase C).
 *
 * One factory, mounted by each translatable resource's own router so a
 * translation is guarded by the same scopes as the resource it translates:
 *
 *   GET   {path}  the source fields and every language's translations, each
 *                 flagged `outdated` when its source changed after it was written
 *   PATCH {path}  a JSON Merge Patch (RFC 7396) of one language: a string sets
 *                 a field, `null` removes it, other fields are untouched
 *
 * A translation is only ever for one of the store's added languages other than
 * the primary — the resource's own columns already hold the primary text.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getDb, type AppDb } from "@/db";
import { defineRoute, type AuthStrategy } from "@/lib/route-builder";
import { NotFoundError } from "@/lib/errors/classes";
import type { AppContext } from "@/types";
import type { TranslatableResource } from "../../../../cod-shared/i18n/translations";
import { getStore } from "../../../../cod-shared/queries/stores";
import {
  TranslationViewSchema,
  patchResourceTranslations,
  readResourceTranslations,
  translationPatchSchema,
} from "./service";

export { translationPatchSchema };

export interface TranslationRoutesOptions {
  resource: TranslatableResource;
  /** Path on the mounting router, e.g. `/{id}/translations` or `/me/translations`. */
  path: string;
  read: AuthStrategy;
  write: AuthStrategy;
  /** The resource's own row by id (the path's `{id}`, or undefined for `/me`). */
  load: (db: AppDb, id: string | undefined) => Promise<({ id: string } & Record<string, unknown>) | null | undefined>;
  /** For the OpenAPI tag and the 404 message. */
  label: string;
  tag: string;
}

export function registerTranslationRoutes(router: OpenAPIHono<AppContext>, options: TranslationRoutesOptions) {
  const { resource, path, label, tag } = options;
  const params = path.includes("{id}") ? z.object({ id: z.string() }) : undefined;
  const body = translationPatchSchema(resource);

  async function loadView(c: Context<AppContext>) {
    const db = getDb(c.env.DB);
    const id = c.req.param("id");
    const [record, store] = await Promise.all([options.load(db, id), getStore(db)]);
    if (!record) throw new NotFoundError(label, id);
    if (!store) throw new NotFoundError("Store");
    return { db, record, store };
  }

  const getRoute = defineRoute({
    method: "get",
    path,
    auth: options.read,
    tags: [tag],
    summary: `Get a ${label.toLowerCase()}'s translations`,
    description:
      "The translatable fields in the store's primary language and every stored translation, each flagged `outdated` when its source text changed after it was written.",
    operationId: `get${label.replace(/\s/g, "")}Translations`,
    ...(params ? { params } : {}),
    responses: { 200: { description: "Source and translations", content: { "application/json": { schema: z.object({ success: z.boolean(), data: TranslationViewSchema }) } } } },
    handler: async (c) => {
      const { db, record, store } = await loadView(c);
      const data = await readResourceTranslations(db, c.env, { resource, record, store });
      return c.json({ success: true, data }, 200);
    },
  });

  const patchRoute = defineRoute({
    method: "patch",
    path,
    auth: options.write,
    tags: [tag],
    summary: `Translate a ${label.toLowerCase()} into one language`,
    description:
      "A JSON Merge Patch (RFC 7396) of one language: a string sets a field, `null` removes its translation, other fields are untouched. The language must be one the store has added, and not its primary — the resource's own fields hold that.",
    operationId: `patch${label.replace(/\s/g, "")}Translations`,
    ...(params ? { params } : {}),
    body,
    responses: { 200: { description: "Source and translations after the patch", content: { "application/json": { schema: z.object({ success: z.boolean(), data: TranslationViewSchema }) } } } },
    handler: async (c) => {
      const { db, record, store } = await loadView(c);
      const { locale, values } = ((c.req as any).valid?.("json") ?? body.parse(await c.req.json())) as z.infer<typeof body>;
      const data = await patchResourceTranslations(db, c.env, { resource, record, label, locale, values, store });
      return c.json({ success: true, data }, 200);
    },
  });

  router.openapi(getRoute.route, getRoute.handler);
  router.openapi(patchRoute.route, patchRoute.handler);
}
