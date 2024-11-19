export interface Reminder {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  reminderTime: string;
  autoOpen: boolean;
  webPush: boolean;
  createdAt: string;
  hidden: boolean;
}

export interface SettingsType {
  autoOpen: boolean;
  webPush: boolean;
  connectionType: string;
  url: string;
}

export interface StoragePayloadType {
  key: string;
  reminders: Reminder[];
}
