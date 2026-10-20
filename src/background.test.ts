import { it, expect, beforeEach, vi } from "vitest";
import type { ChromeMock } from "@/test/chrome";
import type { ReminderDto } from "@/types/types";

const cfg = { apiBaseUrl: "https://a.test", authBaseUrl: "https://b.test", clientId: "x", imageHost: "https://c.test" };
const KEY = Object.values(cfg).join("|");
const FUTURE = "2099-01-01T00:00:00.000Z";
const ch = () => globalThis.chrome as unknown as ChromeMock;
const store = () => ch().storage.local._data;
const alarmNames = async () => (await ch().alarms.getAll()).map((a) => a.name).sort();
const dto = (id: string): ReminderDto => ({
  id, url: "u", title: "t", reminderTime: FUTURE, autoOpen: false, webPush: false,
  hidden: false, revision: 1, createdAt: "c", updatedAt: "u", thumbnail: null,
});
const reminder = (id: string) => ({ ...dto(id), thumbnail: "x" });

// background.ts は import の時に listener を登録する
const load = async () => {
  vi.resetModules();
  await import("@/background.ts");
  return ch().runtime.onInstalled.addListener.mock.calls[0][0] as () => void;
};

beforeEach(() => {
  store().reminders = [reminder("local1")];
  store().serverCache = { items: [dto("server1")], images: {}, syncedAt: 0, configKey: KEY };
});

it("R-STO-11: 起動時と onInstalled で setAccessLevel を呼ぶ", async () => {
  const onInstalled = await load();
  const setAccessLevel = ch().storage.local.setAccessLevel;
  expect(setAccessLevel).toHaveBeenCalledTimes(1);
  expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  onInstalled();
  expect(setAccessLevel).toHaveBeenCalledTimes(2);
});

it.each([
  ["local", ["local1"]],
  ["server", ["server1"]],
])("R-ALARM-05: onInstalled は %s モードの一覧から alarm を作り直す", async (connectionType, names) => {
  store().settings = { connectionType, ...cfg };
  await ch().alarms.create("stale", { when: Date.parse(FUTURE) });
  (await load())();
  await vi.waitFor(async () => expect(await alarmNames()).toEqual(names));
});
