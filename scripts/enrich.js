import crypto from "crypto";
import { dedupeArticles, clusterBySimilarText } from "./lib/dedupe.js";
import { enrichWithGemini } from "./lib/gemini-client.js";

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
const EXCLUDE_LABEL = "対象外";
const FALLBACK_CATEGORY = { label: "その他", emoji: "📰" };

function buildCaptionFallback(title) {
  return title.length > 40 ? title.slice(0, 39) + "…" : title;
}

function makeId(seed) {
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

/**
 * 記事候補を重複排除し、Gemini APIでキャプション/カテゴリ/重要度を付与する。
 * 主題が日立でない、または5分類に当てはまらないとGeminiが判定した記事は除外する(FR-09)。
 *
 * @param {Array} articles - collect-news.js の出力
 * @param {{apiKey:string, model:string}} geminiConfig
 * @param {string} batchDate - YYYY-MM-DD
 * @param {number} maxArticles - 1日に処理する記事の上限件数(NFR-01: 情報の網羅性よりデザイン優先)
 * @returns {Promise<Array>} tiles.json の news タイル用オブジェクト配列(idなし以外は確定)
 */
export async function enrichArticles(articles, geminiConfig, batchDate, maxArticles = 10) {
  const deduped = dedupeArticles(articles)
    // 一次情報を優先し、同条件なら新しい記事を優先して上位N件だけをタイル化する
    .sort((a, b) => {
      if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, maxArticles);
  const tiles = [];

  for (const [index, article] of deduped.entries()) {
    // Gemini無料枠のレート制限(5回/分)を超えないよう、呼び出し間隔を空ける
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 13000));

    const categoryLabels = [...CATEGORY_DEFS.map((c) => c.label), EXCLUDE_LABEL];
    let result;
    try {
      result = await enrichWithGemini(
        { title: article.title, sourceName: article.sourceName, categories: categoryLabels },
        geminiConfig
      );
    } catch (err) {
      console.error("[enrich] Gemini呼び出し失敗:", err.message);
      result = null;
    }

    let caption, categoryLabel, badgeEmoji, importance, topicKey;

    if (result === null) {
      // Gemini APIに到達できなかった場合のフォールバック(通信障害時もNFR-11により処理を継続する)
      caption = buildCaptionFallback(article.title);
      categoryLabel = FALLBACK_CATEGORY.label;
      badgeEmoji = FALLBACK_CATEGORY.emoji;
      importance = 40;
      topicKey = article.title;
    } else if (result.category === EXCLUDE_LABEL) {
      // 主題が日立でない、または5分類に当てはまらない記事は収集しない(FR-09)
      continue;
    } else {
      const categoryDef = CATEGORY_DEFS.find((c) => c.label === result.category);
      if (!categoryDef) {
        // Geminiが想定外のラベルを返した場合も安全側でフォールバック
        caption = buildCaptionFallback(article.title);
        categoryLabel = FALLBACK_CATEGORY.label;
        badgeEmoji = FALLBACK_CATEGORY.emoji;
        importance = 40;
        topicKey = article.title;
      } else {
        caption = result.caption;
        categoryLabel = categoryDef.label;
        badgeEmoji = categoryDef.emoji;
        // カテゴリの優先度帯(20点幅)の中で、Geminiのスコアを相対位置として使う。
        // これにより優先度の高い分類は常に優先度の低い分類より大きいスコアになる(FR-04, AC-05)。
        const within = Math.max(0, Math.min(100, result.importance));
        importance = categoryDef.base + Math.round((within / 100) * 19);
        topicKey = result.topicKey;
      }
    }

    tiles.push({
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
      topicKey,
      stock: null,
    });
  }

  // タイトルの文言は違っても、同じ出来事を扱う記事(例:同じ合弁ニュースを
  // 複数媒体が報じたもの)をGemini判定のtopicKeyでまとめ直す(FR-02)。
  // isOfficialを優先し、同条件なら重要度が高い方を代表として残す。
  const byTopic = clusterBySimilarText(
    tiles,
    (t) => t.topicKey,
    (candidate, current) => {
      if (candidate.isOfficial !== current.isOfficial) return candidate.isOfficial;
      return candidate.importance > current.importance;
    },
    0.5
  );

  return byTopic.map(({ topicKey, ...tile }) => tile);
}
