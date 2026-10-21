import { useState, useEffect, useRef } from "react";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Settings } from "@/components/Settings";
import { ReminderList } from "@/components/ReminderList";
import {
  captureVisibleTab,
  createZeroSecCurrentDate,
  DEFAULT_SETTINGS,
  removeOldReminders,
} from "@/utils/ReminderUtils";
import { NO_DATA } from "./utils/nodataUtils";
import { loadSettings } from "@/utils/config";
import { makeCall } from "@/utils/bg";
import { canvasHalve, shrinkToLimit } from "@/utils/image";
import { parseYouTubeTime } from "@/utils/date";
import { ConnectionType, Fail, Reminder, ServerConfig, SettingsType } from "@/types/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import "@/App.css";

type Ok = { ok: true };
type ListRes = { ok: true; reminders: Reminder[] } | (Fail & { reminders: Reminder[] });

const withNoData = (list: Reminder[]): Reminder[] =>
  list.some((r) => !r.hidden && r.id !== NO_DATA.id) ? list.filter((r) => r.id !== NO_DATA.id) : [...list.filter((r) => r.id !== NO_DATA.id), NO_DATA];

function App() {
  const [reminderTime, setReminderTime] = useState(createZeroSecCurrentDate);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  // 切断（NETWORK）の後、次の操作の前に一覧を読み直す（認証の状態は ServerSettings が読む）
  const needsReload = useRef(false);

  const markDisconnected = () => {
    needsReload.current = true;
  };

  const call = makeCall(setError, markDisconnected);

  const showList = (r: ListRes | Fail) => {
    if ("reminders" in r) setReminders(withNoData(r.reminders));
  };

  const loadServerList = async () => {
    showList(await call<ListRes>({ type: "reminders/list" }));
    showList(await call<ListRes>({ type: "reminders/list", fresh: true }));
  };

  const loadLocalList = async () => {
    const { reminders: stored } = await chrome.storage.local.get("reminders");
    const list = removeOldReminders(Array.isArray(stored) ? stored : []);
    await chrome.storage.local.set({ reminders: list });
    setReminders(withNoData(list));
    await call<Ok>({ type: "alarms/reset" });
  };

  const ensureFresh = async () => {
    if (!needsReload.current) return;
    needsReload.current = false;
    if (settings.connectionType === "server") showList(await call<ListRes>({ type: "reminders/list", fresh: true }));
  };

  useEffect(() => {
    (async () => {
      if (chrome.tabs && chrome.scripting) {
        const [activeTab] = await chrome.tabs.query({
          url: ["http://*/*", "https://*/*"],
          active: true,
          lastFocusedWindow: true,
        });
        if (activeTab && activeTab.id) {
          const [ytTimeElement] = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              const el = document.querySelector<HTMLElement>(
                "div.ytp-offline-slate-subtitle-text"
              );
              return el ? el.innerText : null;
            },
          });
          const ytTime = ytTimeElement?.result
            ? parseYouTubeTime(ytTimeElement.result, new Date())
            : null;
          if (ytTime) setReminderTime(ytTime);
        }
      }
    })();
  }, []);

  // 開いた時に一度だけ: 設定と一覧（server は cache → fresh の2段）を読む
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      if (s.connectionType === "server") await loadServerList();
      else await loadLocalList();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddReminder = async () => {
    setError(null);
    await ensureFresh();
    let tab;
    if (chrome.tabs) {
      [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
    } else {
      tab = { url: "http://localhost", title: "Test" };
    }
    if (!tab.url || !tab.title) return;

    if (reminderTime.getTime() <= Date.now()) {
      setError("Past date cannot be set.");
      return;
    }

    if (!settings.autoOpen && !settings.webPush) {
      return;
    }

    const server = settings.connectionType === "server";
    const capture = await captureVisibleTab();
    // capture の失敗は NO_DATA の path のまま。縮められなければ画像なし
    const thumbnail = !capture
      ? NO_DATA.thumbnail
      : !server
        ? capture
        : ((await shrinkToLimit(capture, canvasHalve).catch(() => null)) ?? NO_DATA.thumbnail);

    const reminder: Reminder = {
      id: crypto.randomUUID(),
      url: tab.url,
      title: tab.title,
      thumbnail,
      reminderTime: reminderTime.toISOString(),
      autoOpen: settings.autoOpen,
      webPush: settings.webPush,
      createdAt: new Date().toISOString(),
      hidden: false,
    };

    if (server) {
      setReminders((cur) => withNoData([...cur, reminder]));
      const r = await call<{ ok: true; reminder: Reminder }>({ type: "reminders/create", reminder });
      if (!r.ok) setReminders((cur) => withNoData(cur.filter((x) => x.id !== reminder.id)));
      return;
    }
    const newReminders = [...reminders.filter((r) => r.id !== NO_DATA.id), reminder];
    setReminders(newReminders);
    await chrome.storage.local.set({ reminders: newReminders });
    await call<Ok>({ type: "alarms/reset" });
  };

  const handleDeleteReminder = async (id: string) => {
    setError(null);
    await ensureFresh();

    if (settings.connectionType === "server") {
      // ensureFresh が一覧を置き換えている場合があるので、閉包の reminders ではなく cur から消す
      let removed: Reminder | undefined;
      setReminders((cur) => {
        removed = cur.find((x) => x.id === id) ?? removed;
        return withNoData(cur.filter((x) => x.id !== id));
      });
      const r = await call<Ok>({ type: "reminders/delete", id });
      if (r.ok) return;
      if (r.code === "CONFLICT") showList(await call<ListRes>({ type: "reminders/list", fresh: true }));
      else if (removed) {
        const back = removed;
        setReminders((cur) => withNoData([...cur.filter((x) => x.id !== id), back]));
      }
      return;
    }
    // local モードでは ensureFresh は一覧を書き換えないので、閉包の reminders は古くならない
    const newReminders = reminders.filter((r) => r.id !== id && r.id !== NO_DATA.id);
    setReminders(withNoData(newReminders));
    await chrome.storage.local.set({ reminders: newReminders });
    await call<Ok>({ type: "alarms/reset" });
  };

  const handleOpenReminder = (url: string) => {
    chrome.tabs.create({ url });
  };

  // storage の今の値にその field だけを重ねる（background が保存した接続先を巻き込まない）
  const handleSettingsChange = async (patch: Partial<Pick<SettingsType, "autoOpen" | "webPush">>) => {
    setSettings((cur) => ({ ...cur, ...patch }));
    const s = await loadSettings();
    await chrome.storage.local.set({ settings: { ...s, ...patch } });
  };

  const handleModeChange = async (connectionType: ConnectionType) => {
    if (connectionType === settings.connectionType) return;
    setError(null);
    await ensureFresh();
    const r = await call<Ok>({ type: "mode/change", connectionType });
    if (!r.ok) return;
    setSettings((cur) => ({ ...cur, connectionType }));
    if (connectionType === "server") await loadServerList();
    else await loadLocalList();
  };

  // 接続先が変わると background が cache を消すので、一覧も読み直す
  const handleSaved = async (c: ServerConfig) => {
    setSettings((cur) => ({ ...cur, ...c }));
    showList(await call<ListRes>({ type: "reminders/list" }));
  };

  return (
    <Tabs defaultValue="reminders" className="w-root m-4">
      <TabsList className="w-full">
        <TabsTrigger value="reminders" className="w-full">
          Reminders
        </TabsTrigger>
        <TabsTrigger value="settings" className="w-full">
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="reminders" className="mt-6">
        <div>
          <div className="space-y-4">
            <DateTimePicker
              value={reminderTime}
              onChange={(d) => {
                setReminderTime(d);
                setError(null);
              }}
            />
            <Button onClick={handleAddReminder} className="w-full">
              Create Reminder
            </Button>
          </div>

          {error && <Label className="text-red-500">{error}</Label>}

          <div className="mt-6 space-y-4 grid justify-center">
            <h2 className="text-lg font-semibold">Reminders</h2>
            <ReminderList
              reminders={reminders}
              onDelete={handleDeleteReminder}
              onOpen={handleOpenReminder}
            />
          </div>
        </div>
      </TabsContent>
      <TabsContent value="settings" className="mt-6">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Settings
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onModeChange={handleModeChange}
            onSaved={handleSaved}
            markDisconnected={markDisconnected}
            ensureFresh={ensureFresh}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default App;
