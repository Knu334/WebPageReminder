import { it, expect, beforeEach, vi } from "vitest";
import type { ChromeMock } from "@/test/chrome";
import type { ReminderDto, ServerCache } from "@/types/types";

// route ごとの応答。配列は順に返し、関数は呼んだ結果を返す
type Route = unknown[] | ((...args: unknown[]) => unknown);
const h = vi.hoisted(() => ({
  routes: {} as Record<string, Route>,
  calls: [] as { route: string; args: unknown[] }[],
}));
vi.mock("@/background/api", () => {
  const call = (route: string) => async (...args: unknown[]) => {
    h.calls.push({ route, args });
    const r = h.routes[route];
    if (typeof r === "function") return r(...args);
    if (!r?.length) throw new Error("no scripted response for " + route);
    const x = r.shift();
    return typeof x === "function" ? x(...args) : x;
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

let s: typeof import("@/background/sync");
let c: typeof import("@/background/cache");
let g: typeof import("@/background/gen");
let a: typeof import("@/background/auth");
let p: typeof import("@/background/pkce");
const IMG = "https://c.example.com";
const cfg = { apiBaseUrl: "https://a.example.com", authBaseUrl: "https://b.example.com", clientId: "x", imageHost: IMG };
const KEY = `https://a.example.com|https://b.example.com|x|${IMG}`;
const ch = () => globalThis.chrome as unknown as ChromeMock;
const store = () => ch().storage.local._data;
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = new Date(Date.now() - 60_000).toISOString();
const OLD = "2000-01-01T00:00:00.000Z";
const BYTES = new Uint8Array([1, 2, 3]);
let SHA = "";
const thumb = (o: Record<string, unknown> = {}) => ({ imageId: "img1", mime: "image/png", bytes: 3, sha256: SHA, ...o });
const dto = (id: string, o: Partial<ReminderDto> = {}): ReminderDto => ({
  id, url: "https://e.example.com/", title: "t", reminderTime: FUTURE, autoOpen: false, webPush: true,
  hidden: false, revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", thumbnail: null, ...o,
});
const cache = (items: ReminderDto[] = [], o: Partial<ServerCache> = {}): ServerCache => ({ items, images: {}, syncedAt: 0, configKey: KEY, ...o });
const ok = (data: unknown, etag: string | null = '"e"', status = 200) => ({ ok: true, status, data, etag });
const page = (items: ReminderDto[], nextCursor: string | null = null) => ok({ items, nextCursor }, null);
const script = (r: Record<string, Route>) => Object.assign(h.routes, r);
const count = (route: string) => h.calls.filter((x) => x.route === route).length;
const stored = () => store().serverCache as ServerCache;
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const thumbUrl = (o: Record<string, unknown> = {}) => () =>
  ok({ url: `${IMG}/k?X-Amz-Signature=s`, expiresAt: FUTURE, imageId: "img1", revision: 1, ...o });
const s3 = (status = 200, body: Uint8Array = BYTES) => vi.fn(async () => new Response(body, { status }));
const DATA_URL = "data:image/png;base64,AQID";

beforeEach(async () => {
  vi.resetModules();
  h.routes = {};
  h.calls = [];
  store().settings = { connectionType: "server", ...cfg };
  g = await import("@/background/gen");
  c = await import("@/background/cache");
  a = await import("@/background/auth");
  p = await import("@/background/pkce");
  s = await import("@/background/sync");
  SHA = await p.sha256Hex(BYTES.slice().buffer);
});

it("pickRandom は重複なく n 件まで選ぶ", () => {
  expect(s.pickRandom([1, 2, 3, 4], 2, () => 0)).toEqual([1, 2]);
  expect(s.pickRandom([1, 2, 3, 4], 9, () => 0.99).sort()).toEqual([1, 2, 3, 4]);
  expect(new Set(s.pickRandom([...Array(40).keys()], 30)).size).toBe(30);
});

it("空の items で nextCursor が残る page を読み続ける", async () => {
  script({ LIST: [page([dto("a")], "c1"), page([], "c2"), page([dto("b")])] });
  const r = await s.listReminders(g.currentGen(), true);
  expect(h.calls.filter((x) => x.route === "LIST").map((x) => x.args[0])).toEqual([null, "c1", "c2"]);
  expect(stored().items.map((i) => i.id)).toEqual(["a", "b"]);
  expect(stored().syncedAt).toBeGreaterThan(0);
  expect(r).toEqual({ ok: true, reminders: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })] });
});

