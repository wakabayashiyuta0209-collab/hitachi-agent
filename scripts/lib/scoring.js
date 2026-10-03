/**
 * 重要度スコア(0-100)からタイルサイズを決定する(4.4)。
 * big(2x2)は画面を占有しすぎるため使用しない。最大サイズはwide/tall。
 */
export function assignTileSizes(tiles) {
  let wideTallToggle = 0;

  const sizeById = new Map();
  for (const tile of tiles) {
    if (tile.type === "stock") {
      sizeById.set(tile.id, "sq");
      continue;
    }

    if (tile.importance >= 65) {
      sizeById.set(tile.id, wideTallToggle++ % 2 === 0 ? "wide" : "tall");
    } else {
      sizeById.set(tile.id, "sq");
    }
  }

  return tiles.map((tile) => ({ ...tile, size: sizeById.get(tile.id) }));
}
