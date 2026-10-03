import { fetchOgImage } from "./lib/fetch-og-image.js";

const PRESS_URL = "https://www.hitachi.com/ja-jp/press/";

function parseDateFromUrl(url) {
  // https://www.hitachi.com/ja-jp/press/articles/2026/09/0903b/ -> 2026-09-03
  const m = url.match(/\/articles\/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(`${y}-${mo}-${d}T00:00:00+09:00`);
}

function parseArticles(html) {
  const results = [];
  const re = /<a[^>]+href="(https:\/\/www\.hitachi\.com\/ja-jp\/press\/articles\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const [, url, inner] = m;
    const title = inner.replace(/<[^>]+>/g, "").trim();
    // "詳細はこちら" などのリンク文言や空文言は見出しとして扱わない
    if (!title || title === "詳細はこちら" || seen.has(url)) continue;
    seen.add(url);
    results.push({ url, title, publishedAt: parseDateFromUrl(url) });
  }
  return results;
}

/**
 * 日立製作所公式サイトのニュースリリース一覧から記事候補を収集する(一次情報)。
 * 失敗しても例外を投げず、取得できた範囲の配列を返す(NFR-11)。
 *
 * @param {number} maxAgeDays - 何日以内の記事を対象にするか
 * @returns {Promise<Array<{title, url, publishedAt, sourceName, isOfficial, companyName, imageUrl}>>}
 */
export async function collectHitachiOfficial(maxAgeDays = 2) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  let html;
  try {
    const res = await fetch(PRESS_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`取得失敗: ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error("[collect-hitachi-official]", err.message);
    return [];
  }

  const articles = parseArticles(html).filter(
    (a) => !a.publishedAt || a.publishedAt.getTime() >= cutoff
  );

  const results = [];
  for (const article of articles) {
    const imageUrl = await fetchOgImage(article.url);
    results.push({
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt ? article.publishedAt.toISOString() : null,
      sourceName: "日立製作所 ニュースリリース",
      isOfficial: true,
      companyName: "日立製作所",
      imageUrl,
    });
  }
  return results;
}
