/**
 * The Media module's boundary (ADR 0021), read from the source of cod-server
 * and cod-shared: the store's bucket is reached only through Staging and the
 * R2 host; no code reads a column Media Keys replaced; nothing of the system
 * before them is left.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SOURCES = ["cod-server/src", "cod-shared"].map((dir) => join(ROOT, dir));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "migrations", "test-utils", "testing"].includes(entry.name) ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const FILES = SOURCES.flatMap(sourceFiles).map((path) => ({ path: relative(ROOT, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

/** Each line of a file matching `pattern`, as `path:line: text`. */
function matches(pattern: RegExp, files = FILES): string[] {
  return files.flatMap(({ path, text }) =>
    text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  );
}

describe("the store's bucket", () => {
  it("is handed only to Staging and the R2 host", () => {
    const uses = matches(/MEDIA_BUCKET/).filter((use) => !use.startsWith("cod-server/src/types/env.ts:"));
    const allowed = /staging\((?:c\.|this\.)?env\.MEDIA_BUCKET\)|r2Host\(\{ binding: env\.MEDIA_BUCKET \}\)/;
    expect(uses.filter((use) => !allowed.test(use))).toEqual([]);
    expect(uses.length).toBeGreaterThan(0);
  });

  it("is used as a bucket only by Staging and the R2 host", () => {
    const owners = new Set(["cod-server/src/lib/staging.ts", "cod-shared/media/hosts/r2.ts", "cod-server/src/types/env.ts"]);
    expect(matches(/\bR2Bucket\b/).filter((use) => !owners.has(use.split(":")[0]!))).toEqual([]);
  });
});

describe("the columns Media Keys replaced (dropped by migration 0069)", () => {
  it("are read by no code", () => {
    const outsideSchema = FILES.filter(({ path }) => path !== "cod-shared/db/schema.ts");
    const drizzle = /\b(productImages|landingPageImages|reviewMedia)\.(src|r2Key|srcSm|srcMd|srcLg)\b|\bproductCategories\.imageUrl\b|\bstores\.(logoUrl|ogImage)\b/;
    const sql = /\b(r2_key|image_url|logo_url|og_image|src_sm|src_md|src_lg)\b|\bpi\.src\b/;
    expect(matches(drizzle, outsideSchema)).toEqual([]);
    expect(matches(sql, outsideSchema)).toEqual([]);
  });
});

describe("the media system before Media Keys", () => {
  it("is gone", () => {
    expect(matches(/MEDIA_DOMAIN|R2_BUCKET_NAME|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|CF_ACCOUNT_ID|\benv\.IMAGES\b|@aws-sdk|review-uploads\/|endpoints\/images\//)).toEqual([]);
  });
});
