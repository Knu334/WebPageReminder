import { vi } from "vitest";

type Data = Record<string, unknown>;

const createStorageArea = () => {
  const _data: Data = {};
  return {
    _data,
    // Chrome 同様: keys が undefined/null なら全件、string・string[]・既定値つき object
    get: vi.fn(async (keys?: string | string[] | Data | null) => {
      if (keys == null) return { ..._data };
      if (typeof keys === "string") keys = [keys];
      const out: Data = {};
      if (Array.isArray(keys)) {
        for (const k of keys) if (k in _data) out[k] = _data[k];
      } else {
        for (const [k, def] of Object.entries(keys)) out[k] = k in _data ? _data[k] : def;
      }
      return out;
    }),
    set: vi.fn(async (obj: Data) => {
      Object.assign(_data, obj);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete _data[k];
    }),
    setAccessLevel: vi.fn(async () => {}),
  };
};

const createEvent = () => ({ addListener: vi.fn() });

export const installChromeMock = () => {
  const alarms = new Map<string, { name: string; scheduledTime: number }>();
  return {
    storage: { local: createStorageArea(), session: createStorageArea() },
    alarms: {
      create: vi.fn(async (name: string, info: { when: number }) => {
        alarms.set(name, { name, scheduledTime: info.when });
      }),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      clearAll: vi.fn(async () => {
        alarms.clear();
        return true;
      }),
      getAll: vi.fn(async () => [...alarms.values()]),
      onAlarm: createEvent(),
    },
    identity: {
      getRedirectURL: (p: string) => "https://test-ext-id.chromiumapp.org/" + p,
      launchWebAuthFlow: vi.fn(),
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      id: "test-ext-id",
      sendMessage: vi.fn(),
      onMessage: createEvent(),
      onInstalled: createEvent(),
    },
    notifications: {
      create: vi.fn(),
      clear: vi.fn(),
      onClicked: createEvent(),
    },
    tabs: { create: vi.fn() },
  };
};

export type ChromeMock = ReturnType<typeof installChromeMock>;
