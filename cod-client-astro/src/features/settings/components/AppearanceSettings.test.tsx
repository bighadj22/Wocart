// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:env/client", () => ({ PUBLIC_API_URL: "https://api.test" }));

const seam = vi.hoisted(() => ({
  appearance: null as null | Record<string, any>,
  calls: [] as Array<Record<string, any>>,
}));

vi.mock("@/features/settings/api", () => ({
  getAppearance: async () => seam.appearance,
  saveAppearance: async (payload: Record<string, any>) => {
    seam.calls.push(payload);
    seam.appearance = { ...seam.appearance!, ...payload };
    return seam.appearance;
  },
}));
vi.mock("@/i18n/react", () => ({
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { APPEARANCE_DEFAULT_SCHEMES } from "../../../../../cod-shared/stores/appearance";
import { AppearanceSettings } from "./AppearanceSettings";

const appearance = () => ({
  themeKey: "theme-00",
  primaryLocale: "en",
  locales: ["en"],
  colorSchemes: JSON.parse(JSON.stringify(APPEARANCE_DEFAULT_SCHEMES)),
  pageScheme: "scheme-1",
  hideLogo: false,
  searchEnabled: true,
  headerHtml: "",
  logoAlignment: "right",
  texts: {},
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  seam.appearance = appearance();
  seam.calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(host);
    root.render(<AppearanceSettings />);
  });
}

async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string, event: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

function section(title: string): HTMLElement {
  const found = [...host.querySelectorAll("section")].find((node) => node.textContent?.includes(title));
  if (!found) throw new Error(`No section for ${title}`);
  return found;
}

function saveButton(card: HTMLElement): HTMLButtonElement {
  const found = [...card.querySelectorAll("button")].find((node) => node.textContent === "store.save");
  if (!found) throw new Error("No save button");
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

describe("AppearanceSettings", () => {
  it("saves only colors so a color change cannot clear texts or storefront controls", async () => {
    await render();
    const background = host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!;
    await setValue(background, "#123456", "input");
    await act(async () => background.dispatchEvent(new FocusEvent("blur", { bubbles: true })));

    await click(saveButton(section("store.appearance_colors_title")));

    expect(seam.calls).toHaveLength(1);
    expect(Object.keys(seam.calls[0]!).sort()).toEqual(["colorSchemes", "pageScheme"]);
    expect(seam.calls[0]!.colorSchemes[0].colors.background).toBe("#123456");
    expect(host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!.value).toBe("#123456");
  });

  it("accepts a hex typed without the hash when the field loses focus", async () => {
    await render();
    const background = host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!;
    await setValue(background, "123456", "input");
    await act(async () => background.dispatchEvent(new FocusEvent("blur", { bubbles: true })));
    await click(saveButton(section("store.appearance_colors_title")));

    expect(seam.calls[0]!.colorSchemes[0].colors.background).toBe("#123456");
    expect(background.value).toBe("#123456");
  });

  it("opens on the scheme the storefront actually wears", async () => {
    seam.appearance = { ...appearance(), pageScheme: "scheme-6" };
    await render();
    const selected = Array.from(host.querySelectorAll("button")).find(
      (node) => node.getAttribute("aria-pressed") === "true" && node.textContent?.includes("store.appearance_look_olive"),
    );
    expect(selected).toBeTruthy();
    expect(host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!.value).toBe("#f3f2e7");
  });

  it("saves storefront controls on their own", async () => {
    await render();
    const logoSelect = (Array.from(host.querySelectorAll("select")) as HTMLSelectElement[]).find((node) =>
      Array.from(node.options).some((option) => option.value === "left"),
    )!;
    await setValue(logoSelect, "left", "change");

    await click(saveButton(section("store.appearance_storefront_title")));

    expect(seam.calls).toHaveLength(1);
    expect(seam.calls[0]!.logoAlignment).toBe("left");
    expect(seam.calls[0]!.colorSchemes).toBeUndefined();
    expect(seam.calls[0]!.texts).toBeUndefined();
  });

  it("saves text edits without touching colors or storefront controls", async () => {
    await render();
    const label = [...host.querySelectorAll("label")].find((node) =>
      node.textContent?.includes("store.appearance_text_heroTitle"),
    )!;
    const title = label.querySelector("input")!;
    await setValue(title, "New title", "input");

    await click(saveButton(section("store.appearance_texts_title")));

    expect(seam.calls).toHaveLength(1);
    expect(Object.keys(seam.calls[0]!)).toEqual(["texts"]);
    expect(seam.calls[0]!.texts.values.heroTitle).toBe("New title");
    expect(seam.calls[0]!.colorSchemes).toBeUndefined();
    expect(seam.calls[0]!.logoAlignment).toBeUndefined();
  });
});
