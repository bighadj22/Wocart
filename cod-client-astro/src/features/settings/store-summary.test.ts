// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

const seam = vi.hoisted(() => ({ getMyStore: vi.fn(), updateMyStore: vi.fn() }));
vi.mock("./api", () => seam);

const store = { id: "s1", name: "Maysa", domain: "maysashop.online", logo: null, lang: "ar" };

beforeEach(() => {
  vi.resetModules();
  seam.getMyStore.mockReset();
  seam.updateMyStore.mockReset();
  sessionStorage.clear();
});

describe("the store summary", () => {
  it("is read once a visit, shared by every caller at once, with only what the frame shows", async () => {
    seam.getMyStore.mockResolvedValue(store);
    const { readStoreSummary } = await import("./store-summary");
    const [first, second] = await Promise.all([readStoreSummary(), readStoreSummary()]);
    await readStoreSummary();

    expect(seam.getMyStore).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ name: "Maysa", domain: "maysashop.online", logo: null });
    expect(second).toEqual(first);
  });

  it("does not keep a read that failed", async () => {
    seam.getMyStore.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(store);
    const { readStoreSummary } = await import("./store-summary");
    await expect(readStoreSummary()).rejects.toThrow("offline");
    await expect(readStoreSummary()).resolves.toMatchObject({ name: "Maysa" });
    expect(seam.getMyStore).toHaveBeenCalledTimes(2);
  });

  it("takes a saved store at once, tells every watcher, and is kept for the next page of the tab", async () => {
    seam.getMyStore.mockResolvedValue(store);
    const { readStoreSummary, storeSummaryChanged, watchStoreSummary, cachedStoreSummary } = await import("./store-summary");
    await readStoreSummary();
    const seen: string[] = [];
    const stop = watchStoreSummary((summary) => seen.push(summary.name));

    storeSummaryChanged({ ...store, name: "Maysa Shop" });
    expect(seen).toEqual(["Maysa Shop"]);
    await expect(readStoreSummary()).resolves.toMatchObject({ name: "Maysa Shop" });
    expect(cachedStoreSummary()).toEqual({ name: "Maysa Shop", domain: "maysashop.online", logo: null });
    expect(seam.getMyStore).toHaveBeenCalledTimes(1);

    stop();
    storeSummaryChanged({ ...store, name: "Later" });
    expect(seen).toEqual(["Maysa Shop"]);
  });

  it("is told of every save of the store, and the dashboard saves the store nowhere else", async () => {
    seam.updateMyStore.mockResolvedValue({ ...store, name: "Maysa Shop", logo: { key: "products/logo.webp", url: "https://media.example.com/products/logo.webp", width: 512, height: 512 } });
    const { saveMyStore, watchStoreSummary } = await import("./store-summary");
    const seen: unknown[] = [];
    watchStoreSummary((summary) => seen.push(summary));

    await expect(saveMyStore({ name: "Maysa Shop" })).resolves.toMatchObject({ id: "s1", name: "Maysa Shop" });
    expect(seam.updateMyStore).toHaveBeenCalledWith({ name: "Maysa Shop" });
    expect(seen).toEqual([{ name: "Maysa Shop", domain: "maysashop.online", logo: { key: "products/logo.webp", url: "https://media.example.com/products/logo.webp", width: 512, height: 512 } }]);

    const callers = sourceFiles(SRC).filter((file) => /\bupdateMyStore\(/.test(readFileSync(file, "utf8"))).map((file) => relative(SRC, file).replace(/\\/g, "/"));
    expect(callers.sort()).toEqual(["features/settings/api.ts", "features/settings/store-summary.ts"]);
  });
});
