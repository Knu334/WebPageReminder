import { it, expect, beforeEach, vi } from "vitest";

let g: typeof import("@/background/gen");
let auth: typeof import("@/background/auth");
let pkce: typeof import("@/background/pkce");

const CFG = {
  apiBaseUrl: "https://api.test",
  authBaseUrl: "https://auth.test",
  clientId: "abc123",
  imageHost: "https://img.test",
};
const KEY = [CFG.apiBaseUrl, CFG.authBaseUrl, CFG.clientId, CFG.imageHost].join("|");
const fetchMock = vi.fn();
const res = (status: number, body: unknown = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const okBody = (n = 2) => ({ access_token: `a${n}`, refresh_token: `r${n}`, token_type: "Bearer", expires_in: 3600 });
const local = () => chrome.storage.local as unknown as { _data: Record<string, unknown>; set: ReturnType<typeof vi.fn> };
const session = () => chrome.storage.session as unknown as { _data: Record<string, unknown>; set: ReturnType<typeof vi.fn> };

const load = async () => {
  vi.resetModules();
  g = await import("@/background/gen");
  auth = await import("@/background/auth");
  pkce = await import("@/background/pkce");
};

beforeEach(async () => {
  await load();
  local()._data.settings = { autoOpen: true, webPush: true, connectionType: "server", ...CFG };
  local()._data.authRefresh = { refreshToken: "r1", configKey: KEY };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

it("期限まで30秒より多ければ token endpoint を呼ばない", async () => {
  session()._data.authSession = { accessToken: "a1", expiresAt: Date.now() + 31_000, configKey: KEY };
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: true, token: "a1" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("30秒以下なら refresh する", async () => {
  session()._data.authSession = { accessToken: "a1", expiresAt: Date.now() + 30_000, configKey: KEY };
  fetchMock.mockResolvedValue(res(200, okBody()));
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: true, token: "a2" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("force は30秒の判定を飛ばす", async () => {
  session()._data.authSession = { accessToken: "a1", expiresAt: Date.now() + 3_600_000, configKey: KEY };
  fetchMock.mockResolvedValue(res(200, okBody()));
  expect(await auth.getAccessToken(g.currentGen(), { force: true })).toEqual({ ok: true, token: "a2" });
});

it("同時の3回で token endpoint は1回", async () => {
  fetchMock.mockImplementation(async () => res(200, okBody()));
  const gen = g.currentGen();
  const rs = await Promise.all([auth.getAccessToken(gen), auth.getAccessToken(gen), auth.getAccessToken(gen, { force: true })]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(rs).toEqual([1, 2, 3].map(() => ({ ok: true, token: "a2" })));
});

it("新しい refresh token を access token より先に保存する", async () => {
  const order: string[] = [];
  local().set.mockImplementation(async (o: Record<string, unknown>) => {
    order.push(...Object.keys(o).map((k) => "local:" + k));
    Object.assign(local()._data, o);
  });
  session().set.mockImplementation(async (o: Record<string, unknown>) => {
    order.push(...Object.keys(o).map((k) => "session:" + k));
    Object.assign(session()._data, o);
  });
  fetchMock.mockResolvedValue(res(200, okBody()));
  await auth.getAccessToken(g.currentGen());
  expect(order.indexOf("local:authRefresh")).toBeGreaterThan(-1);
  expect(order.indexOf("local:authRefresh")).toBeLessThan(order.indexOf("session:authSession"));
  expect(local()._data.authRefresh).toEqual({ refreshToken: "r2", configKey: KEY });
  expect(session()._data.authSession).toMatchObject({ accessToken: "a2", configKey: KEY });
  expect(session()._data.refreshPending).toBeUndefined();

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://auth.test/oauth2/token");
  expect(init.method).toBe("POST");
  expect(String(init.body)).toBe("grant_type=refresh_token&client_id=abc123&refresh_token=r1");
  expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
});

it("refresh_token の無い応答は失敗", async () => {
  const body: Partial<ReturnType<typeof okBody>> = okBody();
  delete body.refresh_token;
  fetchMock.mockResolvedValue(res(200, body));
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  expect((session()._data.authNotice as { code: string }).code).toBe("REFRESH_FAILED");
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
});

it("token_type・expires_in が不正なら保存しない", async () => {
  for (const bad of [{ token_type: "bearer" }, { expires_in: 0 }, { expires_in: "3600" }]) {
    local()._data.authRefresh = { refreshToken: "r1", configKey: KEY };
    fetchMock.mockResolvedValue(res(200, { ...okBody(), ...bad }));
    expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
    expect(session()._data.authSession).toBeUndefined();
    expect(local()._data.authRefresh).toBeUndefined();
  }
});

it("invalid_grant で認証状態を消す", async () => {
  session()._data.authSession = { accessToken: "a1", expiresAt: Date.now() + 1_000, configKey: KEY };
  fetchMock.mockResolvedValue(res(400, { error: "invalid_grant" }));
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
  expect(session()._data.refreshPending).toBeUndefined();
  expect((session()._data.authNotice as { code: string }).code).toBe("REFRESH_FAILED");
});

it("通信障害では消さない", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "NETWORK" });
  expect(fetchMock).toHaveBeenCalledTimes(3); // 初回 + backoff 0.5秒・1秒
  expect(local()._data.authRefresh).toEqual({ refreshToken: "r1", configKey: KEY });
  expect(session()._data.refreshPending).toMatchObject({ refreshTokenHash: await pkce.sha256Hex("r1") });
  expect(session()._data.authNotice).toBeUndefined();
});

it("5xx は refreshPending を消して backoff で再送する", async () => {
  const pendings: unknown[] = [];
  fetchMock
    .mockImplementationOnce(async () => {
      pendings.push(session()._data.refreshPending);
      return res(503, "<html>");
    })
    .mockImplementationOnce(async () => {
      pendings.push(session()._data.refreshPending);
      return res(200, okBody());
    });
  const removeSpy = chrome.storage.session.remove as ReturnType<typeof vi.fn>;
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: true, token: "a2" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(pendings.every(Boolean)).toBe(true);
  expect(removeSpy.mock.calls.filter((c) => [c[0]].flat().includes("refreshPending")).length).toBeGreaterThanOrEqual(2);
  expect(session()._data.refreshPending).toBeUndefined();
});

it("10秒を過ぎた refreshPending があれば送らない", async () => {
  const pending = { refreshTokenHash: await pkce.sha256Hex("r1"), firstSentAt: Date.now() - 11_000 };
  session()._data.refreshPending = { ...pending };
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(local()._data.authRefresh).toBeUndefined();
  expect((session()._data.authNotice as { code: string }).code).toBe("REFRESH_FAILED");

  // worker の再起動
  local()._data.authRefresh = { refreshToken: "r1", configKey: KEY };
  session()._data.refreshPending = { ...pending };
  await load();
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("10秒以内の refreshPending は再送する", async () => {
  const firstSentAt = Date.now() - 5_000;
  session()._data.refreshPending = { refreshTokenHash: await pkce.sha256Hex("r1"), firstSentAt };
  let seen: unknown;
  fetchMock.mockImplementation(async () => {
    seen = session()._data.refreshPending;
    return res(200, okBody());
  });
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: true, token: "a2" });
  expect(seen).toMatchObject({ firstSentAt });
});

it("世代が変わった応答は捨てる", async () => {
  fetchMock.mockImplementation(async () => {
    g.bumpGen();
    return res(200, okBody());
  });
  const before = { local: structuredClone(local()._data), session: structuredClone(session()._data) };
  const setCalls = local().set.mock.calls.length + session().set.mock.calls.length;
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "STALE" });
  expect(local()._data).toEqual(before.local);
  // 送る前の refreshPending の記録以外は書かない
  expect(local().set.mock.calls.length + session().set.mock.calls.length).toBe(setCalls + 1);
  expect(session()._data.authSession).toBeUndefined();
});

it("古い世代の呼び出しは STALE", async () => {
  const gen = g.currentGen();
  g.bumpGen();
  expect(await auth.getAccessToken(gen)).toEqual({ ok: false, code: "STALE" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("configKey が違う認証状態は使わずに消す", async () => {
  local()._data.authRefresh = { refreshToken: "r1", configKey: "old" };
  session()._data.authSession = { accessToken: "a1", expiresAt: Date.now() + 3_600_000, configKey: "old" };
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
});

it("未設定なら NOT_CONFIGURED", async () => {
  local()._data.settings = { autoOpen: true, webPush: true, connectionType: "server" };
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "NOT_CONFIGURED" });
});

it("authRefresh が無ければ LOGIN_REQUIRED", async () => {
  delete local()._data.authRefresh;
  expect(await auth.getAccessToken(g.currentGen())).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("storage の例外でも throw しない", async () => {
  (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
  expect(await auth.getAccessToken(g.currentGen())).toMatchObject({ ok: false });
});

it("getAuthStatus", async () => {
  const contains = chrome.permissions.contains as ReturnType<typeof vi.fn>;
  expect(await auth.getAuthStatus()).toEqual({
    configured: true,
    permitted: true,
    state: "LOGGED_IN",
    loginInProgress: false,
    notice: null,
  });
  expect(contains).toHaveBeenCalledWith({ origins: ["https://api.test/*", "https://auth.test/*", "https://img.test/*"] });

  delete local()._data.authRefresh;
  session()._data.authNotice = { code: "REFRESH_FAILED", at: Date.now() };
  session()._data.authAttempt = { state: "s", verifier: "v", redirectUri: "x", configKey: KEY, startedAt: Date.now() - 9 * 60_000 };
  contains.mockResolvedValue(false);
  expect(await auth.getAuthStatus()).toEqual({
    configured: true,
    permitted: false,
    state: "LOGIN_REQUIRED",
    loginInProgress: true,
    notice: "REFRESH_FAILED",
  });

  session()._data.authNotice = { code: "LOGGED_OUT", at: Date.now() };
  (session()._data.authAttempt as { startedAt: number }).startedAt = Date.now() - 11 * 60_000;
  expect(await auth.getAuthStatus()).toMatchObject({ state: "LOGGED_OUT", loginInProgress: false, notice: "LOGGED_OUT" });

  local()._data.settings = { autoOpen: true, webPush: true, connectionType: "server" };
  expect(await auth.getAuthStatus()).toMatchObject({ configured: false, permitted: false, state: "LOGGED_OUT" });
});

it("clearAuth は authSession・authRefresh・refreshPending を消す", async () => {
  session()._data.authSession = { accessToken: "a1", expiresAt: 0, configKey: KEY };
  session()._data.refreshPending = { refreshTokenHash: "h", firstSentAt: 0 };
  session()._data.authNotice = { code: "LOGGED_OUT", at: 0 };
  await auth.authLock(() => auth.clearAuth());
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
  expect(session()._data.refreshPending).toBeUndefined();
  expect(session()._data.authNotice).toBeDefined();
});
