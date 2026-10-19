import { isCurrent } from "./gen";
import { getNotifiedIds, readCache, toReminders } from "./cache";
import { loadSettings } from "@/utils/config";
import type { Reminder } from "@/types/types";

// queue の中から呼ぶこと
export const rebuildAlarms = async (gen: number): Promise<void> => {
  if (!isCurrent(gen)) return;
  const s = await loadSettings();
  let list: Reminder[];
  if (s.connectionType === "server") list = toReminders(await readCache(), await getNotifiedIds());
  else list = ((await chrome.storage.local.get("reminders")).reminders as Reminder[] | undefined) ?? [];
  if (!isCurrent(gen)) return;
  await chrome.alarms.clearAll();
  const now = Date.now();
  for (const r of list) {
    const when = new Date(r.reminderTime).getTime();
    if (r.hidden || !(when > now)) continue;
    if (!isCurrent(gen)) return;
    await chrome.alarms.create(r.id, { when });
  }
};

export const clearServerAlarms = async (gen: number): Promise<void> => {
  if (!isCurrent(gen)) return;
  if ((await loadSettings()).connectionType === "server") await chrome.alarms.clearAll();
};
