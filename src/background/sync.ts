import { createApi, type CreateBody } from "./api";
import { getAccessToken } from "./auth";
import { getNotifiedIds, queue, readCache, removeItem, removeNotified, toReminders, upsertItem, writeCache } from "./cache";
import { rebuildAlarms } from "./alarms";
import { isCurrent, signalFor } from "./gen";
import { sha256Hex } from "./pkce";
import { loadSettings } from "@/utils/config";
import { oneMonthBefore } from "@/utils/ReminderUtils";
import { NO_DATA } from "@/utils/nodataUtils";
import type { Fail, Reminder, ReminderDto, ServerCache } from "@/types/types";

export type Api = ReturnType<typeof createApi>;
type Ok = { ok: true };
type Image = ServerCache["images"][string];
// cache への反映: dto が null なら外す、undefined（change なし）なら何もしない
type Change = { dto: ReminderDto | null; image?: Image };
type Outcome = { result: Ok | Fail; change?: Change };

const OK: Ok = { ok: true };
const STALE: Fail = { ok: false, code: "STALE" };
const REMOVED: Outcome = { result: OK, change: { dto: null } };

export const apiFor = async (gen: number): Promise<Api> =>
  createApi({ baseUrl: (await loadSettings()).apiBaseUrl, gen, getToken: getAccessToken });

const apply = (cache: ServerCache, id: string, change?: Change): ServerCache =>
  !change ? cache : change.dto ? upsertItem(cache, change.dto, change.image) : removeItem(cache, id);

// queue の外から呼ぶ。queue の中で cache と alarm を更新する
const commit = (gen: number, id: string, change: Change): Promise<ServerCache | null> =>
  queue(async () => {
    const next = apply(await readCache(), id, change);
    if (!(await writeCache(gen, next))) return null;
    await rebuildAlarms(gen);
    return next;
  });

const finish = async (gen: number, id: string, o: Outcome): Promise<Ok | Fail> => {
  if (o.change && !(await commit(gen, id, o.change))) return STALE;
  return o.result;
};

const done = (d: ReminderDto) => d.hidden && d.thumbnail === null;

async function hideFlow(api: Api, id: string): Promise<Outcome> {
  for (let attempt = 0; ; attempt++) {
    const g = await api.getReminder(id);
    if (!g.ok) return g.status === 404 ? REMOVED : { result: g };
    if (done(g.data) || Date.parse(g.data.reminderTime) > Date.now()) return { result: OK, change: { dto: g.data } };
    if (!g.etag) return { result: { ok: false, code: "BAD_RESPONSE", status: g.status } };
    const p = await api.patchReminder(id, { hidden: true, thumbnail: null }, g.etag);
    if (p.ok) return { result: OK, change: { dto: p.data } };
    if (p.status === 404) return REMOVED;
    if (p.status === 412 && attempt === 0) continue;
    if (p.code === "UNKNOWN_RESULT") {
      const v = await api.getReminder(id);
      if (v.ok && done(v.data)) return { result: OK, change: { dto: v.data } };
      if (!v.ok && v.status === 404) return REMOVED;
    }
    return { result: p };
  }
}

async function deleteFlow(api: Api, id: string, cleanup: boolean): Promise<Outcome> {
  for (let attempt = 0; ; attempt++) {
    const g = await api.getReminder(id);
    if (!g.ok) return g.status === 404 ? REMOVED : { result: g };
    if (cleanup && !(Date.parse(g.data.reminderTime) < oneMonthBefore(new Date()).getTime()))
      return { result: OK, change: { dto: g.data } };
    if (!g.etag) return { result: { ok: false, code: "BAD_RESPONSE", status: g.status } };
    const d = await api.deleteReminder(id, g.etag);
    if (d.ok || d.status === 404) return REMOVED;
    if (d.status === 412) {
      if (cleanup && attempt === 0) continue;
      if (!cleanup) {
        // 自動では削除し直さない。最新の内容を cache に入れて user に確かめてもらう
        const l = await api.getReminder(id);
        if (!l.ok && l.status === 404) return REMOVED;
        return { result: { ok: false, code: "CONFLICT", status: 412 }, change: l.ok ? { dto: l.data } : undefined };
      }
    }
    if (d.code === "UNKNOWN_RESULT") {
      const v = await api.getReminder(id);
      if (!v.ok && v.status === 404) return REMOVED;
    }
    return { result: d };
  }
}

