import { it, expect } from "vitest";
import { createSerial } from "@/background/serial";

it("R-GEN-03 R-GEN-04: runs serially and survives rejection", async () => {
  const serial = createSerial();
  const log: string[] = [];
  const a = serial(async () => {
    await new Promise((r) => setTimeout(r, 10));
    log.push("a");
    throw new Error("x");
  });
  const b = serial(async () => {
    log.push("b");
    return 1;
  });
  await expect(a).rejects.toThrow();
  expect(await b).toBe(1);
  expect(log).toEqual(["a", "b"]);
});
