import { describe, it, expect, vi } from "vitest";
import { errorText, makeCall, send } from "@/utils/bg";

const NET = "通信できません。時間をおいて再度お試しください";

describe("errorText", () => {
  it("R-ERR-01 R-ERR-02 R-ERR-03 R-ERR-04 R-ERR-06 R-ERR-07 R-ERR-08 R-ERR-09: maps the spec table", () => {
    expect(errorText("NOT_CONFIGURED")).toBe("接続先を設定してください");
    expect(errorText("LOGIN_REQUIRED")).toBe("ログインしてください");
    expect(errorText("UNAUTHORIZED")).toBe("ログインしてください");
    expect(errorText("LOGIN_IN_PROGRESS")).toBe("ログインの処理中です");
    expect(errorText("CONFLICT")).toBe("別の端末で変更されています。最新の内容を確認して、もう一度操作してください");
    for (const c of ["NETWORK", "SERVICE_UNAVAILABLE", "UNKNOWN_RESULT"]) expect(errorText(c)).toBe(NET);
    expect(errorText("OWNER_RATE_LIMIT_EXCEEDED")).toBe("操作が多すぎます。しばらく待ってください");
    expect(errorText("HTTP_429", 429)).toBe("操作が多すぎます。しばらく待ってください");
    expect(errorText("OWNER_STORAGE_LIMIT_EXCEEDED")).toBe("保存できる上限（1000件・画像 128 MiB）を超えています");
    expect(errorText("FORBIDDEN", 403)).toBe("権限がありません（FORBIDDEN）");
    expect(errorText("HTTP_403", 403)).toBe("権限がありません（HTTP_403）");
  });
  it("R-ERR-05 R-ERR-10: hides STALE and formats unknown", () => {
    expect(errorText("STALE")).toBeNull();
    expect(errorText("X")).toBe("エラー（X）");
  });
  it("R-ERR-11: hides login failures shown as the notice", () => {
    expect(errorText("LOGIN_CANCELLED")).toBeNull();
    expect(errorText("LOGIN_FAILED")).toBeNull();
  });
});

describe("R-MSG-12: send", () => {
  it("returns the response", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true } as never);
    expect(await send({ type: "alarms/reset" })).toEqual({ ok: true });
  });
  it("maps a rejected sendMessage to NETWORK", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error("Could not establish connection"));
    expect(await send({ type: "reminders/list" })).toEqual({ ok: false, code: "NETWORK" });
  });
});

describe("R-MSG-12 R-CRUD-07: makeCall", () => {
  const setup = () => {
    const setError = vi.fn();
    const markDisconnected = vi.fn();
    return { setError, markDisconnected, call: makeCall(setError, markDisconnected) };
  };
  it("NETWORK marks disconnected and sets the error", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error("gone"));
    const { setError, markDisconnected, call } = setup();
    expect(await call({ type: "auth/status" })).toEqual({ ok: false, code: "NETWORK" });
    expect(markDisconnected).toHaveBeenCalledOnce();
    expect(setError).toHaveBeenCalledWith(NET);
  });
  it("ok sets no error", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true } as never);
    const { setError, markDisconnected, call } = setup();
    expect(await call({ type: "alarms/reset" })).toEqual({ ok: true });
    expect(setError).not.toHaveBeenCalled();
    expect(markDisconnected).not.toHaveBeenCalled();
  });
  it("STALE sets no error text", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false, code: "STALE" } as never);
    const { setError, markDisconnected, call } = setup();
    await call({ type: "auth/login" });
    expect(setError).toHaveBeenCalledWith(null);
    expect(markDisconnected).not.toHaveBeenCalled();
  });
});
