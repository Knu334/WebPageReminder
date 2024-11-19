import { useState, useEffect } from "react";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Settings } from "@/components/Settings";
import { ReminderList } from "@/components/ReminderList";
import {
  captureVisibleTab,
  createZeroSecCurrentDate,
  NO_DATA,
  ReminderUtils,
  removeOldReminders,
  resetAlerm,
} from "@/utils/ReminderUtils";
import { Reminder, SettingsType } from "@/types/types";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import "@/App.css";

function App() {
  const [reminderTime, setReminderTime] = useState(createZeroSecCurrentDate);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [settings, setSettings] = useState<SettingsType>({
    autoOpen: true,
    webPush: false,
    connectionType: "local",
    url: "http://localhost:3000",
  });

  useEffect(() => {
    // Load saved reminders and settings
    (async () => {
      const storage = chrome.storage
        ? await chrome.storage.local.get(["settings", "reminders"])
        : {};
      let localSettings: SettingsType = storage.settings || {
        autoOpen: true,
        webPush: false,
        connectionType: "local",
        url: "http://localhost:3000",
      };
      if (localSettings) setSettings(localSettings);

      if (!chrome.storage) {
        setSettings({ ...localSettings, connectionType: "server" });
      }

      let storageReminders: Reminder[] = [];
      if (localSettings.connectionType === "server" || !chrome.storage) {
        try {
          const utils = new ReminderUtils(localSettings.url);
          storageReminders = await utils.getRemoteReminders();
          storageReminders = removeOldReminders(storageReminders);
          await utils.setRemoteReminders(storageReminders);
        } catch (error) {
          if (chrome.storage) {
            storageReminders = storage.reminders || [];
            localSettings = { ...localSettings, connectionType: "local" };
            setSettings(localSettings);
            await chrome.storage.local.set({ settings: localSettings });
          }
          console.log(error);
        }
      } else if (chrome.storage) {
        storageReminders = storage.reminders || [];
        storageReminders = removeOldReminders(storageReminders);
        await chrome.storage.local.set({ reminders: storageReminders });
      }
      if (storageReminders.length === 0) {
        storageReminders.push(NO_DATA);
      }
      setReminders(storageReminders);
      resetAlerm(storageReminders);
    })();
  }, [settings.connectionType]);

  const handleAddReminder = async () => {
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

    const reminder: Reminder = {
      id: crypto.randomUUID(),
      url: tab.url,
      title: tab.title,
      thumbnail: (await captureVisibleTab()) || NO_DATA.thumbnail,
      reminderTime: reminderTime.toISOString(),
      autoOpen: settings.autoOpen,
      webPush: settings.webPush,
      createdAt: new Date().toISOString(),
      hidden: false,
    };

    let updatedReminders;
    if (reminders[0].id === NO_DATA.id) {
      updatedReminders = [reminder];
    } else {
      updatedReminders = [...reminders, reminder];
    }
    setReminders(updatedReminders);
    if (settings.connectionType === "server" || !chrome.storage) {
      const utils = new ReminderUtils(settings.url);
      utils.setRemoteReminders(updatedReminders);
    } else {
      chrome.storage.local.set({ reminders: updatedReminders });
    }

    // Set up alarm for the reminder
    if (chrome.alarms) {
      chrome.alarms.create(reminder.id, {
        when: reminderTime.getTime(),
      });
    }
  };

  const handleDeleteReminder = (id: string) => {
    const updatedReminders = reminders.filter((r) => r.id !== id);
    if (updatedReminders.length === 0) {
      updatedReminders.push(NO_DATA);
    }
    setReminders(updatedReminders);
    if (settings.connectionType === "server" || !chrome.storage) {
      const utils = new ReminderUtils(settings.url);
      utils.setRemoteReminders(updatedReminders);
    } else {
      chrome.storage.local.set({ reminders: updatedReminders });
    }
    if (chrome.alarms) {
      chrome.alarms.clear(id);
    }
  };

  const handleOpenReminder = (url: string) => {
    chrome.tabs.create({ url });
  };

  const handleSettingsChange = (newSettings: SettingsType) => {
    setSettings(newSettings);
    if (chrome.storage) {
      chrome.storage.local.set({ settings: newSettings });
    }
  };

  return (
    <ScrollArea className="w-root">
      <div className="h-root pt-6 px-6 space-y-6">
        <div className="space-y-4">
          <DateTimePicker value={reminderTime} onChange={setReminderTime} />
          <Button onClick={handleAddReminder} className="w-full">
            Create Reminder
          </Button>
        </div>

        <Label id="status" className="text-red-500" hidden={true}>
          Past date cannot be set.
        </Label>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Settings
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        </div>

        <div className="pb-6 space-y-4 grid justify-center">
          <h2 className="text-lg font-semibold">Reminders</h2>
          <ReminderList
            reminders={reminders}
            onDelete={handleDeleteReminder}
            onOpen={handleOpenReminder}
          />
        </div>
      </div>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  );
}

export default App;