it("fresh でなければ通信しない", async () => {
  store().serverCache = cache([dto("a")]);
  expect(await s.listReminders(g.currentGen(), false)).toEqual({ ok: true, reminders: [expect.objectContaining({ id: "a" })] });
  expect(h.calls).toEqual([]);
});

it("60秒以内は同期しない", async () => {
  store().serverCache = cache([dto("a")], { syncedAt: Date.now() - 59_000 });
  expect(await s.listReminders(g.currentGen(), true)).toEqual({ ok: true, reminders: [expect.objectContaining({ id: "a" })] });
  expect(h.calls).toEqual([]);
});

it("同時の fresh は1回の同期", async () => {
  script({ LIST: [page([dto("a")]), page([dto("b")])] });
  const [r1, r2] = await Promise.all([s.listReminders(g.currentGen(), true), s.listReminders(g.currentGen(), true)]);
  expect(count("LIST")).toBe(1);
  expect(r1).toEqual(r2);
});

it("整理は書き込み30件まで", async () => {
  const items = [...Array(40).keys()].map((i) => dto(`r${i}`, { reminderTime: i % 2 ? OLD : PAST }));
  const byId = (id: unknown) => items.find((d) => d.id === id)!;
  script({
    LIST: [page(items)],
    GET: (id) => ok(byId(id)),
    PATCH: (id) => ok({ ...byId(id), hidden: true }),
    DELETE: (id) => ok({ id, deleted: true, revision: 2 }),
  });
  await s.listReminders(g.currentGen(), true);
  expect(count("PATCH") + count("DELETE")).toBe(30);
  expect(stored().items.length).toBe(40 - count("DELETE"));
});

it("1か月より前は DELETE だけ", async () => {
  script({
    LIST: [page([dto("r1", { reminderTime: OLD })])],
    GET: [ok(dto("r1", { reminderTime: OLD }))],
    DELETE: [ok({ id: "r1", deleted: true, revision: 2 })],
  });
  expect(await s.listReminders(g.currentGen(), true)).toEqual({ ok: true, reminders: [] });
  expect(count("PATCH")).toBe(0);
  expect(count("DELETE")).toBe(1);
  expect(stored().items).toEqual([]);
});