export async function createOnServer(gen: number, r: Reminder): Promise<{ ok: true; reminder: Reminder } | Fail> {
  if (!isCurrent(gen)) return STALE;
  const api = await apiFor(gen);
  const body: CreateBody = {
    id: r.id,
    url: r.url,
    title: r.title,
    reminderTime: r.reminderTime,
    autoOpen: r.autoOpen,
    webPush: r.webPush,
    hidden: false,
    thumbnail: r.thumbnail === NO_DATA.thumbnail ? null : r.thumbnail,
  };
  let res = await api.createReminder(body);
  if (!res.ok && (res.code === "UNKNOWN_RESULT" || res.status === 409)) {
    const g = await api.getReminder(r.id);
    // id は client が作る UUID なので、200 なら自分の作成とみなす
    if (g.ok) res = g;
    else if (g.status !== 404) return g;
    else if (res.status === 409) return { ok: false, code: "ALREADY_EXISTS", status: 409 };
    else res = await api.createReminder(body);
  }
  if (!res.ok) return res;
  const dto = res.data;
  const image = body.thumbnail && dto.thumbnail
    ? { imageId: dto.thumbnail.imageId, sha256: dto.thumbnail.sha256, dataUrl: body.thumbnail }
    : undefined;
  const cache = await commit(gen, dto.id, { dto, image });
  if (!cache) return STALE;
  const reminder = toReminders({ ...cache, items: [dto] }, await getNotifiedIds())[0];
  return { ok: true, reminder };
}

export async function hideOnServer(gen: number, id: string): Promise<Ok | Fail> {
  if (!isCurrent(gen)) return STALE;
  return finish(gen, id, await hideFlow(await apiFor(gen), id));
}

// user の削除。412 は CONFLICT
export async function deleteOnServer(gen: number, id: string): Promise<Ok | Fail> {
  if (!isCurrent(gen)) return STALE;
  return finish(gen, id, await deleteFlow(await apiFor(gen), id, false));
}

// queue の中から呼ぶ。queue に積まず、writeCache もしない
export async function hideInQueue(
  gen: number,
  api: Api,
  cache: ServerCache,
  id: string,
): Promise<{ result: Ok | Fail; cache: ServerCache }> {
  if (!isCurrent(gen)) return { result: STALE, cache };
  const o = await hideFlow(api, id);
  return { result: o.result, cache: apply(cache, id, o.change) };
}

// 期限切れの整理。412 は GET からやり直す
export async function deleteInQueue(
  gen: number,
  api: Api,
  cache: ServerCache,
  id: string,
): Promise<{ result: Ok | Fail; cache: ServerCache }> {
  if (!isCurrent(gen)) return { result: STALE, cache };
  const o = await deleteFlow(api, id, true);
  return { result: o.result, cache: apply(cache, id, o.change) };
}

// 一覧の同期

type ListResult = { ok: true; reminders: Reminder[] } | (Fail & { reminders: Reminder[] });
const SYNC_INTERVAL = 60_000;
const MAX_WRITES = 30;
const MAX_IMAGES = 30;
const inflight = new Map<number, Promise<ListResult>>();

// 先頭 n 件だけの Fisher–Yates
export const pickRandom = <T>(xs: T[], n: number, random = Math.random): T[] => {
  const a = [...xs];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
};

const fromCache = async (): Promise<Reminder[]> => toReminders(await readCache(), await getNotifiedIds());

const failWith = async (f: Fail): Promise<ListResult> => {
  if (f.code !== "STALE") console.error("sync failed", f.code, f.status);
  return { ok: false, code: f.code, status: f.status, reminders: await fromCache() };
};

