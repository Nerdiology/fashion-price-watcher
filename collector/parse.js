// Generic product extractor for Bright Data Web Unlocker markdown.
//
// Fashion listing pages differ site to site, but once Web Unlocker renders them
// to markdown they share a shape: each product is a link (often wrapping an
// image and/or an `##` heading) sitting next to a price. We locate every price,
// then walk backwards to the nearest product link + name. This is heuristic by
// design and tolerant of noise — downstream code dedupes and sanity-checks.

const PRICE_RE = /(?:US)?\s*([$£€])\s*([0-9][0-9.,]*[0-9]|[0-9])/g;
const LINK_RE = /\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^)]+)\)/g;

// Anchor words that mark navigation / promo links we never want as products.
const NOISE = /^(shop|view all|see all|show more|filter|sort|sign in|log in|register|help|menu|home|women|men|kids|sale|new in|new arrivals?|best ?sellers?|trending|recommended|featured|look|outfit|the edit|newsletter|account|bag|cart|wishlist|favou?rites?|save to favou?rites|back to top|customer service|size guide|gift card|store locator|about|careers|privacy|cookies?|terms|delivery|returns?)\b/i;

// A residue string is a name we failed to clean (still holds markup/urls).
function isResidue(s) {
  return /[\[\]()]|https?:|\/[a-z]|productpage|\.html|\bwww\b/i.test(s);
}

function cleanName(raw) {
  let s = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // image syntax ![alt](src)
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ") // link syntax [txt](href)
    .replace(/[#*_>`]+/g, " ") // markdown emphasis / headings
    .replace(/\bSave to Favou?rites\b/gi, " ")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Collapse an immediately repeated phrase ("Cotton T-shirt Cotton T-shirt").
  const half = Math.floor(s.length / 2);
  if (s.length > 6 && s.slice(0, half).trim() === s.slice(half).trim()) {
    s = s.slice(0, half).trim();
  }
  return s;
}

// Turn "$1,299.00" / "£29.99" into { value, currency }.
function parsePrice(symbol, digits) {
  const value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const currency = { $: "USD", "£": "GBP", "€": "EUR" }[symbol] || "USD";
  return { value, currency };
}

// Pull the `title` out of a markdown target: `/path "Nice Title"` -> Nice Title.
function targetParts(target) {
  const m = target.match(/^(\S+)(?:\s+"([^"]*)")?/);
  return { url: m ? m[1] : target.trim(), title: m && m[2] ? m[2] : "" };
}

function collectLinks(md) {
  const links = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(md))) {
    const { url, title } = targetParts(m[2]);
    const alt = (m[1].match(/!\[([^\]]*)\]/) || [])[1] || "";
    links.push({ index: m.index, text: cleanName(m[1]), url, title: cleanName(title || alt) });
  }
  return links;
}

// URLs that are never products even if a price sits nearby (news, help, apps…).
const URL_BLOCK = /(\/news\/|\/help|\/customer-service|\/account|\/login|\/logon|\/story|\/stories|\/blog|\/size-guide|\/gift-card|\/stores?\/|onelink|\/faq|\/legal|\/privacy|\/cookie|\/shipping|\/returns)/i;

function looksLikeProductUrl(url) {
  if (!url) return false;
  if (URL_BLOCK.test(url)) return false;
  if (/(productpage|\/prd\/|\/pd\/|\/products?\/|\/dp\/|\/t\/|-p-|-p[0-9]{3,}|\/p\/)/i.test(url)) return true;
  if (/\/[^/]*\d{6,}/.test(url)) return true; // long numeric id in path
  return false;
}

function resolveUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

