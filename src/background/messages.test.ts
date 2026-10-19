import { it, expect, beforeEach, vi, describe } from "vitest";
import type { ChromeMock } from "@/test/chrome";
import type { ReminderDto, ServerCache } from "@/types/types";

let m: typeof import("@/background/messages");
let g: typeof import("@/background/gen");
let c: typeof import("@/background/cache");

const CFG = { apiBaseUrl: "https://api.test", authBaseUrl: "https://auth.test", clientId: "abc123", imageHost: "https://img.test" };
const CFG2 = { ...CFG, apiBaseUrl: "https://api2.test" };
const KEY = Object.values(CFG).join("|");
const REDIRECT = "https://test-ext-id.chromiumapp.org/cognito";
const FUTURE = "2099-01-01T00:00:00.000Z";
const ch = () => globalThis.chrome as unknown as ChromeMock;
const local = () => ch().storage.local._data;
const session = () => ch().storage.session._data;
const flow = () => ch().identity.launchWebAuthFlow;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tokens = { access_token: "a1", refresh_token: "r1", token_type: "Bearer", expires_in: 3600 };
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const dto = (id: string): ReminderDto => ({
  id, url: "https://e.test/", title: "t", reminderTime: FUTURE, autoOpen: false, webPush: true, hidden: false,
  revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", thumbnail: null,
});
const cache = (items: ReminderDto[]): ServerCache => ({ items, images: {}, syncedAt: 0, configKey: KEY });
const reminder = (o: Record<string, unknown> = {}) => ({
  id: "r1", url: "https://e.test/", title: "t", thumbnail: "data:image/png;base64,AQID", reminderTime: FUTURE,
  autoOpen: false, webPush: true, createdAt: "2026-01-01T00:00:00.000Z", hidden: false, ...o,
});
const alarmNames = async () => (await ch().alarms.getAll()).map((a) => a.name).sort();
const loggedIn = () => {
  local().authRefresh = { refreshToken: "rt0", configKey: KEY };
  session().authSession = { accessToken: "at0", expiresAt: Date.now() + 3_600_000, configKey: KEY };
};
const fetchCalls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part)).length;
const handle = async (raw: unknown) => {
  const p = m.parseMessage(raw);
  if (p.kind !== "ok") throw new Error(p.kind);
  return m.handleMessage(p.msg);
};

// URL ごとの応答
let routes: Record<string, () => Promise<Response> | Response>;
const fetchMock = vi.fn(async (url: string) => {
  const key = Object.keys(routes).find((k) => String(url).includes(k));
  if (!key) throw new Error("no route " + url);
  return routes[key]();
});

beforeEach(async () => {
  vi.resetModules();
  routes = {
    "/oauth2/token": () => json(tokens),
    "/oauth2/revoke": () => json({}),
    "/v2/reminders?limit=50": () => json({ items: [], nextCursor: null }),
  };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  local().settings = { connectionType: "server", ...CFG };
  flow().mockImplementation(async ({ url }: { url: string }) =>
    url.includes("/oauth2/authorize")
      ? `${REDIRECT}?code=c1&state=${new URL(url).searchParams.get("state")}`
      : "https://test-ext-id.chromiumapp.org/logout",
  );
  g = await import("@/background/gen");
  c = await import("@/background/cache");
  m = await import("@/background/messages");
});

describe("isTrustedSender", () => {
  it("自拡張の page だけを受け付ける", () => {
    expect(m.isTrustedSender({ id: "test-ext-id", url: "chrome-extension://test-ext-id/popup.html" })).toBe(true);
    expect(m.isTrustedSender({ id: "other", url: "chrome-extension://other/popup.html" })).toBe(false);
    expect(m.isTrustedSender({ id: "test-ext-id", url: "https://example.com/" })).toBe(false);
    expect(m.isTrustedSender({ id: "test-ext-id" })).toBe(false);
  });
});

