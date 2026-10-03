import crypto from "crypto";
import { dedupeArticles } from "./lib/dedupe.js";
import { selectTopicsWithGemini } from "./lib/gemini-client.js";

// 要件6.0の5分類(優先度①が最も重要)。
// 詳細設計6.3のプロンプト例は決算/技術/人事...という広い分類だったが、
// FR-09(主題が日立でない記事・5分類に当たらない記事はタイルにしない)と
// FR-04(優先度が高いほど大きいタイル)を両立させるため、
// Geminiには要件書の5分類そのものを判定させ、分類できない記事は除外する。
export const CATEGORY_DEFS = [
  { label: "経営情報", emoji: "📊", base: 80 },
  { label: "提携", emoji: "🤝", base: 60 },
  { label: "統廃合", emoji: "🔀", base: 40 },
  { label: "先進事例", emoji: "💡", base: 20 },
  { label: "人事", emoji: "👔", base: 0 },
];
const FALLBACK_CATEGORY = { label: "その他", emoji: "📰" };

function buildCaptionFallback(title) {
  return title.length > 40 ? title.slice(0, 39) + "…" : title;
}

function makeId(seed) {
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

function buildTile(article, { caption, categoryLabel, badgeEmoji, importance }, batchDate) {
  return {
    id: makeId(article.url),
    type: "news",
    batchDate,
    category: categoryLabel,
    badgeEmoji,
    caption,
    sourceUrl: article.url,
    sourceName: article.sourceName,
    imageUrl: article.imageUrl || null,
    size: null, // lib/scoring.js で後から決定
    importance,
    isOfficial: article.isOfficial,
    stock: null,
  };
}

/**
 * 記事候補(タイトルレベルの重複を除いた上位N件)をまとめてGeminiに渡し、
 * 「同じ出来事はひとつにまとめる」「主題が日立でない/5分類に当たらないものは除く」
 * 「キャプション・カテゴリ・重要度を付ける」を1回のオーケストレーション呼び出しで行う(FR-02, FR-09)。
 * Gemini呼び出しに失敗した場合は、上位数件をフォールバック表示する(NFR-11)。
 *
 * @param {Array} articles - collect-news.js 等の出力
 * @param {{apiKey:string, model:string}} geminiConfig
 * @param {string} batchDate - YYYY-MM-DD
 * @param {number} candidatePoolSize - オーケストレーターに渡す候補記事の上限件数
 * @returns {Promise<Array>} tiles.json の news タイル用オブジェクト配列
 */
export async function enrichArticles(articles, geminiConfig, batchDate, candidatePoolSize = 20) {
  const candidates = dedupeArticles(articles)
    // 一次情報を優先し、同条件なら新しい記事を優先して上位N件を候補プールとする
    .sort((a, b) => {
      if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, candidatePoolSize);

  if (candidates.length === 0) return [];

  const categoryLabels = CATEGORY_DEFS.map((c) => c.label);
  let selections;
  try {
    selections = await selectTopicsWithGemini(candidates, categoryLabels, geminiConfig);
  } catch (err) {
    console.error("[enrich] Geminiオーケストレーション呼び出し失敗:", err.message);
    selections = null;
  }

  if (selections === null) {
    // Gemini APIに到達できなかった場合のフォールバック。
    // 記事単体の品質を判断できないため、件数を絞ってその他扱いで表示する(NFR-11)。
    console.warn("[enrich] フォールバック表示に切り替えます(上位5件)");
    return candidates
      .slice(0, 5)
      .map((article) =>
        buildTile(
          article,
          {
            caption: buildCaptionFallback(article.title),
            categoryLabel: FALLBACK_CATEGORY.label,
            badgeEmoji: FALLBACK_CATEGORY.emoji,
            importance: 40,
          },
          batchDate
        )
      );
  }

  const tiles = [];
  const usedIndexes = new Set();

  for (const selection of selections) {
    if (usedIndexes.has(selection.sourceIndex)) continue; // Geminiが同じ記事を複数グループに入れた場合の保険
    usedIndexes.add(selection.sourceIndex);

    const article = candidates[selection.sourceIndex];
    const categoryDef = CATEGORY_DEFS.find((c) => c.label === selection.category);
    if (!categoryDef) continue; // 想定外のカテゴリラベルは安全側で除外

    // カテゴリの優先度帯(20点幅)の中で、Geminiのスコアを相対位置として使う。
    // これにより優先度の高い分類は常に優先度の低い分類より大きいスコアになる(FR-04, AC-05)。
    const within = Math.max(0, Math.min(100, selection.importance));
    const importance = categoryDef.base + Math.round((within / 100) * 19);

    tiles.push(
      buildTile(
        article,
        { caption: selection.caption, categoryLabel: categoryDef.label, badgeEmoji: categoryDef.emoji, importance },
        batchDate
      )
    );
  }

  return tiles;
}