// Choose the cleanest human-readable name from candidates, in priority order.
function pickName(candidates) {
  for (const c of candidates) {
    const n = cleanName(c || "");
    if (n.length >= 2 && n.length <= 90 && !isResidue(n) && !NOISE.test(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON-LD fallback for JS-rendered sites (Zara, many others) where prices are
// injected client-side and never land in the markdown. Web Unlocker still
// returns the rendered HTML, which usually embeds schema.org Product data.
// ---------------------------------------------------------------------------

function walkForProducts(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walkForProducts(n, out);
    return;
  }
  const type = node["@type"];
  const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
  if (isProduct) {
    const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
    const rawPrice = offer && (offer.price ?? offer.lowPrice ?? offer.highPrice);
    const price = rawPrice != null ? Number(String(rawPrice).replace(/[^0-9.]/g, "")) : NaN;
    const name = typeof node.name === "string" ? cleanName(node.name) : "";
    const url = node.url || (offer && offer.url) || "";
    if (name && Number.isFinite(price) && price >= 1 && price <= 5000) {
      out.push({
        name,
        price,
        currency: (offer && offer.priceCurrency) || "USD",
        url: typeof url === "string" ? url : "",
      });
    }
  }
  // Recurse into common containers (@graph, itemListElement, item, etc.).
  for (const k of Object.keys(node)) {
    if (k === "@type") continue;
    walkForProducts(node[k], out);
  }
}

export function extractFromJsonLd(html, retailer, opts = {}) {
  const limit = opts.limit || 60;
  const baseUrl = opts.baseUrl || retailer.url || `https://${retailer.domain}`;
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const found = [];
  for (const b of blocks) {
    let data;
    try {
      data = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    walkForProducts(data, found);
  }
  const seen = new Set();
  const products = [];
  for (const p of found) {
    if (NOISE.test(p.name)) continue;
    const key = p.name.toLowerCase() + "|" + p.price;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({ ...p, url: resolveUrl(p.url, baseUrl) });
    if (products.length >= limit) break;
  }
  return products;
}

// ---------------------------------------------------------------------------
// Raw-HTML fallback for sites that render a product grid client-side and expose
// no JSON-LD (e.g. Gap): prices sit in the HTML text next to product anchors.
// Mirrors the markdown heuristic but operates on tag soup.
// ---------------------------------------------------------------------------

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(openTag, name) {
  const m = openTag.match(new RegExp(name + '=["\']([^"\']*)["\']', "i"));
  return m ? m[1] : "";
}

export function extractFromHtml(html, retailer, opts = {}) {
  const limit = opts.limit || 60;
  const baseUrl = opts.baseUrl || retailer.url || `https://${retailer.domain}`;

  // Collect product anchors: index, url, best-effort name.
  const anchors = [];
  const ARE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = ARE.exec(html))) {
    const open = am[1];
    const href = attr(open, "href");
    if (!looksLikeProductUrl(href)) continue;
    const name = attr(open, "aria-label") || attr(open, "title") || stripTags(am[2]) || (am[2].match(/alt=["']([^"']+)["']/i) || [])[1] || "";
    anchors.push({ index: am.index, url: href, name: cleanName(name) });
  }
  if (!anchors.length) return [];

  const products = [];
  const seen = new Set();
  let pm;
  PRICE_RE.lastIndex = 0;
  while ((pm = PRICE_RE.exec(html))) {
    const price = parsePrice(pm[1], pm[2]);
    if (!price || price.value < 1 || price.value > 5000) continue;
    const at = pm.index;
    let anchor = null;
    for (let i = anchors.length - 1; i >= 0; i--) {
      if (anchors[i].index >= at) continue;
      if (at - anchors[i].index > 4000) break;
      anchor = anchors[i];
      break;
    }
    if (!anchor) continue;
    const name = pickName([anchor.name]);
    if (!name) continue;
    const key = name.toLowerCase() + "|" + price.value;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({ name, price: price.value, currency: price.currency, url: resolveUrl(anchor.url, baseUrl) });
    if (products.length >= limit) break;
  }
  return products;
}

// Extract up to `limit` products from markdown for one retailer.
export function extractProducts(markdown, retailer, opts = {}) {
  const limit = opts.limit || 60;
  const baseUrl = opts.baseUrl || retailer.url || `https://${retailer.domain}`;
  if (!markdown || markdown.length < 200) return [];
  const md = markdown;
  const links = collectLinks(md);
  const headings = [...md.matchAll(/^#{1,4}\s+(.+)$/gm)].map((h) => ({
    index: h.index,
    text: cleanName(h[1]),
  }));

  const products = [];
  const seen = new Set();
  let pm;
  PRICE_RE.lastIndex = 0;
  while ((pm = PRICE_RE.exec(md))) {
    const price = parsePrice(pm[1], pm[2]);
    if (!price || price.value < 1 || price.value > 5000) continue;
    const at = pm.index;

    // Nearest preceding link whose URL actually looks like a product page.
    let link = null;
    for (let i = links.length - 1; i >= 0; i--) {
      if (links[i].index >= at) continue;
      if (at - links[i].index > 2500) break;
      if (looksLikeProductUrl(links[i].url)) {
        link = links[i];
        break;
      }
    }
    if (!link) continue;

    // Nearest heading before the price is usually the product title.
    const heading = headings.filter((x) => x.index < at && at - x.index < 800).pop();

    const name = pickName([link.title, link.text, heading && heading.text]);
    if (!name) continue;

    const key = name.toLowerCase() + "|" + price.value;
    if (seen.has(key)) continue;
    seen.add(key);

    products.push({
      name,
      price: price.value,
      currency: price.currency,
      url: resolveUrl(link.url, baseUrl),
    });
    if (products.length >= limit) break;
  }
  return products;
}