describe("isValidId", () => {
  it.each([[""], ["a".repeat(129)], ["a\u0000"], ["a\u0085"], ["\ud800"], [1]])("%j は不可", (id) => {
    expect(m.isValidId(id)).toBe(false);
  });
  it.each([["😀".repeat(128)], ["123e4567-e89b-42d3-a456-426614174000"]])("%s は可", (id) => {
    expect(m.isValidId(id)).toBe(true);
  });
});

describe("parseMessage", () => {
  it("未知の type は unknown", () => {
    expect(m.parseMessage({ type: "x" })).toEqual({ kind: "unknown" });
    expect(m.parseMessage(null)).toEqual({ kind: "unknown" });
  });
  it.each([
    ["ftp の url", { url: "ftp://e.test/" }],
    ["4097 文字の url", { url: "https://e.test/" + "a".repeat(4097 - 15) }],
    ["1025 文字の title", { title: "a".repeat(1025) }],
    ['autoOpen が "true"', { autoOpen: "true" }],
    ["offset の無い reminderTime", { reminderTime: "2099-01-01 00:00:00" }],
    ["1 MiB を超える画像", { thumbnail: "data:image/png;base64," + "A".repeat(1_398_104 + 4) }],
  ])("reminders/create の %s は invalid", (_, o) => {
    expect(m.parseMessage({ type: "reminders/create", reminder: reminder(o) })).toEqual({ kind: "invalid" });
  });
  it("正しい reminders/create と境界の大きさは ok", () => {
    const r = reminder({ url: "https://e.test/" + "a".repeat(4096 - 15), title: "a".repeat(1024) });
    expect(m.parseMessage({ type: "reminders/create", reminder: r })).toMatchObject({ kind: "ok" });
  });
  it("config/save の不正な URL は invalid、正しければ正規化する", () => {
    expect(m.parseMessage({ type: "config/save", config: { ...CFG, apiBaseUrl: "http://api.test" } })).toEqual({ kind: "invalid" });
    expect(m.parseMessage({ type: "config/save", config: null })).toEqual({ kind: "invalid" });
    expect(m.parseMessage({ type: "config/save", config: { ...CFG, apiBaseUrl: "https://API.test/" } })).toEqual({
      kind: "ok", msg: { type: "config/save", config: CFG },
    });
  });
  it("その他の入力の検証", () => {
    expect(m.parseMessage({ type: "mode/change", connectionType: "x" })).toEqual({ kind: "invalid" });
    expect(m.parseMessage({ type: "reminders/list", fresh: "1" })).toEqual({ kind: "invalid" });
    expect(m.parseMessage({ type: "reminders/delete", id: "" })).toEqual({ kind: "invalid" });
    expect(m.parseMessage({ type: "reminders/delete", id: "a" })).toMatchObject({ kind: "ok" });
  });
});

