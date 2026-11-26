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
    const texts = payload.texts as { locale: string; values: Record<string, string> } | undefined;
    seam.appearance = {
      ...seam.appearance!,
      colorSchemes: payload.colorSchemes,
      pageScheme: payload.pageScheme,
      hideLogo: payload.hideLogo,
      searchEnabled: payload.searchEnabled,
      headerHtml: payload.headerHtml,
      logoAlignment: payload.logoAlignment,
      sections: payload.sections ?? seam.appearance!.sections,
      priceColors: payload.priceColors,
      bannerBodyHtml: payload.bannerBodyHtml ?? "",
      texts: texts
        ? { ...seam.appearance!.texts, [texts.locale]: texts.values }
        : seam.appearance!.texts,
    };
    return seam.appearance;
  },
}));
vi.mock("@/i18n/react", () => ({
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/uploads/components/ImageUploader", () => ({
  ImageUploader: () => null,
}));

import { APPEARANCE_DEFAULT_SCHEMES, APPEARANCE_HOME_SECTIONS } from "../../../../../cod-shared/stores/appearance";
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
  sections: Object.fromEntries(APPEARANCE_HOME_SECTIONS.map(({ key }) => [key, { hidden: false, image: null }])),
  priceColors: {},
  bannerBodyHtml: "",
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

async function setValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
  event: string,
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
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
  it("saves a typed hex color and keeps it in the field after the answer", async () => {
    await render();
    const background = host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!;
    await setValue(background, "#123456", "input");
    await act(async () => background.dispatchEvent(new FocusEvent("blur", { bubbles: true })));

    await click(saveButton(section("store.appearance_colors_title")));

    expect(seam.calls[0]!.colorSchemes[0].colors.background).toBe("#123456");
    expect(host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!.value).toBe("#123456");
  });

  it("sends logo alignment and each home section's hide switch with the controls", async () => {
    await render();
    const logoSelect = (Array.from(host.querySelectorAll("select")) as HTMLSelectElement[]).find((node) =>
      Array.from(node.options).some((option) => option.value === "left"),
    )!;
    await setValue(logoSelect, "left", "change");

    const heroLabel = [...host.querySelectorAll("span")].find(
      (node) => node.textContent === "store.appearance_section_hero",
    )!;
    await click(heroLabel.closest("div")!.querySelector('[role="switch"]')!);

    await click(saveButton(section("store.appearance_sections_title")));

    expect(seam.calls[0]!.logoAlignment).toBe("left");
    expect(seam.calls[0]!.sections.hero.hidden).toBe(true);
    expect(seam.calls[0]!.sections.marquee.hidden).toBe(false);
  });

  it("sends unsaved edits from another card with the card being saved", async () => {
    await render();
    const background = host.querySelectorAll<HTMLInputElement>('input[aria-label$=" hex"]')[0]!;
    await setValue(background, "#123456", "input");
    await act(async () => background.dispatchEvent(new FocusEvent("blur", { bubbles: true })));

    const heroLabel = [...host.querySelectorAll("span")].find(
      (node) => node.textContent === "store.appearance_section_hero",
    )!;
    await click(heroLabel.closest("div")!.querySelector('[role="switch"]')!);
    await click(saveButton(section("store.appearance_sections_title")));

    expect(seam.calls[0]!.colorSchemes[0].colors.background).toBe("#123456");
    expect(seam.calls[0]!.sections.hero.hidden).toBe(true);
  });

  it("edits the scrolling strip as text instead of an image uploader", async () => {
    await render();
    const marquee = section("store.appearance_sections_title");
    const field = [...marquee.querySelectorAll("label")].find((node) =>
      node.textContent?.includes("store.appearance_text_trust4Title"),
    )!;
    const input = field.querySelector("input")!;
    expect(input.type).not.toBe("file");
    await setValue(input, "Pay at your door", "input");

    await click(saveButton(section("store.appearance_texts_title")));

    expect(seam.calls[0]!.texts.values.trust4Title).toBe("Pay at your door");
    expect(marquee.querySelector('input[type="file"]')).toBeNull();
  });

  it("saves semantic price colors and offer HTML alongside the image sections", async () => {
    await render();
    const oldPrice = host.querySelector<HTMLInputElement>(
      'input[aria-label="store.appearance_color_oldPrice hex"]',
    )!;
    await setValue(oldPrice, "#777777", "input");
    await act(async () => oldPrice.dispatchEvent(new FocusEvent("blur", { bubbles: true })));

    const offer = section("store.appearance_texts_title");
    const offerField = [...offer.querySelectorAll("label")].find((node) =>
      node.textContent?.includes("store.appearance_text_bannerBodyHtml"),
    )!;
    await setValue(offerField.querySelector("textarea")!, "<p>Free delivery</p>", "input");

    await click(saveButton(section("store.appearance_colors_title")));

    expect(seam.calls[0]!.priceColors.oldPrice).toBe("#777777");
    expect(seam.calls[0]!.bannerBodyHtml).toBe("<p>Free delivery</p>");
    expect(seam.calls[0]!.sections["image-banner"].image).toBeNull();
  });
});
