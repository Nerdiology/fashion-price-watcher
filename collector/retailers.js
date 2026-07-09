// Retailer registry for Fashion Price Watcher.
//
// Every retailer is scraped from its US storefront so that all prices land in
// USD and are directly comparable. `url` is the curated best-seller / trending
// listing page; `discoveryQuery` is the SERP fallback used when the curated URL
// stops returning products (sites reorganize their catalogs constantly).
//
// `currency` is the symbol the parser expects on the page. `country` is the
// Bright Data geo used for the Web Unlocker request.

export const RETAILERS = [
  {
    id: "hm",
    name: "H&M",
    color: "#E50010",
    url: "https://www2.hm.com/en_us/women/seasonal-trending/best-sellers.html",
    discoveryQuery: "H&M best sellers women",
    domain: "hm.com",
    currency: "$",
    country: "us",
  },
  {
    id: "zara",
    name: "Zara",
    color: "#C08457",
    url: "https://www.zara.com/us/en/woman-new-in-l1180.html",
    discoveryQuery: "Zara women new in trending",
    domain: "zara.com",
    currency: "$",
    country: "us",
  },
  {
    id: "uniqlo",
    name: "Uniqlo",
    color: "#14B8A6",
    url: "https://www.uniqlo.com/us/en/women/featured/new-arrivals",
    discoveryQuery: "Uniqlo women best sellers",
    domain: "uniqlo.com",
    currency: "$",
    country: "us",
  },
  {
    id: "mango",
    name: "Mango",
    color: "#F59E0B",
    url: "https://shop.mango.com/us/en/c/women/new-now_d5f2a6e6",
    discoveryQuery: "Mango women new now bestsellers US",
    domain: "mango.com",
    currency: "$",
    country: "us",
  },
  {
    id: "asos",
    name: "ASOS",
    color: "#6366F1",
    url: "https://www.asos.com/us/women/new-in/new-in-clothing/cat/?cid=2623",
    discoveryQuery: "ASOS women new in bestsellers",
    domain: "asos.com",
    currency: "$",
    country: "us",
  },
  {
    id: "cos",
    name: "COS",
    color: "#8B93A7",
    url: "https://www.cos.com/en_usd/women/bestsellers.html",
    discoveryQuery: "COS women bestsellers",
    domain: "cos.com",
    currency: "$",
    country: "us",
  },
  {
    id: "gap",
    name: "Gap",
    color: "#1D4ED8",
    url: "https://www.gap.com/browse/women/bestsellers?cid=1127944",
    discoveryQuery: "Gap women bestsellers",
    domain: "gap.com",
    currency: "$",
    country: "us",
  },
  {
    id: "shein",
    name: "SHEIN",
    color: "#EC4899",
    url: "https://us.shein.com/Women-Best-Sellers-sc-016322921.html",
    discoveryQuery: "SHEIN women best sellers",
    domain: "shein.com",
    currency: "$",
    country: "us",
  },
  {
    id: "nike",
    name: "Nike",
    color: "#22C55E",
    url: "https://www.nike.com/w/womens-best-sellers-76m50z5e1x6",
    discoveryQuery: "Nike women best sellers",
    domain: "nike.com",
    currency: "$",
    country: "us",
  },
  {
    id: "adidas",
    name: "adidas",
    color: "#A855F7",
    url: "https://www.adidas.com/us/women-best_sellers",
    discoveryQuery: "adidas women best sellers",
    domain: "adidas.com",
    currency: "$",
    country: "us",
  },
];

export function getRetailer(id) {
  return RETAILERS.find((r) => r.id === id);
}
