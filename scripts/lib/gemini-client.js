const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelaySeconds(errText) {
  const m = errText.match(/"retryDelay":\s*"(\d+)s"/);
  return m ? Number(m[1]) : null;
}

/**
 * 記事タイトル・出典から、キャプション・カテゴリ・重要度をGemini APIで取得する。
 * 失敗時(APIキー未設定・通信エラー・JSONパース失敗)はnullを返す。
 * 無料枠のレート制限(429)・一時的な混雑(503)の場合は、少し待って1回だけ再試行する。
 */
export async function enrichWithGemini({ title, sourceName, categories }, { apiKey, model }) {
  if (!apiKey) return null;

  const prompt =
    `以下のニュース記事の情報から、次のJSON形式で出力してください。記事にない事実を加えないでください。\n\n` +
    `記事タイトル: ${title}\n出典: ${sourceName}\n\n` +
    `出力形式:\n{"caption": "25文字程度の短い見出し", "category": "${categories.join("|")}のいずれか", "importance": 0から100の整数(日立製作所の株主・従業員にとっての重要度), "topicKey": "この記事が扱う出来事を表す10文字以内の短い語句(例:日立OKI ATM合弁)。表現の違う記事でも同じ出来事なら同じtopicKeyにしてください"}`;

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
    const parsed = JSON.parse(text);
    if (
      typeof parsed.caption !== "string" ||
      typeof parsed.category !== "string" ||
      typeof parsed.importance !== "number"
    ) {
      return null;
    }
    if (typeof parsed.topicKey !== "string" || !parsed.topicKey.trim()) {
      parsed.topicKey = parsed.caption; // topicKeyが無い場合はcaptionで代用(重複排除の精度は落ちるが継続する)
    }
    return parsed;
  } catch {
    return null;
  }
}
