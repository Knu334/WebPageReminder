import { rebuildAlarms } from "@/background/alarms";
import { queue } from "@/background/cache";
import { currentGen } from "@/background/gen";
import { handleMessage, isTrustedSender, parseMessage } from "@/background/messages";
import { handleAlarm, handleNotificationClick } from "@/background/notify";

// content script から storage を読ませない
const restrictStorage = () =>
  chrome.storage.local
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch((e) => console.error("setAccessLevel failed", (e as Error)?.name));

void restrictStorage();

chrome.runtime.onInstalled.addListener(() => {
  void restrictStorage();
  queue(() => rebuildAlarms(currentGen())).catch((e) => console.error("rebuild failed", (e as Error)?.name));
});

chrome.alarms.onAlarm.addListener((alarm) => void handleAlarm(alarm.name));

chrome.notifications.onClicked.addListener((id) => void handleNotificationClick(id));

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (!isTrustedSender(sender)) return;
  const p = parseMessage(raw);
  if (p.kind === "unknown") return;
  if (p.kind === "invalid") {
    sendResponse({ ok: false, code: "INVALID_MESSAGE" });
    return;
  }
  void handleMessage(p.msg).then(sendResponse);
  return true;
});
