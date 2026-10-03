// 東証の休業日判定(FR-20)。
// 祝日データは内閣府の祝日データを基にした静的API(holidays-jp)から取得する。
// 取得に失敗した場合は、更新を止めないことを優先し「祝日ではない」として扱う
// (週末・年末年始の判定は祝日データに依存せず行えるため、その分は確実に機能する)。

const HOLIDAYS_API = "https://holidays-jp.github.io/api/v1/date.json";

function toJstParts(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
    dow: jst.getUTCDay(), // 0=日, 6=土
  };
}

function toDateKey({ y, m, d }) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

let holidayCache = null;

async function fetchHolidayDates() {
  if (holidayCache) return holidayCache;
  try {
    const res = await fetch(HOLIDAYS_API);
    if (!res.ok) throw new Error(`祝日データ取得失敗: ${res.status}`);
    const json = await res.json();
    holidayCache = new Set(Object.keys(json));
  } catch (err) {
    console.error("[market-calendar] 祝日データ取得失敗(祝日ではないものとして続行):", err.message);
    holidayCache = new Set();
  }
  return holidayCache;
}

/**
 * 指定した日(Dateオブジェクト、UTC基準)が東証休業日(土日・祝日・年末年始)かどうかを返す。
 */
export async function isMarketHoliday(date = new Date()) {
  const parts = toJstParts(date);

  if (parts.dow === 0 || parts.dow === 6) return true;

  // 年末年始(12/31, 1/2, 1/3)。1/1は祝日データ側の「元日」でも判定される
  if (parts.m === 12 && parts.d === 31) return true;
  if (parts.m === 1 && (parts.d === 2 || parts.d === 3)) return true;

  const holidays = await fetchHolidayDates();
  return holidays.has(toDateKey(parts));
}
