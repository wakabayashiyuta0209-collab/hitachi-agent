const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelaySeconds(errText) {
  const m = errText.match(/"retryDelay":\s*"(\d+)s"/);
  return m ? Number(m[1]) : null;
}

async function callGemini(prompt, { apiKey, model }) {
  if (!apiKey) return null;

  const url = `${ENDPOINT}/${model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  });

  const MAX_ATTEMPTS = 2;
  let res;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      console.error("[gemini-client] 通信エラー:", err.message);
      return null;
    }

    if (res.ok) break;

    const errText = await res.text().catch(() => "");

    // 日次クォータ切れ(RetryInfoのretryDelayが長い)は待っても解決しないため即座に諦める。
    // 一時的な混雑(503)やRPM制限(短いretryDelayの429)のみ再試行する。
    const retryDelaySec = parseRetryDelaySeconds(errText);
    const isLongTermQuotaError = retryDelaySec !== null && retryDelaySec > 120;

    if (!isLongTermQuotaError && (res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS - 1) {
      const waitMs = 15000;
      console.warn(`[gemini-client] ${res.status}のため${waitMs / 1000}秒待って再試行します`);
      await sleep(waitMs);
      continue;
    }
    if (isLongTermQuotaError) {
      console.error(`[gemini-client] 日次クォータ切れ(モデル:${model})。フォールバックに切り替えます`);
    } else {
      console.error("[gemini-client] APIエラー:", res.status, errText);
    }
    return null;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 候補記事リストをまとめてGeminiに渡し、1回の呼び出しで
 * 「同じ出来事をまとめる」「5分類に当てはまらないものを除外する」
 * 「キャプション・カテゴリ・重要度を付与する」をまとめて行わせる(オーケストレーション)。
 * 記事を1件ずつ投げて事後的に文字列類似度でまとめる方式だと、見出しの表現が
 * 違うだけの同一トピックを確実には統合できないため、候補を一度に見せて
 * Gemini自身に「これらは同じ出来事か」を判断させる。
 *
 * @param {Array<{title:string, sourceName:string, isOfficial:boolean}>} candidates
 * @param {string[]} categories - 5分類のラベル
 * @param {{apiKey:string, model:string}} config
 * @returns {Promise<Array<{sourceIndex:number, caption:string, category:string, importance:number}>|null>}
 *   失敗時はnull
 */
export async function selectTopicsWithGemini(candidates, categories, config) {
  const list = candidates
    .map(
      (c, i) =>
        `${i}. タイトル: ${c.title} / 出典: ${c.sourceName}${c.isOfficial ? "(公式発表)" : ""}`
    )
    .join("\n");

  const prompt =
    `あなたは日立製作所の社内向けニュースダイジェストの編集者です。` +
    `以下は本日の候補記事の一覧です。これらを「実際に起きた1つの出来事」単位でグルーピングし、` +
    `グループごとに最も代表的な記事を1件だけ選んでください。見出しの言い回しが違うだけで` +
    `同じ出来事を報じている記事(例:同じ提携や同じ新会社設立を複数媒体が報じたもの)は、` +
    `必ず1つのグループにまとめてください。同じ出来事かどうか迷った場合は、まとめる方を優先してください。\n\n` +
    `候補記事(先頭の数字がsourceIndex):\n${list}\n\n` +
    `選ぶ際のルール:\n` +
    `- 記事の主題が日立製作所(グループ会社を含む)でないもの、または下記の5分類のいずれにも` +
    `当てはまらないものはグループに含めず、結果からも除外してください\n` +
    `- グループの代表記事は、出典が「(公式発表)」のものを優先して選んでください\n` +
    `- 5分類: ${categories.join(" / ")}\n\n` +
    `出力形式(JSON配列。グループの数だけ要素を持つ):\n` +
    `[{"sourceIndex": 代表記事の番号(整数), "caption": "25文字程度の短い見出し", ` +
    `"category": "${categories.join("|")}のいずれか", ` +
    `"importance": 0から100の整数(日立製作所の株主・従業員にとっての重要度)}]`;

  const result = await callGemini(prompt, config);
  if (!Array.isArray(result)) return null;

  const valid = result.filter(
    (r) =>
      Number.isInteger(r?.sourceIndex) &&
      r.sourceIndex >= 0 &&
      r.sourceIndex < candidates.length &&
      typeof r.caption === "string" &&
      typeof r.category === "string" &&
      typeof r.importance === "number"
  );
  return valid;
}
