// 株価取得。
// 基本設計書ではstooqを想定していたが、動作検証の結果 stooq はこの実行環境
// (および GitHub Actions 等のクラウドIPレンジ)から 403 Access denied を返し
// 利用できなかったため、同じく無料・無認証で利用できる Yahoo Finance の
// チャートAPIに差し替えている(NFR-40「無料」の制約は変わらず満たす)。

const CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart/";

function toYahooSymbol(tickerJp) {
  // "6501.jp" -> "6501.T"
  const code = tickerJp.split(".")[0];
  return `${code}.T`;
}

/**
 * @param {string} ticker - watchlist.yaml の ticker (例: "6501.jp")
 * @returns {Promise<{price:number, changePercent:number, direction:string, sparkline:number[], isSignificantMove:boolean}|null>}
 *   取得失敗時は null (呼び出し側は株価タイル生成をスキップして継続する)
 */
export async function collectStock(ticker) {
  const symbol = toYahooSymbol(ticker);
  const url = `${CHART_ENDPOINT}${symbol}?range=6mo&interval=1d`;

  let json;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`株価取得失敗: ${res.status}`);
    json = await res.json();
  } catch (err) {
    console.error("[collect-stock]", err.message);
    return null;
  }

  const result = json?.chart?.result?.[0];
  const closesRaw = result?.indicators?.quote?.[0]?.close;
  if (!result || !Array.isArray(closesRaw)) {
    console.error("[collect-stock] 予期しないレスポンス形式");
    return null;
  }

  // nullの欠損値(休場日・取得不能日)を除去
  const closes = closesRaw.filter((v) => typeof v === "number");
  if (closes.length < 2) {
    console.error("[collect-stock] 有効な終値が不足");
    return null;
  }

  const price = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const changePercent = Number((((price - prevClose) / prevClose) * 100).toFixed(2));
  const direction = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";

  const sparkline = closes.slice(-15);
  const isSignificantMove = calcIsSignificantMove(closes, changePercent);

  return { price, changePercent, direction, sparkline, isSignificantMove };
}

/**
 * FR-07「大きく動いた」の判定。
 * 直近60営業日の日次騰落率の標準偏差(σ)の2倍以上を基準とする。
 * 60営業日分のデータが無い場合は固定値(±3%)を使う。
 */
function calcIsSignificantMove(closes, latestChangePercent) {
  const window = closes.slice(0, -1).slice(-61); // 当日を除いた直近60日分の終値(前日比を60個作るには61個必要)
  if (window.length < 61) {
    return Math.abs(latestChangePercent) >= 3;
  }

  const dailyReturns = [];
  for (let i = 1; i < window.length; i++) {
    dailyReturns.push(((window[i] - window[i - 1]) / window[i - 1]) * 100);
  }

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);

  return Math.abs(latestChangePercent) >= stdDev * 2;
}
