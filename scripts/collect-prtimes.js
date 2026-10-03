// PR TIMESのキーワード検索結果ページ(サーバーサイドレンダリング)をパースする。
// Google Newsと異なりリンクが直接記事URLであり、サムネイル画像・発信元企業名も
// 検索結果に含まれているため、追加のURL解決・画像取得が不要。

function buildSearchUrl(keyword) {
  return (
    "https://prtimes.jp/main/action.php?run=html&page=searchkey&search_word=" +
    encodeURIComponent(keyword)
  );
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseJapaneseDateTime(text) {
  // "2026年10月2日 11時10分" -> Date
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})時(\d{1,2})分/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // JSTとして解釈してUTCへ変換
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

const ARTICLE_RE =
  /<a class="_link_13jbw_11" href="(\/main\/html\/rd\/p\/[^"]+)"[^>]*><div[^>]*><h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<time>([^<]*)<\/time>[\s\S]*?(?:<img[^>]+src="([^"]+)"[^>]*class="_thumbnail_[^"]*"[^>]*\/>)?<\/a><span class="_companyName_[^"]*"><a[^>]*>([\s\S]*?)<\/a><\/span>/g;

function parseSearchResults(html) {
  const results = [];
  let m;
  ARTICLE_RE.lastIndex = 0;
  while ((m = ARTICLE_RE.exec(html))) {
    const [, href, titleHtml, timeText, imageUrl, companyHtml] = m;
    // PR TIMESは画像未設定の記事に "/common/v3/blank/..." のダミー画像を返すため除外する
    const validImage = imageUrl && !imageUrl.includes("/common/") ? decodeHtmlEntities(imageUrl) : null;
    results.push({
      url: "https://prtimes.jp" + href,
      title: decodeHtmlEntities(titleHtml.replace(/<[^>]+>/g, "").trim()),
      publishedAt: parseJapaneseDateTime(timeText),
      imageUrl: validImage,
      companyName: decodeHtmlEntities(companyHtml.replace(/<[^>]+>/g, "").trim()),
    });
  }
  return results;
}

/**
 * ウォッチリストの各企業について、PR TIMESのキーワード検索から記事候補を収集する。
 * 失敗しても例外を投げず、取得できた範囲の配列を返す(NFR-11)。
 *
 * @param {object} watchlist - watchlist.yaml の内容
 * @param {number} maxAgeDays - 何日以内の記事を対象にするか
 * @returns {Promise<Array<{title, url, publishedAt, sourceName, isOfficial, companyName, imageUrl}>>}
 */
export async function collectPrtimes(watchlist, maxAgeDays = 2) {
  const results = [];
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  for (const company of watchlist.companies) {
    for (const keyword of company.newsKeywords) {
      let html;
      try {
        const res = await fetch(buildSearchUrl(keyword), {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) throw new Error(`PR TIMES検索失敗: ${res.status}`);
        html = await res.text();
      } catch (err) {
        console.error(`[collect-prtimes] 取得失敗 (${keyword}):`, err.message);
        continue;
      }

      const articles = parseSearchResults(html);
      const officialNames = company.prTimesOfficialNames || [];

      for (const article of articles) {
        if (article.publishedAt && article.publishedAt.getTime() < cutoff) continue;

        results.push({
          title: article.title,
          url: article.url,
          publishedAt: article.publishedAt ? article.publishedAt.toISOString() : null,
          sourceName: article.companyName,
          isOfficial: officialNames.includes(article.companyName),
          companyName: company.name,
          imageUrl: article.imageUrl,
        });
      }
    }
  }

  return results;
}
