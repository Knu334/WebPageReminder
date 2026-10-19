import { it, expect, beforeEach, vi } from "vitest";

let g: typeof import("@/background/gen");
let mod: typeof import("@/background/api");
const sleep = vi.fn(async (_ms: number) => {});
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

it("送る前に世代を確かめる", async () => {
  const api = mk();
  g.bumpGen();
  expect(await api.listPage(null)).toEqual({ ok: false, code: "STALE" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("Bearer と JSON を付ける", async () => {
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

it("401 で1回だけ force refresh して再送する", async () => {
  fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, {}));
  expect((await mk().getReminder("a")).ok).toBe(true);
  expect(getToken).toHaveBeenCalledWith(expect.any(Number), { force: true });
  expect(getToken.mock.calls.filter((c) => c[1]?.force)).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  fetchMock.mockReset().mockImplementation(async () => res(401, { code: "X" }));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "UNAUTHORIZED", status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("429 は Retry-After と jitter で最大2回", async () => {
  fetchMock.mockResolvedValueOnce(res(429, {}, { "Retry-After": "3" })).mockResolvedValueOnce(res(200, {}));
  expect((await mk().getReminder("a")).ok).toBe(true);
  expect(sleep).toHaveBeenCalledWith(3500);
  fetchMock.mockReset().mockImplementation(async () => res(429, { code: "OWNER_RATE_LIMIT_EXCEEDED" }));
  const r = await mk().getReminder("a");
  expect(r).toMatchObject({ ok: false, code: "OWNER_RATE_LIMIT_EXCEEDED", status: 429 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("JSON でない 429 は1秒待つ", async () => {
  fetchMock.mockImplementation(async () => res(429, "<html>"));
  const r = await mk().getReminder("a");
  expect(sleep).toHaveBeenCalledWith(1500);
  expect(r).toEqual({ ok: false, code: "HTTP_429", status: 429 });
});

it("GET の通信障害は 0.5秒・1秒で最大2回、書き込みは再送しない", async () => {
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

it("PATCH と DELETE に If-Match を付ける", async () => {
  fetchMock.mockResolvedValue(res(200, {}, { ETag: '"e2"' }));
  const api = mk();
  const r = await api.patchReminder("a", { hidden: true, thumbnail: null }, '"e1"');
  expect(r).toMatchObject({ ok: true, etag: '"e2"' });
  await api.deleteReminder("a", '"e1"');
  expect(fetchMock.mock.calls[0][1].headers["If-Match"]).toBe('"e1"');
  expect(fetchMock.mock.calls[1][1].headers["If-Match"]).toBe('"e1"');
});

it("403 は再試行しない", async () => {
  fetchMock.mockResolvedValue(res(403, "<html>"));
  expect(await mk().getReminder("a")).toEqual({ ok: false, code: "HTTP_403", status: 403 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("token が取れなければ code を返し、abort は STALE", async () => {
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
