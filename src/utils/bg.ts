import type { Message } from "@/types/messages";
import type { Fail } from "@/types/types";

// worker の停止などで channel が切れたら reject される。それを NETWORK にする
export const send = <T>(msg: Message): Promise<T | Fail> =>
  chrome.runtime.sendMessage(msg).then(
    (r) => r as T,
    (): Fail => ({ ok: false, code: "NETWORK" }),
  );

const NETWORK_TEXT = "通信できません。時間をおいて再度お試しください";
const RATE_TEXT = "操作が多すぎます。しばらく待ってください";
const TEXT = new Map<string, string>(Object.entries({
  NOT_CONFIGURED: "接続先を設定してください",
  LOGIN_REQUIRED: "ログインしてください",
  UNAUTHORIZED: "ログインしてください",
  LOGIN_IN_PROGRESS: "ログインの処理中です",
  CONFLICT: "別の端末で変更されています。最新の内容を確認して、もう一度操作してください",
  NETWORK: NETWORK_TEXT,
  SERVICE_UNAVAILABLE: NETWORK_TEXT,
  UNKNOWN_RESULT: NETWORK_TEXT,
  OWNER_RATE_LIMIT_EXCEEDED: RATE_TEXT,
  HTTP_429: RATE_TEXT,
  OWNER_STORAGE_LIMIT_EXCEEDED: "保存できる上限（1000件・画像 128 MiB）を超えています",
}));

// STALE は設定やログインが変わって古い操作をやめただけなので表示しない
export const errorText = (code: string, status?: number): string | null => {
  if (code === "STALE") return null;
  if (status === 429) return RATE_TEXT;
  const t = TEXT.get(code);
  if (t) return t;
  if (status === 403) return `権限がありません（${code}）`;
  return `エラー（${code}）`;
};

// send して、失敗なら error を出す。NETWORK は切断として印を付ける（次の操作の前に読み直す）
export const makeCall =
  (setError: (t: string | null) => void, markDisconnected: () => void) =>
  async <T>(msg: Message): Promise<T | Fail> => {
    const r = await send<T>(msg);
    const f = r as Fail;
    if (f.ok === false) {
      if (f.code === "NETWORK") markDisconnected();
      setError(errorText(f.code, f.status));
    }
    return r;
  };
