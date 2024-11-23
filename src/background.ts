import { Reminder } from "@/types/types";
import { ReminderUtils } from "@/utils/ReminderUtils";

const openedReminders = new Set();

const NO_DATA = {
  id: "Nodata",
  url: "Nodata",
  title: "Nodata",
  thumbnail: "/assets/no-data.png",
  reminderTime: "9999-12-31 23:59:59",
  autoOpen: false,
  webPush: false,
  createdAt: new Date().toISOString(),
  hidden: false,
} as const satisfies Reminder;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    // 重複実行を防ぐ
    if (openedReminders.has(alarm.name)) {
      console.log("Already processed this alarm");
      return;
    }
    openedReminders.add(alarm.name);

    const data = await chrome.storage.local.get(["reminders", "settings"]);
    let reminders: Reminder[];
    const settings = data.settings || {
      connectionType: "local",
      url: "http://localhost:3000",
    };
    const utils = new ReminderUtils(settings.url);

    if (settings.connectionType === "local") {
      reminders = data.reminders || [];
    } else {
      reminders = await utils.getRemoteReminders();
    }

    const reminder = reminders.find(
      (r: Reminder) => r.id.toString() === alarm.name
    );

    if (!reminder) {
      console.log("Reminder not found.");
      // 処理済みセットからも削除
      setTimeout(() => {
        openedReminders.delete(alarm.name);
      }, 5000);
      return;
    }

    // Web Push通知
    if (reminder.webPush) {
      await chrome.notifications.create(alarm.name, {
        type: "basic",
        iconUrl: "/icons/icon48.png",
        title: reminder.title,
        message: reminder.url,
        requireInteraction: true,
      });
    }

    // 自動でタブを開く
    if (reminder.autoOpen) {
      await chrome.tabs.create({
        url: reminder.url,
        active: true,
      });
    }

    // リマインダーを削除
    reminder.hidden = true;
    reminder.thumbnail = "";
    // reminders = reminders.filter((r) => r.id !== reminder.id);
    // reminders = [...reminders, reminder];

    const activeReminder = reminders.find(
      (r) => r.id !== NO_DATA.id && !r.hidden
    );

    if (!activeReminder) {
      reminders = [...reminders, NO_DATA];
    }

    if (settings.connectionType === "local") {
      await chrome.storage.local.set({ reminders: reminders });
    } else {
      await utils.setRemoteReminders(reminders);
    }

    // 処理済みセットからも削除
    setTimeout(() => {
      openedReminders.delete(alarm.name);
    }, 5000);
  } catch (error) {
    console.error("Error processing alarm:", error);
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const data = await chrome.storage.local.get("reminders");
  const reminders: Reminder[] = data.reminders || [];

  const reminder = reminders.find((r) => r.id === notificationId);
  if (reminder) {
    chrome.tabs.create({ url: reminder.url });
    chrome.notifications.clear(notificationId);
  }
});

// 拡張機能インストール/更新時の初期化
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // 既存のアラームをすべてクリア
    await chrome.alarms.clearAll();

    // 保存されているリマインダーを取得して再設定
    const data = await chrome.storage.local.get("reminders");
    const reminders: Reminder[] = data.reminders || [];

    for (const reminder of reminders) {
      const reminderTime = new Date(reminder.reminderTime);
      if (reminderTime.getTime() > Date.now()) {
        await chrome.alarms.create(reminder.id.toString(), {
          when: reminderTime.getTime(),
        });
      }
    }
  } catch (error) {
    console.error("Error during initialization:", error);
  }
});
