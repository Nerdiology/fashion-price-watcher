// Thin wrapper around the Bright Data CLI (`bdata`).
//
// The collector deliberately drives Bright Data through its official CLI rather
// than raw REST calls: one command surface for the Web Unlocker (`scrape`), the
// SERP API (`search`), and the Web Scraper API data-feeds (`pipelines`). The CLI
// reads its credentials from `BRIGHTDATA_API_KEY` in the environment, so the same
// code runs locally (after `bdata login`) and in CI (with the repo secret).

import { execFile } from "node:child_process";

const BIN = process.env.BDATA_BIN || "bdata";

// Scrapes can be large (100 KB+ of markdown); give the child plenty of headroom.
const MAX_BUFFER = 64 * 1024 * 1024;

function run(args, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      BIN,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          err.stdout = stdout;
          return reject(err);
        }
        resolve(stdout);
      }
    );
    child.on("error", reject);
  });
}

// Web Unlocker: fetch a page as clean markdown with bot/CAPTCHA/JS handled.
export async function scrapeMarkdown(url, country = "us", opts = {}) {
  const args = ["scrape", url, "-f", "markdown"];
  if (country) args.push("--country", country);
  return run(args, opts);
}

// Web Unlocker: fetch rendered HTML (used to recover embedded JSON-LD prices
// on JS-heavy sites where the markdown drops client-injected prices).
export async function scrapeHtml(url, country = "us", opts = {}) {
  const args = ["scrape", url, "-f", "html"];
  if (country) args.push("--country", country);
  return run(args, opts);
}

// SERP API: structured Google results as JSON.
export async function search(query, country = "us", opts = {}) {
  const args = ["search", query, "--json"];
  if (country) args.push("--country", country);
  const out = await run(args, opts);
  return JSON.parse(out);
}

// Web Scraper API data-feed: structured records for a supported platform.
export async function pipeline(type, params = [], opts = {}) {
  const args = ["pipelines", type, ...params, "--json"];
  const out = await run(args, { timeoutMs: 300_000, ...opts });
  return JSON.parse(out);
}

// Verify the CLI is present and authenticated. Returns { ok, balance, error }.
export async function healthcheck() {
  try {
    const out = await run(["budget"], { timeoutMs: 30_000 });
    const balance = (out.match(/\$[0-9]+(?:\.[0-9]{2})?/) || [])[0] || null;
    return { ok: true, balance };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}
