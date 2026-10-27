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
