// Google News RSSの<link>は news.google.com のリダイレクトページであり、
// 実記事のURLではない。記事ページに埋め込まれた署名付きIDを
// Google内部の batchexecute エンドポイントへ渡すことで、実URLを取得する。
// (Googleが公開しているAPIではないため、将来仕様変更で動かなくなる可能性がある。
//  解決できない場合はnullを返し、呼び出し側でそのタイルを除外する)

const DECODE_ENDPOINT = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

async function fetchArticlePageIds(googleNewsUrl) {
  const res = await fetch(googleNewsUrl, { redirect: "follow" });
  if (!res.ok) return null;
  const html = await res.text();

  const idMatch = html.match(/data-n-a-id="([^"]+)"/);
  const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);
  const sgMatch = html.match(/data-n-a-sg="([^"]+)"/);
  if (!idMatch || !sgMatch) return null;

  return {
    id: idMatch[1],
    ts: tsMatch ? tsMatch[1] : "0",
    sg: sgMatch[1],
  };
}

async function decodeRealUrl({ id, ts, sg }) {
  const innerArray = [
    "garturlreq",
    [
      ["en-US", "US", ["FINANCE_TOP_INDICES", "GENESIS_PUBLISHER_SECTION", "WEB_TEST_1_0_0"], null, null, 1, 1, "US:en", null, null, null, null, null, null, null, false, 5],
      "en-US",
      "US",
      true,
      [3, 5, 9, 19],
      1,
      true,
      "990638521",
      null,
      null,
      null,
      false,
    ],
    id,
    ts,
    sg,
  ];
  const reqArray = [[["Fbv4je", JSON.stringify(innerArray), null, "generic"]]];
  const body = "f.req=" + encodeURIComponent(JSON.stringify(reqArray));

  const res = await fetch(DECODE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!res.ok) return null;
  const text = await res.text();

  // レスポンスは ")]}'\n\n[[...]]" のような形式。1行目のゴミを除いてJSONとして解釈する。
  const jsonLine = text.split("\n").find((line) => line.trim().startsWith("["));
  if (!jsonLine) return null;

  let outer;
  try {
    outer = JSON.parse(jsonLine);
  } catch {
    return null;
  }

  const frame = outer.find((row) => row[0] === "wrb.fr" && row[1] === "Fbv4je");
  if (!frame || typeof frame[2] !== "string") return null;

  let inner;
  try {
    inner = JSON.parse(frame[2]);
  } catch {
    return null;
  }

  if (inner[0] === "garturlres" && typeof inner[1] === "string") {
    return inner[1];
  }
  return null;
}

/**
 * Google News RSSの<link>(リダイレクトURL)を、実記事のURLへ変換する。
 * 解決できない場合はnullを返す。
 */
export async function resolveGoogleNewsUrl(googleNewsUrl) {
  try {
    const ids = await fetchArticlePageIds(googleNewsUrl);
    if (!ids) return null;
    const realUrl = await decodeRealUrl(ids);
    return realUrl || null;
  } catch {
    return null;
  }
}
