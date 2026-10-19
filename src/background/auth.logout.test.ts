import { it, expect, beforeEach, vi } from "vitest";

let g: typeof import("@/background/gen");
let auth: typeof import("@/background/auth");

const CFG = {
  apiBaseUrl: "https://api.test",
  authBaseUrl: "https://auth.test",
  clientId: "abc123",
  imageHost: "https://img.test",
};
const KEY = [CFG.apiBaseUrl, CFG.authBaseUrl, CFG.clientId, CFG.imageHost].join(
  "|",
);
const REDIRECT = "https://test-ext-id.chromiumapp.org/cognito";
const fetchMock = vi.fn();
const res = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });
const okBody = {
  access_token: "a2",
  refresh_token: "r2",
  token_type: "Bearer",
  expires_in: 3600,
};
const local = () =>
  chrome.storage.local as unknown as {
    _data: Record<string, unknown>;
    set: ReturnType<typeof vi.fn>;
  };
const session = () =>
  chrome.storage.session as unknown as {
    _data: Record<string, unknown>;
    set: ReturnType<typeof vi.fn>;
  };
const flow = () =>
  chrome.identity.launchWebAuthFlow as unknown as ReturnType<typeof vi.fn>;
const notice = () =>
  (session()._data.authNotice as { code: string } | undefined)?.code;
// login の authorize には callback を返し、logout の page はそのまま閉じる
const flowOk = () =>
  flow().mockImplementation(async ({ url }: { url: string }) => {
    const u = new URL(url);
    return u.pathname === "/logout"
      ? "https://test-ext-id.chromiumapp.org/logout"
      : `${REDIRECT}?code=c1&state=${u.searchParams.get("state")}`;
  });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.resetModules();
  g = await import("@/background/gen");
  auth = await import("@/background/auth");
  local()._data.settings = {
    autoOpen: true,
    webPush: true,
    connectionType: "server",
    ...CFG,
  };
  local()._data.authRefresh = { refreshToken: "r1", configKey: KEY };
  session()._data.authSession = {
    accessToken: "a1",
    expiresAt: Date.now() + 3600_000,
    configKey: KEY,
  };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

it("R-LOGOUT-02 R-LOGOUT-06: revoke の form", async () => {
  const order: string[] = [];
  fetchMock.mockImplementation(async () => (order.push("revoke"), res(200)));
  const gen = g.currentGen();
  const clearLocal = vi.fn<(gen: number) => Promise<void>>(async () => void order.push("clear"));
  flow().mockImplementation(
    async () => (
      order.push("page"),
      "https://test-ext-id.chromiumapp.org/logout"
    ),
  );

  expect(await auth.logout(clearLocal)).toEqual({ revoked: true });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://auth.test/oauth2/revoke");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
    client_id: "abc123",
    token: "r1",
  });
  const [[arg]] = flow().mock.calls;
  expect(arg).toEqual({
    url: "https://auth.test/logout?client_id=abc123&logout_uri=https%3A%2F%2Ftest-ext-id.chromiumapp.org%2Flogout",
    interactive: true,
  });
  expect(clearLocal).toHaveBeenCalledTimes(1);
  expect(clearLocal).toHaveBeenCalledWith(gen + 1);
  expect(order).toEqual(["revoke", "clear", "page"]);
  expect(g.currentGen()).toBe(gen + 1);
  expect(notice()).toBe("LOGGED_OUT");
});

it.each([
  ["reject", () => fetchMock.mockRejectedValue(new TypeError("net"))],
  ["503", () => fetchMock.mockResolvedValue(res(503))],
])("R-LOGOUT-02 R-LOGOUT-05 R-STO-03: revoke が失敗しても端末の状態は消える: %s", async (_, setup) => {
  setup();
  flowOk();
  expect(await auth.logout(vi.fn(async () => {}))).toEqual({ revoked: false });
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
  expect(notice()).toBe("REVOKE_FAILED");
});

it("R-LOGOUT-04: logout page の失敗", async () => {
  fetchMock.mockResolvedValue(res(200));
  flow().mockRejectedValue(new Error("closed"));
  expect(await auth.logout(vi.fn(async () => {}))).toEqual({ revoked: true });
  expect(notice()).toBe("LOGOUT_PAGE_FAILED");
});

it("R-LOGOUT-02: refresh token が無ければ revoke を送らない", async () => {
  delete local()._data.authRefresh;
  flowOk();
  expect(await auth.logout(vi.fn(async () => {}))).toEqual({ revoked: true });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(notice()).toBe("LOGGED_OUT");
});

it("R-LOGOUT-01: logout の後の API は LOGIN_REQUIRED", async () => {
  fetchMock.mockResolvedValue(res(200));
  flowOk();
  await auth.logout(vi.fn(async () => {}));
  fetchMock.mockClear();
  expect(await auth.getAccessToken(g.currentGen())).toEqual({
    ok: false,
    code: "LOGIN_REQUIRED",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("R-LOGOUT-05 R-GEN-01: revoke 中に成功した新しい login を消さない", async () => {
  let resolveRevoke!: (r: Response) => void;
  // 本物の fetch と同じく signal の中断で reject する
  fetchMock.mockImplementationOnce(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((r, rj) => {
        resolveRevoke = r;
        init.signal?.addEventListener("abort", () =>
          rj(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  fetchMock.mockResolvedValue(res(200, okBody));
  flowOk();
  const p = auth.logout(vi.fn(async () => {}));
  while (!fetchMock.mock.calls.length) await tick();
  expect((await auth.login(g.currentGen())).ok).toBe(true);
  resolveRevoke(res(200));
  expect(await p).toEqual({ revoked: true });
  expect(local()._data.authRefresh).toEqual({
    refreshToken: "r2",
    configKey: KEY,
  });
  expect(session()._data.authSession).toMatchObject({ accessToken: "a2" });
  expect(session()._data.authNotice).toBeUndefined();
});

it("R-GEN-01 R-GEN-03: login の保存と logout の消去を交互にしても復活しない", async () => {
  delete local()._data.authRefresh;
  delete session()._data.authSession;
  fetchMock.mockResolvedValue(res(200, okBody));
  flowOk();
  let out: Promise<unknown> | undefined;
  local().set.mockImplementation(async (o: Record<string, unknown>) => {
    Object.assign(local()._data, o);
    // login の保存の途中で logout を割り込ませる
    if ("authRefresh" in o && !out) {
      out = auth.logout(vi.fn(async () => {}));
      await tick();
    }
  });
  expect((await auth.login(g.currentGen())).ok).toBe(true);
  await out;
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
});
