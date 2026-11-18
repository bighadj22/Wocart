import { describe, expect, it } from "vitest";
import { cleanPastedHtml } from "./clean-pasted-html";

describe("cleanPastedHtml", () => {
  it("strips a Markdown code fence around the markup", () => {
    const raw = "```html\n<h2>Title</h2>\n<p>Body</p>\n```";
    expect(cleanPastedHtml(raw)).toBe("<h2>Title</h2>\n<p>Body</p>");
  });

  it("strips a full document's wrappers", () => {
    const raw = [
      "<!DOCTYPE html>",
      "<html>",
      "<head><title>Product</title><style>p{color:red}</style></head>",
      "<body><p>Body</p></body>",
      "</html>",
    ].join("\n");
    expect(cleanPastedHtml(raw)).toBe("<p>Body</p>");
  });

  it("removes scripts and styles with their content", () => {
    const raw = '<p>Hello</p><script>alert("x")</script><style>p { color: red }</style>';
    expect(cleanPastedHtml(raw)).toBe("<p>Hello</p>");
  });

  it("removes elements the rich-text allow-list refuses, keeping text around them", () => {
    const raw = '<p>Before</p><iframe src="https://example.com"></iframe><svg><circle /></svg><p>After</p>';
    expect(cleanPastedHtml(raw)).toBe("<p>Before</p><p>After</p>");
  });

  it("keeps the formatting the editor understands", () => {
    const raw = '<h2>Title</h2><p><strong>Bold</strong> and <a href="https://example.com">link</a></p><ul><li>One</li></ul>';
    expect(cleanPastedHtml(raw)).toBe(raw);
  });

  it("leaves plain text alone", () => {
    expect(cleanPastedHtml("  Just a description  ")).toBe("Just a description");
  });
});
