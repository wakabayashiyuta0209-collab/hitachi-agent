const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * 当日バッチで追加された新規タイルのうち重要度最大の1件をハイライトとして、
 * 更新通知メールを送信する(Resend使用)。
 * 失敗した場合は例外を投げる(呼び出し側で「通知失敗」として扱えるようにする)。
 *
 * @param {Array} newTiles - 当日追加された新規タイル
 * @param {{apiKey:string, fromName:string, toEmail:string, siteUrl:string}} config
 */
export async function sendNotification(newTiles, config) {
  const { apiKey, fromName, toEmail, siteUrl } = config;

  if (!apiKey) {
    throw new Error("RESEND_API_KEYが設定されていません");
  }
  if (!toEmail) {
    throw new Error("通知先メールアドレスが設定されていません");
  }

  const highlight = [...newTiles]
    .filter((t) => t.type === "news")
    .sort((a, b) => b.importance - a.importance)[0];

  const highlightCaption = highlight ? highlight.caption : "株価情報を更新しました";
  const subject = "本日の日立デイジェストが更新されました";
  const html = `<p>${escapeHtml(highlightCaption)}</p><p><a href="${escapeHtml(siteUrl || "")}">見る →</a></p>`;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName || "日立デイジェスト"} <onboarding@resend.dev>`,
      to: [toEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend送信失敗: ${res.status} ${text}`);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
