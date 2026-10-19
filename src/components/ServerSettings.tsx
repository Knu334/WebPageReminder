import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { errorText, send } from "@/utils/bg";
import { normalizeConfig, originPatterns } from "@/utils/config";
import type { Message } from "@/types/messages";
import type { AuthStatus, Fail, ServerConfig, SettingsType } from "@/types/types";

const FIELDS: { key: keyof ServerConfig; label: string }[] = [
  { key: "apiBaseUrl", label: "API base URL" },
  { key: "authBaseUrl", label: "Auth base URL" },
  { key: "clientId", label: "Client ID" },
  { key: "imageHost", label: "Image host" },
];

const NOTICE: Partial<Record<string, string>> = {
  REVOKE_FAILED: "ログアウトしたが、server 側の失効は未完了（通信障害）",
  LOGOUT_PAGE_FAILED: "Cognito のログインの記録が残っている可能性がある",
};

const stateText = (s: AuthStatus): string =>
  !s.configured
    ? "未設定"
    : !s.permitted
      ? "許可なし"
      : s.loginInProgress
        ? "ログイン処理中"
        : s.state === "LOGGED_IN"
          ? "ログイン中"
          : s.state === "LOGIN_REQUIRED"
            ? "要再ログイン"
            : "未ログイン";

export const ServerSettings: React.FC<{
  settings: SettingsType;
  onSaved: (c: ServerConfig) => void;
  markDisconnected: () => void;
  ensureFresh: () => Promise<void>;
}> = ({ settings, onSaved, markDisconnected, ensureFresh }) => {
  const [input, setInput] = useState<ServerConfig>(() => ({
    apiBaseUrl: settings.apiBaseUrl,
    authBaseUrl: settings.authBaseUrl,
    clientId: settings.clientId,
    imageHost: settings.imageHost,
  }));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ServerConfig, string>>>({});
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async <T,>(msg: Message): Promise<T | Fail> => {
    const r = await send<T>(msg);
    const f = r as Fail;
    if (f.ok === false) {
      if (f.code === "NETWORK") markDisconnected();
      setError(errorText(f.code, f.status));
    }
    return r;
  };

  const loadStatus = async () => {
    const r = await call<AuthStatus>({ type: "auth/status" });
    if (!("ok" in r)) setStatus(r);
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 許可の dialog で popup が閉じることがある。その時は次に開いた時の「許可する」ボタンで求め直す
  const requestPermission = async (c: ServerConfig) => {
    try {
      await chrome.permissions.request({ origins: originPatterns(c) });
    } catch (e) {
      console.error("permissions.request failed", (e as Error)?.name);
    }
    await loadStatus();
  };

  const handleSave = async () => {
    setError(null);
    const n = normalizeConfig(input);
    if (!n.ok) {
      setFieldErrors(n.errors);
      return;
    }
    setFieldErrors({});
    await ensureFresh();
    const r = await call<{ ok: true }>({ type: "config/save", config: n.config });
    if (!r.ok) return;
    setInput(n.config);
    onSaved(n.config);
    await requestPermission(n.config);
  };

  const handleAuth = async (type: "auth/login" | "auth/logout") => {
    setError(null);
    await ensureFresh();
    await call<{ ok: true }>({ type });
    await loadStatus();
  };

  const saved: ServerConfig = {
    apiBaseUrl: settings.apiBaseUrl,
    authBaseUrl: settings.authBaseUrl,
    clientId: settings.clientId,
    imageHost: settings.imageHost,
  };
  const ready = status?.configured && status.permitted;

  return (
    <div className="space-y-4">
      {FIELDS.map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <Label htmlFor={key}>{label}</Label>
          <Input
            id={key}
            value={input[key]}
            onChange={(e) => setInput((cur) => ({ ...cur, [key]: e.target.value }))}
          />
          {fieldErrors[key] && <Label className="text-red-500">{fieldErrors[key]}</Label>}
        </div>
      ))}
      <Button onClick={handleSave} className="w-full">
        保存
      </Button>

      {status && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>状態: {stateText(status)}</Label>
            {status.configured && !status.permitted && (
              <Button onClick={() => requestPermission(saved)}>許可する</Button>
            )}
            {ready && status.state === "LOGGED_IN" && (
              <Button onClick={() => handleAuth("auth/logout")}>ログアウト</Button>
            )}
            {ready && status.state !== "LOGGED_IN" && !status.loginInProgress && (
              <Button onClick={() => handleAuth("auth/login")}>ログイン</Button>
            )}
          </div>
          {status.notice && NOTICE[status.notice] && <Label className="block">{NOTICE[status.notice]}</Label>}
        </div>
      )}
      {error && <Label className="text-red-500">{error}</Label>}

      <div className="space-y-1">
        <Label htmlFor="callback-url">Callback URL</Label>
        <Input id="callback-url" readOnly value={chrome.identity.getRedirectURL("cognito")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="logout-url">Logout URL</Label>
        <Input id="logout-url" readOnly value={chrome.identity.getRedirectURL("logout")} />
      </div>
    </div>
  );
};
