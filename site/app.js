/* Fashion Price Watcher — dashboard logic. Vanilla JS, no dependencies. */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const money = (n) => (n == null ? "—" : "$" + Number(n).toFixed(2).replace(/\.00$/, ""));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- theme ---------- */
function initTheme() {
  const saved = localStorage.getItem("fpw-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", cur);
    localStorage.setItem("fpw-theme", cur);
  });
}

/* ---------- data load ---------- */
async function load() {
  initTheme();
  let data, history = [];
  try {
    data = await (await fetch("./data/latest.json", { cache: "no-store" })).json();
  } catch (e) {
    $("#loading").innerHTML =
      "No snapshot found yet. Run <code>npm run collect</code> or trigger the GitHub Action to generate <code>site/data/latest.json</code>.";
    return;
  }
  try {
    history = await (await fetch("./data/history.json", { cache: "no-store" })).json();
  } catch (e) {}
  render(data, history);
}

/* ---------- render ---------- */
let STATE = { data: null, sort: { key: "avg", dir: 1 }, retailer: "all", query: "" };

function render(data, history) {
  STATE.data = data;
  const app = $("#app");
  app.innerHTML = "";
  const tpl = $("#tpl-dashboard").content.cloneNode(true);

  const d = new Date(data.generatedAt);
  $("[data-slot=updated]", tpl).textContent = d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  $("[data-slot=source]", tpl).textContent = data.poweredBy || "";

  renderLegend($("[data-slot=legend]", tpl), data);
  renderKpis($("[data-slot=kpis]", tpl), data);
  renderRankChart($("[data-slot=rankchart]", tpl), data);
  renderSpread($("[data-slot=spread]", tpl), data);
  renderTrend($("[data-slot=trend]", tpl), data, history);
  renderRetailerFilter($("[data-slot=retailer-filter]", tpl), data);

  app.appendChild(tpl);

  // table + products depend on live state; re-render on interaction.
  $("#search").addEventListener("input", (e) => {
    STATE.query = e.target.value.toLowerCase();
    renderProducts();
  });
  renderTable();
  renderProducts();
}

function renderLegend(root, data) {
  for (const r of data.retailers) {
    const item = el("span", "item");
    item.appendChild(el("span", "sw")).style.background = r.color;
    item.appendChild(document.createTextNode(r.name));
    root.appendChild(item);
  }
}

function renderKpis(root, data) {
  const s = data.summary;
  const cards = [
    {
      label: "Cheapest on average",
      value: s.cheapestRetailer ? s.cheapestRetailer.name : "—",
      note: s.cheapestRetailer ? money(s.cheapestRetailer.avg) + " avg best-seller" : "",
      small: true,
    },
    {
      label: "Most premium",
      value: s.priciestRetailer ? s.priciestRetailer.name : "—",
      note: s.priciestRetailer ? money(s.priciestRetailer.avg) + " avg best-seller" : "",
      small: true,
    },
    { label: "Market median", value: money(s.overallMedian), note: "across all tracked items" },
    {
      label: "Cheapest item",
      value: s.cheapestItem ? money(s.cheapestItem.price) : "—",
      note: s.cheapestItem ? esc(s.cheapestItem.name) + " · " + esc(s.cheapestItem.retailer) : "",
      small: true,
    },
    { label: "Items tracked", value: String(s.totalProducts), note: s.okCount + " / " + s.retailerCount + " retailers live" },
  ];
  for (const c of cards) {
    const card = el("div", "kpi");
    card.appendChild(el("div", "label", esc(c.label)));
    card.appendChild(el("div", "value" + (c.small ? " small" : ""), esc(c.value)));
    if (c.note) card.appendChild(el("div", "note", c.note));
    root.appendChild(card);
  }
}

function renderRankChart(root, data) {
  const rank = data.summary.ranking || [];
  if (!rank.length) {
    root.appendChild(el("p", "panel-sub", "No priced retailers in this snapshot."));
    return;
  }
  const max = Math.max(...rank.map((r) => r.avg));
  for (const r of rank) {
    const row = el("div", "rank-row");
    row.appendChild(el("div", "name", `${esc(r.name)} <span class="cnt">${r.count}</span>`));
    const track = el("div", "rank-track");
    const fill = el("div", "rank-fill");
    fill.style.width = Math.max(4, (r.avg / max) * 100) + "%";
    fill.style.background = r.color;
    fill.title = `${r.name}: avg ${money(r.avg)} · median ${money(r.median)} · ${r.count} items`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("div", "rank-val", money(r.avg)));
    root.appendChild(row);
  }
}

