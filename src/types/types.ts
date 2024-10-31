export interface Reminder {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  reminderTime: string;
  autoOpen: boolean;
  webPush: boolean;
  createdAt: string;
}

export interface SettingsType {
  autoOpen: boolean;
  webPush: boolean;
}
