import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const layout = readFileSync(join(SRC, "layouts/DashboardLayout.astro"), "utf8");

const OUTSIDE_THE_DASHBOARD = [
  "pages/sign-in/index.astro",
  "pages/forgot-password/index.astro",
  "pages/reset-password/index.astro",
  "pages/delivery/index.astro",
  "pages/print/labels.astro",
  "pages/print/delivery-sheet.astro",
];

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? pages(path) : path.endsWith(".astro") ? [path] : [];
  });
}

describe("the dashboard frame", () => {
  it("keeps the sidebar and the top bar across navigation, each its own persisted island", () => {
    const islands = [...layout.matchAll(/<(Frame\w+)\s+client:only="react"\s+transition:persist="([^"]+)"\s*\/>/g)];
    expect(islands.map(([, name]) => name)).toEqual(["FrameSidebar", "FrameTopbar"]);
    expect(new Set(islands.map(([, , id]) => id)).size).toBe(2);
  });

  it("holds the frame still while the page under it changes, and hides it on frameless routes", () => {
    const shells = [...layout.matchAll(/<div\s+data-frame="(\w+)"\s+class="([^"]*)"\s+transition:name="[^"]+"\s+transition:animate="none"\s*>/g)];
    expect(shells.map(([, part]) => part)).toEqual(["sidebar", "topbar"]);
    for (const [, , classes] of shells) expect(classes.split(" ")).toContain("frameless:hidden");
    const layer = (classes: string) => Number(/\bz-\[?(\d+)\]?/.exec(classes)?.[1] ?? 0);
    const [sidebar, topbar] = shells.map(([, , classes]) => classes);
    expect(sidebar.split(" ")).toContain("relative");
    expect(topbar.split(" ")).toContain("relative");
    expect(layer(topbar), "the mobile menu opens above the page and its action bars (z-40)").toBeGreaterThanOrEqual(50);
    expect(layer(sidebar), "the skip link shows above the top bar").toBeGreaterThan(layer(topbar));
    expect(layer(sidebar), "dialogs (z-70) cover the frame").toBeLessThan(70);
    expect(layout).toMatch(/define:vars=\{\{ framelessPath: FRAMELESS_PATH\.source \}\}/);
    expect(layout).toMatch(/document\.addEventListener\("astro:after-swap", applyFrameMode\)/);
  });

  it("is around every dashboard page, so moving between them never drops it", () => {
    const framed = pages(join(SRC, "pages"))
      .map((path) => relative(SRC, path).replace(/\\/g, "/"))
      .filter((path) => !OUTSIDE_THE_DASHBOARD.includes(path));
    expect(framed.length).toBeGreaterThan(30);
    for (const path of framed) {
      const source = readFileSync(join(SRC, path), "utf8");
      expect(source, path).toMatch(/<DashboardLayout>[\s\S]*<\/DashboardLayout>/);
      expect(source, path).not.toMatch(/BaseLayout|<main\b/);
    }
  });

  it("shows one loading state on every page: the page skeleton, then the page in its place", () => {
    const gated = pages(join(SRC, "pages"))
      .map((path) => relative(SRC, path).replace(/\\/g, "/"))
      .filter((path) => !["pages/sign-in/index.astro", "pages/forgot-password/index.astro", "pages/reset-password/index.astro", "pages/delivery/index.astro"].includes(path));
    expect(gated.length).toBeGreaterThan(30);
    for (const path of gated) {
      const source = readFileSync(join(SRC, path), "utf8");
      expect(source, path).toMatch(/<PageSkeleton gate="required" \/>\s*<div data-auth-gate="required" hidden>\s*<\w+(?: \w+=\{\w+\})* client:only="react" \/>\s*<\/div>/);
      expect(source, path).not.toMatch(/GateSpinner|data-gate-spinner/);
    }
  });
});