function renderSpread(root, data) {
  const rows = data.retailers.filter((r) => r.stats);
  if (!rows.length) {
    root.appendChild(el("p", "panel-sub", "No data."));
    return;
  }
  const globalMax = Math.max(...rows.map((r) => r.stats.max));
  const scale = (v) => (v / globalMax) * 100;
  for (const r of rows) {
    const s = r.stats;
    const row = el("div", "spread-row");
    row.appendChild(el("div", "name", esc(r.name)));
    const track = el("div", "spread-track");

    const bar = el("div", "spread-bar");
    bar.style.left = scale(s.min) + "%";
    bar.style.width = Math.max(1, scale(s.max) - scale(s.min)) + "%";
    track.appendChild(bar);

    const iqr = el("div", "spread-iqr");
    iqr.style.left = scale(s.p25) + "%";
    iqr.style.width = Math.max(1, scale(s.p75) - scale(s.p25)) + "%";
    iqr.style.background = r.color;
    iqr.title = `IQR ${money(s.p25)}–${money(s.p75)}`;
    track.appendChild(iqr);

    for (const v of [s.min, s.max]) {
      const dot = el("div", "spread-dot");
      dot.style.left = scale(v) + "%";
      dot.title = money(v);
      track.appendChild(dot);
    }
    const med = el("div", "spread-med");
    med.style.left = scale(s.median) + "%";
    med.title = `median ${money(s.median)}`;
    track.appendChild(med);

    row.appendChild(track);
    root.appendChild(row);
  }
  const scaleEl = el("div", "spread-scale");
  scaleEl.appendChild(el("span", null, "$0"));
  scaleEl.appendChild(el("span", null, money(globalMax / 2)));
  scaleEl.appendChild(el("span", null, money(globalMax)));
  root.appendChild(scaleEl);
}

function renderTrend(root, data, history) {
  if (!history || history.length < 2) {
    root.appendChild(
      el("div", "empty", "Trend appears after the collector runs on at least two days. Scheduled daily via GitHub Actions.")
    );
    return;
  }
  const W = 520, H = 220, padL = 40, padB = 24, padT = 12, padR = 12;
  const ids = data.retailers.map((r) => r.id);
  const points = history;
  const allVals = points.flatMap((p) => Object.values(p.retailers || {})).filter((v) => v != null);
  const maxY = Math.max(...allVals, 10) * 1.1;
  const x = (i) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / maxY) * (H - padB - padT);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // y gridlines
  for (let g = 0; g <= 4; g++) {
    const yy = padT + (g / 4) * (H - padB - padT);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", padL); line.setAttribute("x2", W - padR);
    line.setAttribute("y1", yy); line.setAttribute("y2", yy);
    line.setAttribute("stroke", "currentColor"); line.setAttribute("opacity", "0.08");
    svg.appendChild(line);
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", 4); t.setAttribute("y", yy + 3);
    t.setAttribute("fill", "currentColor"); t.setAttribute("opacity", "0.5"); t.setAttribute("font-size", "9");
    t.textContent = money(maxY - (g / 4) * maxY);
    svg.appendChild(t);
  }
  for (const r of data.retailers) {
    const seg = points.map((p, i) => [i, p.retailers && p.retailers[r.id]]).filter((p) => p[1] != null);
    if (seg.length < 2) continue;
    const dpath = seg.map((p, k) => (k ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(" ");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", dpath);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", r.color);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("opacity", "0.9");
    const title = document.createElementNS(svgNS, "title");
    title.textContent = r.name;
    path.appendChild(title);
    svg.appendChild(path);
  }
  root.appendChild(svg);
}

function renderRetailerFilter(root, data) {
  const chips = el("div", "chips");
  const mk = (id, label) => {
    const c = el("button", "chip", esc(label));
    c.setAttribute("aria-pressed", STATE.retailer === id);
    c.addEventListener("click", () => {
      STATE.retailer = id;
      [...chips.children].forEach((ch) => ch.setAttribute("aria-pressed", "false"));
      c.setAttribute("aria-pressed", "true");
      renderProducts();
    });
    return c;
  };
  chips.appendChild(mk("all", "All"));
  for (const r of data.retailers.filter((x) => x.productCount)) chips.appendChild(mk(r.id, r.name));
  root.appendChild(chips);
}

