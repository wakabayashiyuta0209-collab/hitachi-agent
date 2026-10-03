import fs from "fs";

const TILES_PATH = "data/tiles.json";

export function loadTiles(path = TILES_PATH) {
  if (!fs.existsSync(path)) return [];
  const raw = fs.readFileSync(path, "utf8");
  return raw.trim() ? JSON.parse(raw) : [];
}

/**
 * 新規タイルを既存タイルの先頭に追加して書き戻す。既存タイルは変更しない。
 */
export function appendTiles(newTiles, path = TILES_PATH) {
  const existing = loadTiles(path);
  const updated = [...newTiles, ...existing];
  fs.writeFileSync(path, JSON.stringify(updated, null, 2) + "\n", "utf8");
  return updated;
}
