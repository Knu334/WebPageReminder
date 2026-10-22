import { Reminder, SettingsType } from "@/types/types";

// 前月の同じ日時。同じ日が無ければ前月の末日
export const oneMonthBefore = (now: Date): Date => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - 1);
  if (d.getDate() !== now.getDate()) d.setDate(0);
  return d;
};

export const removeOldReminders = (reminders: Reminder[]): Reminder[] => {
  const baseTime = new Date();

  // 現在時刻を過ぎたリマンダーに非表示フラグを設定
  for (const r of reminders) {
    if (new Date(r.reminderTime).getTime() < baseTime.getTime()) {
      r.thumbnail = "";
      r.hidden = true;
    }
  }

  // 非表示にしたリマインダーのパージ
  const limit = oneMonthBefore(baseTime).getTime();
  reminders = reminders.filter((r) => new Date(r.reminderTime).getTime() >= limit);

  return reminders;
};

export const captureVisibleTab = async (): Promise<string> => {
  if (!chrome.tabs) return "";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab.id) return "";

    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: "jpeg",
      quality: 50,
    });
    return dataUrl;
  } catch (error) {
    console.error("Failed to capture tab:", error);
    return "";
  }
};

export const createZeroSecCurrentDate = (): Date => {
  const current = new Date();
  current.setSeconds(0);
  current.setMilliseconds(0);
  return current;
};

export const DEFAULT_SETTINGS = {
  autoOpen: true,
  webPush: false,
  connectionType: "local",
  theme: "system",
  apiBaseUrl: "",
  authBaseUrl: "",
  clientId: "",
  imageHost: "",
} as const satisfies SettingsType;