/* ---------- table (interactive) ---------- */
function renderTable() {
  const data = STATE.data;
  const table = $("[data-slot=table]");
  if (!table) return;
  const cols = [
    { key: "name", label: "Retailer", align: "left" },
    { key: "productCount", label: "Items" },
    { key: "avg", label: "Avg" },
    { key: "median", label: "Median" },
    { key: "min", label: "Min" },
    { key: "max", label: "Max" },
    { key: "cheapest", label: "Cheapest item", align: "left" },
  ];
  const val = (r, k) => {
    if (k === "name") return r.name;
    if (k === "productCount") return r.productCount;
    if (k === "cheapest") return r.cheapest ? r.cheapest.price : Infinity;
    return r.stats ? r.stats[k] : -1;
  };
  const rows = data.retailers.slice().sort((a, b) => {
    const va = val(a, STATE.sort.key), vb = val(b, STATE.sort.key);
    if (typeof va === "string") return va.localeCompare(vb) * STATE.sort.dir;
    return (va - vb) * STATE.sort.dir;
  });

  const thead = el("thead");
  const htr = el("tr");
  for (const c of cols) {
    const th = el("th", null, esc(c.label) + (STATE.sort.key === c.key ? (STATE.sort.dir === 1 ? " ▲" : " ▼") : ""));
    if (c.align === "left") th.style.textAlign = "left";
    th.addEventListener("click", () => {
      if (STATE.sort.key === c.key) STATE.sort.dir *= -1;
      else STATE.sort = { key: c.key, dir: c.key === "name" ? 1 : 1 };
      renderTable();
    });
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const tbody = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    const status = r.stale ? '<span class="badge stale">stale</span>' : r.status === "ok" ? "" : '<span class="badge err">no data</span>';
    tr.appendChild(el("td", "retailer", `<span class="swatch" style="background:${r.color}"></span>${esc(r.name)} ${status}`));
    tr.appendChild(el("td", "num", r.productCount || "—"));
    tr.appendChild(el("td", "num", r.stats ? money(r.stats.avg) : "—"));
    tr.appendChild(el("td", "num", r.stats ? money(r.stats.median) : "—"));
    tr.appendChild(el("td", "num", r.stats ? money(r.stats.min) : "—"));
    tr.appendChild(el("td", "num", r.stats ? money(r.stats.max) : "—"));
    const cheap = r.cheapest
      ? `<a href="${esc(r.cheapest.url)}" target="_blank" rel="noopener">${esc(r.cheapest.name)}</a> — ${money(r.cheapest.price)}`
      : "—";
    const ctd = el("td", null, cheap);
    ctd.style.textAlign = "left";
    tr.appendChild(ctd);
    tbody.appendChild(tr);
  }
  table.innerHTML = "";
  table.appendChild(thead);
  table.appendChild(tbody);
}

/* ---------- product grid ---------- */
function renderProducts() {
  const data = STATE.data;
  const root = $("[data-slot=products]");
  if (!root) return;
  root.innerHTML = "";

  const cheapestOverall = data.summary.cheapestItem ? data.summary.cheapestItem.price : 0;
  let items = [];
  for (const r of data.retailers) {
    if (STATE.retailer !== "all" && r.id !== STATE.retailer) continue;
    for (const p of r.products || []) items.push({ ...p, retailer: r });
  }
  if (STATE.query) items = items.filter((p) => p.name.toLowerCase().includes(STATE.query));
  items.sort((a, b) => a.price - b.price);
  items = items.slice(0, 60);

  if (!items.length) {
    root.appendChild(el("p", "panel-sub", "No products match your filter."));
    return;
  }
  for (const p of items) {
    const card = el("div", "card");
    const top = el("div", "top");
    const rtl = el("div", "rtl");
    rtl.appendChild(el("span", "sw")).style.background = p.retailer.color;
    rtl.appendChild(document.createTextNode(p.retailer.name));
    top.appendChild(rtl);
    card.appendChild(top);
    card.appendChild(el("div", "pname", `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`));
    const isCheap = p.price <= cheapestOverall * 1.15;
    card.appendChild(el("div", "price" + (isCheap ? " cheap" : ""), money(p.price)));
    root.appendChild(card);
  }
}

load();
