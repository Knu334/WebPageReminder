import { it, expect, beforeEach, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "@/test/chrome";
import type { ReminderDto, ServerCache } from "@/types/types";

let c: typeof import("@/background/cache");
let a: typeof import("@/background/alarms");
let g: typeof import("@/background/gen");
let NO: typeof import("@/utils/nodataUtils");
const cfg = { apiBaseUrl: "https://a.example.com", authBaseUrl: "https://b.example.com", clientId: "x", imageHost: "https://c.example.com" };
const KEY = "https://a.example.com|https://b.example.com|x|https://c.example.com";
const ch = () => globalThis.chrome as unknown as ChromeMock;
const store = () => ch().storage.local._data;
const dto = (id: string, o: Partial<ReminderDto> = {}): ReminderDto => ({
  id, url: "u", title: "t", reminderTime: "2099-01-01 00:00:00", autoOpen: false, webPush: false,
  hidden: false, revision: 1, createdAt: "c", updatedAt: "u", thumbnail: null, ...o,
});
const cache = (items: ReminderDto[] = [], images: ServerCache["images"] = {}): ServerCache => ({ items, images, syncedAt: 1, configKey: KEY });

beforeEach(async () => {
  vi.resetModules();
  (globalThis as unknown as { chrome: ChromeMock }).chrome = installChromeMock();
  store().settings = { connectionType: "server", ...cfg };
  g = await import("@/background/gen");
  c = await import("@/background/cache");
  a = await import("@/background/alarms");
  NO = await import("@/utils/nodataUtils");
});

it("toReminders: thumbnail は imageId と sha256 が一致する時だけ、notified は hidden", () => {
  const th = { imageId: "i", mime: "image/png", bytes: 1, sha256: "s" };
  const r = c.toReminders(
    cache([dto("a", { thumbnail: th }), dto("b", { thumbnail: { ...th, sha256: "z" } }), dto("n")], {
      a: { imageId: "i", sha256: "s", dataUrl: "data:A" },
      b: { imageId: "i", sha256: "s", dataUrl: "data:B" },
    }),
    new Set(["n"]),
  );
  expect(r.map((x) => x.thumbnail)).toEqual(["data:A", NO.NO_DATA.thumbnail, NO.NO_DATA.thumbnail]);
  expect(r.map((x) => x.hidden)).toEqual([false, false, true]);
});

it("notified の同時の記録がどちらも残る", async () => {
  await Promise.all([c.markNotified("a"), c.markNotified("b")]);
  expect(await c.getNotifiedIds()).toEqual(new Set(["a", "b"]));
  await c.removeNotified(["a"]);
  expect(await c.getNotifiedIds()).toEqual(new Set(["b"]));
});

it("readCache: configKey が違う cache は空になり消える", async () => {
  store().serverCache = { ...cache([dto("a")]), configKey: "old" };
  const r = await c.readCache();
  expect(r.items).toEqual([]);
  expect(r.configKey).toBe(KEY);
  expect("serverCache" in store()).toBe(false);
});

it("writeCache と clearServerCache は古い世代では何もしない", async () => {
  const old = g.currentGen();
  g.bumpGen();
  expect(await c.writeCache(old, cache([dto("a")]))).toBe(false);
  expect("serverCache" in store()).toBe(false);
  store().serverCache = cache([dto("a")]);
  expect(await c.clearServerCache(old)).toBe(false);
  expect("serverCache" in store()).toBe(true);
  const cur = g.currentGen();
  expect(await c.writeCache(cur, cache())).toBe(true);
  expect(await c.clearServerCache(cur)).toBe(true);
  expect("serverCache" in store()).toBe(false);
});

it("upsertItem は同じ id を1件にし、removeItem は画像も消す", () => {
  const img = { imageId: "i", sha256: "s", dataUrl: "d" };
  let x = c.upsertItem(cache(), dto("a"), img);
  x = c.upsertItem(x, dto("a", { title: "new" }));
  expect(x.items).toHaveLength(1);
  expect(x.items[0].title).toBe("new");
  expect(x.images.a).toEqual(img);
  x = c.removeItem(x, "a");
  expect(x.items).toEqual([]);
  expect(x.images).toEqual({});
});

it("rebuildAlarms: server は未来・非表示でない・未通知の1件だけ", async () => {
  store().serverCache = cache([
    dto("future"),
    dto("past", { reminderTime: "2000-01-01 00:00:00" }),
    dto("hid", { hidden: true }),
    dto("notified"),
  ]);
  await c.markNotified("notified");
  await a.rebuildAlarms(g.currentGen());
  expect(ch().alarms.create).toHaveBeenCalledTimes(1);
  expect(ch().alarms.create.mock.calls[0][0]).toBe("future");
});

it("rebuildAlarms: local は reminders から作る", async () => {
  store().settings = { connectionType: "local" };
  store().reminders = [
    { id: "l", reminderTime: "2099-01-01 00:00:00", hidden: false },
    { id: "h", reminderTime: "2099-01-01 00:00:00", hidden: true },
  ];
  await a.rebuildAlarms(g.currentGen());
  expect(ch().alarms.create.mock.calls.map((x: unknown[]) => x[0])).toEqual(["l"]);
});

it("rebuildAlarms と clearServerAlarms: 古い世代は clearAll しない", async () => {
  const old = g.currentGen();
  g.bumpGen();
  await a.rebuildAlarms(old);
  await a.clearServerAlarms(old);
  expect(ch().alarms.clearAll).not.toHaveBeenCalled();
  await a.clearServerAlarms(g.currentGen());
  expect(ch().alarms.clearAll).toHaveBeenCalledTimes(1);
});
