# 🏷️ Fashion Price Watcher

**Live best-seller price comparison across the top 10 global fashion retailers — powered by the [Bright Data](https://brightdata.com) web-data platform.**

Fashion Price Watcher tracks what's actually selling at **H&M, Zara, Uniqlo, Mango, ASOS, COS, Gap, SHEIN, Nike and adidas**, extracts each retailer's best-selling items and prices, and renders them into one comparison dashboard — so you can see, at a glance, who's cheapest, who's premium, and where the single best deal in fast fashion is right now.

> Built for the Bright Data hackathon. It's a genuine end-to-end use case: real sites, real anti-bot bypass, real structured prices, refreshed automatically every day and published straight to GitHub Pages — no server to run.

**▶️ Live dashboard:** https://nerdiology.github.io/fashion-price-watcher/

---

## Why this is a real Bright Data use case

Comparing fashion prices sounds easy until you actually try to scrape ten of the most aggressively bot-protected e-commerce sites on the internet. Fashion Price Watcher leans on **three different Bright Data products**, each where it fits best:

| Bright Data product | CLI command | Used for |
|---|---|---|
| **Web Unlocker** | `bdata scrape` | Fetch each retailer's best-seller page as clean markdown — CAPTCHAs, bot-walls and JS rendering handled automatically. This is the primary price source for server-rendered sites (H&M, Uniqlo, Gap…). |
| **Web Unlocker (rendered HTML)** | `bdata scrape -f html` | For JS-price sites like **Zara**, prices are injected client-side and never appear in markdown. We re-fetch the rendered HTML and recover prices from the embedded **schema.org JSON-LD** — the exact problem a full-browser unlocker exists to solve. |
| **SERP API** | `bdata search` | Discovery fallback: when a curated best-seller URL goes stale, we search Google for the retailer's current best-seller page and re-extract from it. |

Everything runs through the official **Bright Data CLI** (`bdata`), so the same code path works on a laptop (after `bdata login`) and in CI (with an API-key secret).

---

## How it works

```
 ┌─────────────┐   bdata scrape / search    ┌──────────────┐   normalize    ┌──────────────────┐
 │ 10 retailer │ ─────────────────────────▶ │  collector/  │ ─────────────▶ │ site/data/*.json │
 │ best-seller │      (Bright Data)         │  (Node.js)   │  + statistics  │  (committed)     │
 │   pages     │                            └──────────────┘                └────────┬─────────┘
 └─────────────┘                                                                     │
                                                                                     ▼
                                    GitHub Actions (daily cron)            ┌──────────────────┐
                                    commits fresh data + deploys ─────────▶│  GitHub Pages    │
                                                                           │  static dashboard│
                                                                           └──────────────────┘
```

1. **Collect** — `collector/index.js` visits each retailer's best-seller listing, tries three extraction strategies in order (markdown → embedded JSON-LD → SERP discovery), and normalizes everything into a single USD price model.
2. **Snapshot** — results are written to `site/data/latest.json` with per-retailer statistics (avg / median / IQR / min / max) and a cross-retailer summary, plus a rolling `history.json` for trend charts.
3. **Publish** — a GitHub Action runs the collector on a daily schedule, commits the refreshed snapshot, and deploys the static dashboard to GitHub Pages. The dashboard is pure HTML/CSS/JS with **zero runtime dependencies** and no backend.

**Resilience is built in:** the collector caps concurrency, and any retailer that comes back empty or errors on a given run automatically **falls back to its last good data** (flagged `stale` in the UI) — so the published site never loses a column.

---

## The dashboard

- **KPI strip** — cheapest-on-average retailer, most premium, market median, the single cheapest item across all ten, and total items tracked.
- **Average price by retailer** — brand-colored ranking bars, cheapest → most premium.
- **Price spread** — min / 25th / median / 75th / max per retailer.
- **Price trend** — a multi-line history chart that fills in as the daily collector runs.
- **Comparison table** — sortable on every column, with each retailer's cheapest item linked.
- **Best sellers grid** — filterable by retailer and searchable across all products, cheapest deals highlighted.
- Light / dark theme, fully responsive, works offline once loaded.

---

## Run it yourself

### Prerequisites

- Node.js ≥ 20
- The Bright Data CLI, authenticated once:

```bash
npm install -g @brightdata/cli
bdata login          # browser OAuth (or: bdata login --device on a headless box)
```

A free Bright Data account includes monthly credits that comfortably cover a full run (~20–40 Web Unlocker requests).

### Collect

```bash
npm run collect                 # all 10 retailers → site/data/latest.json
node collector/index.js --only hm,zara,uniqlo   # a subset
node collector/index.js --dry-run               # verify auth without scraping
```

### Preview the dashboard

```bash
npx serve site        # or: python3 -m http.server -d site
# open http://localhost:3000
```

---

## Deploy to GitHub Pages (automated)

The included workflow (`.github/workflows/collect-and-deploy.yml`) does everything:

1. In your repo, add a secret **`BRIGHTDATA_API_KEY`** (Settings → Secrets and variables → Actions). Get the key from `bdata` after login or from the [Bright Data dashboard](https://brightdata.com/cp).
2. Enable Pages with **Source: GitHub Actions** (Settings → Pages).
3. Push to `main`. The workflow deploys the dashboard immediately, then refreshes prices **daily at 06:00 UTC** (or on demand via *Actions → Run workflow*).

Collection runs only on the schedule and manual triggers; plain code pushes just redeploy, and auto-commits are tagged `[skip ci]` so there's no trigger loop.

---

## Project layout

```
fashion-price-watcher/
├── collector/
│   ├── index.js        # orchestrator: collect → normalize → write snapshot
│   ├── retailers.js    # the 10 retailers (US storefronts, USD)
│   ├── brightdata.js   # thin wrapper over the bdata CLI
│   ├── parse.js        # markdown + JSON-LD product extractors
│   └── normalize.js    # price statistics + cross-retailer summary
├── site/
│   ├── index.html      # dashboard (GitHub Pages root)
│   ├── styles.css
│   ├── app.js
│   └── data/           # latest.json + history.json (committed snapshots)
└── .github/workflows/collect-and-deploy.yml
```

---

## Notes & honest caveats

- Prices are **point-in-time snapshots for comparison**, not a live checkout price; always confirm on the retailer's site.
- All retailers are scraped from their **US storefronts** so prices are directly comparable in USD.
- "Best sellers" reflects each retailer's own best-seller / trending / new-in listing where available.
- This project scrapes only public listing pages and stores no personal data.

## License

MIT © [Nerdiology](https://github.com/Nerdiology)

Data infrastructure by [Bright Data](https://brightdata.com).
