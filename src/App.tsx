import { useState, useEffect } from "react";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Settings } from "@/components/Settings";
import { ReminderList } from "@/components/ReminderList";
import { Reminder, SettingsType } from "@/types/types";
import { captureVisibleTab } from "@/utils/capture";
import { createZeroSecCurrentDate } from "@/utils/dateUtils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import "@/App.css";

function App() {
  const [reminderTime, setReminderTime] = useState(createZeroSecCurrentDate());
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [settings, setSettings] = useState<SettingsType>({
    autoOpen: true,
    webPush: false,
  });

  useEffect(() => {
    // Load saved reminders and settings
    chrome.storage.local.get(["reminders", "settings"], (result) => {
      const savedReminders: Reminder[] = result.reminders || [];
      const savedSettings: SettingsType = result.settings;
      const updatedReminders: Reminder[] = savedReminders.filter(
        (r: Reminder) => {
          return new Date(r.reminderTime).getTime() > Date.now();
        }
      );
      chrome.storage.local.set({ reminders: updatedReminders });
      setReminders(updatedReminders);
      if (savedSettings) setSettings(savedSettings);
    });
  }, []);

  const handleAddReminder = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
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
      thumbnail: await captureVisibleTab(),
      reminderTime: reminderTime.toISOString(),
      autoOpen: settings.autoOpen,
      webPush: settings.webPush,
      createdAt: new Date().toISOString(),
    };

    console.log(reminder);

    const updatedReminders = [...reminders, reminder];
    setReminders(updatedReminders);
    chrome.storage.local.set({ reminders: updatedReminders });
    if (settings.webPush) {
      chrome.storage.local.set({ webpushdata: updatedReminders });
    }

    // Set up alarm for the reminder
    chrome.alarms.create(reminder.id, {
      when: reminderTime.getTime(),
    });
  };

  const handleDeleteReminder = (id: string) => {
    const updatedReminders = reminders.filter((r) => r.id !== id);
    setReminders(updatedReminders);
    chrome.storage.local.set({ reminders: updatedReminders });
    chrome.storage.local.set({ webpush_data: updatedReminders });
    chrome.alarms.clear(id);
  };

  const handleOpenReminder = (url: string) => {
    chrome.tabs.create({ url });
  };

  const handleSettingsChange = (newSettings: SettingsType) => {
    setSettings(newSettings);
    chrome.storage.local.set({ settings: newSettings });
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

        <div className="pb-6 space-y-4">
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
