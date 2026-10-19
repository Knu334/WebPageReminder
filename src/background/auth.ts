import type { AuthNoticeCode, AuthStatus, Fail } from "@/types/types";
import { configKey, isConfigured, loadSettings, originPatterns } from "@/utils/config";
import type { TokenResult } from "./api";
import { isCurrent, signalFor } from "./gen";
import { sha256Hex } from "./pkce";
import { createSerial } from "./serial";

type AuthSession = { accessToken: string; expiresAt: number; configKey: string };
type AuthRefresh = { refreshToken: string; configKey: string };
type RefreshPending = { refreshTokenHash: string; firstSentAt: number };
type AuthAttempt = { startedAt: number };
type AuthNotice = { code: AuthNoticeCode; at: number };

const STALE: Fail = { ok: false, code: "STALE" };
const NETWORK: Fail = { ok: false, code: "NETWORK" };
const LOGIN_REQUIRED: Fail = { ok: false, code: "LOGIN_REQUIRED" };
const REFRESH_MARGIN = 30_000;
const ATTEMPT_TTL = 10 * 60_000;
const RETRY_GRACE = 10_000;
const RETRY_DELAYS = [500, 1_000];
const FATAL_ERRORS = ["invalid_grant", "invalid_client", "unauthorized_client"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 認証状態（authAttempt・authSession・authRefresh・authNotice・refreshPending）の読み書きはすべてこの中で行う
export const authLock = createSerial();

export const clearAuth = async (): Promise<void> => {
  await chrome.storage.local.remove("authRefresh");
  await chrome.storage.session.remove(["authSession", "refreshPending"]);
};

const setNotice = (code: AuthNoticeCode) => chrome.storage.session.set({ authNotice: { code, at: Date.now() } });

// authLock の中で呼ぶ: 確定した refresh の失敗
const refreshFailed = async (): Promise<Fail> => {
  await clearAuth();
  await setNotice("REFRESH_FAILED");
  return LOGIN_REQUIRED;
};

const validTokens = (b: unknown): b is { access_token: string; refresh_token: string; expires_in: number } => {
  const t = b as Record<string, unknown> | null;
  return (
    !!t &&
    typeof t.access_token === "string" &&
    typeof t.refresh_token === "string" &&
    t.token_type === "Bearer" &&
    typeof t.expires_in === "number" &&
    t.expires_in > 0
  );
};

async function refresh(gen: number, authBaseUrl: string, clientId: string, key: string): Promise<TokenResult> {
  const rt = await authLock(async (): Promise<string | Fail> => {
    if (!isCurrent(gen)) return STALE;
    const { authRefresh: r } = (await chrome.storage.local.get("authRefresh")) as { authRefresh?: AuthRefresh };
    if (r && r.configKey === key && typeof r.refreshToken === "string") return r.refreshToken;
    if (r) await clearAuth();
    return LOGIN_REQUIRED;
  });
  if (typeof rt !== "string") return rt;
  const hash = await sha256Hex(rt);

  for (let i = 0; ; i++) {
    const firstSentAt = await authLock(async (): Promise<number | Fail> => {
      if (!isCurrent(gen)) return STALE;
      const { refreshPending: p } = (await chrome.storage.session.get("refreshPending")) as { refreshPending?: RefreshPending };
      const now = Date.now();
      if (p?.refreshTokenHash === hash) return now - p.firstSentAt > RETRY_GRACE ? refreshFailed() : p.firstSentAt;
      await chrome.storage.session.set({ refreshPending: { refreshTokenHash: hash, firstSentAt: now } });
      return now;
    });
    if (typeof firstSentAt !== "number") return firstSentAt;

    let res: Response;
    let text: string;
    try {
      res = await fetch(`${authBaseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: rt }),
        signal: AbortSignal.any([AbortSignal.timeout(4_000), signalFor(gen)]),
      });
      text = await res.text();
    } catch {
      // 結果が不明: refreshPending を残し、猶予の10秒の中でだけ再送する
      if (!isCurrent(gen)) return STALE;
      const d = RETRY_DELAYS[i];
      if (d === undefined || Date.now() + d - firstSentAt > RETRY_GRACE) return NETWORK;
      await sleep(d);
      continue;
    }

    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // HTML や空の body
    }
    const status = res.status;
    const done = await authLock(async (): Promise<TokenResult | null> => {
      if (!isCurrent(gen)) return STALE;
      await chrome.storage.session.remove("refreshPending");
      if (status >= 200 && status < 300) {
        if (!validTokens(body)) return refreshFailed();
        await chrome.storage.local.set({ authRefresh: { refreshToken: body.refresh_token, configKey: key } });
        await chrome.storage.session.set({
          authSession: { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, configKey: key },
        });
        return { ok: true, token: body.access_token };
      }
      if (status === 400 && FATAL_ERRORS.includes(String((body as { error?: unknown } | null)?.error))) return refreshFailed();
      return null;
    });
    if (done) return done;
    console.error("refresh failed", status);
    if (status >= 500 && i < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[i]);
      continue;
    }
    return NETWORK;
  }
}

const inflight = new Map<number, Promise<TokenResult>>();

export async function getAccessToken(gen: number, opts: { force?: boolean } = {}): Promise<TokenResult> {
  try {
    if (!isCurrent(gen)) return STALE;
    const s = await loadSettings();
    if (!isConfigured(s)) return { ok: false, code: "NOT_CONFIGURED" };
    const key = configKey(s);
    if (!opts.force) {
      const token = await authLock(async () => {
        const { authSession: a } = (await chrome.storage.session.get("authSession")) as { authSession?: AuthSession };
        if (!a) return null;
        if (a.configKey !== key) {
          if (isCurrent(gen)) await chrome.storage.session.remove("authSession");
          return null;
        }
        return a.expiresAt - Date.now() > REFRESH_MARGIN ? a.accessToken : null;
      });
      if (token) return isCurrent(gen) ? { ok: true, token } : STALE;
    }
    let p = inflight.get(gen);
    if (!p) {
      p = refresh(gen, s.authBaseUrl, s.clientId, key)
        .catch(() => NETWORK)
        .finally(() => inflight.delete(gen));
      inflight.set(gen, p);
    }
    return await p;
  } catch {
    return NETWORK;
  }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const s = await loadSettings();
  const configured = isConfigured(s);
  const permitted = configured && (await chrome.permissions.contains({ origins: originPatterns(s) }));
  return authLock(async () => {
    const { authRefresh } = (await chrome.storage.local.get("authRefresh")) as { authRefresh?: AuthRefresh };
    const { authAttempt, authNotice } = (await chrome.storage.session.get(["authAttempt", "authNotice"])) as {
      authAttempt?: AuthAttempt;
      authNotice?: AuthNotice;
    };
    const loggedIn = configured && !!authRefresh && authRefresh.configKey === configKey(s);
    return {
      configured,
      permitted,
      state: loggedIn ? "LOGGED_IN" : authNotice?.code === "REFRESH_FAILED" ? "LOGIN_REQUIRED" : "LOGGED_OUT",
      loginInProgress: !!authAttempt && Date.now() - authAttempt.startedAt < ATTEMPT_TTL,
      notice: authNotice?.code ?? null,
    };
  });
}
