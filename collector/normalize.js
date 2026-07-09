// Turn per-retailer product lists into the normalized snapshot the dashboard
// consumes: per-retailer price statistics plus a cross-retailer summary.

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return round(sorted[base] + rest * (next - sorted[base]));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function priceStats(products) {
  const prices = products.map((p) => p.price).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    count: prices.length,
    min: round(prices[0]),
    max: round(prices[prices.length - 1]),
    avg: round(sum / prices.length),
    median: quantile(prices, 0.5),
    p25: quantile(prices, 0.25),
    p75: quantile(prices, 0.75),
  };
}

// Build the full snapshot from raw collection results.
export function buildSnapshot(results, meta = {}) {
  const retailers = results.map((r) => {
    const products = (r.products || []).slice().sort((a, b) => a.price - b.price);
    const stats = priceStats(products);
    const status = products.length ? (r.stale ? "stale" : "ok") : r.error ? "error" : "empty";
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      url: r.url,
      domain: r.domain,
      status,
      stale: !!r.stale,
      error: r.error || null,
      collectedFrom: r.collectedFrom || r.url,
      method: r.method || null, // how the data was extracted (markdown / json-ld / serp)
      productCount: products.length,
      stats,
      cheapest: products[0] || null,
      products: products.slice(0, 48),
    };
  });

  const ok = retailers.filter((r) => r.stats && (r.status === "ok" || r.status === "stale"));
  const ranking = ok
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      avg: r.stats.avg,
      median: r.stats.median,
      min: r.stats.min,
      max: r.stats.max,
      count: r.productCount,
    }))
    .sort((a, b) => a.avg - b.avg);

  const allPrices = ok.flatMap((r) => r.products.map((p) => p.price)).sort((a, b) => a - b);
  const overall = priceStats(allPrices.map((price) => ({ price })));

  // Cheapest single item across every retailer.
  let cheapestItem = null;
  for (const r of ok) {
    if (r.cheapest && (!cheapestItem || r.cheapest.price < cheapestItem.price)) {
      cheapestItem = { retailer: r.name, retailerId: r.id, ...r.cheapest };
    }
  }

  const summary = {
    retailerCount: retailers.length,
    okCount: ok.length,
    totalProducts: ok.reduce((a, r) => a + r.productCount, 0),
    ranking,
    cheapestRetailer: ranking[0] || null,
    priciestRetailer: ranking[ranking.length - 1] || null,
    overallAvg: overall ? overall.avg : null,
    overallMedian: overall ? overall.median : null,
    cheapestItem,
  };

  return {
    generatedAt: meta.generatedAt || new Date().toISOString(),
    currency: "USD",
    poweredBy: "Bright Data — Web Unlocker, SERP API & Web Scraper API",
    retailers,
    summary,
  };
}

// Append one datapoint per retailer to the rolling price history.
export function updateHistory(history, snapshot) {
  const day = snapshot.generatedAt.slice(0, 10);
  const point = {
    date: day,
    generatedAt: snapshot.generatedAt,
    overallAvg: snapshot.summary.overallAvg,
    retailers: Object.fromEntries(
      snapshot.retailers.filter((r) => r.stats).map((r) => [r.id, r.stats.avg])
    ),
  };
  const rest = (history || []).filter((h) => h.date !== day);
  return [...rest, point].sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
}
