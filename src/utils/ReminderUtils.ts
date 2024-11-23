import { Reminder, StoragePayloadType } from "@/types/types";
import axios, { AxiosInstance, CreateAxiosDefaults } from "axios";

export class ReminderUtils {
  private axiosBase: AxiosInstance;

  constructor(baseUrl: string) {
    const axiosConfig: CreateAxiosDefaults = {
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      responseType: "json",
    };
    axiosConfig.baseURL = baseUrl;
    this.axiosBase = axios.create(axiosConfig);
  }

  private getUserId = async (): Promise<string> => {
    if (!chrome.identity) return "dummy";

    const userInfo = await chrome.identity.getProfileUserInfo({
      accountStatus: chrome.identity.AccountStatus.ANY,
    });
    return userInfo.id;
  };

  public getRemoteReminders = async (): Promise<Reminder[]> => {
    const response = await this.axiosBase.post("/reminders", {
      key: await this.getUserId(),
    });
    const remoteReminders: Reminder[] = response.data || [];
    return remoteReminders;
  };

  public setRemoteReminders = async (reminders: Reminder[]) => {
    const payload: StoragePayloadType = {
      key: await this.getUserId(),
      reminders: reminders,
    };
    this.axiosBase.put("/reminders", payload);
  };
}

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
  if (baseTime.getMonth() - 1 < 0) {
    baseTime.setFullYear(baseTime.getFullYear() - 1);
    baseTime.setMonth(11);
  } else {
    baseTime.setMonth(baseTime.getMonth() - 1);
  }

  reminders = reminders.filter((r) => {
    return new Date(r.reminderTime).getTime() > baseTime.getTime();
  });

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
