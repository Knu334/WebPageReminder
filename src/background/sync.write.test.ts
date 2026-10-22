import { it, expect, beforeEach, vi } from "vitest";
import type { ChromeMock } from "@/test/chrome";
import type { Reminder, ReminderDto, ServerCache } from "@/types/types";

// route ごとに応答を並べる fake の api
const h = vi.hoisted(() => ({
  routes: {} as Record<string, unknown[]>,
  calls: [] as { route: string; args: unknown[] }[],
}));
vi.mock("@/background/api", () => {
  const call = (route: string) => async (...args: unknown[]) => {
    h.calls.push({ route, args });
    const q = h.routes[route];
    if (!q?.length) throw new Error("no scripted response for " + route);
    return q.shift();
  };
  return {
    createApi: () => ({
      getReminder: call("GET"),
      createReminder: call("POST"),
      patchReminder: call("PATCH"),
      deleteReminder: call("DELETE"),
      listPage: call("LIST"),
      getThumbnailUrl: call("THUMB"),
    }),
  };
});
vi.mock("@/background/auth", () => ({ getAccessToken: vi.fn() }));

let s: typeof import("@/background/sync");
let c: typeof import("@/background/cache");
let g: typeof import("@/background/gen");
let NO: typeof import("@/utils/nodataUtils");
const cfg = { apiBaseUrl: "https://a.example.com", authBaseUrl: "https://b.example.com", clientId: "x", imageHost: "https://c.example.com" };
const KEY = "https://a.example.com|https://b.example.com|x|https://c.example.com";
const ch = () => globalThis.chrome as unknown as ChromeMock;
const store = () => ch().storage.local._data;
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = new Date(Date.now() - 60_000).toISOString();
const OLD = "2000-01-01T00:00:00.000Z";
const dto = (id: string, o: Partial<ReminderDto> = {}): ReminderDto => ({
  id, url: "https://e.example.com/", title: "t", reminderTime: FUTURE, autoOpen: false, webPush: true,
  hidden: false, revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", thumbnail: null, ...o,
});
const cache = (items: ReminderDto[] = []): ServerCache => ({ items, images: {}, syncedAt: 1, configKey: KEY });
const ok = (data: unknown, etag: string | null = '"e"', status = 200) => ({ ok: true, status, data, etag });
const fail = (status: number, code = `HTTP_${status}`) => ({ ok: false, status, code });
const UNKNOWN = { ok: false, code: "UNKNOWN_RESULT" };
const script = (r: Record<string, unknown[]>) => Object.assign(h.routes, r);
const count = (route: string) => h.calls.filter((x) => x.route === route).length;
const stored = () => store().serverCache as ServerCache;
const thumb = { imageId: "img1", mime: "image/png", bytes: 3, sha256: "abc" };
const rem = (o: Partial<Reminder> = {}): Reminder => ({
  id: "r1", url: "https://e.example.com/", title: "t", thumbnail: "data:image/png;base64,AAA", reminderTime: FUTURE,
  autoOpen: false, webPush: true, createdAt: "x", hidden: true, ...o,
});

beforeEach(async () => {
  vi.resetModules();
  h.routes = {};
  h.calls = [];
  store().settings = { connectionType: "server", ...cfg };
  g = await import("@/background/gen");
  c = await import("@/background/cache");
  s = await import("@/background/sync");
  NO = await import("@/utils/nodataUtils");
});

// 作成

it("R-WRITE-01 R-CRUD-05 R-CRUD-01 R-CRUD-02 R-MSG-13 R-STO-07: 201 で成功し cache に入る", async () => {
  store().serverCache = cache([dto("r1", { title: "old" })]);
  script({ POST: [ok(dto("r1", { thumbnail: thumb }), '"e"', 201)] });
  const r = await s.createOnServer(g.currentGen(), rem());
  expect(h.calls[0].args[0]).toEqual({
    id: "r1", url: "https://e.example.com/", title: "t", reminderTime: FUTURE, autoOpen: false, webPush: true,
    hidden: false, thumbnail: "data:image/png;base64,AAA",
  });
  expect(r).toEqual({ ok: true, reminder: expect.objectContaining({ id: "r1", thumbnail: "data:image/png;base64,AAA", hidden: false }) });
  // 同期で入った同じ id と重複しない
  expect(stored().items).toEqual([dto("r1", { thumbnail: thumb })]);
  expect(stored().images.r1).toEqual({ imageId: "img1", sha256: "abc", dataUrl: "data:image/png;base64,AAA" });
  expect(ch().alarms.create).toHaveBeenCalledWith("r1", { when: Date.parse(FUTURE) });
});

it("R-CRUD-03: NO_DATA の thumbnail は null で送り、画像は cache に入れない", async () => {
  script({ POST: [ok(dto("r1"), '"e"', 201)] });
  const r = await s.createOnServer(g.currentGen(), rem({ thumbnail: NO.NO_DATA.thumbnail }));
  expect((h.calls[0].args[0] as { thumbnail: unknown }).thumbnail).toBeNull();
  expect(r.ok && r.reminder.thumbnail).toBe(NO.NO_DATA.thumbnail);
  expect(stored().images).toEqual({});
});

