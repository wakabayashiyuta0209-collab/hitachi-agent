// 記事ページのOGP画像をサムネイルとして使う。画像ファイル自体は複製せず、
// 元記事のURLをそのまま参照する(リンクプレビューと同様の扱い。NFR-50/51)。
//
// サイトの汎用ロゴ・ノーイメージ画像など、ニュースの内容を表さない画像は
// 除外する(除外した場合はnullを返し、呼び出し側でカテゴリ別のプレースホルダーを使う)。

const BAD_URL_PATTERNS = [
  /logo/i,
  /no[-_]?image/i,
  /noimage/i,
  /default/i,
  /placeholder/i,
  /favicon/i,
  /og[-_]default/i,
  /common\/image/i,
  /disclosure/i, // 適時開示等の自動生成テーブル画像(文書のスクリーンショットで見栄えが悪い)
  /\/tdnr\//i,
];

const MIN_DIMENSION = 300;

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaContent(html, property) {
  const tagMatch = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]*>`, "i")
  );
  if (!tagMatch) return null;
  const contentMatch = tagMatch[0].match(/content=["']([^"']+)["']/i);
  return contentMatch ? decodeHtmlEntities(contentMatch[1]) : null;
}

export async function fetchOgImage(articleUrl) {
  try {
    const res = await fetch(articleUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const html = await res.text();

    const imageUrl = extractMetaContent(html, "og:image");
    if (!imageUrl) return null;

    if (BAD_URL_PATTERNS.some((re) => re.test(imageUrl))) return null;

    const width = Number(extractMetaContent(html, "og:image:width"));
    const height = Number(extractMetaContent(html, "og:image:height"));
    if (width && height && (width < MIN_DIMENSION || height < MIN_DIMENSION)) return null;

    return imageUrl;
  } catch {
    return null;
  }
}
