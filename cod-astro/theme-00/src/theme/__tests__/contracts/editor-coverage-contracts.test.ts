// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Every word a home section shows must be reachable by an editor.
 *
 * Copy reaches a section two ways, as on Shopify (section settings + locale
 * files): a **field** on the section's definition, editable per instance, or a
 * **shared UI label** from the store-wide pack (button verbs, aria text),
 * editable once for the whole store through the content overrides. A section
 * that renders a pack key that is neither silently freezes that text for
 * every merchant — this file makes it a test failure instead.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@wocart/theme";
import { theme00 } from "@/theme/theme";

/**
 * Labels shared across sections and pages. They are UI vocabulary, not section
 * copy, so they stay store-wide. Each entry must be rendered by some section.
 */
const SHARED_UI_LABELS = new Set([
  "announcePrevious",
  "announceNext",
  "ariaMainNavigation",
  "navMenu",
  "navMenuClose",
  "searchLabel",
  "footerRights",
  "trust1Title",
  "ariaBrowseCategoryProducts",
  "ariaStarRating",
  "reviewsVerifiedBuyer",
  // Navigation and the order action, the same on every page.
  "ariaBreadcrumb",
  "navHome",
  "orderCta",
  "orderCtaSubtext",
  "viewAllCta",
  "allProductsSection",
  "footerWhatsapp",
  // A social link's accessible name when the merchant gave it none.
  "socialInstagram",
  "socialFacebook",
  "socialTiktok",
  "socialYoutube",
  // Facts about a product, worded once: stock, reviews, the saving.
  "productReviewCount",
  "productInStock",
  "outOfStock",
  "lowStock",
  "productSaving",
  // The review form's own title, also the button that opens it, and its dialog's close button.
  "reviewFormTitle",
  "reviewFormClose",
  // The track-order page's name, the same wherever it is linked.
  "trackTitle",
  // An order's facts, worded once for the store.
  "orderNumberLabel",
  "totalAmountLabel",
  // Following an order: the form, its refusals, the order's step and facts.
  "trackNumberLabel",
  "trackNumberHint",
  "trackPhoneLabel",
  "trackSubmit",
  "trackMissing",
  "trackInvalidNumber",
  "trackInvalidPhone",
  "trackNotFound",
  "trackRateLimited",
  "trackRateLimitedSoon",
  "trackFailed",
  "trackPlacedOn",
  "trackProgress",
  "trackDeliveryLabel",
  "trackDeliveryStopDesk",
  "trackDeliveryHome",
  "trackTotalLabel",
  "trackTrackingLabel",
  "trackItemsTitle",
  "trackContact",
  "trackWhatsAppPrefill",
  "trackAnother",
  // The search box and what it says of its results.
  "searchResults",
  "searchPlaceholder",
  "searchSubmit",
  "searchEmpty",
  // The checkout's states, and the order form's words it shares with the product page.
  "checkoutLoading",
  "cartEmptyTitle",
  "cartEmptyHint",
  "cartContinueShopping",
  "cartLineUnavailable",
  "cartFreeDeliveryEarned",
  "cartFreeDeliveryRemaining",
  "shippingCalculated",
  "shippingFree",
  "shippingUnavailable",
  "formCommuneLoading",
  "formCommunePlaceholder",
  "formCommuneDisabled",
  "formSubmit",
  "formConfirmNote",
  // Each way to reach the store, named once.
  "contactWhatsapp",
  "contactPhone",
  "contactEmail",
  "contactAddress",
  "contactHours",
  "contactPagesTitle",
  "contactNone",
  // A listing's words: its count, the "all" button, its empty states.
  "listingCount",
  "listingRangeTotal",
  "listingBrowse",
  "allLabel",
  "noProductsTitle",
  "emptyStoreTitle",
  "emptyStoreSub",
  "ariaBrowseAllProducts",
  "pageEmpty",
  // A countdown's units.
  "countdownDays",
  "countdownHours",
  "countdownMinutes",
  "countdownSeconds",
]);

const CATALOG_DIR = path.resolve(process.cwd(), "src/theme/catalog");