it("R-WRITE-02: UNKNOWN_RESULT → GET 200 で成功", async () => {
  script({ POST: [UNKNOWN], GET: [ok(dto("r1"))] });
  expect((await s.createOnServer(g.currentGen(), rem())).ok).toBe(true);
  expect(count("POST")).toBe(1);
  expect(stored().items.map((i) => i.id)).toEqual(["r1"]);
});

it("R-WRITE-02: UNKNOWN_RESULT → GET 404 → POST 1回だけ再送", async () => {
  script({ POST: [UNKNOWN, UNKNOWN], GET: [fail(404, "REMINDER_NOT_FOUND")] });
  expect(await s.createOnServer(g.currentGen(), rem())).toMatchObject({ ok: false, code: "UNKNOWN_RESULT" });
  expect(count("POST")).toBe(2);
  expect(count("GET")).toBe(1);
});

it("R-WRITE-03: 409 → GET 404 で ALREADY_EXISTS", async () => {
  script({ POST: [fail(409, "ALREADY_EXISTS")], GET: [fail(404, "REMINDER_NOT_FOUND")] });
  expect(await s.createOnServer(g.currentGen(), rem())).toMatchObject({ ok: false, code: "ALREADY_EXISTS" });
  expect(count("POST")).toBe(1);
  expect(store().serverCache).toBeUndefined();
});

it("R-WRITE-03: 409 → GET 200 で成功", async () => {
  script({ POST: [fail(409, "ALREADY_EXISTS")], GET: [ok(dto("r1"))] });
  expect((await s.createOnServer(g.currentGen(), rem())).ok).toBe(true);
  expect(stored().items.map((i) => i.id)).toEqual(["r1"]);
});

// 非表示

it("R-WRITE-05: 最新が未来の時刻なら PATCH しない", async () => {
  script({ GET: [ok(dto("r1"))] });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  expect(count("PATCH")).toBe(0);
});

it("R-WRITE-05: すでに hidden かつ thumbnail null なら PATCH しない", async () => {
  script({ GET: [ok(dto("r1", { reminderTime: PAST, hidden: true }))] });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  expect(count("PATCH")).toBe(0);
});

it("R-WRITE-04 R-WRITE-06 R-WRITE-12: 412 で GET からやり直す（1回）", async () => {
  store().serverCache = cache([dto("r1", { reminderTime: PAST })]);
  const done = dto("r1", { reminderTime: PAST, hidden: true, revision: 3 });
  script({
    GET: [ok(dto("r1", { reminderTime: PAST, thumbnail: thumb }), '"e1"'), ok(dto("r1", { reminderTime: PAST, revision: 2 }), '"e2"')],
    PATCH: [fail(412, "PRECONDITION_FAILED"), ok(done)],
  });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  expect(h.calls.filter((x) => x.route === "PATCH").map((x) => x.args)).toEqual([
    ["r1", { hidden: true, thumbnail: null }, '"e1"'],
    ["r1", { hidden: true, thumbnail: null }, '"e2"'],
  ]);
  expect(stored().items).toEqual([done]);
});

it("R-WRITE-06: 412 が2回なら失敗を返す", async () => {
  const d = ok(dto("r1", { reminderTime: PAST }));
  script({ GET: [d, d], PATCH: [fail(412, "PRECONDITION_FAILED"), fail(412, "PRECONDITION_FAILED")] });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toMatchObject({ ok: false, code: "PRECONDITION_FAILED" });
  expect(count("PATCH")).toBe(2);
});

it("R-WRITE-06: 404 で cache から外す", async () => {
  store().serverCache = cache([dto("r1", { reminderTime: PAST }), dto("r2")]);
  script({ GET: [ok(dto("r1", { reminderTime: PAST }))], PATCH: [fail(404, "REMINDER_NOT_FOUND")] });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  expect(stored().items.map((i) => i.id)).toEqual(["r2"]);
});

it("R-WRITE-07: UNKNOWN_RESULT → GET で両方の条件を満たせば成功", async () => {
  script({
    GET: [ok(dto("r1", { reminderTime: PAST, thumbnail: thumb })), ok(dto("r1", { reminderTime: PAST, hidden: true }))],
    PATCH: [UNKNOWN],
  });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  expect(stored().items[0].hidden).toBe(true);
});

it("R-WRITE-07: UNKNOWN_RESULT → GET で条件を満たさなければ UNKNOWN_RESULT", async () => {
  const d = ok(dto("r1", { reminderTime: PAST, hidden: true, thumbnail: thumb }));
  script({ GET: [d, d], PATCH: [UNKNOWN] });
  expect(await s.hideOnServer(g.currentGen(), "r1")).toMatchObject({ ok: false, code: "UNKNOWN_RESULT" });
});

// 削除

