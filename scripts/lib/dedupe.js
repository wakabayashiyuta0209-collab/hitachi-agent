function normalize(title) {
  return title.replace(/[\s　、。・「」『』【】\[\]()（）\-–—:：]/g, "").toLowerCase();
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
 * タイトルの文字列レベルでの重複(同一記事の転載・ほぼ同じ見出し)をまとめる。
 * 表現が異なる同一トピックの統合はenrich.js側のGeminiオーケストレーションで行うため、
 * ここでは閾値を高めに取り、明らかな同一記事だけを対象とする。
 */
export function dedupeArticles(articles, threshold = 0.75) {
  const groups = [];

  for (const article of articles) {
    const grams = bigrams(normalize(article.title));
    let matchedGroup = null;

    for (const group of groups) {
      if (jaccardSimilarity(grams, group.representativeGrams) >= threshold) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      if (article.isOfficial && !matchedGroup.representative.isOfficial) {
        matchedGroup.representative = article;
        matchedGroup.representativeGrams = grams;
      }
    } else {
      groups.push({ representative: article, representativeGrams: grams });
    }
  }

  return groups.map((g) => g.representative);
}
