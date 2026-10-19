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
import { errorText, send } from "@/utils/bg";
import { canvasHalve, shrinkToLimit } from "@/utils/image";
import type { Message } from "@/types/messages";
import { AuthStatus, Fail, Reminder, SettingsType } from "@/types/types";
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
  // Task 13 の ServerSettings に渡す
  const [, setAuthStatus] = useState<AuthStatus | null>(null);
  // 切断（NETWORK）の後、次の操作の前に一覧と状態を読み直す
  const needsReload = useRef(false);

  const markDisconnected = () => {
    needsReload.current = true;
  };

  const call = async <T,>(msg: Message): Promise<T | Fail> => {
    const r = await send<T>(msg);
    const f = r as Fail;
    if (f.ok === false) {
      if (f.code === "NETWORK") markDisconnected();
      setError(errorText(f.code, f.status));
    }
    return r;
  };

  const loadAuthStatus = async () => {
    const r = await call<AuthStatus>({ type: "auth/status" });
    if (!("ok" in r)) setAuthStatus(r);
  };

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
    await loadAuthStatus();
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
          if (ytTimeElement && ytTimeElement.result) {
            const ytTimeGroup =
              /^(\d+)月(\d+)日 (\d+):(\d+)$/.exec(ytTimeElement.result) || [];
            if (ytTimeGroup.length == 5) {
              const ytTimeArray = ytTimeGroup
                .slice(1)
                .map((p) => parseInt(p, 10));
              const ytTime = new Date();
              ytTime.setMonth(ytTimeArray[0] - 1);
              ytTime.setDate(ytTimeArray[1]);
              ytTime.setHours(ytTimeArray[2]);
              ytTime.setMinutes(ytTimeArray[3]);
              ytTime.setSeconds(0);
              ytTime.setMilliseconds(0);
              setReminderTime(ytTime);
            }
          }
        }
      }
    })();
  }, []);

  // 開いた時に一度だけ: 設定、一覧（server は cache → fresh の2段）、認証の状態を読む
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setSettings(s);
      if (s.connectionType === "server") await loadServerList();
      else await loadLocalList();
      await loadAuthStatus();
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
      console.log("Past date cannot be set.");
      const status = document.getElementById("status");
      if (status) {
        status.hidden = false;
        setTimeout(() => {
          status.hidden = true;
        }, 3000);
      }
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
    const removed = reminders.find((r) => r.id === id);
    const newReminders = reminders.filter((r) => r.id !== id);
    setReminders(withNoData(newReminders));

    if (settings.connectionType === "server") {
      const r = await call<Ok>({ type: "reminders/delete", id });
      if (r.ok) return;
      if (r.code === "CONFLICT") showList(await call<ListRes>({ type: "reminders/list", fresh: true }));
      else if (removed) setReminders((cur) => withNoData([...cur.filter((x) => x.id !== id), removed]));
      return;
    }
    await chrome.storage.local.set({ reminders: newReminders.filter((r) => r.id !== NO_DATA.id) });
    await call<Ok>({ type: "alarms/reset" });
  };

  const handleOpenReminder = (url: string) => {
    chrome.tabs.create({ url });
  };

  const handleSettingsChange = async (newSettings: SettingsType) => {
    if (newSettings.connectionType === settings.connectionType) {
      setSettings(newSettings);
      await chrome.storage.local.set({ settings: newSettings });
      return;
    }
    setError(null);
    await ensureFresh();
    const r = await call<Ok>({ type: "mode/change", connectionType: newSettings.connectionType });
    if (!r.ok) return;
    setSettings(newSettings);
    if (newSettings.connectionType === "server") await loadServerList();
    else await loadLocalList();
  };

  return (
    <Tabs defaultValue="reminders" className="w-root m-4 space-y-6">
      <TabsList className="w-full">
        <TabsTrigger value="reminders" className="w-full">
          Reminders
        </TabsTrigger>
        <TabsTrigger value="settings" className="w-full">
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="reminders">
        <div className="space-y-6">
          <div className="space-y-4">
            <DateTimePicker value={reminderTime} onChange={setReminderTime} />
            <Button onClick={handleAddReminder} className="w-full">
              Create Reminder
            </Button>
          </div>

          <Label id="status" className="text-red-500" hidden={true}>
            Past date cannot be set.
          </Label>
          {error && <Label className="text-red-500">{error}</Label>}

          <div className="space-y-4 grid justify-center">
            <h2 className="text-lg font-semibold">Reminders</h2>
            <ReminderList
              reminders={reminders}
              onDelete={handleDeleteReminder}
              onOpen={handleOpenReminder}
            />
          </div>
        </div>
      </TabsContent>
      <TabsContent value="settings">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Settings
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default App;
