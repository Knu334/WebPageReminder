import { it, expect } from "vitest";
import { extractIds, parseSpec, plain, stripIdPrefix, unknownIds } from "../../scripts/trace-lib.mjs";

it("parseSpec reads tags, sections and descriptions, and reports duplicates", () => {
  const spec = [
    "## A",
    "- [R-X-01] **作成**: `POST` する",
    "### B",
    "| [R-X-02] `401` | 再送する |",
    "```",
    "## not a section [R-X-09]",
    "```",
    "1. [R-X-01] again",
  ].join("\n");
  const { reqs, duplicates } = parseSpec(spec);
  expect(reqs.map((r) => [r.id, r.section, r.desc])).toEqual([
    ["R-X-01", "A", "作成: POST する"],
    ["R-X-02", "B", "401 / 再送する"],
    ["R-X-01", "B", "again"],
  ]);
  expect(duplicates).toEqual(["R-X-01"]);
});

it("parseSpec reports lines with more than one tag", () => {
  const { reqs, multiTag } = parseSpec(["- [R-X-01] a [R-X-02] b", "- [R-X-03] c"].join("\n"));
  expect(multiTag).toEqual(["- [R-X-01] a [R-X-02] b"]);
  expect(reqs.map((r) => r.id)).toEqual(["R-X-01", "R-X-03"]);
});

it("plain truncates and escapes table-breaking characters", () => {
  expect(plain("a".repeat(130))).toHaveLength(120);
  expect(plain("x * y <code>")).toBe("x \\* y &lt;code&gt;");
});

it("extractIds finds every ID once; stripIdPrefix removes only the leading ones", () => {
  expect(extractIds("R-API-01 R-API-02: 401 (see R-API-01, R-GEN-03)")).toEqual(["R-API-01", "R-API-02", "R-GEN-03"]);
  expect(extractIds("no ids")).toEqual([]);
  expect(stripIdPrefix("R-API-01 R-API-02: 401 R-GEN-03")).toBe("401 R-GEN-03");
  expect(stripIdPrefix("[R-API-01] x")).toBe("x");
});

it("unknownIds lists IDs not in the spec", () => {
  const tests = [{ file: "a.test.ts", name: "t", ids: ["R-X-01", "R-Y-01"] }];
  expect(unknownIds(tests, ["R-X-01"])).toEqual(["R-Y-01 (a.test.ts › t)"]);
});
