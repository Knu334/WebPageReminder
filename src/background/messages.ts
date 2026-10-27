import type { Message } from "@/types/messages";
import type { Fail, Reminder, ServerConfig } from "@/types/types";
import { configKey, loadSettings, normalizeConfig } from "@/utils/config";
import { authLock, clearAuth, getAuthStatus, login, logout } from "./auth";
import { rebuildAlarms, clearServerAlarms } from "./alarms";
import { clearServerCache, queue } from "./cache";
import { bumpGen, currentGen, isCurrent } from "./gen";
import { createOnServer, deleteOnServer, listReminders } from "./sync";

const OK = { ok: true } as const;
const INVALID: Fail = { ok: false, code: "INVALID_MESSAGE" };
const INTERNAL: Fail = { ok: false, code: "INTERNAL" };
const NOT_SERVER_MODE: Fail = { ok: false, code: "NOT_SERVER_MODE" };
const MAX_IMAGE = 1_048_576;

// 4項目だけを取り出す（他の field で settings を書き換えさせない）
const pickConfig = (c: ServerConfig): ServerConfig => ({
  apiBaseUrl: c.apiBaseUrl,
  authBaseUrl: c.authBaseUrl,
  clientId: c.clientId,
  imageHost: c.imageHost,
});

export const isTrustedSender = (sender: chrome.runtime.MessageSender): boolean =>
  sender.id === chrome.runtime.id && !!sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);

const cpLen = (s: string) => [...s].length;

// 1〜128 code point。制御文字（U+0000〜U+001F、U+007F〜U+009F）と対になっていない surrogate を含まない
export const isValidId = (id: unknown): id is string => {
  if (typeof id !== "string") return false;
  const cps = [...id].map((c) => c.codePointAt(0)!);
  return (
    cps.length >= 1 &&
    cps.length <= 128 &&
    cps.every((c) => c > 0x1f && !(c >= 0x7f && c <= 0x9f) && !(c >= 0xd800 && c <= 0xdfff))
  );
};

const isHttpUrl = (u: unknown): u is string => {
  if (typeof u !== "string" || cpLen(u) > 4096) return false;
  try {
    return ["http:", "https:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
};

const isTime = (t: unknown): t is string =>
  typeof t === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(t) && Number.isFinite(Date.parse(t));

// data URL なら decode 後の大きさを確かめる（それ以外は NO_DATA の path で、送る時に null になる）
const isThumbnail = (t: unknown): t is string => {
  if (typeof t !== "string") return false;
  if (!t.startsWith("data:")) return true;
  const b64 = t.slice(t.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0) <= MAX_IMAGE;
};

const isReminder = (r: unknown): r is Reminder => {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  return (
    isValidId(x.id) &&
    isHttpUrl(x.url) &&
    typeof x.title === "string" &&
    cpLen(x.title) <= 1024 &&
    isTime(x.reminderTime) &&
    typeof x.autoOpen === "boolean" &&
    typeof x.webPush === "boolean" &&
    isThumbnail(x.thumbnail)
  );
};

export function parseMessage(raw: unknown): { kind: "ok"; msg: Message } | { kind: "invalid" } | { kind: "unknown" } {
  if (!raw || typeof raw !== "object") return { kind: "unknown" };
  const m = raw as Record<string, unknown>;
  const ok = (msg: Message) => ({ kind: "ok" as const, msg });
  const check = (valid: boolean, msg: Message) => (valid ? ok(msg) : { kind: "invalid" as const });
  switch (m.type) {
    case "auth/status":
    case "auth/login":
    case "auth/logout":
    case "alarms/reset":
      return ok({ type: m.type });
    case "config/save": {
      const n = m.config && typeof m.config === "object" ? normalizeConfig(pickConfig(m.config as ServerConfig)) : null;
      return n?.ok ? ok({ type: m.type, config: n.config }) : { kind: "invalid" };
    }
    case "mode/change":
      return check(m.connectionType === "local" || m.connectionType === "server", {
        type: m.type,
        connectionType: m.connectionType as "local" | "server",
      });
    case "reminders/list":
      return check(m.fresh === undefined || typeof m.fresh === "boolean", { type: m.type, fresh: m.fresh as boolean });
    case "reminders/create":
      return check(isReminder(m.reminder), { type: m.type, reminder: m.reminder as Reminder });
    case "reminders/delete":
      return check(isValidId(m.id), { type: m.type, id: m.id as string });
    default:
      return { kind: "unknown" };
  }
}

// cache の消去は新しい世代の cache を消さない（clearServerCache が古い世代を拒む）
const clearLocal = (g: number) =>
  queue(async () => {
    if (await clearServerCache(g)) await clearServerAlarms(g);
  });

async function dispatch(msg: Message, gen: number): Promise<unknown> {
  switch (msg.type) {
    case "auth/status":
      return getAuthStatus();
    case "auth/login": {
      const r = await login(gen);
      if (!r.ok) return r;
      await clearLocal(r.gen);
      listReminders(r.gen, true).catch((e) => console.error("sync failed", (e as Error)?.name));
      return OK;
    }
    case "auth/logout":
      return { ok: true, revoked: (await logout(clearLocal)).revoked };
    case "config/save": {
      const n = normalizeConfig(pickConfig(msg.config));
      if (!n.ok) return INVALID;
      return queue(() =>
        authLock(async () => {
          const s = await loadSettings();
          await chrome.storage.local.set({ settings: { ...s, ...n.config } });
          if (configKey(s) !== configKey(n.config)) {
            const g = bumpGen();
            await clearAuth();
            if (await clearServerCache(g)) await clearServerAlarms(g);
          }
          return OK;
        }),
      );
    }
    case "mode/change":
      return queue(async () => {
        const s = await loadSettings();
        await chrome.storage.local.set({ settings: { ...s, connectionType: msg.connectionType } });
        bumpGen();
        await rebuildAlarms(currentGen());
        return OK;
      });
    case "alarms/reset": {
      const mode = (await loadSettings()).connectionType;
      return queue(async () => {
        if (isCurrent(gen) && (await loadSettings()).connectionType === mode) await rebuildAlarms(gen);
        return OK;
      });
    }
    default: {
      if ((await loadSettings()).connectionType !== "server")
        return msg.type === "reminders/list" ? { ...NOT_SERVER_MODE, reminders: [] } : NOT_SERVER_MODE;
      if (msg.type === "reminders/list") return listReminders(gen, !!msg.fresh);
      if (msg.type === "reminders/create") return createOnServer(gen, msg.reminder);
      return deleteOnServer(gen, msg.id);
    }
  }
}

// reject しない。想定外の例外は INTERNAL にする
export async function handleMessage(msg: Message): Promise<unknown> {
  const gen = currentGen();
  try {
    return await dispatch(msg, gen);
  } catch (e) {
    console.error("message failed", msg.type, (e as Error)?.name);
    if (msg.type !== "reminders/list") return INTERNAL;
    const reminders = await listReminders(gen, false).then((r) => r.reminders, () => []);
    return { ...INTERNAL, reminders };
  }
}
