import type { Reminder, ServerConfig, ConnectionType } from "@/types/types";

export type Message =
  | { type: "auth/status" }
  | { type: "auth/login" }
  | { type: "auth/logout" }
  | { type: "config/save"; config: ServerConfig }
  | { type: "mode/change"; connectionType: ConnectionType }
  | { type: "alarms/reset" }
  | { type: "reminders/list"; fresh?: boolean }
  | { type: "reminders/create"; reminder: Reminder }
  | { type: "reminders/delete"; id: string };
