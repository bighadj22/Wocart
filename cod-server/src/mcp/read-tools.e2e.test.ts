/**
 * Every read-only MCP tool, run inside workerd (the Workers runtime) over a
 * real D1 store seeded with the starter catalog: each one answers, its answer
 * matches the output schema it declares, and none fails on its own code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleWorker, createTestD1, type TestD1 } from "@/test-utils/d1";
import { testMedia } from "@/test-utils/media";
import { webp } from "../../../cod-shared/media/hosts/testing/files";
import { demoCatalogSql, starterPrefix, storeDefaultsSql, storeStarterPictures, type StarterStore } from "../../../cod-shared/starter";
import { TOOL_ANNOTATIONS } from "./annotations";
import { TOOL_SCHEMAS } from "./schemas";

const WORKER = `
import { buildToolsForUser } from "@/mcp/registry";
import { TOOL_OUTPUT_SCHEMAS } from "@/mcp/schemas";
const PROPS = { userId: "u1", role: "admin", scopes: [], name: "Nadia", email: "nadia@example.com" };
export default {
  async fetch(request, env) {
    const name = new URL(request.url).pathname.slice(1);
    const tool = buildToolsForUser(env, PROPS)[name];
    if (!tool) return Response.json({ missing: true });
    let result;
    try {
      result = await tool.execute(await request.json(), { toolCallId: "t", messages: [] });
    } catch (error) {
      return Response.json({ threw: String(error && error.stack || error) });
    }
    const schema = TOOL_OUTPUT_SCHEMAS[name];
    const issues = schema ? (schema.safeParse(result).error?.issues ?? []).slice(0, 5).map((i) => i.path.join(".") + ": " + i.message) : [];
    return Response.json({ result, issues });
  },
};
`;

const NOW = "2026-11-04T08:00:00.000Z";
const STORE: StarterStore = { id: "store-1", name: "Boutique Amel", lang: "ar" };
const P = starterPrefix(STORE.id);

let d1: TestD1;
const ids: Record<string, string | number> = { wilayaId: 16, communeId: "c-16-001" };

beforeAll(async () => {
  d1 = await createTestD1({ worker: await bundleWorker(WORKER, __dirname, { external: ["fs", "path", "os"] }) });
  await d1.raw.prepare("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)").bind(STORE.id, STORE.name, STORE.lang, NOW).run();
  await storeStarterPictures(testMedia(d1), async () => webp());
  const statements = [...(await storeDefaultsSql(STORE, NOW)), ...(await demoCatalogSql(STORE, NOW))];
  for (let i = 0; i < statements.length; i += 50) await d1.raw.batch(statements.slice(i, i + 50).map((s) => d1.raw.prepare(s)));
  const first = async (table: string) => (await d1.raw.prepare(`SELECT id FROM ${table} WHERE id LIKE ?1 LIMIT 1`).bind(`${P}%`).first<{ id: string }>())!.id;
  ids.productId = `${P}product:handbag`;
  ids.groupId = await first("product_categories");
  ids.variantId = await first("product_variants");
  ids.offerId = await first("offers");
  ids.couponId = await first("coupons");
}, 180_000);

afterAll(async () => d1?.dispose());

const READ_TOOLS = Object.keys(TOOL_SCHEMAS)
  .filter((name) => TOOL_ANNOTATIONS[name]?.readOnlyHint)
  .sort();

function argsFor(name: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(TOOL_SCHEMAS[name]!)) {
    if ((schema as unknown as { safeParse(v: unknown): { success: boolean } }).safeParse(undefined).success) continue;
    args[key] = key in ids ? ids[key] : `${P}unknown`;
  }
  return args;
}

describe("read-only MCP tools on a starter store", () => {
  it("covers the read-only tools", () => {
    expect(READ_TOOLS.length).toBeGreaterThan(40);
  });

  it.each(READ_TOOLS)("%s answers to its own output schema", async (name) => {
    const res = (await (await d1.fetch(`http://mcp.test/${name}`, { method: "POST", body: JSON.stringify(argsFor(name)) })).json()) as {
      missing?: boolean;
      threw?: string;
      result?: { success?: boolean; error?: string };
      issues?: string[];
    };
    expect(res.missing).toBeUndefined();
    expect(res.threw).toBeUndefined();
    expect(res.issues).toEqual([]);
    expect(res.result?.error ?? "").not.toMatch(/Database error|is not defined|TypeError|SQLITE|no such (table|column)/);
  });
});
