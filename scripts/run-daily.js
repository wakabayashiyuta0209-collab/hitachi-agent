import fs from "fs";
import yaml from "js-yaml";
import crypto from "crypto";

// ローカル実行時は .env を読み込む(GitHub Actions上ではSecretsから注入されるため不要。
// ファイルが無い場合は何もしない)
try {
  process.loadEnvFile(".env");
} catch {
  /* .env が無い場合は何もしない */
}

import { collectNews } from "./collect-news.js";
import { collectPrtimes } from "./collect-prtimes.js";
import { collectHitachiOfficial } from "./collect-hitachi-official.js";
import { collectStock } from "./collect-stock.js";
import { enrichArticles } from "./enrich.js";
import { assignTileSizes } from "./lib/scoring.js";
import { appendTiles } from "./store.js";
import { buildSite } from "./build-site.js";
import { isMarketHoliday } from "./lib/market-calendar.js";
import { sendNotification } from "./notify.js";

function todayJst() {
  const now = new Date();
  // JSTはUTC+9。日付境界をJSTで判定する。
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function buildStockTile(ticker, companyName, stockData, batchDate) {
  if (!stockData) return null;
  return {
    id: crypto.createHash("sha1").update(`${ticker}-${batchDate}`).digest("hex").slice(0, 12),
    type: "stock",
    batchDate,
    category: "株価",
    badgeEmoji: "📈",
    caption: `${companyName}(${ticker.split(".")[0]})`,
    sourceUrl: null,
    sourceName: null,
    imageUrl: null,
    size: "sq",
    importance: stockData.isSignificantMove ? 90 : 50,
    isOfficial: null,
    stock: {
      price: stockData.price,
      changePercent: stockData.changePercent,
      direction: stockData.direction,
      sparkline: stockData.sparkline,
      isSignificantMove: stockData.isSignificantMove,
    },
  };
}

export async function runDaily() {
  const batchDate = todayJst();
  console.log(`[run-daily] 開始 batchDate=${batchDate}`);

  if (process.env.FORCE_RUN !== "1" && (await isMarketHoliday())) {
    console.log("[run-daily] 本日は東証休業日のため、更新処理を行わず終了します(FR-20)");
    return [];
  }

  const watchlist = yaml.load(fs.readFileSync("data/watchlist.yaml", "utf8"));
  const sources = yaml.load(fs.readFileSync("data/sources.yaml", "utf8"));

  const geminiConfig = {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  };

  console.log("[run-daily] ニュース収集中(Google News)...");
  let googleArticles = [];
  try {
    googleArticles = await collectNews(watchlist, sources);
  } catch (err) {
    console.error("[run-daily] Google News収集で致命的エラー(空配列で続行):", err.message);
  }
  console.log(`[run-daily]   -> ${googleArticles.length}件`);

  console.log("[run-daily] ニュース収集中(PR TIMES)...");
  let prtimesArticles = [];
  try {
    prtimesArticles = await collectPrtimes(watchlist);
  } catch (err) {
    console.error("[run-daily] PR TIMES収集で致命的エラー(空配列で続行):", err.message);
  }
  console.log(`[run-daily]   -> ${prtimesArticles.length}件`);

  console.log("[run-daily] ニュース収集中(日立公式サイト)...");
  let hitachiArticles = [];
  try {
    hitachiArticles = await collectHitachiOfficial();
  } catch (err) {
    console.error("[run-daily] 日立公式サイト収集で致命的エラー(空配列で続行):", err.message);
  }
  console.log(`[run-daily]   -> ${hitachiArticles.length}件`);

  const articles = [...hitachiArticles, ...prtimesArticles, ...googleArticles];
  console.log(`[run-daily] 記事候補 合計${articles.length}件`);

  console.log("[run-daily] 要約・分類中(Gemini)...");
  const newsTiles = await enrichArticles(articles, geminiConfig, batchDate);
  console.log(`[run-daily] タイル化された記事 ${newsTiles.length}件`);

  console.log("[run-daily] 株価収集中...");
  const stockTiles = [];
  for (const company of watchlist.companies) {
    const stockData = await collectStock(company.ticker);
    const tile = buildStockTile(company.ticker, company.name, stockData, batchDate);
    if (tile) stockTiles.push(tile);
  }
  console.log(`[run-daily] 株価タイル ${stockTiles.length}件`);

  // 株価タイルを先頭(グリッドの一番上)に配置する
  const allNewTiles = assignTileSizes([...stockTiles, ...newsTiles]);

  console.log("[run-daily] tiles.json 更新中...");
  appendTiles(allNewTiles);

  console.log("[run-daily] サイト生成中...");
  buildSite();

  console.log("[run-daily] 通知メール送信中...");
  try {
    await sendNotification(allNewTiles, {
      apiKey: process.env.RESEND_API_KEY,
      fromName: watchlist.notification?.fromName,
      toEmail: process.env.NOTIFY_EMAIL || watchlist.notification?.toEmail,
      siteUrl: process.env.SITE_URL,
    });
    console.log("[run-daily] 通知メール送信完了");
  } catch (err) {
    // 通知の失敗でサイト更新(既に完了済み)自体を無効にはしない(NFR-11の精神)。
    // ただしログには明示的にエラーとして残し、GitHub Actionsの実行ログから気づけるようにする(NFR-12)。
    console.error("[run-daily] 通知メール送信失敗:", err.message);
  }

  console.log(`[run-daily] 完了。新規タイル ${allNewTiles.length}件`);
  return allNewTiles;
}

if (process.argv[1] && process.argv[1].endsWith("run-daily.js")) {
  runDaily().catch((err) => {
    console.error("[run-daily] 致命的エラー:", err);
    process.exit(1);
  });
}
