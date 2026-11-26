/**
 * A product description as a sandboxed document for the preview.
 *
 * The storefront renders the stored description; the editor previews it before
 * a save, when the dashboard is the only place it exists. The markup goes into
 * an iframe with `sandbox` set, so a pasted script cannot run with the
 * dashboard's session, and the document's CSP leaves nothing loadable but
 * images. The editor's own schema and the server's allow-list still decide what
 * is stored.
 */
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px 16px;
  background: #fff;
  color: #1f2937;
  font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow-wrap: anywhere;
}
p:last-child, ul:last-child, ol:last-child { margin-block-end: 0; }
h1, h2, h3, h4, h5, h6 { margin: 0 0 0.55em; line-height: 1.3; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.18em; }
h4, h5, h6 { font-size: 1.05em; }
p, ul, ol, blockquote, pre, figure, table { margin: 0 0 0.9em; }
ul, ol { padding-inline-start: 1.4em; }
li + li { margin-block-start: 0.2em; }
a { color: #0f766e; text-decoration: underline; }
img { max-width: 100%; height: auto; border-radius: 8px; }
figure { max-width: 100%; }
figcaption { margin-top: 0.35em; color: #6b7280; font-size: 12px; }
blockquote { border-inline-start: 3px solid #e5e7eb; padding-inline-start: 12px; color: #4b5563; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.2em 0; }
code, pre { background: #f3f4f6; border-radius: 6px; }
code { padding: 1px 4px; }
pre { padding: 12px; overflow-x: auto; }
pre code { padding: 0; }
mark { background: #fef08a; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: start; }
ul[data-type="taskList"] { padding-inline-start: 0; list-style: none; }
ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; }
ul[data-type="taskList"] li > label { margin-top: 3px; }
`;

export function previewDescriptionDocument(html: string): string {
  return `<!doctype html>
<html dir="auto">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Description</title>
<style>${STYLE}</style>
</head>
<body>${html}</body>
</html>`;
}
