// Fashion Price Watcher — collector entry point.
//
// Drives the Bright Data CLI to gather best-selling products from 10 fashion
// retailers, normalizes them into a single snapshot, and writes the JSON the
// static dashboard renders. Designed to survive partial failure: any retailer
// that errors or comes back empty falls back to its previous good data so the
// published site never loses a column.
//
// Usage:
//   node collector/index.js                 # collect all retailers
//   node collector/index.js --only hm,zara  # subset
//   node collector/index.js --dry-run       # healthcheck + config only
//   node collector/index.js --limit 40      # cap products per retailer

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RETAILERS } from "./retailers.js";
import { scrapeMarkdown, scrapeHtml, search, healthcheck } from "./brightdata.js";
import { extractProducts, extractFromJsonLd } from "./parse.js";
import { buildSnapshot, updateHistory } from "./normalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "site", "data");
const LATEST = join(DATA_DIR, "latest.json");
const HISTORY = join(DATA_DIR, "history.json");

const MIN_PRODUCTS = 4; // below this we treat a page as a miss and try discovery
const CONCURRENCY = 3;

function parseArgs(argv) {
  const args = { only: null, dryRun: false, limit: 60 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit") args.limit = Number(argv[++i]) || 60;
  }
  return args;
}

// Find the best retailer-owned URL from a SERP result set.
function pickDiscoveryUrl(serp, domain) {
  const organic = serp.organic || [];
  const onDomain = organic.filter((o) => (o.link || "").includes(domain));
  return (onDomain[0] || organic[0] || {}).link || null;
}

async function collectRetailer(retailer, limit) {
  const base = { id: retailer.id, name: retailer.name, color: retailer.color, url: retailer.url, domain: retailer.domain };
  try {
    // 1) Scrape the curated best-seller listing page as markdown (Web Unlocker).
    //    Works for retailers that render prices server-side (H&M, Uniqlo, Gap…).
    let collectedFrom = retailer.url;
    let method = "web-unlocker/markdown";
    const md = await scrapeMarkdown(retailer.url, retailer.country);
    let products = extractProducts(md, retailer, { baseUrl: retailer.url, limit });

    // 2) JS-price sites (Zara, etc.) drop client-injected prices from markdown.
    //    Re-fetch the rendered HTML and recover prices from embedded JSON-LD.
    if (products.length < MIN_PRODUCTS) {
      try {
        const html = await scrapeHtml(retailer.url, retailer.country);
        const viaLd = extractFromJsonLd(html, retailer, { baseUrl: retailer.url, limit });
        if (viaLd.length > products.length) {
          products = viaLd;
          method = "web-unlocker/json-ld";
        }
      } catch (e) {
        // HTML fallback is best-effort
      }
    }

    // 3) Still thin? Discover a fresh listing URL via the SERP API and retry
    //    both extraction strategies against it.
    if (products.length < MIN_PRODUCTS && retailer.discoveryQuery) {
      try {
        const serp = await search(retailer.discoveryQuery, retailer.country);
        const url = pickDiscoveryUrl(serp, retailer.domain);
        if (url && url !== retailer.url) {
          const md2 = await scrapeMarkdown(url, retailer.country);
          let alt = extractProducts(md2, retailer, { baseUrl: url, limit });
          if (alt.length < MIN_PRODUCTS) {
            const html2 = await scrapeHtml(url, retailer.country);
            const ld2 = extractFromJsonLd(html2, retailer, { baseUrl: url, limit });
            if (ld2.length > alt.length) alt = ld2;
          }
          if (alt.length > products.length) {
            products = alt;
            collectedFrom = url;
            method = "serp-discovery";
          }
        }
      } catch (e) {
        // discovery is best-effort
      }
    }

    console.log(`  ✓ ${retailer.name.padEnd(8)} ${String(products.length).padStart(2)} items via ${method}`);
    return {
      ...base,
      products,
      collectedFrom,
      method,
      error: products.length ? null : "no products parsed",
    };
  } catch (err) {
    console.log(`  ✗ ${retailer.name.padEnd(8)} failed: ${(err.stderr || err.message || "").slice(0, 80)}`);
    return { ...base, products: [], error: (err.stderr || err.message || String(err)).slice(0, 300) };
  }
}

