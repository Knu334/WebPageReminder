import { Reminder } from "@/types/types";
import nodataImg from "@/resources/no-data.png";

export const NO_DATA = {
  id: "Nodata",
  url: "Nodata",
  title: "Nodata",
  thumbnail: nodataImg,
  reminderTime: "9999-12-31 23:59:59",
  autoOpen: false,
  webPush: false,
  createdAt: new Date().toISOString(),
  hidden: false,
} as const satisfies Reminder;

export const resetAlerm = (reminders: Reminder[]) => {
  if (!chrome.alarms) return;

  chrome.alarms.clearAll();
  for (const r of reminders) {
    if (r.id === NO_DATA.id) continue;

    const reminderTime = new Date(r.reminderTime);
    if (!r.hidden) {
      chrome.alarms.create(r.id, {
        when: reminderTime.getTime(),
      });
    }
  }
};
