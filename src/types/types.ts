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

export type ConnectionType = "local" | "server";

export interface SettingsType {
  autoOpen: boolean;
  webPush: boolean;
  connectionType: ConnectionType;
  apiBaseUrl: string;
  authBaseUrl: string;
  clientId: string;
  imageHost: string;
}

export type ServerConfig = Pick<SettingsType, "apiBaseUrl" | "authBaseUrl" | "clientId" | "imageHost">;

export interface ThumbnailMeta {
  imageId: string;
  mime: string;
  bytes: number;
  sha256: string;
}

export interface ReminderDto {
  id: string;
  url: string;
  title: string;
  reminderTime: string;
  autoOpen: boolean;
  webPush: boolean;
  hidden: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  thumbnail: ThumbnailMeta | null;
}

export interface ServerCache {
  items: ReminderDto[];
  images: Record<string, { imageId: string; sha256: string; dataUrl: string }>;
  syncedAt: number;
  configKey: string;
}

export type AuthNoticeCode =
  | "LOGIN_FAILED"
  | "LOGIN_CANCELLED"
  | "REFRESH_FAILED"
  | "LOGGED_OUT"
  | "REVOKE_FAILED"
  | "LOGOUT_PAGE_FAILED";

export interface AuthStatus {
  configured: boolean;
  permitted: boolean;
  state: "LOGGED_OUT" | "LOGGED_IN" | "LOGIN_REQUIRED";
  loginInProgress: boolean;
  notice: AuthNoticeCode | null;
}

export type Fail = { ok: false; code: string; status?: number; message?: string };

export interface StoragePayloadType {
  key: string;
  reminders: Reminder[];
}
