import { it, expect, beforeEach, vi } from "vitest";
import type { ChromeMock } from "@/test/chrome";
import type { ReminderDto } from "@/types/types";

const h = vi.hoisted(() => ({ hide: vi.fn() }));
vi.mock("@/background/sync", () => ({ hideOnServer: h.hide }));

let n: typeof import("@/background/notify");
let g: typeof import("@/background/gen");
const cfg = { apiBaseUrl: "https://a.example.com", authBaseUrl: "https://b.example.com", clientId: "x", imageHost: "https://c.example.com" };
const KEY = Object.values(cfg).join("|");
const ch = () => globalThis.chrome as unknown as ChromeMock;
const store = () => ch().storage.local._data;
const SOON = () => new Date(Date.now() + 30_000).toISOString();
const dto = (id: string, o: Partial<ReminderDto> = {}): ReminderDto => ({
  id, url: "https://e.example.com/", title: "t", reminderTime: SOON(), autoOpen: true, webPush: true,
  hidden: false, revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", thumbnail: null, ...o,
});
const serverCache = (items: ReminderDto[]) => ({ items, images: {}, syncedAt: 0, configKey: KEY });

beforeEach(async () => {
  vi.resetModules();
  h.hide.mockReset().mockResolvedValue({ ok: true });
  store().settings = { connectionType: "server", ...cfg };
  g = await import("@/background/gen");
  n = await import("@/background/notify");
});

it.each([
  ["通知済み", "a", () => (store()["notified:a"] = 1)],
  ["hidden", "h", () => {}],
  ["1分より先", "f", () => {}],
  ["cache に無い", "missing", () => {}],
])("R-ALARM-02: 通知済み・hidden・1分より先・cache に無い項目は通知しない: %s", async (_, id, setup) => {
  store().serverCache = serverCache([
    dto("a"),
    dto("h", { hidden: true }),
    dto("f", { reminderTime: new Date(Date.now() + 120_000).toISOString() }),
  ]);
  setup();
  await n.handleAlarm(id);
  expect(ch().notifications.create).not.toHaveBeenCalled();
  expect(ch().tabs.create).not.toHaveBeenCalled();
  expect(h.hide).not.toHaveBeenCalled();
});

it("R-ALARM-03: 通知の前に notified:<id> を書く", async () => {
  store().serverCache = serverCache([dto("a")]);
  let atCreate: unknown;
  ch().notifications.create.mockImplementation(async () => (atCreate = store()["notified:a"]));
  await n.handleAlarm("a");
  expect(atCreate).toEqual(expect.any(Number));
  expect(ch().notifications.create).toHaveBeenCalledWith("a", expect.objectContaining({ title: "t", message: "https://e.example.com/" }));
  expect(ch().tabs.create).toHaveBeenCalledWith({ url: "https://e.example.com/", active: true });
});

it("R-ALARM-03 R-LOG-01: 通知の後に hideOnServer を呼び、失敗しても例外を投げない", async () => {
  store().serverCache = serverCache([dto("a"), dto("b")]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.hide.mockResolvedValueOnce({ ok: false, code: "NETWORK" });
  await expect(n.handleAlarm("a")).resolves.toBeUndefined();
  expect(h.hide).toHaveBeenCalledWith(g.currentGen(), "a");
  expect(ch().notifications.create.mock.invocationCallOrder[0]).toBeLessThan(h.hide.mock.invocationCallOrder[0]);
  h.hide.mockRejectedValueOnce(new Error("boom"));
  await expect(n.handleAlarm("b")).resolves.toBeUndefined();
  expect(console.error).toHaveBeenCalledWith("hide failed", "NETWORK", undefined);
});

it("R-STO-06: local モードは今の動作（hidden を true にして保存）", async () => {
  store().settings = { connectionType: "local" };
  store().reminders = [
    { id: "l1", url: "https://l.example.com/", title: "L", thumbnail: "data:x", reminderTime: SOON(), autoOpen: false, webPush: true, createdAt: "", hidden: false },
  ];
  await n.handleAlarm("l1");
  expect(ch().notifications.create).toHaveBeenCalledWith("l1", {
    type: "basic", iconUrl: "/icons/icon48.png", title: "L", message: "https://l.example.com/", requireInteraction: true,
  });
  expect(ch().tabs.create).not.toHaveBeenCalled();
  expect(store().reminders).toEqual([expect.objectContaining({ id: "l1", hidden: true, thumbnail: "" })]);
  expect(h.hide).not.toHaveBeenCalled();
  // 5秒以内の同じ alarm は処理しない
  vi.spyOn(console, "log").mockImplementation(() => {});
  await n.handleAlarm("l1");
  expect(ch().notifications.create).toHaveBeenCalledTimes(1);
});

it("R-ALARM-01: 通知の click で cache の URL を開いて通知を消す", async () => {
  store().serverCache = serverCache([dto("a")]);
  await n.handleNotificationClick("a");
  expect(ch().tabs.create).toHaveBeenCalledWith({ url: "https://e.example.com/" });
  expect(ch().notifications.clear).toHaveBeenCalledWith("a");
});
