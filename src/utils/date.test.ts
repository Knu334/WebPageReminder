import { it, expect } from "vitest";
import { daysInMonth, parseYouTubeTime, setDateField } from "./date";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 34);
const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

it("R-PICK-02: daysInMonth は閏年を考える", () => {
  expect([daysInMonth(2027, 1), daysInMonth(2028, 1), daysInMonth(2027, 3), daysInMonth(2027, 11)]).toEqual([28, 29, 30, 31]);
});

it("R-PICK-01: 月を変えて日が溢れたら月末にする", () => {
  expect(ymd(setDateField(at(2027, 1, 31), "month", 2))).toEqual([2027, 2, 28, 12, 34]);
  expect(ymd(setDateField(at(2027, 3, 31), "month", 4))).toEqual([2027, 4, 30, 12, 34]);
  expect(ymd(setDateField(at(2027, 1, 15), "month", 2))).toEqual([2027, 2, 15, 12, 34]);
});

it("R-PICK-01: 年を変えて 2/29 が無ければ 2/28 にする", () => {
  expect(ymd(setDateField(at(2028, 2, 29), "year", 2029))).toEqual([2029, 2, 28, 12, 34]);
});

it("R-PICK-01 R-PICK-02: その月に無い日は月末にする", () => {
  expect(ymd(setDateField(at(2027, 2, 1), "day", 31))).toEqual([2027, 2, 28, 12, 34]);
  expect(ymd(setDateField(at(2027, 2, 1), "day", 10))).toEqual([2027, 2, 10, 12, 34]);
});

it("R-PICK-01: 時・分を変え、元の Date は書き換えない", () => {
  const v = at(2027, 1, 31);
  expect(ymd(setDateField(setDateField(v, "hour", 5), "minute", 7))).toEqual([2027, 1, 31, 5, 7]);
  expect(ymd(v)).toEqual([2027, 1, 31, 12, 34]);
});

it("R-PICK-03: YouTube の時刻は今日の日付から繰り上げずに読む", () => {
  expect(ymd(parseYouTubeTime("2月15日 20:00", at(2027, 1, 31))!)).toEqual([2027, 2, 15, 20, 0]);
  const t = parseYouTubeTime("12月1日 9:05", at(2027, 3, 30))!;
  expect([...ymd(t), t.getSeconds(), t.getMilliseconds()]).toEqual([2027, 12, 1, 9, 5, 0, 0]);
});

it("R-PICK-03: 形式が違う、または存在しない日時は null", () => {
  for (const s of ["2月30日 10:00", "13月1日 10:00", "2月1日 24:00", "2月1日 10:60", "2月1日10:00", "Feb 1"]) {
    expect(parseYouTubeTime(s, at(2027, 1, 1))).toBeNull();
  }
});
