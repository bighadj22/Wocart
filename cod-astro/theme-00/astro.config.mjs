import { defineConfig, envField, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import icon from "astro-icon";
import { PAGES_CACHE_TAG } from "@wocart/storefront/server";
import themeFonts from "./src/theme/fonts.json" with { type: "json" };

const isVercel = process.env.DEPLOY_TARGET === "vercel";
// Images: both builds use the theme's own image service
// (src/theme/utils/image-service.ts) — every media-domain <Image> is resized
// by Cloudflare on the media domain itself, so a storefront on Vercel gets
// the same resizing and edge cache as one on Cloudflare. "custom" keeps it on
// Cloudflare; the Vercel adapter keeps it while its own imageService is off.
const adapter = isVercel
  ? (await import("@astrojs/vercel")).default()
  : (await import("@astrojs/cloudflare")).default({ imageService: "custom" });

const cacheProvider = isVercel
  ? (await import("@astrojs/vercel/cache")).cacheVercel()
  : (await import("@astrojs/cloudflare/cache")).cacheCloudflare();

// `astro dev` keeps its own dependency cache. `astro check` and `astro build`
// run Vite against this same project and rewrite a shared cache with their own,
// smaller scan — under a running dev server that leaves every open page
// importing deleted files (404s, islands that never hydrate, a blank page).
const devServer = process.argv.includes("dev");

export default defineConfig({
  output: "server",
  compressHTML: true,
  session: false,
  adapter,
  cache: {
    provider: cacheProvider,
  },
  // Pages render on every request: a dashboard Appearance save must show on
  // the storefront immediately. The tag stays so a publish can still drop any
  // copy an edge cache made before this rule applied.
  routeRules: {
    "/": { maxAge: 0, swr: 0, tags: ["home", PAGES_CACHE_TAG] },
    "/products": { maxAge: 0, swr: 0, tags: ["products", PAGES_CACHE_TAG] },
    "/products/[slug]": { maxAge: 0, swr: 0, tags: ["products", PAGES_CACHE_TAG] },
    "/category/[slug]": { maxAge: 0, swr: 0, tags: ["categories", PAGES_CACHE_TAG] },
    "/lp/[slug]": { maxAge: 0, swr: 0, tags: ["landing-pages", PAGES_CACHE_TAG] },
    "/pages/[slug]": { maxAge: 0, swr: 0, tags: ["legal-pages", PAGES_CACHE_TAG] },
    "/api/communes/[wilayaId]": { maxAge: 31536000, swr: 31536000, tags: ["communes"] },
  },
  env: {
    schema: {
      STORE_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true, // Allow build to proceed with warning if missing
      }),
      COD_SERVER_URL: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      // Optional editor preview public key (an Ed25519 JWK). Unset → the
      // preview route answers 404; a storefront verifies tokens, never makes them.
      WOCART_PREVIEW_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
    },
  },
  // Links prefetch only when they opt in with data-astro-prefetch, as before
  // ClientRouter; its default would prefetch every link on the page.
  prefetch: { prefetchAll: false },
  image: {
    service: { entrypoint: "./src/theme/utils/image-service.ts" },
    remotePatterns: [{ protocol: "https" }],
  },
  // Every font a store can use is declared here and self-hosted at build time:
  // Astro downloads the files from Google once, serves them from the store's own
  // domain, and the browser fetches a face only when text uses it. The list lives
  // in fonts.json, which the theme reads too, so the two cannot drift.
  fonts: themeFonts.map((font) => ({
    name: font.family,
    cssVariable: font.cssVariable,
    provider: fontProviders.google(),
    weights: font.weights,
    styles: ["normal"],
    subsets: ["arabic", "latin"],
    fallbacks: ["system-ui", "sans-serif"],
  })),
  build: {
    // Astro's default: stylesheets under 4 kB are inlined, larger ones are
    // linked, so the page's CSS is cached and shared across every page.
    inlineStylesheets: "auto",
  },
  integrations: [
    icon({
      include: {
        heroicons: [
          "check-badge",       // features: Authentic Products, verified buyer
          "truck",             // features: Fast Delivery, announcement bar
          "banknotes",         // features: COD, HowItWorks step 3
          "clock",             // features: 24/7 Support
          "arrow-right",       // CTA arrows
          "magnifying-glass",  // search
          "bars-3",            // phone menu toggle
          "shopping-bag",      // HowItWorks, product card order btn
          "chat-bubble-left-right", // HowItWorks step 2
          "check",             // selected state checkmarks
          "chevron-down",      // dropdown toggle
          "chevron-left",      // announcement bar: previous message
          "chevron-right",     // announcement bar: next message
          "sparkles-solid",    // scrolling text: between messages
          "arrow-up-left",     // category tiles: "discover all" (RTL flips it)
          "shield-check",      // order form: no prepayment
          "arrow-path",        // order form: exchange policy
          "map-pin",           // order form: address
          "user",              // order form: name
          "fire",              // product page: stock running low
          "photo",             // image placeholder
          "home",              // mobile nav
          "squares-2x2",       // mobile nav products
          "check-circle",      // review success, verified buyer
          "credit-card",       // trust: COD payment
          "envelope",          // contact: the store's email
          "bolt",              // trust: fast / low stock
          "phone",             // thank-you step 1
          "cube",              // thank-you step 2 (package)
          "gift",              // offer free label
          "tag",               // coupon code box
          "exclamation-triangle", // warning/error
          "chat-bubble-left",  // WhatsApp CTA
          "chat-bubble-left-ellipsis", // OTP step
          "star",              // reviews header
          "star-solid",        // filled rating stars
          "home-modern",       // delivery: home
          "x-mark",            // cart drawer close button
          "minus",             // cart line quantity decrease
          "plus",              // cart line quantity increase
          "trash",             // cart line remove button
          "language",          // header language switcher
          "microphone",        // review form: record a voice note
          "stop",              // review form: stop recording
          "play-solid",        // review voice note: play
          "pause-solid",       // review voice note: pause
          "paper-clip",        // review form: send an audio file
          "camera",            // review form: add photos
        ],
      },
    }),
  ],
  vite: {
    cacheDir: devServer ? "node_modules/.vite-dev" : undefined,
    plugins: [tailwindcss()],
    environments: {
      ssr: {
        optimizeDeps: {
          // Deps discovered after boot trigger a re-bundle whose chunk renames
          // race the workerd reload and wedge/crash the runner
          // (withastro/astro#16933). Disable late discovery entirely: deps
          // found at request time load unbundled instead. Must live under
          // vite.environments.ssr — the legacy vite.ssr.optimizeDeps key is
          // ignored by Vite 8 here.
          noDiscovery: true,
          // The adapter's worker entry is excluded too: pre-bundled, a later
          // re-bundle (Tailwind regenerating CSS after an edit is enough)
          // leaves the runner asking for the entry under a stale version
          // hash, and every request 500s until the dev server restarts.
          exclude: [
            "astro/assets/services/noop",
            "astro-icon/components",
            "@astrojs/cloudflare/entrypoints/server",
          ],
        },
      },
    },
    build: {
      // Minify for production
      minify: "esbuild",
      cssMinify: true,
    },
  },
});
