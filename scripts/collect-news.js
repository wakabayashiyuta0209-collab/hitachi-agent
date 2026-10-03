import { XMLParser } from "fast-xml-parser";
import { resolveGoogleNewsUrl } from "./lib/gnews-resolve.js";
import { fetchOgImage } from "./lib/fetch-og-image.js";

const parser = new XMLParser({ ignoreAttributes: false });

function buildSearchUrl(keyword) {
  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(keyword) +
    "&hl=ja&gl=JP&ceid=JP:ja"
  );
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isAllowedDomain(hostname, sources) {
  if (!hostname) return false;
  const all = [...sources.official, ...sources.press, ...sources.media];
  return all.some((domain) => hostname === domain || hostname.endsWith("." + domain));
}

function isOfficialDomain(hostname, officialDomains) {
  if (!hostname) return false;
  return officialDomains.some((d) => hostname === d || hostname.endsWith("." + d));
}

async function fetchRssItems(keyword) {
  const url = buildSearchUrl(keyword);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS取得失敗: ${res.status}`);
  const xml = await res.text();
  const data = parser.parse(xml);
  const items = data?.rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/**
 * ウォッチリストの各企業について、信頼できる情報源の範囲内の記事を収集する。
 * 失敗しても例外を投げず、取得できた範囲の配列を返す(NFR-11)。
 *
 * @param {object} watchlist - watchlist.yaml の内容
 * @param {object} sources - sources.yaml の内容
 * @param {number} maxAgeDays - 何日以内の記事を対象にするか
 * @returns {Promise<Array<{title, url, publishedAt, sourceName, isOfficial, companyName}>>}
 */
export async function collectNews(watchlist, sources, maxAgeDays = 2) {
  const results = [];
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  for (const company of watchlist.companies) {
    for (const keyword of company.newsKeywords) {
      let items;
      try {
        items = await fetchRssItems(keyword);
      } catch (err) {
        console.error(`[collect-news] RSS取得失敗 (${keyword}):`, err.message);
        continue;
      }

      for (const item of items) {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        if (pubDate && pubDate.getTime() < cutoff) continue;

        const rawTitle = String(item.title || "");
        // Google Newsのtitleは "見出し - 出典名" の形式。出典名部分を取り除く。
        const sourceNameFromTag =
          typeof item.source === "object" ? item.source["#text"] : item.source;
        const title = sourceNameFromTag
          ? rawTitle.replace(new RegExp(`\\s*-\\s*${escapeRegExp(sourceNameFromTag)}$`), "")
          : rawTitle;

        const googleLink = item.link;
        if (!googleLink) continue;

        let realUrl;
        try {
          realUrl = await resolveGoogleNewsUrl(googleLink);
        } catch (err) {
          console.error(`[collect-news] URL解決失敗: ${title}`, err.message);
          realUrl = null;
        }
        // 実記事URLを解決できない記事は、リンクが機能しないため収集しない。
        if (!realUrl) {
          console.warn(`[collect-news] URL解決不可のためスキップ: ${title}`);
          continue;
        }

        const hostname = hostnameOf(realUrl);
        if (!isAllowedDomain(hostname, sources)) {
          continue;
        }

        const imageUrl = await fetchOgImage(realUrl);

        results.push({
          title: title.trim(),
          url: realUrl,
          publishedAt: pubDate ? pubDate.toISOString() : null,
          sourceName: sourceNameFromTag || hostname,
          isOfficial: isOfficialDomain(hostname, company.officialDomains),
          companyName: company.name,
          imageUrl,
        });
      }
    }
  }

  return results;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
