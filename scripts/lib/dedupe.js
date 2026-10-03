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
 * 同じ話題を扱う記事を1件にまとめる(FR-02)。
 * タイトルの2-gram Jaccard類似度が閾値以上のものを重複とみなし、
 * isOfficial を優先、次点は先に見つかった記事を代表として残す。
 */
export function dedupeArticles(articles, threshold = 0.6) {
  const groups = [];

  for (const article of articles) {
    const grams = bigrams(normalize(article.title));
    let matchedGroup = null;

    for (const group of groups) {
      const similarity = jaccardSimilarity(grams, group.representativeGrams);
      if (similarity >= threshold) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.members.push(article);
      if (article.isOfficial && !matchedGroup.representative.isOfficial) {
        matchedGroup.representative = article;
        matchedGroup.representativeGrams = grams;
      }
    } else {
      groups.push({ representative: article, representativeGrams: grams, members: [article] });
    }
  }

  return groups.map((g) => g.representative);
}