const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  // 1 MiB の画像で引数の上限を超えないよう分けて変換する
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// どれかの照合が合わなければ null（次の同期で取り直す）。署名 URL は log に出さない
async function fetchImage(gen: number, api: Api, imageHost: string, d: ReminderDto): Promise<Image | null> {
  const t = d.thumbnail!;
  const u = await api.getThumbnailUrl(d.id);
  if (!u.ok) {
    if (u.code !== "STALE") console.error("thumbnail-url failed", u.code, u.status);
    return null;
  }
  if (u.data.imageId !== t.imageId) return null;
  try {
    if (new URL(u.data.url).origin !== imageHost) return null;
    const res = await fetch(u.data.url, {
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), signalFor(gen)]),
    });
    if (res.status !== 200) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== t.bytes || (await sha256Hex(buf)) !== t.sha256) return null;
    return { imageId: t.imageId, sha256: t.sha256, dataUrl: `data:${t.mime};base64,${toBase64(new Uint8Array(buf))}` };
  } catch {
    return null;
  }
}

// queue の中で行う
async function syncInQueue(gen: number): Promise<ListResult> {
  if (!isCurrent(gen)) return failWith(STALE);
  const settings = await loadSettings();
  const api = await apiFor(gen);

  // 1. 全 page を読んでから全件置き換える
  const items: ReminderDto[] = [];
  let cursor: string | null = null;
  do {
    const r = await api.listPage(cursor);
    if (!r.ok) return failWith(r);
    items.push(...r.data.items);
    cursor = r.data.nextCursor;
  } while (cursor);
  let cache: ServerCache = { ...(await readCache()), items };

  // 2. 期限切れの整理
  const now = Date.now();
  const monthAgo = oneMonthBefore(new Date(now)).getTime();
  const isOld = (d: ReminderDto) => Date.parse(d.reminderTime) < monthAgo;
  const expired = items.filter((d) => isOld(d) || (Date.parse(d.reminderTime) < now && !d.hidden));
  for (const d of pickRandom(expired, MAX_WRITES)) {
    const r = await (isOld(d) ? deleteInQueue : hideInQueue)(gen, api, cache, d.id);
    cache = r.cache;
    if (!r.result.ok) {
      if (r.result.code === "STALE") return failWith(STALE);
      console.error("cleanup failed", r.result.code, r.result.status);
    }
  }

  // 3. 画像
  const images = { ...cache.images };
  const byId = new Map(cache.items.map((d) => [d.id, d]));
  for (const id of Object.keys(images)) if (!byId.get(id)?.thumbnail) delete images[id];
  const stale = cache.items.filter(
    (d) => d.thumbnail && (images[d.id]?.imageId !== d.thumbnail.imageId || images[d.id]?.sha256 !== d.thumbnail.sha256),
  );
  for (const d of pickRandom(stale, MAX_IMAGES)) {
    const img = await fetchImage(gen, api, settings.imageHost, d);
    if (img) images[d.id] = img;
  }

  // 6. syncedAt（cache の書き込みは最後に1回。alarm は書いた cache から作るので先に書く）
  cache = { ...cache, images, syncedAt: Date.now() };
  if (!(await writeCache(gen, cache))) return failWith(STALE);

  // 4. notifiedIds の整理
  const notified = await getNotifiedIds();
  await removeNotified([...notified].filter((id) => !byId.has(id) || byId.get(id)!.hidden));

  // 5. server モードの時だけ alarm を作り直す（世代が違えば rebuildAlarms は何もしない）
  if ((await loadSettings()).connectionType === "server") await rebuildAlarms(gen);
  return { ok: true, reminders: toReminders(cache, await getNotifiedIds()) };
}

export function listReminders(gen: number, fresh: boolean): Promise<ListResult> {
  if (!fresh) return fromCache().then((reminders) => ({ ok: true, reminders }));
  let p = inflight.get(gen);
  if (!p) {
    p = (async (): Promise<ListResult> => {
      const c = await readCache();
      if (Date.now() - c.syncedAt < SYNC_INTERVAL) return { ok: true, reminders: toReminders(c, await getNotifiedIds()) };
      return queue(() => syncInQueue(gen));
    })().finally(() => inflight.delete(gen));
    inflight.set(gen, p);
  }
  return p;
}
