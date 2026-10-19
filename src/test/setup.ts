import { afterEach, beforeEach, vi } from "vitest";
import { installChromeMock } from "./chrome";

process.env.TZ = "Asia/Tokyo";

beforeEach(() => {
  globalThis.chrome = installChromeMock() as unknown as typeof chrome;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