it("local モードの reminders/list は NOT_SERVER_MODE", async () => {
  local().settings = { connectionType: "local" };
  expect(await handle({ type: "reminders/list", fresh: true })).toMatchObject({ ok: false, code: "NOT_SERVER_MODE" });
  expect(await handle({ type: "reminders/delete", id: "a" })).toEqual({ ok: false, code: "NOT_SERVER_MODE" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("config/save で接続先が変わると認証と cache と alarm が消え、世代が進む", async () => {
  loggedIn();
  local().serverCache = cache([dto("a")]);
  await ch().alarms.create("a", { when: Date.parse(FUTURE) });
  const gen = g.currentGen();
  expect(await handle({ type: "config/save", config: CFG2 })).toEqual({ ok: true });
  expect(g.currentGen()).toBe(gen + 1);
  expect(local().settings).toMatchObject({ connectionType: "server", ...CFG2 });
  expect(local().authRefresh).toBeUndefined();
  expect(session().authSession).toBeUndefined();
  expect(local().serverCache).toBeUndefined();
  expect(await alarmNames()).toEqual([]);
});

it("config/save で接続先が変わらなければ消さない", async () => {
  loggedIn();
  local().serverCache = cache([dto("a")]);
  await ch().alarms.create("a", { when: Date.parse(FUTURE) });
  const gen = g.currentGen();
  expect(await handle({ type: "config/save", config: CFG })).toEqual({ ok: true });
  expect(g.currentGen()).toBe(gen);
  expect(local().authRefresh).toBeDefined();
  expect(local().serverCache).toBeDefined();
  expect(await alarmNames()).toEqual(["a"]);
});

it("login の成功で古い cache を消して同期を始める", async () => {
  local().serverCache = cache([dto("old")]);
  routes["/v2/reminders?limit=50"] = () => json({ items: [dto("n")], nextCursor: null });
  expect(await handle({ type: "auth/login" })).toEqual({ ok: true });
  await vi.waitFor(() => expect((local().serverCache as ServerCache | undefined)?.items.map((i) => i.id)).toEqual(["n"]));
  await vi.waitFor(async () => expect(await alarmNames()).toEqual(["n"]));
});

it("logout の revoke 中に成功した新しい login の cache と alarm を、logout の後処理が消さない", async () => {
  loggedIn();
  local().serverCache = cache([dto("old")]);
  const revoke = deferred<Response>();
  routes["/oauth2/revoke"] = () => revoke.promise;
  routes["/v2/reminders?limit=50"] = () => json({ items: [dto("n")], nextCursor: null });
  const lo = handle({ type: "auth/logout" });
  await vi.waitFor(() => expect(fetchCalls("/oauth2/revoke")).toBe(1));
  expect(await handle({ type: "auth/login" })).toEqual({ ok: true });
  await vi.waitFor(async () => expect(await alarmNames()).toEqual(["n"]));
  revoke.resolve(json({}));
  expect(await lo).toEqual({ ok: true, revoked: true });
  expect((local().serverCache as ServerCache).items.map((i) => i.id)).toEqual(["n"]);
  expect(await alarmNames()).toEqual(["n"]);
  expect(local().authRefresh).toEqual({ refreshToken: "r1", configKey: KEY });
  expect(session().authNotice).toBeUndefined();
});

it("login の後処理の前に logout が来たら、login の後処理は何もしない", async () => {
  local().serverCache = cache([dto("old")]);
  const start = g.currentGen();
  const block = deferred<void>();
  void c.queue(() => block.promise);
  const li = handle({ type: "auth/login" });
  await vi.waitFor(() => expect(g.currentGen()).toBe(start + 1));
  const lo = handle({ type: "auth/logout" });
  await vi.waitFor(() => expect(g.currentGen()).toBe(start + 2));
  block.resolve();
  expect(await li).toEqual({ ok: true });
  expect(await lo).toEqual({ ok: true, revoked: true });
  await new Promise((r) => setTimeout(r, 10));
  await c.queue(async () => {});
  expect(fetchCalls("/v2/")).toBe(0);
  // logout の後処理の1回だけ
  expect(ch().storage.local.remove.mock.calls.filter(([k]) => k === "serverCache").length).toBe(1);
});

it("受け付けた後に config/save が来た作成は STALE で API を送らない", async () => {
  loggedIn();
  const d = deferred<void>();
  const settings = { ...(local().settings as object) };
  ch().storage.local.get.mockImplementationOnce(async () => (await d.promise, { settings }));
  const cr = handle({ type: "reminders/create", reminder: reminder() });
  expect(await handle({ type: "config/save", config: CFG2 })).toEqual({ ok: true });
  d.resolve();
  expect(await cr).toEqual({ ok: false, code: "STALE" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["local", "server"])("alarms/reset の受付の後に mode/change が来たら何もしない（→ %s）", async (to) => {
  local().reminders = [reminder({ id: "l1" })];
  local().serverCache = cache([dto("s1")]);
  const d = deferred<void>();
  const settings = { ...(local().settings as object) };
  ch().storage.local.get.mockImplementationOnce(async () => (await d.promise, { settings }));
  const reset = handle({ type: "alarms/reset" });
  expect(await handle({ type: "mode/change", connectionType: to })).toEqual({ ok: true });
  d.resolve();
  expect(await reset).toEqual({ ok: true });
  expect(ch().alarms.clearAll).toHaveBeenCalledTimes(1);
  expect(await alarmNames()).toEqual([to === "local" ? "l1" : "s1"]);
});

it("alarms/reset は今のモードの一覧から alarm を作り直す", async () => {
  local().settings = { connectionType: "local" };
  local().reminders = [reminder({ id: "l1" }), reminder({ id: "l2", hidden: true })];
  expect(await handle({ type: "alarms/reset" })).toEqual({ ok: true });
  expect(await alarmNames()).toEqual(["l1"]);
});

it("mode/change の後に古いモードの alarm が残らない", async () => {
  local().serverCache = cache([dto("s1")]);
  local().reminders = [reminder({ id: "l1" })];
  await ch().alarms.create("s1", { when: Date.parse(FUTURE) });
  const gen = g.currentGen();
  expect(await handle({ type: "mode/change", connectionType: "local" })).toEqual({ ok: true });
  expect(g.currentGen()).toBe(gen + 1);
  expect((local().settings as { connectionType: string }).connectionType).toBe("local");
  expect(await alarmNames()).toEqual(["l1"]);
  expect(await handle({ type: "mode/change", connectionType: "server" })).toEqual({ ok: true });
  expect(await alarmNames()).toEqual(["s1"]);
});

it("進行中の server の同期が、切り替えた後の local の alarm を上書きしない", async () => {
  loggedIn();
  local().reminders = [reminder({ id: "l1" })];
  const list = deferred<Response>();
  routes["/v2/reminders?limit=50"] = () => list.promise;
  const sync = handle({ type: "reminders/list", fresh: true });
  await vi.waitFor(() => expect(fetchCalls("/v2/")).toBe(1));
  const mode = handle({ type: "mode/change", connectionType: "local" });
  list.resolve(json({ items: [dto("s1")], nextCursor: null }));
  await sync;
  expect(await mode).toEqual({ ok: true });
  expect(await alarmNames()).toEqual(["l1"]);
});

it("login の window を開いている間の auth/status は loginInProgress: true、取り消し後は notice: LOGIN_CANCELLED", async () => {
  const win = deferred<string>();
  flow().mockImplementation(() => win.promise);
  const li = handle({ type: "auth/login" });
  await vi.waitFor(() => expect(flow()).toHaveBeenCalled());
  expect(await handle({ type: "auth/status" })).toMatchObject({ loginInProgress: true, notice: null, state: "LOGGED_OUT" });
  win.reject(new Error("closed"));
  expect(await li).toEqual({ ok: false, code: "LOGIN_CANCELLED" });
  expect(await handle({ type: "auth/status" })).toMatchObject({ loginInProgress: false, notice: "LOGIN_CANCELLED" });
});

it("想定外の例外は reject せず INTERNAL を返す", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  ch().storage.session.get.mockRejectedValueOnce(new Error("boom"));
  expect(await handle({ type: "auth/status" })).toEqual({ ok: false, code: "INTERNAL" });
  loggedIn();
  local().serverCache = cache([dto("a")]);
  // fresh の同期の最初の cache の読み込みで失敗させる
  ch().storage.local.get.mockImplementationOnce(async () => ({ settings: local().settings }));
  ch().storage.local.get.mockRejectedValueOnce(new Error("boom"));
  expect(await handle({ type: "reminders/list", fresh: true })).toEqual({
    ok: false, code: "INTERNAL", reminders: [expect.objectContaining({ id: "a" })],
  });
  expect(console.error).toHaveBeenCalledWith("message failed", "auth/status", "Error");
});