it("R-WRITE-09: user の 412 は cache を最新にして CONFLICT、DELETE は1回", async () => {
  store().serverCache = cache([dto("r1")]);
  const latest = dto("r1", { title: "new", revision: 2 });
  script({ GET: [ok(dto("r1")), ok(latest)], DELETE: [fail(412, "PRECONDITION_FAILED")] });
  expect(await s.deleteOnServer(g.currentGen(), "r1")).toMatchObject({ ok: false, code: "CONFLICT" });
  expect(count("DELETE")).toBe(1);
  expect(stored().items).toEqual([latest]);
});

it("R-WRITE-08 R-WRITE-11 R-CRUD-06: user の削除の成功で cache から外し alarm を消す", async () => {
  store().serverCache = cache([dto("r1"), dto("r2")]);
  await ch().alarms.create("r1", { when: Date.parse(FUTURE) });
  script({ GET: [ok(dto("r1"))], DELETE: [ok({ id: "r1", deleted: true, revision: 2 }, null)] });
  expect(await s.deleteOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  expect(h.calls[1].args).toEqual(["r1", '"e"']);
  expect(stored().items.map((i) => i.id)).toEqual(["r2"]);
  expect((await ch().alarms.getAll()).map((a) => a.name)).toEqual(["r2"]);
});

it("R-WRITE-10: cleanup の 412 は GET からやり直す", async () => {
  const d = ok(dto("r1", { reminderTime: OLD }));
  script({ GET: [d, d], DELETE: [fail(412, "PRECONDITION_FAILED"), ok({ id: "r1", deleted: true, revision: 3 }, null)] });
  const r = await s.deleteInQueue(g.currentGen(), await s.apiFor(g.currentGen()), cache([dto("r1", { reminderTime: OLD })]), "r1");
  expect(r.result).toEqual({ ok: true });
  expect(r.cache.items).toEqual([]);
  expect(count("DELETE")).toBe(2);
  expect(store().serverCache).toBeUndefined(); // InQueue は書かない
});

it("R-WRITE-08: cleanup で最新が1か月以内なら DELETE しない", async () => {
  script({ GET: [ok(dto("r1", { reminderTime: PAST }))] });
  const r = await s.deleteInQueue(g.currentGen(), await s.apiFor(g.currentGen()), cache([dto("r1", { reminderTime: OLD })]), "r1");
  expect(r.result).toEqual({ ok: true });
  expect(count("DELETE")).toBe(0);
  expect(r.cache.items[0].reminderTime).toBe(PAST);
});

it("R-WRITE-08: 404 と UNKNOWN_RESULT → GET 404 は成功", async () => {
  store().serverCache = cache([dto("r1"), dto("r2")]);
  script({ GET: [ok(dto("r1")), fail(404, "REMINDER_NOT_FOUND")], DELETE: [UNKNOWN] });
  expect(await s.deleteOnServer(g.currentGen(), "r1")).toEqual({ ok: true });
  script({ GET: [ok(dto("r2"))], DELETE: [fail(404, "REMINDER_NOT_FOUND")] });
  expect(await s.deleteOnServer(g.currentGen(), "r2")).toEqual({ ok: true });
  expect(stored().items).toEqual([]);
});

// 再入

it("R-GEN-04: queue の中から hideInQueue・deleteInQueue を呼んでも完了する", async () => {
  const gen = g.currentGen();
  const api = await s.apiFor(gen);
  script({ GET: [ok(dto("r1")), ok(dto("r2", { reminderTime: OLD }))], DELETE: [ok({ id: "r2", deleted: true, revision: 2 }, null)] });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1000));
  const run = c.queue(async () => {
    const a = await s.hideInQueue(gen, api, cache([dto("r1"), dto("r2", { reminderTime: OLD })]), "r1");
    return s.deleteInQueue(gen, api, a.cache, "r2");
  });
  const r = await Promise.race([run, timeout]);
  expect(r).toMatchObject({ result: { ok: true }, cache: { items: [dto("r1")] } });
});

// 世代

it("R-GEN-02: 受け付けた後に bumpGen されたら API を送らず STALE", async () => {
  const gen = g.currentGen();
  g.bumpGen();
  expect(await s.createOnServer(gen, rem())).toEqual({ ok: false, code: "STALE" });
  expect(await s.hideOnServer(gen, "r1")).toEqual({ ok: false, code: "STALE" });
  expect(await s.deleteOnServer(gen, "r1")).toEqual({ ok: false, code: "STALE" });
  expect(h.calls).toEqual([]);
});

it("R-GEN-02: API の成功後に bumpGen されたら cache に書かず STALE", async () => {
  const gen = g.currentGen();
  script({ POST: [ok(dto("r1"), '"e"', 201)] }); // fake は世代を見ないので POST は成功する
  const p = s.createOnServer(gen, rem());
  g.bumpGen();
  expect(await p).toEqual({ ok: false, code: "STALE" });
  expect(store().serverCache).toBeUndefined();
});
