import { describe, expect, it } from "vitest";
import { previewDescriptionDocument } from "./preview-description";

describe("previewDescriptionDocument", () => {
  it("keeps the markup the editor will save", () => {
    const html = '<h2>Title</h2><p><strong>Bold</strong> and <img src="https://media.example/p.webp"></p>';
    const doc = previewDescriptionDocument(html);
    expect(doc).toContain(html);
  });

  it("blocks scripts and every load but images", () => {
    const doc = previewDescriptionDocument("<p>Body</p>");
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src http: https: data:");
  });

  it("carries storefront-like typography for the pasted content", () => {
    const doc = previewDescriptionDocument("<p>Body</p>");
    expect(doc).toContain("font: 14px/1.7 system-ui");
    expect(doc).toContain('ul[data-type="taskList"]');
  });
});
