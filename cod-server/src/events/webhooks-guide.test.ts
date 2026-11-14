/**
 * The developer guide to webhooks (cod-docs `webhooks.mdx`, in English,
 * French and Arabic) says what the code does: its example is the published
 * event, its list of Event Types is the catalogue, its numbers are the
 * constants, its code is the same in every language — and its Node.js
 * verification code, run here against the real signer, accepts what the
 * store signs and refuses what it did not.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_CATALOGUE, EVENT_TYPES } from "../../../cod-shared/events/catalogue";
import { DELIVERY_RETRIES, REPLAY_MAX_EVENTS } from "../../../cod-shared/events/deliveries";
import { PREVIOUS_SECRET_SIGNS_FOR_MS, WEBHOOK_CONSUMERS_MAX, newSigningSecret } from "../../../cod-shared/events/webhooks";
import { WEBHOOK_BODY_MAX_BYTES, WEBHOOK_TIMEOUT_MS, signWebhook } from "./consumers/webhook";
import { exampleEvent } from "./examples";

const PAGES = resolve(import.meta.dirname, "../../../cod-docs/pages");
const guides = { en: "webhooks.mdx", fr: "fr/webhooks.mdx", ar: "ar/webhooks.mdx" } as const;
const read = (locale: keyof typeof guides) => readFileSync(join(PAGES, guides[locale]), "utf8").replace(/\r\n/g, "\n");

const blocks = (page: string, language: string) => [...page.matchAll(new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```", "g"))].map((m) => m[1]!);
/** The rows of the Markdown table that follows a heading, as cells. */
function tableAfter(page: string, heading: RegExp): string[][] {
  const start = page.search(heading);
  expect(start, `no ${heading}`).toBeGreaterThan(-1);
  const lines = page.slice(start).split("\n");
  const first = lines.findIndex((line) => line.startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}
const waitsInMinutes = () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  return Array.from({ length: DELIVERY_RETRIES.maxAttempts - 1 }, (_, i) => (Date.parse(DELIVERY_RETRIES.nextAttemptAfter(i + 1, t0)!) - t0.getTime()) / 60_000);
};

describe.each(Object.keys(guides) as Array<keyof typeof guides>)("the %s guide", (locale) => {
  const page = read(locale);

  it("shows the published example event", () => {
    expect(JSON.parse(blocks(page, "json")[0]!)).toEqual(exampleEvent("order.confirmed"));
  });

  it("lists every Event Type, in the catalogue's order", () => {
    expect(tableAfter(page, /\n## [^\n]+\n\n\| [^|]+ \| [^|]+ \|\n\| --- \| --- \|\n\| `order\.created`/).map(([type]) => type)).toEqual(EVENT_TYPES.map((type) => `\`${type}\``));
  });

  it("gives the retry schedule's every attempt", () => {
    expect(tableAfter(page, /\| [^|]+ \| [^|]+ \|\n\| --- \| --- \|\n\| 1 \|/).map(([attempt]) => Number(attempt))).toEqual(Array.from({ length: DELIVERY_RETRIES.maxAttempts }, (_, i) => i + 1));
  });

  it("has the same code as the English guide", () => {
    for (const language of ["js", "php", "python", "bash"]) expect(blocks(page, language), language).toEqual(blocks(read("en"), language));
  });
});

describe("the English guide's numbers", () => {
  const page = read("en");

  it("are the constants", () => {
    expect(page).toContain(`A store has at most ${WEBHOOK_CONSUMERS_MAX} webhooks.`);
    expect(page).toContain(`An event never exceeds ${WEBHOOK_BODY_MAX_BYTES / 1024} KB.`);
    expect(page).toContain(`| Any \`2xx\`, within ${WEBHOOK_TIMEOUT_MS / 1000} seconds | Delivered. |`);
    expect(page).toContain(`For ${PREVIOUS_SECRET_SIGNS_FOR_MS / 3_600_000} hours every request carries a signature by each secret`);
    expect(page).toContain(`A Delivery is tried ${DELIVERY_RETRIES.maxAttempts} times.`);
    expect(page).toContain(`at most ${REPLAY_MAX_EVENTS.toLocaleString("en")} events at a time`);
  });

  it("give the schedule's waits", () => {
    const words = (minutes: number) => (minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`);
    expect(tableAfter(page, /\| Attempt \|/).slice(1).map(([, wait]) => wait)).toEqual(waitsInMinutes().map(words));
  });

  it("say what each Event Type means, as the catalogue does", () => {
    const rows = tableAfter(page, /## Event types/);
    expect(rows.map(([, when]) => when)).toEqual(EVENT_TYPES.map((type) => EVENT_CATALOGUE[type].summary));
  });
});

describe("the guide's Node.js verification code", () => {
  const load = async () => {
    const file = join(mkdtempSync(join(tmpdir(), "webhooks-guide-")), "verify.mjs");
    writeFileSync(file, blocks(read("en"), "js")[0]!);
    return (await import(pathToFileURL(file).href)) as { verifyWebhook: (secret: string, headers: Record<string, string | undefined>, rawBody: string) => boolean };
  };

  it("accepts what the store signs, during a rotation by either secret, and refuses everything else", async () => {
    const { verifyWebhook } = await load();
    const [current, previous, other] = [newSigningSecret(), newSigningSecret(), newSigningSecret()];
    const body = JSON.stringify({ ...exampleEvent("order.created"), note: "اتصل قبل المرور" });
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = { "webhook-id": "evt_1", "webhook-timestamp": String(timestamp), "webhook-signature": await signWebhook([current, previous], "evt_1", timestamp, body) };

    expect(verifyWebhook(current, headers, body)).toBe(true);
    expect(verifyWebhook(previous, headers, body)).toBe(true);
    expect(verifyWebhook(other, headers, body)).toBe(false);
    expect(verifyWebhook(current, headers, body.replace("اتصل", "لا تتصل"))).toBe(false);
    expect(verifyWebhook(current, { ...headers, "webhook-id": "evt_2" }, body)).toBe(false);
    expect(verifyWebhook(current, { ...headers, "webhook-timestamp": String(timestamp - 301) }, body)).toBe(false);
    expect(verifyWebhook(current, { ...headers, "webhook-timestamp": "soon" }, body)).toBe(false);
    expect(verifyWebhook(current, { ...headers, "webhook-timestamp": undefined }, body)).toBe(false);
    expect(verifyWebhook(current, { ...headers, "webhook-signature": "v2,AAAA v1," }, body)).toBe(false);
  });
});