it("整理の1件の失敗が後続を止めない", async () => {
  const items = [dto("r1", { reminderTime: PAST }), dto("r2", { reminderTime: PAST })];
  let n = 0;
  script({
    LIST: [page(items)],
    GET: (id) => (n++ === 0 ? { ok: false, code: "NETWORK" } : ok(items.find((d) => d.id === id))),
    PATCH: (id) => ok({ ...items.find((d) => d.id === id)!, hidden: true }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await s.listReminders(g.currentGen(), true)).ok).toBe(true);
  expect(count("PATCH")).toBe(1);
});

it("画像は30件まで、sha256 と imageId が同じなら取り直さない", async () => {
  const items = [...Array(40).keys()].map((i) => dto(`r${i}`, { thumbnail: thumb() }));
  items.push(dto("same", { thumbnail: thumb() }));
  store().serverCache = cache([], { images: { same: { imageId: "img1", sha256: SHA, dataUrl: "data:x" } } });
  const fetch = vi.fn(async () => new Response(BYTES, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  script({ LIST: [page(items)], THUMB: thumbUrl() });
  await s.listReminders(g.currentGen(), true);
  expect(count("THUMB")).toBe(30);
  expect(h.calls.some((x) => x.route === "THUMB" && x.args[0] === "same")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(30);
  const imgs = stored().images;
  expect(Object.keys(imgs).length).toBe(31);
  expect(imgs.same.dataUrl).toBe("data:x");
});

it("画像を取得して data URL で保存する。S3 には Authorization を付けず redirect: error", async () => {
  const fetch = s3();
  vi.stubGlobal("fetch", fetch);
  script({ LIST: [page([dto("r1", { thumbnail: thumb() })])], THUMB: thumbUrl() });
  const r = await s.listReminders(g.currentGen(), true);
  expect(stored().images.r1).toEqual({ imageId: "img1", sha256: SHA, dataUrl: DATA_URL });
  expect(r.reminders[0].thumbnail).toBe(DATA_URL);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`${IMG}/k?X-Amz-Signature=s`);
  expect(init.redirect).toBe("error");
  expect(init.headers).toBeUndefined();
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

it.each([
  ["imageId 違い", thumbUrl({ imageId: "other" }), s3(), thumb()],
  ["origin 違い", thumbUrl({ url: "https://evil.example.com/k" }), s3(), thumb()],
  ["status 200 以外", thumbUrl(), s3(203), thumb()],
  ["bytes 違い", thumbUrl(), s3(), thumb({ bytes: 4 })],
  ["hash 違い", thumbUrl(), s3(), thumb({ sha256: "0".repeat(64) })],
])("画像の照合: %s なら保存しない", async (_, THUMB, fetch, t) => {
  vi.stubGlobal("fetch", fetch);
  script({ LIST: [page([dto("r1", { thumbnail: t })])], THUMB });
  expect((await s.listReminders(g.currentGen(), true)).ok).toBe(true);
  expect(stored().images).toEqual({});
});

it("DTO の thumbnail が null、または DTO に無い id の画像を消す", async () => {
  const img = { imageId: "img1", sha256: SHA, dataUrl: "data:x" };
  store().serverCache = cache([], { images: { r1: img, gone: img, r2: img } });
  script({ LIST: [page([dto("r1"), dto("r2", { thumbnail: thumb() })])] });
  await s.listReminders(g.currentGen(), true);
  expect(stored().images).toEqual({ r2: img });
});

it("notified から hidden:true と DTO に無い id を消す", async () => {
  Object.assign(store(), { "notified:r1": 1, "notified:gone": 1, "notified:r2": 1 });
  script({ LIST: [page([dto("r1", { hidden: true }), dto("r2")])] });
  await s.listReminders(g.currentGen(), true);
  expect(await c.getNotifiedIds()).toEqual(new Set(["r2"]));
});

it.each([true, false])("同期中の作成が全件置き換えで消えない（応答に含む: %s）", async (included) => {
  const d = deferred<unknown>();
  script({ LIST: [() => d.promise], POST: [ok(dto("new"), '"e"', 201)] });
  const gen = g.currentGen();
  const sync = s.listReminders(gen, true);
  await vi.waitFor(() => expect(count("LIST")).toBe(1));
  const create = s.createOnServer(gen, {
    id: "new", url: "https://e.example.com/", title: "t", thumbnail: "x", reminderTime: FUTURE,
    autoOpen: false, webPush: true, createdAt: "x", hidden: false,
  });
  await vi.waitFor(() => expect(count("POST")).toBe(1));
  d.resolve(page(included ? [dto("a"), dto("new")] : [dto("a")]));
  await Promise.all([sync, create]);
  expect(stored().items.filter((i) => i.id === "new").length).toBe(1);
  expect(stored().items.map((i) => i.id)).toContain("a");
});

it("同期中の config/save が完了する", async () => {
  const d = deferred<unknown>();
  // 実際の listPage と同じく、page ごとに authLock の中で token を取る
  const token = () => a.authLock(async () => {});
  script({ LIST: [async () => (await token(), await d.promise, await token(), page([], "c1")), async () => (await token(), page([]))] });
  const sync = s.listReminders(g.currentGen(), true);
  await vi.waitFor(() => expect(count("LIST")).toBe(1));
  // Task 10 の config/save と同じ lock の順
  const save = c.queue(() => a.authLock(async () => (g.bumpGen(), "saved")));
  d.resolve(undefined);
  await expect(save).resolves.toBe("saved");
  await expect(sync).resolves.toMatchObject({ ok: true });
});

it("失敗した時は cache の変換と code を返す", async () => {
  store().serverCache = cache([dto("a")]);
  script({ LIST: [{ ok: false, code: "SERVICE_UNAVAILABLE", status: 503 }] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await s.listReminders(g.currentGen(), true)).toEqual({
    ok: false, code: "SERVICE_UNAVAILABLE", status: 503, reminders: [expect.objectContaining({ id: "a" })],
  });
  expect(stored().syncedAt).toBe(0);
});

it("同期の後に server の alarm を作り直す", async () => {
  script({ LIST: [page([dto("a"), dto("h", { hidden: true })])] });
  await s.listReminders(g.currentGen(), true);
  expect(ch().alarms.clearAll).toHaveBeenCalled();
  expect(ch().alarms.create).toHaveBeenCalledTimes(1);
  expect(ch().alarms.create).toHaveBeenCalledWith("a", { when: Date.parse(FUTURE) });
});
