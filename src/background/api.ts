import type { Fail, ReminderDto } from "@/types/types";
import { isCurrent, signalFor } from "./gen";

export type TokenResult = { ok: true; token: string } | Fail;
export type ApiResult<T> = { ok: true; status: number; data: T; etag: string | null } | Fail;

export interface ApiDeps {
  baseUrl: string;
  gen: number;
  getToken: (gen: number, opts?: { force?: boolean }) => Promise<TokenResult>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type CreateBody = {
  id: string;
  url: string;
  title: string;
  reminderTime: string;
  autoOpen: boolean;
  webPush: boolean;
  hidden: false;
  thumbnail: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const STALE: Fail = { ok: false, code: "STALE" };

export function createApi(deps: ApiDeps) {
  const { baseUrl, gen, getToken } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  async function request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; ifMatch?: string } = {},
  ): Promise<ApiResult<T>> {
    const isGet = method === "GET";
    const netFail: Fail = { ok: false, code: isGet ? "NETWORK" : "UNKNOWN_RESULT" };
    let refreshed = false;
    let forceNext = false;
    let retries429 = 0;
    let retriesNet = 0;

    for (;;) {
      if (!isCurrent(gen)) return STALE;
      const t = await (forceNext ? getToken(gen, { force: true }) : getToken(gen));
      forceNext = false;
      if (!t.ok) return t;
      if (!isCurrent(gen)) return STALE;

      const headers: Record<string, string> = { Authorization: `Bearer ${t.token}` };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.ifMatch !== undefined) headers["If-Match"] = opts.ifMatch;

      let res: Response;
      let text: string;
      try {
        res = await fetch(baseUrl + path, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.any([AbortSignal.timeout(10_000), signalFor(gen)]),
        });
        text = await res.text();
      } catch {
        if (!isCurrent(gen)) return STALE;
        if (isGet && retriesNet < 2) {
          await sleep(500 * 2 ** retriesNet++ + random() * 250);
          continue;
        }
        return netFail;
      }
      if (!isCurrent(gen)) return STALE;

      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        // Gateway の HTML など。2xx なら壊れた応答、それ以外は HTTP_<status> で返す
        if (res.ok) return { ok: false, code: "BAD_RESPONSE", status: res.status };
      }
      const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

      if (res.ok) return { ok: true, status: res.status, data: body as T, etag: res.headers.get("ETag") };

      if (res.status === 401) {
        if (!refreshed) {
          refreshed = forceNext = true;
          continue;
        }
        return { ok: false, code: "UNAUTHORIZED", status: 401 };
      }
      if (res.status === 429 && retries429 < 2) {
        retries429++;
        const ra = Number(res.headers.get("Retry-After"));
        await sleep((Number.isFinite(ra) && ra > 0 ? ra : 1) * 1000 + random() * 1000);
        continue;
      }
      if (res.status === 503) {
        if (isGet && retriesNet < 2) {
          await sleep(500 * 2 ** retriesNet++ + random() * 250);
          continue;
        }
        if (!isGet) return netFail;
      }
      const fail: Fail = {
        ok: false,
        code: typeof b.code === "string" ? b.code : `HTTP_${res.status}`,
        status: res.status,
      };
      if (typeof b.message === "string") fail.message = b.message;
      return fail;
    }
  }

  const rid = (id: string) => `/v2/reminders/${encodeURIComponent(id)}`;
  return {
    listPage: (cursor: string | null) =>
      request<{ items: ReminderDto[]; nextCursor: string | null }>(
        "GET",
        `/v2/reminders?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    getReminder: (id: string) => request<ReminderDto>("GET", rid(id)),
    createReminder: (body: CreateBody) => request<ReminderDto>("POST", "/v2/reminders", { body }),
    patchReminder: (id: string, patch: { hidden: true; thumbnail: null }, etag: string) =>
      request<ReminderDto>("PATCH", rid(id), { body: patch, ifMatch: etag }),
    deleteReminder: (id: string, etag: string) =>
      request<{ id: string; deleted: true; revision: number }>("DELETE", rid(id), { ifMatch: etag }),
    getThumbnailUrl: (id: string) =>
      request<{ url: string; expiresAt: string; imageId: string; revision: number }>("GET", `${rid(id)}/thumbnail-url`),
  };
}
