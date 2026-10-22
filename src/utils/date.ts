export type DateField = "year" | "month" | "day" | "hour" | "minute";

export const daysInMonth = (year: number, month0: number): number => new Date(year, month0 + 1, 0).getDate();

// 年・月を変えて日が溢れたら月末にする（1/31 で2月を選ぶと 2/28）
export const setDateField = (value: Date, field: DateField, val: number): Date => {
  const d = new Date(value);
  switch (field) {
    case "year":
    case "month": {
      const y = field === "year" ? val : d.getFullYear();
      const m = field === "month" ? val - 1 : d.getMonth();
      d.setFullYear(y, m, Math.min(d.getDate(), daysInMonth(y, m)));
      break;
    }
    case "day":
      d.setDate(Math.min(val, daysInMonth(d.getFullYear(), d.getMonth())));
      break;
    case "hour":
      d.setHours(val);
      break;
    case "minute":
      d.setMinutes(val);
      break;
  }
  return d;
};

// YouTube の配信予定の「M月D日 H:MM」を今年の日時として読む。月・日を一度に設定し、今日の日付から繰り上げない
export const parseYouTubeTime = (text: string, now: Date): Date | null => {
  const g = /^(\d+)月(\d+)日 (\d+):(\d+)$/.exec(text);
  if (!g) return null;
  const [mo, d, h, mi] = g.slice(1).map((p) => parseInt(p, 10));
  const t = new Date(now.getFullYear(), mo - 1, d, h, mi);
  // ページの文字列なので、存在しない日時（13月、2月30日など）は捨てる
  return t.getMonth() === mo - 1 && t.getDate() === d && t.getHours() === h && t.getMinutes() === mi ? t : null;
};
