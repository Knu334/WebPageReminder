import { Reminder } from "@/types/types";
import nodataImg from "@/resources/no-data.png";

const nodata: Reminder = {
  id: "Nodata",
  url: "Nodata",
  title: "Nodata",
  thumbnail: nodataImg,
  reminderTime: "9999-12-31 23:59:59",
  autoOpen: false,
  webPush: false,
  createdAt: new Date().toISOString(),
};

export const getNodata = (): Reminder => {
  return nodata;
};

export const delNodata = (reminders: Reminder[]): Reminder[] => {
  return reminders.filter((r: Reminder) => r.id !== nodata.id);
};