/** Every definition file of the catalog, in any of its folders. */
const DEFINITION_FILES = readdirSync(CATALOG_DIR, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".def.ts"))
  .map((file) => readFileSync(path.join(CATALOG_DIR, file), "utf8"));

/** The part of a definition file that defines `type`: a file may define a section and its blocks. */
function definitionOf(type: string): string {
  for (const file of DEFINITION_FILES) {
    const at = file.indexOf(`type: "${type}"`);
    if (at === -1) continue;
    const next = file.indexOf("defineComponent(", at);
    return file.slice(file.lastIndexOf("defineComponent(", at), next === -1 ? undefined : next);
  }
  throw new Error(`no definition file defines "${type}"`);
}

/** The section's component source, found through the import its definition file makes. */
function componentSourceOf(type: string): string {
  const definition = definitionOf(type);
  const name = /component:\s*(\w+)/.exec(definition)?.[1];
  const file = DEFINITION_FILES.find((candidate) => candidate.includes(definition))!;
  const match = name ? new RegExp(`import\\s+${name}\\s+from\\s+"@/(theme/components/[^"]+\\.astro)"`).exec(file) : null;
  if (!match) throw new Error(`the definition of "${type}" does not import its component`);
  return readFileSync(path.resolve(process.cwd(), "src", match[1] as string), "utf8");
}

/**
 * The section's `load` hook, as written in its definition — a setting can be
 * consumed there (e.g. deciding whether to read anything at all) rather than
 * by the component. The field declarations come before it, so they never
 * count as a read.
 */
function loadSourceOf(type: string): string {
  const definition = definitionOf(type);
  const start = definition.indexOf("load:");
  return start === -1 ? "" : definition.slice(start);
}

const sections = Object.entries(theme00.components).map(([type, definition]) => {
  const fields: readonly FieldDefinition[] = definition.fields ?? [];
  const source = componentSourceOf(type);
  const loadSource = loadSourceOf(type);
  // A label is rendered as `content.key`, or through the message binding as
  // `message(content, "key", …)` when it has placeholders or plural forms.
  const rendered = new Set(
    [...source.matchAll(/\bcontent\.(\w+)|\bmessage\(\s*content\s*,\s*"(\w+)"/g)].map((m) => (m[1] ?? m[2]) as string),
  );
  const copyFields = fields.filter(
    (field): field is FieldDefinition & { contentKey: string } =>
      (field.kind === "text" || field.kind === "textarea") && field.contentKey !== undefined,
  );
  return { type, fields, source, loadSource, rendered, copyFields };
});

describe("home sections expose their copy to the editor", () => {
  it("found every section's component", () => {
    expect(sections.map((s) => s.type).sort()).toEqual(Object.keys(theme00.components).sort());
  });

  it.each(sections)("$type renders only fields or shared UI labels", ({ rendered, copyFields }) => {
    const editable = new Set(copyFields.map((field) => field.contentKey));
    const frozen = [...rendered].filter((key) => !editable.has(key) && !SHARED_UI_LABELS.has(key));
    expect(frozen).toEqual([]);
  });

  it.each(sections)("$type copy fields are named after their pack key", ({ copyFields, loadSource }) => {
    // `copyOverrides` overlays a resolved field onto the pack by its key; a
    // component that takes its fields as props names them as it likes.
    if (!loadSource.includes("copyOverrides")) return;
    const renamed = copyFields.filter((field) => field.key !== field.contentKey).map((f) => f.key);
    expect(renamed).toEqual([]);
  });

  it.each(sections)("$type component reads every setting it declares", ({ fields, source, loadSource }) => {
    const settings = fields.filter((field) => !("contentKey" in field && field.contentKey));
    const unused = settings
      .map((field) => field.key)
      .filter((key) => !new RegExp(`\\b${key}\\b`).test(source) && !new RegExp(`\\bprops\\.${key}\\b`).test(loadSource));
    expect(unused).toEqual([]);
  });

  it("every shared UI label is still rendered by some section", () => {
    const renderedAnywhere = new Set(sections.flatMap((s) => [...s.rendered]));
    expect([...SHARED_UI_LABELS].filter((key) => !renderedAnywhere.has(key))).toEqual([]);
  });
});
