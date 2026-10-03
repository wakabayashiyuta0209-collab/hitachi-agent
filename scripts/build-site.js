import fs from "fs";
import path from "path";
import { loadTiles } from "./store.js";

const CATEGORY_KEYS = {
  経営情報: "keiei",
  提携: "teikei",
  統廃合: "touhaigo",
  先進事例: "senshin",
  人事: "jinji",
  その他: "sonota",
};

const EXPANDED_BATCH_COUNT = 2; // 直近2回分は展開表示(FR-15)

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildSparklinePath(values) {
  if (!values || values.length < 2) return { line: "", area: "" };
  const w = 100;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return [x, y];
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return { line, area };
}

function renderNewsTile(tile) {
  const categoryKey = CATEGORY_KEYS[tile.category] || "sonota";
  const bg = tile.imageUrl
    ? `<div class="bg photo" style="background-image:url('${escapeHtml(tile.imageUrl)}')"></div>`
    : `<div class="bg placeholder" data-icon="${escapeHtml(tile.badgeEmoji)}"></div>`;
  const pressLabel = !tile.isOfficial ? `<span class="press-label">報道</span>` : "";

  return `<div class="tile ${tile.size} is-new" data-cat="${categoryKey}" data-tile-id="${tile.id}" data-url="${escapeHtml(tile.sourceUrl)}">
  ${bg}
  <span class="badge">${tile.badgeEmoji} ${escapeHtml(tile.category)}</span>
  ${pressLabel}
  <span class="new-chip">NEW</span>
  <span class="cap">${escapeHtml(tile.caption)}</span>
</div>`;
}

function renderStockTile(tile) {
  const s = tile.stock;
  const direction = s.direction === "up" ? "up" : s.direction === "down" ? "down" : "";
  const { line, area } = buildSparklinePath(s.sparkline);
  const sign = s.changePercent > 0 ? "+" : "";
  const arrow = s.direction === "up" ? "▲" : s.direction === "down" ? "▼" : "・";
  const significantClass = s.isSignificantMove ? " significant-move" : "";

  return `<div class="tile ${tile.size} stock ${direction}${significantClass} is-new" data-tile-id="${tile.id}">
  <svg class="stock-chart" viewBox="0 0 100 40" preserveAspectRatio="none">
    <path class="area" d="${area}"></path>
    <path class="line" d="${line}"></path>
  </svg>
  <span class="badge">${tile.badgeEmoji} ${escapeHtml(tile.category)}</span>
  <span class="new-chip">NEW</span>
  <div class="cap">
    <span class="name">${escapeHtml(tile.caption)}</span>
    <span class="price">¥${s.price.toLocaleString("ja-JP")}</span>
    <span class="chg">${arrow}${sign}${s.changePercent}%</span>
  </div>
</div>`;
}

function renderTile(tile) {
  return tile.type === "stock" ? renderStockTile(tile) : renderNewsTile(tile);
}

function groupByBatch(tiles) {
  const order = [];
  const map = new Map();
  for (const tile of tiles) {
    if (!map.has(tile.batchDate)) {
      map.set(tile.batchDate, []);
      order.push(tile.batchDate);
    }
    map.get(tile.batchDate).push(tile);
  }
  return order.map((batchDate) => ({ batchDate, tiles: map.get(batchDate) }));
}

export function renderGridHtml(tiles) {
  const batches = groupByBatch(tiles);
  const expanded = batches.slice(0, EXPANDED_BATCH_COUNT);
  const collapsed = batches.slice(EXPANDED_BATCH_COUNT);

  const expandedHtml = expanded.flatMap((b) => b.tiles.map(renderTile)).join("\n");

  let collapsedHtml = "";
  if (collapsed.length > 0) {
    const collapsedTiles = collapsed.flatMap((b) => b.tiles.map(renderTile)).join("\n");
    collapsedHtml = `
<button class="collapse-toggle" type="button" data-target="collapsed-tiles">
  <span class="toggle-icon">▼</span> 過去の更新 <span class="unread-badge" hidden></span>
</button>
<div class="collapse-section is-collapsed" id="collapsed-tiles">
${collapsedTiles}
</div>`;
  }

  return `${expandedHtml}\n${collapsedHtml}`;
}

export function buildSite({
  tilesPath = "data/tiles.json",
  templatePath = "site/template.html",
  outDir = "dist",
} = {}) {
  const tiles = loadTiles(tilesPath);
  const template = fs.readFileSync(templatePath, "utf8");
  const gridHtml = renderGridHtml(tiles);
  const html = template.replace("<!--TILES-->", gridHtml);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  fs.copyFileSync("site/styles.css", path.join(outDir, "styles.css"));
  fs.copyFileSync("site/client.js", path.join(outDir, "client.js"));

  console.log(`[build-site] ${tiles.length}件のタイルから dist/index.html を生成しました`);
}

if (process.argv[1] && process.argv[1].endsWith("build-site.js")) {
  buildSite();
}
