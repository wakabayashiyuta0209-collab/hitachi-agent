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

  const brandName = fromName || "きょうの日立";
  const highlight = [...newTiles]
    .filter((t) => t.type === "news")
    .sort((a, b) => b.importance - a.importance)[0];

  const subject = `「${brandName}」が更新されました`;
  // ハイライトの見出しは元記事へ直接遷移させ、下の「見る→」ボタンでサイト全体を見られるようにする
  const headlineHref = highlight?.sourceUrl || siteUrl || "";
  const html = buildHtml({ brandName, highlight, headlineHref, siteUrl });
  const text = buildText({ brandName, highlight, headlineHref, siteUrl });

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${brandName} <onboarding@resend.dev>`,
      to: [toEmail],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend送信失敗: ${res.status} ${text}`);
  }
}

export function buildHtml({ brandName, highlight, headlineHref, siteUrl }) {
  const badge = highlight
    ? `<span style="display:inline-block;background:#f3ecff;color:#7a5ea8;font-size:12px;font-weight:700;padding:5px 14px;border-radius:999px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;">${escapeHtml(highlight.badgeEmoji)} ${escapeHtml(highlight.category)}</span>`
    : "";

  const headlineText = highlight ? highlight.caption : "本日は株価情報を更新しました";
  const headline = headlineHref
    ? `<a href="${escapeHtml(headlineHref)}" style="color:#2d2838;text-decoration:none;">${escapeHtml(headlineText)}</a>`
    : escapeHtml(headlineText);

  const sourceLine = highlight?.sourceName
    ? `<p style="margin:10px 0 0;font-size:12.5px;color:#9a93ab;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;">出典: ${escapeHtml(highlight.sourceName)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:0;background:#f3ecff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ecff;padding:36px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 28px rgba(150,130,200,.25);">
<tr><td style="padding:26px 28px 0;">
<div style="font-size:13px;font-weight:800;color:#9b7fd1;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;letter-spacing:.02em;">${escapeHtml(brandName)}</div>
</td></tr>
<tr><td style="padding:14px 28px 4px;">
${badge}
</td></tr>
<tr><td style="padding:12px 28px 0;">
<div style="font-size:21px;line-height:1.5;font-weight:800;color:#2d2838;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;">${headline}</div>
${sourceLine}
</td></tr>
<tr><td style="padding:26px 28px 30px;">
<a href="${escapeHtml(siteUrl || "")}" style="display:inline-block;background:linear-gradient(135deg,#ff9ecb,#ffb199);color:#ffffff;font-weight:800;font-size:15px;padding:13px 30px;border-radius:999px;text-decoration:none;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;">きょうの日立を見る →</a>
</td></tr>
</table>
<div style="margin-top:18px;font-size:11.5px;color:#9a93ab;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;">${escapeHtml(brandName)} — 日立製作所のニュース・株価ダイジェスト</div>
</td></tr>
</table>
</body></html>`;
}

function buildText({ brandName, highlight, headlineHref, siteUrl }) {
  const headlineText = highlight ? highlight.caption : "本日は株価情報を更新しました";
  const lines = [brandName, "", headlineText];
  if (headlineHref) lines.push(headlineHref);
  lines.push("", `サイトを見る: ${siteUrl || ""}`);
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
