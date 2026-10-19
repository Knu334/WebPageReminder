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
const REDIRECT = "https://test-ext-id.chromiumapp.org/cognito";
const fetchMock = vi.fn();
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const okBody = { access_token: "a1", refresh_token: "r1", token_type: "Bearer", expires_in: 3600 };
const local = () => chrome.storage.local as unknown as { _data: Record<string, unknown>; set: ReturnType<typeof vi.fn> };
const session = () => chrome.storage.session as unknown as { _data: Record<string, unknown>; set: ReturnType<typeof vi.fn> };
const flow = () => chrome.identity.launchWebAuthFlow as unknown as ReturnType<typeof vi.fn>;
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;
// 渡された URL の state で callback を返す
const flowCalled = async () => {
  while (!flow().mock.calls.length) await new Promise((r) => setTimeout(r, 0));
};
const callback = (extra = "code=c1", base = REDIRECT) =>
  flow().mockImplementation(async ({ url }: { url: string }) => `${base}?${extra}&state=${stateOf(url)}`);

beforeEach(async () => {
  vi.resetModules();
  g = await import("@/background/gen");
  auth = await import("@/background/auth");
  pkce = await import("@/background/pkce");
  local()._data.settings = { autoOpen: true, webPush: true, connectionType: "server", ...CFG };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

it("R-LOGIN-06 R-LOGIN-05: authorize の URL", async () => {
  callback();
  fetchMock.mockResolvedValue(res(200, okBody));
  await auth.login(g.currentGen());
  const [[arg]] = flow().mock.calls;
  expect(arg.interactive).toBe(true);
  const u = new URL(arg.url);
  expect(u.origin + u.pathname).toBe("https://auth.test/oauth2/authorize");
  const p = Object.fromEntries(u.searchParams);
  expect(p).toEqual({
    response_type: "code",
    client_id: "abc123",
    redirect_uri: REDIRECT,
    scope: "openid reminder-api/read reminder-api/write",
    state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: "S256",
  });
});

it("R-LOGIN-08 R-LOGIN-09 R-LOGIN-10 R-LOGIN-05 R-STO-01 R-STO-04: code を交換して保存する", async () => {
  session()._data.authNotice = { code: "LOGIN_FAILED", at: 1 };
  callback();
  const order: string[] = [];
  local().set.mockImplementation(async (o: Record<string, unknown>) => {
    order.push(...Object.keys(o));
    Object.assign(local()._data, o);
  });
  session().set.mockImplementation(async (o: Record<string, unknown>) => {
    order.push(...Object.keys(o));
    Object.assign(session()._data, o);
  });
  fetchMock.mockResolvedValue(res(200, okBody));
  const gen = g.currentGen();
  const r = await auth.login(gen);
  expect(r).toEqual({ ok: true, gen: gen + 1 });
  expect(g.currentGen()).toBe(gen + 1);

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://auth.test/oauth2/token");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
  const form = Object.fromEntries(new URLSearchParams(String(init.body)));
  expect(form).toEqual({
    grant_type: "authorization_code",
    client_id: "abc123",
    code: "c1",
    redirect_uri: REDIRECT,
    code_verifier: expect.any(String),
  });
  const challenge = new URL(flow().mock.calls[0][0].url).searchParams.get("code_challenge");
  expect(await pkce.codeChallenge(form.code_verifier)).toBe(challenge);

  expect(order.filter((k) => k === "authRefresh" || k === "authSession")).toEqual(["authRefresh", "authSession"]);
  expect(local()._data.authRefresh).toEqual({ refreshToken: "r1", configKey: KEY });
  expect(session()._data.authSession).toMatchObject({ accessToken: "a1", configKey: KEY });
  expect(session()._data.authNotice).toBeUndefined();
  expect(session()._data.authAttempt).toBeUndefined();
});

it.each([
  ["reject", () => flow().mockRejectedValue(new Error("closed")), "LOGIN_CANCELLED"],
  ["undefined", () => flow().mockResolvedValue(undefined), "LOGIN_CANCELLED"],
  ["host 違い", () => callback("code=c1", "https://evil.test/cognito"), "LOGIN_FAILED"],
  ["path 違い", () => callback("code=c1", "https://test-ext-id.chromiumapp.org/logout"), "LOGIN_FAILED"],
  ["state 違い", () => flow().mockResolvedValue(`${REDIRECT}?code=c1&state=other`), "LOGIN_FAILED"],
  [
    "11分後",
    () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      flow().mockImplementation(async ({ url }: { url: string }) => {
        vi.setSystemTime(Date.now() + 11 * 60_000);
        return `${REDIRECT}?code=c1&state=${stateOf(url)}`;
      });
    },
    "LOGIN_FAILED",
  ],
  ["error=access_denied", () => callback("error=access_denied&code=c1"), "LOGIN_FAILED"],
  ["code 無し", () => callback("x=1"), "LOGIN_FAILED"],
])("R-LOGIN-07 R-STO-03: 交換しない callback: %s", async (_, setup, code) => {
  setup();
  expect(await auth.login(g.currentGen())).toEqual({ ok: false, code });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(session()._data.authAttempt).toBeUndefined();
  expect((session()._data.authNotice as { code: string }).code).toBe(code);
  expect(local()._data.authRefresh).toBeUndefined();
});

it.each([
  ["token_type 小文字", { ...okBody, token_type: "bearer" }],
  ["expires_in 0", { ...okBody, expires_in: 0 }],
])("R-LOGIN-09: 応答の検証: %s", async (_, body) => {
  callback();
  fetchMock.mockResolvedValue(res(200, body));
  const gen = g.currentGen();
  expect(await auth.login(gen)).toEqual({ ok: false, code: "LOGIN_FAILED" });
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
  expect((session()._data.authNotice as { code: string }).code).toBe("LOGIN_FAILED");
  expect(g.currentGen()).toBe(gen);
});

it("R-LOGIN-08: 交換が 400 なら LOGIN_FAILED で、code を再送しない", async () => {
  callback();
  fetchMock.mockResolvedValue(res(400, { error: "invalid_grant" }));
  expect(await auth.login(g.currentGen())).toEqual({ ok: false, code: "LOGIN_FAILED" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("R-LOGIN-03: 同時の2回の login で試行は1つ", async () => {
  let resolve!: (v: string) => void;
  flow().mockImplementation(({ url }: { url: string }) => new Promise((r) => (resolve = () => r(`${REDIRECT}?code=c1&state=${stateOf(url)}`))));
  fetchMock.mockResolvedValue(res(200, okBody));
  const gen = g.currentGen();
  const p1 = auth.login(gen);
  await flowCalled();
  const r2 = await auth.login(gen);
  expect(r2).toEqual({ ok: false, code: "LOGIN_IN_PROGRESS" });
  expect(flow()).toHaveBeenCalledTimes(1);
  resolve("");
  expect(await p1).toEqual({ ok: true, gen: gen + 1 });
});

it("R-LOGIN-11 R-STO-02: 古い試行の finally が新しい試行を消さない", async () => {
  let reject!: () => void;
  flow().mockImplementation(() => new Promise((_, rj) => (reject = () => rj(new Error("closed")))));
  const p = auth.login(g.currentGen());
  await flowCalled();
  const other = { ...(session()._data.authAttempt as object), state: "newer" };
  session()._data.authAttempt = other;
  reject();
  expect(await p).toEqual({ ok: false, code: "LOGIN_CANCELLED" });
  expect(session()._data.authAttempt).toEqual(other);
});

it("R-LOGIN-10 R-GEN-01: logout 後に完了した login は保存しない", async () => {
  flow().mockImplementation(async ({ url }: { url: string }) => {
    g.bumpGen();
    return `${REDIRECT}?code=c1&state=${stateOf(url)}`;
  });
  fetchMock.mockResolvedValue(res(200, okBody));
  expect(await auth.login(g.currentGen())).toEqual({ ok: false, code: "STALE" });
  expect(local()._data.authRefresh).toBeUndefined();
  expect(session()._data.authSession).toBeUndefined();
  expect(session()._data.authAttempt).toBeUndefined();
});

it("R-LOGIN-02: 許可が無ければ NOT_CONFIGURED", async () => {
  (chrome.permissions.contains as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  expect(await auth.login(g.currentGen())).toEqual({ ok: false, code: "NOT_CONFIGURED" });
  expect(flow()).not.toHaveBeenCalled();
  expect(session()._data.authAttempt).toBeUndefined();
});
