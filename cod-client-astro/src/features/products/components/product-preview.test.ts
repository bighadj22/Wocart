/**
 * Product preview — static guards for the dialog a merchant opens before a
 * save. The description is shopper-pasted markup, so it may only render inside
 * a sandboxed document; reviews are moderation data, so the preview reads them
 * under the reviews scope and only for a saved product; and the live link can
 * point only at a product a shopper could actually open.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(process.cwd(), "src/features/products/components/ProductPreview.tsx"),
  "utf8",
);
const DOCUMENT = readFileSync(
  join(process.cwd(), "src/features/products/components/preview-description.ts"),
  "utf8",
);

describe("product preview", () => {
  it("renders a description only inside a sandboxed document", () => {
    expect(SOURCE).toContain('sandbox=""');
    expect(SOURCE).not.toContain("dangerouslySetInnerHTML");
    expect(DOCUMENT).toContain('http-equiv="Content-Security-Policy"');
    expect(DOCUMENT).toContain("default-src 'none'");
  });

  it("reads approved reviews only, and only for a saved product", () => {
    expect(SOURCE).toContain('status: "approved"');
    expect(SOURCE).toContain("SCOPES.REVIEWS_READ");
    expect(SOURCE).toContain("if (!open || !productId || !canReadReviews)");
  });

  it("offers the live page only when a shopper could open it", () => {
    expect(SOURCE).toContain("Boolean(productId && liveUrl && !warning)");
    expect(SOURCE).toContain('status === "DRAFT"');
    expect(SOURCE).toContain('status === "ARCHIVED"');
    expect(SOURCE).toContain("!showInStore || !productVisible");
  });

  it("previews the form's own values, not the saved record", () => {
    const form = readFileSync(
      join(process.cwd(), "src/features/products/components/ProductForm.tsx"),
      "utf8",
    );
    expect(form).toContain("<ProductPreview");
    expect(form).toContain("description={description}");
    expect(form).toContain("price={price}");
    expect(form).toContain("images={previewImages}");
  });
});
