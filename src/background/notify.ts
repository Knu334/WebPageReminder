import type { Reminder } from "@/types/types";
import { loadSettings } from "@/utils/config";
import { getNotifiedIds, markNotified, readCache } from "./cache";
import { currentGen } from "./gen";
import { hideOnServer } from "./sync";

type Shown = Pick<Reminder, "title" | "url" | "autoOpen" | "webPush">;

const opened = new Set<string>();

const show = async (id: string, r: Shown) => {
  // Web Push通知
  if (r.webPush) {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "/icons/icon48.png",
      title: r.title,
      message: r.url,
      requireInteraction: true,
    });
  }
  // 自動でタブを開く
  if (r.autoOpen) await chrome.tabs.create({ url: r.url, active: true });
};

const localReminders = async (): Promise<Reminder[]> =>
  ((await chrome.storage.local.get("reminders")).reminders as Reminder[] | undefined) ?? [];

async function localAlarm(id: string) {
  const reminders = await localReminders();
  const reminder = reminders.find((r) => r.id.toString() === id);
  if (!reminder) {
    console.log("Reminder not found.");
    return;
  }
  await show(id, reminder);
  // リマインダーを削除
  reminder.hidden = true;
  reminder.thumbnail = "";
  await chrome.storage.local.set({ reminders });
}

async function serverAlarm(gen: number, id: string) {
  const d = (await readCache()).items.find((i) => i.id === id);
  if (!d || d.hidden || (await getNotifiedIds()).has(id) || !(Date.parse(d.reminderTime) < Date.now() + 60_000)) return;
  // 長い同期を待たずに再通知を防ぐ（重複より欠落を選ぶ）
  await markNotified(id);
  await show(id, d);
  try {
    const r = await hideOnServer(gen, id);
    if (!r.ok && r.code !== "STALE") console.error("hide failed", r.code, r.status);
  } catch (e) {
    console.error("hide failed", (e as Error)?.name);
  }
}

export async function handleAlarm(id: string): Promise<void> {
  // 重複実行を防ぐ
  if (opened.has(id)) {
    console.log("Already processed this alarm");
    return;
  }
  opened.add(id);
  const gen = currentGen();
  try {
    if ((await loadSettings()).connectionType === "server") await serverAlarm(gen, id);
    else await localAlarm(id);
  } catch (e) {
    console.error("Error processing alarm:", (e as Error)?.name);
  } finally {
    setTimeout(() => opened.delete(id), 5000);
  }
}

export async function handleNotificationClick(id: string): Promise<void> {
  try {
    const list: Pick<Reminder, "id" | "url">[] =
      (await loadSettings()).connectionType === "server" ? (await readCache()).items : await localReminders();
    const reminder = list.find((r) => r.id === id);
    if (reminder) {
      await chrome.tabs.create({ url: reminder.url });
      await chrome.notifications.clear(id);
    }
  } catch (e) {
    console.error("Error processing notification click:", (e as Error)?.name);
  }
}
