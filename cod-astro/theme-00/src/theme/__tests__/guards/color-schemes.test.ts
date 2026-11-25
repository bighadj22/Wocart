/**
 * Every color comes from the scheme an element wears, and the theme derives
 * its tokens on the SDK's own marker. `schemeClass(id)` always emits it, so a
 * section can never wear a scheme whose colors miss the theme's tokens — the
 * failure a marker of the theme's own invites, when one element forgets it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEME_MARKER_CLASS } from "@wocart/theme";
import { themeSourceFiles } from "./theme-source";

describe("color schemes", () => {
  it("derive the theme's tokens on the SDK's scheme marker only", () => {
    const css = readFileSync(resolve(process.cwd(), "src/theme/styles/global.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const derivers = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => /--[\w-]+:\s*[^;]*var\(--wc-color-/.test(rule[2]!))
      .map((rule) => rule[1]!.trim().replace(/\s+/g, " "));
    expect(derivers.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(derivers)]).toEqual([`:root, .${SCHEME_MARKER_CLASS}`]);
  });

  it("are worn through schemeClass, never with a marker of the theme's own", () => {
    const files = themeSourceFiles().filter((file) => file.relPath.endsWith(".astro"));
    expect(files.filter((file) => /\bschemeClass\(/.test(file.content)).length).toBeGreaterThanOrEqual(8);
    const ownMarker = files.filter((file) => /class:list=\{\["[^"]*\bscheme\b[^"]*"|"scheme",\s*schemeClass/.test(file.content)).map((file) => file.relPath);
    expect(ownMarker).toEqual([]);
  });
});
