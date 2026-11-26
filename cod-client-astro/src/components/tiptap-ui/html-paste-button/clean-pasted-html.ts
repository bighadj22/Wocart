/**
 * Turns what a merchant pastes into HTML the description editor can parse.
 *
 * The editor treats pasted markup source as literal text, so a description
 * copied from a supplier page or an AI chat arrives as visible `<p>` tags.
 * This strips the wrappers such a copy carries — code fences, a full document,
 * `<head>`, and the elements the rich-text allow-list refuses — and leaves the
 * markup itself for ProseMirror to parse against the editor's own schema. The
 * server sanitises the saved description; this only makes the paste readable
 * before it gets there.
 */
const BLOCKED = "script|style|iframe|object|embed|svg|math|form|noscript|template";

export function cleanPastedHtml(raw: string): string {
  let html = raw.trim();

  const fence = /^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/.exec(html);
  if (fence) html = fence[1]!.trim();

  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "")
    .replace(/<\/?(?:html|body)\b[^>]*>/gi, "")
    .replace(new RegExp(`<(${BLOCKED})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "")
    .replace(new RegExp(`<\\/?(?:${BLOCKED})\\b[^>]*>`, "gi"), "")
    .trim();
}