// Run tasks with a fixed concurrency cap.
async function pool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, runner));
  return results;
}

// Load the previous snapshot so we can fall back on any retailer that fails now.
async function loadPrevious() {
  try {
    return JSON.parse(await readFile(LATEST, "utf8"));
  } catch {
    return null;
  }
}

function mergeWithPrevious(results, previous) {
  if (!previous) return results;
  const prevById = Object.fromEntries((previous.retailers || []).map((r) => [r.id, r]));
  return results.map((r) => {
    if (r.products && r.products.length >= MIN_PRODUCTS) return r;
    const p = prevById[r.id];
    if (p && p.products && p.products.length) {
      return {
        ...r,
        products: p.products,
        collectedFrom: p.collectedFrom,
        method: p.method,
        error: r.error ? `${r.error} (served last good data)` : "served last good data",
        stale: true,
      };
    }
    return r;
  });
}

async function main() {
  const args = parseArgs(process.argv);
  console.log("Fashion Price Watcher — collector\n");

  const health = await healthcheck();
  if (!health.ok) {
    console.error("Bright Data CLI not ready:", health.error);
    console.error("Run `bdata login` locally, or set BRIGHTDATA_API_KEY in CI.");
    process.exit(1);
  }
  console.log(`Bright Data OK — account balance ${health.balance || "?"}\n`);

  let targets = RETAILERS;
  if (args.only) targets = RETAILERS.filter((r) => args.only.includes(r.id));
  console.log(`Collecting ${targets.length} retailer(s): ${targets.map((r) => r.id).join(", ")}\n`);

  if (args.dryRun) {
    console.log("Dry run — no scraping performed.");
    return;
  }

  const started = Date.now();
  let raw = await pool(targets, (r) => collectRetailer(r, args.limit), CONCURRENCY);

  // Fall back to previous good data for anything thin this run.
  const previous = await loadPrevious();
  if (args.only) {
    // When collecting a subset, keep the other retailers from the last snapshot.
    const collected = new Set(raw.map((r) => r.id));
    const carried = (previous?.retailers || []).filter((r) => !collected.has(r.id));
    raw = [...raw, ...carried];
  }
  const merged = mergeWithPrevious(raw, previous);

  // Keep retailers in the canonical registry order.
  const order = Object.fromEntries(RETAILERS.map((r, i) => [r.id, i]));
  merged.sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));

  const snapshot = buildSnapshot(merged);

  await mkdir(DATA_DIR, { recursive: true });
  let history = [];
  if (existsSync(HISTORY)) {
    try {
      history = JSON.parse(await readFile(HISTORY, "utf8"));
    } catch {}
  }
  history = updateHistory(history, snapshot);

  await writeFile(LATEST, JSON.stringify(snapshot, null, 2));
  await writeFile(HISTORY, JSON.stringify(history, null, 2));

  // Console report.
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`Done in ${secs}s — ${snapshot.summary.okCount}/${snapshot.summary.retailerCount} retailers, ${snapshot.summary.totalProducts} products\n`);
  console.log("Retailer      Status   Items   Avg     Median  Min");
  console.log("-".repeat(56));
  for (const r of snapshot.retailers) {
    const s = r.stats;
    const row = [
      r.name.padEnd(13),
      (r.stale ? "stale" : r.status).padEnd(8),
      String(r.productCount).padStart(5),
      s ? ("$" + s.avg).padStart(8) : "".padStart(8),
      s ? ("$" + s.median).padStart(8) : "".padStart(8),
      s ? ("$" + s.min).padStart(7) : "",
    ].join(" ");
    console.log(row);
  }
  console.log("-".repeat(56));
  if (snapshot.summary.cheapestRetailer)
    console.log(`Cheapest on average: ${snapshot.summary.cheapestRetailer.name} ($${snapshot.summary.cheapestRetailer.avg})`);
  if (snapshot.summary.cheapestItem)
    console.log(`Cheapest single item: ${snapshot.summary.cheapestItem.name} — $${snapshot.summary.cheapestItem.price} at ${snapshot.summary.cheapestItem.retailer}`);
  console.log(`\nWrote ${LATEST}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
