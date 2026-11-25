// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_DEFAULT_SCHEMES } from "../../../../../cod-shared/stores/appearance";
import type { StoreAppearance } from "../types";

const server = vi.hoisted(() => ({
  appearance: null as StoreAppearance | null,
  calls: [] as Array<{ method: string; path: string; body?: Record<string, unknown> }>,
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: Error }));

vi.mock("../api", () => ({
  getAppearance: vi.fn(async () => {
    server.calls.push({ method: "GET", path: "/api/stores/me/appearance" });
    return server.appearance;
  }),
  saveAppearance: vi.fn(async (body: Record<string, unknown>) => {
    server.calls.push({ method: "PUT", path: "/api/stores/me/appearance", body });
    server.appearance = {
      ...server.appearance!,
      colorSchemes: body.colorSchemes as StoreAppearance["colorSchemes"],
      pageScheme: body.pageScheme as string,
    };
    return server.appearance;
  }),
}));

vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { AppearanceSettings } from "./AppearanceSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const fixture = (): StoreAppearance => ({
  themeKey: "theme-00",
  primaryLocale: "ar",
  locales: ["ar", "fr"],
  colorSchemes: JSON.parse(JSON.stringify(APPEARANCE_DEFAULT_SCHEMES)),
  pageScheme: "scheme-1",
  texts: { ar: { heroTitle: "عربي" } },
  images: { heroImage: null, bannerImage: null, categoryCardsImage: null },
  visibility: { heroVisible: null, categoryCardsVisible: null },
});

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  server.appearance = fixture();
  server.calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount() {
  await act(async () => root.render(<AppearanceSettings />));
  await act(async () => {});
}

const text = () => document.body.textContent ?? "";
const button = (label: string, scope: Pick<Element, "querySelectorAll"> = document.body) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label)!;
const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await act(async () => {});
};
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const choose = async (select: unknown, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    (select as { dispatchEvent(event: Event): boolean }).dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const put = () => server.calls.filter((call) => call.method === "PUT");

describe("the Appearance tab", () => {
  it("loads the schemes and shows the live preview", async () => {
    await mount();
    expect(text()).toContain("Light");
    expect(text()).toContain("Live preview");
    expect(host.querySelectorAll('input[type="color"]')).toHaveLength(7);
  });

  it("edits another scheme without changing the first, and previews it", async () => {
    await mount();
    const stone = Array.from(host.querySelectorAll("section")[0].querySelectorAll("button")).find((b) => b.textContent?.includes("Stone"))!;
    await click(stone);
    const background = host.querySelector<HTMLInputElement>('input[aria-label="Background hex"]')!;
    expect(background.value.toLowerCase()).toBe("#f1ede4");
    await type(background, "#abcdef");
    const firstScheme = (server.appearance!.colorSchemes[0] as { colors: { background: string } }).colors.background;
    expect(firstScheme).toBe("#faf8f3");
    await click(button("Save changes", host.querySelectorAll("section")[0]));
    const saved = put()[0].body!.colorSchemes as { id: string; colors: { background: string } }[];
    expect(saved[0].colors.background).toBe("#faf8f3");
    expect(saved[1].colors.background).toBe("#abcdef");
  });

  it("previews the text edits as they are typed", async () => {
    await mount();
    const section = host.querySelectorAll("section")[1];
    const field = Array.from(section.querySelectorAll("label")).find((label) => label.textContent?.includes("Home title"))!;
    await type(field.querySelector("input")!, "A new home title");
    expect(text()).toContain("A new home title");
  });

  it("edits a color, previews it, and saves the color schemes", async () => {
    await mount();
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Background hex"]')!, "#123456");
    const preview = host.querySelector<HTMLElement>('[style*="background"]')!;
    expect(preview.style.background).toBe("#123456");
    await click(button("Save changes", host.querySelectorAll("section")[0]));
    expect(put()).toHaveLength(1);
    expect((put()[0].body!.colorSchemes as { colors: { background: string } }[])[0].colors.background).toBe("#123456");
  });

  it("switches the scheme the page wears", async () => {
    await mount();
    await choose(host.querySelector("select")!, "scheme-3");
    await click(button("Save changes", host.querySelectorAll("section")[0]));
    expect(put()[0].body!.pageScheme).toBe("scheme-3");
  });

  it("saves one language's texts", async () => {
    await mount();
    const section = host.querySelectorAll("section")[1];
    const field = Array.from(section.querySelectorAll("label")).find((label) => label.textContent?.includes("Home title"))!;
    await type(field.querySelector("input")!, "New title");
    await click(button("Save changes", section));
    expect(put()[0].body!.texts).toEqual({ locale: "ar", values: expect.objectContaining({ heroTitle: "New title" }) });
  });

  it("keeps unsaved color and scheme edits when another section is saved", async () => {
    await mount();
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Background hex"]')!, "#123456");
    await choose(host.querySelector("select")!, "scheme-3");

    const textsSection = host.querySelectorAll("section")[1];
    const field = Array.from(textsSection.querySelectorAll("label")).find((label) => label.textContent?.includes("Home title"))!;
    await type(field.querySelector("input")!, "New title");
    await click(button("Save changes", textsSection));

    expect(put()).toHaveLength(1);
    expect(put()[0].body!.pageScheme).toBe("scheme-3");
    expect((put()[0].body!.colorSchemes as { colors: { background: string } }[])[0].colors.background).toBe("#123456");
  });

  it("keeps unsaved color edits when the other sections are saved", async () => {
    await mount();
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Background hex"]')!, "#123456");

    for (const index of [2, 3]) {
      await click(button("Save changes", host.querySelectorAll("section")[index]));
    }

    expect(put()).toHaveLength(2);
    for (const call of put()) {
      expect((call.body!.colorSchemes as { colors: { background: string } }[])[0].colors.background).toBe("#123456");
    }
  });
});
