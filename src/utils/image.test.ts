import { describe, it, expect, vi } from "vitest";
import { decodedSize, shrinkToLimit, type Reencoded } from "@/utils/image";

const MiB = 1_048_576;
// decode 後の大きさが bytes になる data URL（bytes は3の倍数）
const urlOf = (bytes: number) => "data:image/jpeg;base64," + "A".repeat((bytes / 3) * 4);

describe("decodedSize", () => {
  it("counts bytes", () => {
    expect(decodedSize("data:image/png;base64,QUJD")).toBe(3);
    expect(decodedSize("data:image/png;base64,QUI=")).toBe(2);
    expect(decodedSize("data:image/png;base64,QQ==")).toBe(1);
  });
});

describe("shrinkToLimit", () => {
  it("returns input as is when within the limit", async () => {
    const reencode = vi.fn();
    const u = urlOf(MiB - 1);
    expect(await shrinkToLimit(u, reencode)).toBe(u);
    expect(reencode).not.toHaveBeenCalled();
  });

  it("4 MiB 4000x3000 fits after 2 halvings", async () => {
    let w = 4000, h = 3000, bytes = 4 * MiB + 2; // 3の倍数
    const reencode = vi.fn(async (): Promise<Reencoded> => {
      w /= 2; h /= 2; bytes = Math.floor(bytes / 2 / 3) * 3;
      return { dataUrl: urlOf(bytes), width: w, height: h };
    });
    const out = await shrinkToLimit(urlOf(4 * MiB + 2), reencode);
    expect(reencode).toHaveBeenCalledTimes(2);
    expect(out).not.toBeNull();
    expect(decodedSize(out!)).toBeLessThanOrEqual(MiB);
  });

  it("null when the long side drops under 16px", async () => {
    let w = 4000, h = 3000;
    const big = urlOf(4 * MiB + 2);
    const reencode = vi.fn(async (): Promise<Reencoded> => {
      w /= 2; h /= 2;
      return { dataUrl: big, width: w, height: h };
    });
    expect(await shrinkToLimit(big, reencode)).toBeNull();
    // 4000 → 2000,1000,500,250,125,62.5,31.25,15.625 (8回目で16未満)
    expect(reencode).toHaveBeenCalledTimes(8);
    w = 100; h = 50;
    reencode.mockClear();
    expect(await shrinkToLimit(big, reencode)).toBeNull();
    // 50,25,12.5 → 3回目で16未満
    expect(reencode).toHaveBeenCalledTimes(3);
  });

  it("stops after 8 iterations when nothing changes", async () => {
    const big = urlOf(4 * MiB + 2);
    const reencode = vi.fn(async (): Promise<Reencoded> => ({ dataUrl: big, width: 4000, height: 3000 }));
    expect(await shrinkToLimit(big, reencode)).toBeNull();
    expect(reencode).toHaveBeenCalledTimes(8);
  });
});
