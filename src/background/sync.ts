import { createApi, type CreateBody } from "./api";
import { getAccessToken } from "./auth";
import { getNotifiedIds, queue, readCache, removeItem, toReminders, upsertItem, writeCache } from "./cache";
import { rebuildAlarms } from "./alarms";
import { isCurrent } from "./gen";
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
