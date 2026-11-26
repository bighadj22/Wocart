// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(async () => {
  await import("../category-icons.ts");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

function addPhoto(width: number, height: number, complete = true) {
  const tile = document.createElement("a");
  tile.className = "category-tile";
  const photo = document.createElement("img");
  photo.setAttribute("data-category-photo", "");
  Object.defineProperty(photo, "complete", { value: complete, configurable: true });
  Object.defineProperty(photo, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(photo, "naturalHeight", { value: height, configurable: true });
  tile.append(photo);
  document.body.append(tile);
  return { tile, photo };
}

const settle = () => document.dispatchEvent(new Event("astro:page-load"));

describe("category icons", () => {
  it("shows a small photo as a contained icon", () => {
    const { tile } = addPhoto(48, 48);
    settle();
    expect(tile.classList.contains("is-icon")).toBe(true);
  });

  it("keeps a large photo as a filling tile", () => {
    const { tile } = addPhoto(600, 750);
    settle();
    expect(tile.classList.contains("is-icon")).toBe(false);
  });

  it("decides again once a photo without dimensions loads", () => {
    const { tile, photo } = addPhoto(0, 0, false);
    settle();
    expect(tile.classList.contains("is-icon")).toBe(false);

    Object.defineProperty(photo, "naturalWidth", { value: 64, configurable: true });
    Object.defineProperty(photo, "naturalHeight", { value: 64, configurable: true });
    Object.defineProperty(photo, "complete", { value: true, configurable: true });
    photo.dispatchEvent(new Event("load"));
    expect(tile.classList.contains("is-icon")).toBe(true);
  });
});
