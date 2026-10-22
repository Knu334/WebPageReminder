import { DEFAULT_SETTINGS } from "@/utils/ReminderUtils";
import type { ServerConfig, SettingsType } from "@/types/types";

const KEYS = ["apiBaseUrl", "authBaseUrl", "clientId", "imageHost"] as const;

const normalizeOrigin = (v: unknown): string | null => {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && u.pathname === "/" && !u.search && !u.hash ? u.origin : null;
  } catch {
    return null;
  }
};

export const normalizeConfig = (
  c: ServerConfig,
): { ok: true; config: ServerConfig } | { ok: false; errors: Partial<Record<keyof ServerConfig, string>> } => {
  const config = { ...c };
  const errors: Partial<Record<keyof ServerConfig, string>> = {};
  for (const k of KEYS) {
    if (k === "clientId") {
      if (typeof c.clientId !== "string" || !/^[a-z0-9]+$/.test(c.clientId)) errors.clientId = "小文字英数字で入力してください";
    } else {
      const o = normalizeOrigin(c[k]);
      if (o === null) errors[k] = "https の URL（path・query・hash なし）を入力してください";
      else config[k] = o;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, config };
};

export const configKey = (c: ServerConfig): string => KEYS.map((k) => c[k]).join("|");

export const isConfigured = (s: SettingsType): boolean => KEYS.every((k) => !!s[k]);

export const originPatterns = (c: ServerConfig): string[] =>
  [c.apiBaseUrl, c.authBaseUrl, c.imageHost].map((u) => new URL(u).origin + "/*");

export const loadSettings = async (): Promise<SettingsType> => {
  const { settings } = await chrome.storage.local.get("settings");
  const stored = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsType)[]) {
    if (typeof stored[k] === typeof DEFAULT_SETTINGS[k]) out[k] = stored[k];
  }
  if (out.connectionType !== "server") out.connectionType = "local";
  if (out.theme !== "light" && out.theme !== "dark") out.theme = "system";
  return out as unknown as SettingsType;
};
