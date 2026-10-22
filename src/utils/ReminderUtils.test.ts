import { expect, it, vi } from "vitest";
import { NO_DATA } from "./nodataUtils";
import { oneMonthBefore, removeOldReminders } from "./ReminderUtils";

const d = (s: string) => new Date(s);

it("R-SCOPE-07: oneMonthBefore: 存在しない日は前月の末日", () => {
  expect(oneMonthBefore(d("2026-03-31T09:30:00+09:00"))).toEqual(d("2026-02-28T09:30:00+09:00"));
  expect(oneMonthBefore(d("2028-03-31T09:30:00+09:00"))).toEqual(d("2028-02-29T09:30:00+09:00"));
  expect(oneMonthBefore(d("2027-01-31T09:30:00+09:00"))).toEqual(d("2026-12-31T09:30:00+09:00"));
  expect(oneMonthBefore(d("2026-05-15T09:30:00+09:00"))).toEqual(d("2026-04-15T09:30:00+09:00"));
});

it("R-SCOPE-07: removeOldReminders: ちょうど1か月前は残し、それより前は消す", () => {
  vi.useFakeTimers();
  vi.setSystemTime(d("2026-05-15T09:30:00+09:00"));
  const r = (id: string, t: string) => ({ ...NO_DATA, id, reminderTime: t });
  const out = removeOldReminders([r("eq", "2026-04-15T09:30:00+09:00"), r("old", "2026-04-15T09:29:59+09:00")]);
  expect(out.map((x) => x.id)).toEqual(["eq"]);
});
