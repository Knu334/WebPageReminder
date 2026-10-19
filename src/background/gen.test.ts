import { it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

let g: typeof import("@/background/gen");
beforeEach(async () => {
  vi.resetModules();
  g = await import("@/background/gen");
});

it("R-GEN-01 R-GEN-05: bumpGen aborts previous", () => {
  const a = g.bumpGen();
  const s = g.signalFor(a);
  expect(s.aborted).toBe(false);
  const b = g.bumpGen();
  expect(s.aborted).toBe(true);
  expect(g.isCurrent(a)).toBe(false);
  expect(g.isCurrent(b)).toBe(true);
  expect(g.currentGen()).toBe(b);
  expect(g.signalFor(a).aborted).toBe(true);
  expect(g.signalFor(b).aborted).toBe(false);
});
