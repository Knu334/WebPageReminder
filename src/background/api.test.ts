import { it, expect, beforeEach, vi } from "vitest";

let g: typeof import("@/background/gen");
let mod: typeof import("@/background/api");
const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
const getToken = vi.fn();
const fetchMock = vi.fn();
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const mk = () => mod.createApi({ baseUrl: "https://api.test", gen: g.currentGen(), getToken, sleep, random: () => 0.5 });

beforeEach(async () => {
  vi.resetModules();
  g = await import("@/background/gen");
  mod = await import("@/background/api");
  sleep.mockClear();
  getToken.mockReset().mockResolvedValue({ ok: true, token: "t1" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

it("R-GEN-02 R-API-01: 送る前に世代を確かめる", async () => {
  const api = mk();
  g.bumpGen();
  expect(await api.listPage(null)).toEqual({ ok: false, code: "STALE" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("R-API-01 R-API-11: Bearer と JSON を付ける", async () => {
  fetchMock.mockResolvedValue(res(201, { id: "a" }, { ETag: '"e1"' }));
  const api = mk();
  const r = await api.createReminder({ id: "a", url: "u", title: "t", reminderTime: "x", autoOpen: true, webPush: false, hidden: false, thumbnail: null });
  expect(r).toMatchObject({ ok: true, status: 201, etag: '"e1"' });
  const init = fetchMock.mock.calls[0][1];
  expect(init.headers.Authorization).toBe("Bearer t1");
  expect(init.headers["Content-Type"]).toBe("application/json");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  fetchMock.mockResolvedValue(res(200, {}));
  await api.getReminder("a/b");
  expect(fetchMock.mock.calls[1][0]).toBe("https://api.test/v2/reminders/a%2Fb");
});

it("R-API-04: 401 で1回だけ force refresh して再送する", async () => {
  fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, {}));
  expect((await mk().getReminder("a")).ok).toBe(true);
  expect(getToken).toHaveBeenCalledWith(expect.any(Number), { force: true });
  expect(getToken.mock.calls.filter((c) => c[1]?.force)).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  fetchMock.mockReset().mockImplementation(async () => res(401, { code: "X" }));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "UNAUTHORIZED", status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("R-API-06: 429 は Retry-After と jitter で最大2回", async () => {
  fetchMock.mockResolvedValueOnce(res(429, {}, { "Retry-After": "3" })).mockResolvedValueOnce(res(200, {}));
  expect((await mk().getReminder("a")).ok).toBe(true);
  expect(sleep).toHaveBeenCalledWith(3500);
  fetchMock.mockReset().mockImplementation(async () => res(429, { code: "OWNER_RATE_LIMIT_EXCEEDED" }));
  const r = await mk().getReminder("a");
  expect(r).toMatchObject({ ok: false, code: "OWNER_RATE_LIMIT_EXCEEDED", status: 429 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("R-API-06: JSON でない 429 は1秒待つ", async () => {
  fetchMock.mockImplementation(async () => res(429, "<html>"));
  const r = await mk().getReminder("a");
  expect(sleep).toHaveBeenCalledWith(1500);
  expect(r).toEqual({ ok: false, code: "HTTP_429", status: 429 });
});

it("R-API-07 R-API-08: GET の通信障害は 0.5秒・1秒で最大2回、書き込みは再送しない", async () => {
  fetchMock.mockRejectedValue(new TypeError("x"));
  const api = mk();
  expect(await api.listPage(null)).toEqual({ ok: false, code: "NETWORK" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls.map((c) => c[0])).toEqual([625, 1125]);
  fetchMock.mockClear();
  expect(await api.patchReminder("a", { hidden: true, thumbnail: null }, '"e"')).toEqual({ ok: false, code: "UNKNOWN_RESULT" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockReset().mockResolvedValue(res(503));
  expect(await api.deleteReminder("a", '"e"')).toEqual({ ok: false, code: "UNKNOWN_RESULT" });
});

it("R-API-13 R-API-14: PATCH と DELETE に If-Match を付ける", async () => {
  fetchMock.mockResolvedValue(res(200, {}, { ETag: '"e2"' }));
  const api = mk();
  const r = await api.patchReminder("a", { hidden: true, thumbnail: null }, '"e1"');
  expect(r).toMatchObject({ ok: true, etag: '"e2"' });
  await api.deleteReminder("a", '"e1"');
  expect(fetchMock.mock.calls[0][1].headers["If-Match"]).toBe('"e1"');
  expect(fetchMock.mock.calls[1][1].headers["If-Match"]).toBe('"e1"');
});

it("R-API-05: 403 は再試行しない", async () => {
  fetchMock.mockResolvedValue(res(403, "<html>"));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "HTTP_403", status: 403 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("R-API-03 R-GEN-02: token が取れなければ code を返し、abort は STALE", async () => {
  getToken.mockResolvedValue({ ok: false, code: "LOGIN_REQUIRED" });
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  getToken.mockResolvedValue({ ok: true, token: "t" });
  const api = mk();
  fetchMock.mockImplementation(async () => {
    g.bumpGen();
    throw new DOMException("aborted", "AbortError");
  });
  expect(await api.getReminder("a")).toEqual({ ok: false, code: "STALE" });
});

it("R-API-04: force refresh は 401 の直後の1回だけ", async () => {
  fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200, {}));
  expect((await mk().getReminder("a")).ok).toBe(true);
  expect(getToken.mock.calls.filter((c) => c[1]?.force)).toHaveLength(1);
  expect(getToken).toHaveBeenCalledTimes(3);
});

it("R-API-03 R-API-07: body の読み取り失敗は通信障害として扱う", async () => {
  const broken = () => {
    const r = res(200, {});
    vi.spyOn(r, "text").mockRejectedValue(new TypeError("reset"));
    return r;
  };
  fetchMock.mockImplementation(async () => broken());
  const api = mk();
  expect(await api.getReminder("a")).toEqual({ ok: false, code: "NETWORK" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  fetchMock.mockClear();
  expect(await api.deleteReminder("a", '"e"')).toEqual({ ok: false, code: "UNKNOWN_RESULT" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("R-API-03: 2xx で JSON が壊れていれば BAD_RESPONSE", async () => {
  fetchMock.mockResolvedValue(res(200, "<html>"));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "BAD_RESPONSE", status: 200 });
});

it("R-API-02: API の fetch に10秒の timeout を付ける", async () => {
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort());
  fetchMock.mockImplementation(async () => res(200, {}));
  const api = mk();
  await api.listPage(null);
  await api.getReminder("a");
  await api.deleteReminder("a", '"e"');
  expect(spy.mock.calls).toEqual([[10_000], [10_000], [10_000]]);
  // abort 済みの signal を返したので、fetch に渡っていれば aborted
  expect(fetchMock.mock.calls.every((c) => c[1].signal.aborted)).toBe(true);
});

it("R-API-09: その他の status は再試行せず code と status を返す", async () => {
  fetchMock.mockResolvedValueOnce(res(404, { code: "NOT_FOUND" }));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "NOT_FOUND", status: 404 });
  fetchMock.mockResolvedValueOnce(res(409, { code: "PRECONDITION", message: "m" }));
  expect(await mk().deleteReminder("a", '"e"')).toEqual({ ok: false, code: "PRECONDITION", status: 409, message: "m" });
  fetchMock.mockResolvedValueOnce(res(500, "<html>"));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "HTTP_500", status: 500 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(sleep).not.toHaveBeenCalled();
});

it("R-API-10: listPage の query", async () => {
  fetchMock.mockImplementation(async () => res(200, { items: [], nextCursor: null }));
  const api = mk();
  await api.listPage(null);
  await api.listPage("a b/c&d");
  expect(fetchMock.mock.calls.map((c) => [c[0], c[1].method])).toEqual([
    ["https://api.test/v2/reminders?limit=50", "GET"],
    ["https://api.test/v2/reminders?limit=50&cursor=a%20b%2Fc%26d", "GET"],
  ]);
});

it("R-API-12: createReminder は POST /v2/reminders", async () => {
  fetchMock.mockResolvedValue(res(201, {}));
  const body = { id: "a", url: "u", title: "t", reminderTime: "x", autoOpen: true, webPush: false, hidden: false as const, thumbnail: null };
  await mk().createReminder(body);
  const [url, init] = fetchMock.mock.calls[0];
  expect([url, init.method, JSON.parse(init.body)]).toEqual(["https://api.test/v2/reminders", "POST", body]);
});

it("R-API-15: getThumbnailUrl は GET /v2/reminders/{id}/thumbnail-url", async () => {
  fetchMock.mockResolvedValue(res(200, {}));
  await mk().getThumbnailUrl("a/b");
  const [url, init] = fetchMock.mock.calls[0];
  expect([url, init.method]).toEqual(["https://api.test/v2/reminders/a%2Fb/thumbnail-url", "GET"]);
});
