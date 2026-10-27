import { createSerial } from "./serial";
import { isCurrent } from "./gen";
import { configKey, loadSettings } from "@/utils/config";
import { NO_DATA } from "@/utils/nodataUtils";
import type { Reminder, ReminderDto, ServerCache } from "@/types/types";

const CACHE_KEY = "serverCache";
const NOTIFIED = "notified:";

export const queue = createSerial();

type Image = ServerCache["images"][string];

export const readCache = async (): Promise<ServerCache> => {
  const s = await loadSettings();
  const empty: ServerCache = { items: [], images: {}, syncedAt: 0, configKey: configKey(s) };
  const { serverCache } = await chrome.storage.local.get(CACHE_KEY);
  const c = serverCache as ServerCache | undefined;
  if (c && c.configKey === empty.configKey && Array.isArray(c.items)) return c;
  if (c) await chrome.storage.local.remove(CACHE_KEY);
  return empty;
};

export const writeCache = async (gen: number, cache: ServerCache): Promise<boolean> => {
  if (!isCurrent(gen)) return false;
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  return true;
};

export const clearServerCache = async (gen: number): Promise<boolean> => {
  if (!isCurrent(gen)) return false;
  await chrome.storage.local.remove(CACHE_KEY);
  return true;
};

export const upsertItem = (cache: ServerCache, dto: ReminderDto, image?: Image): ServerCache => {
  const images = { ...cache.images };
  if (image) images[dto.id] = image;
  return { ...cache, items: [...cache.items.filter((i) => i.id !== dto.id), dto], images };
};

export const removeItem = (cache: ServerCache, id: string): ServerCache => {
  const images = { ...cache.images };
  delete images[id];
  return { ...cache, items: cache.items.filter((i) => i.id !== id), images };
};

export const markNotified = (id: string) => chrome.storage.local.set({ [NOTIFIED + id]: Date.now() });

export const getNotifiedIds = async (): Promise<Set<string>> => {
  const all = await chrome.storage.local.get(null);
  return new Set(Object.keys(all).filter((k) => k.startsWith(NOTIFIED)).map((k) => k.slice(NOTIFIED.length)));
};

export const removeNotified = async (ids: string[]): Promise<void> => {
  if (ids.length) await chrome.storage.local.remove(ids.map((id) => NOTIFIED + id));
};

export const toReminders = (cache: ServerCache, notified: Set<string>): Reminder[] =>
  cache.items.map((d) => {
    const img = cache.images[d.id];
    const ok = img && d.thumbnail && img.imageId === d.thumbnail.imageId && img.sha256 === d.thumbnail.sha256;
    return {
      id: d.id,
      url: d.url,
      title: d.title,
      thumbnail: ok ? img.dataUrl : NO_DATA.thumbnail,
      reminderTime: d.reminderTime,
      autoOpen: d.autoOpen,
      webPush: d.webPush,
      createdAt: d.createdAt,
      hidden: d.hidden || notified.has(d.id),
    };
  });
