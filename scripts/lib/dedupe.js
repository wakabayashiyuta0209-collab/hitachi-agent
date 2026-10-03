function normalize(text) {
  return text.replace(/[\s　、。・「」『』【】\[\]()（）\-–—:：]/g, "").toLowerCase();
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const g of a) if (b.has(g)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * テキストの2-gram Jaccard類似度で似ているものを1グループにまとめ、
 * 各グループの代表1件だけを返す汎用関数。
 *
 * @param {Array} items
 * @param {(item) => string} getText - 類似度比較に使うテキストを取り出す関数
 * @param {(a, b) => boolean} isBetter - bよりaを代表として優先すべきか
 * @param {number} threshold - この値以上のJaccard類似度を同一とみなす
 */
export function clusterBySimilarText(items, getText, isBetter, threshold) {
  const groups = [];

  for (const item of items) {
    const grams = bigrams(normalize(getText(item)));
    let matchedGroup = null;

    for (const group of groups) {
      if (jaccardSimilarity(grams, group.representativeGrams) >= threshold) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      if (isBetter(item, matchedGroup.representative)) {
        matchedGroup.representative = item;
        matchedGroup.representativeGrams = grams;
      }
    } else {
      groups.push({ representative: item, representativeGrams: grams });
    }
  }

  return groups.map((g) => g.representative);
}

/**
 * 同じ話題を扱う記事を1件にまとめる(FR-02)。
 * タイトルの2-gram Jaccard類似度が閾値以上のものを重複とみなし、
 * isOfficial を優先、次点は先に見つかった記事を代表として残す。
 */
export function dedupeArticles(articles, threshold = 0.6) {
  return clusterBySimilarText(
    articles,
    (a) => a.title,
    (candidate, current) => candidate.isOfficial && !current.isOfficial,
    threshold
  );
}
