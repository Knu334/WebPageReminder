# Chrome 拡張機能の v2 API・Cognito 移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** server モードを reminder-server の v2 API（1件ごとの CRUD・ETag）と Cognito の authorization code + PKCE に移行し、通信・cache・alarm を service worker に集める。

**Architecture:** service worker（`src/background/`）が認証（auth mutex、世代 `authGen`）、v2 client、cache の queue、同期、alarm を持つ。popup は `chrome.runtime.sendMessage` で決まった message を送り、結果だけを表示する。local モードは popup が今のまま `chrome.storage.local` を読み書きし、alarm だけ background に任せる。

**Tech Stack:** TypeScript 5.6、React 18、Vite 6、Chrome MV3 API、`fetch` と `crypto.subtle`、vitest（新規）。

**Spec:** `docs/superpowers/specs/2026-10-19-chrome-extension-v2-design.md`（以下「spec」。節の名前で参照する）

## Global Constraints

- branch は `feature-v2-cognito`。各 task の最後に commit する。commit message の末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける。`git push --force` と `git reset --hard` は使わない。
- `node_modules` と `dist` は読まない（読む必要があれば owner に許可を取る）。
- runtime の依存を追加しない。追加してよい devDependency は `vitest` だけ（Vite 6 を peer に持つ版。`npm view vitest@3 peerDependencies` で確かめる）。`axios` は Task 12 で削除する。
- scope は文字どおり `openid reminder-api/read reminder-api/write`。
- 時間の値: access token の refresh の閾値 30秒、認可の試行の期限 10分、refresh の再送の猶予 10秒、refresh の fetch の timeout 4秒、その他の fetch の timeout 10秒、同期の間隔 60秒、1回の同期の整理の書き込み 30件・画像の取得 30件、`listPage` の `limit=50`、画像の上限 1 MiB（1,048,576 byte）。
- token、認可 code、`state`、`verifier`、callback URL、署名 URL を log に出さない。`console.error` には code と status だけ。
- テストは `src/**/*.test.ts`、node 環境、`TZ=Asia/Tokyo` 固定。`chrome.*` は `src/test/chrome.ts` の mock、`fetch` は `vi.stubGlobal` で差し替える。module の状態（`authGen` など）を持つ module は、`beforeEach` で `vi.resetModules()` してから、テストで使う module を（`gen.ts` も含めて）すべて `await import()` し直す（同じ reset の後に読んだ instance どうしでないと状態を共有しない）。`setup.ts` の `afterEach` で `vi.useRealTimers()` と `vi.unstubAllGlobals()` を呼ぶ。
- **lock の取り方**: 2つを取る時は必ず queue → `authLock` の順（`queue(() => authLock(...))`）。`authLock` を持ったまま queue を待たない。queue の中で動く関数は、同じ queue に積まない（再入すると止まる）。そのため queue に積む公開の関数と、queue の中から呼ぶ `...InQueue` の関数を分ける（Task 8）。
- 各 task の完了時に `npm run lint`、`npm test`、`npm run build` がすべて通る。
- `DEFAULT_SETTINGS.connectionType` は `"local"` にする（新しい extension ID は新規インストール扱いで、server の接続先が未設定のため。spec に記述が無い部分の決定）。

## Review Focus

1. **古い版の設定が残っている**（`url` を持ち、`connectionType: "server"`、4項目が無い）→ 例外にならず、server モードで `NOT_CONFIGURED` と表示される。Task 2 の `loadSettings` のテストで固定する。
2. **Gateway の error が JSON でない**（HTML や空の body の 403・429、`Retry-After` 無し）→ `api.ts` が例外を投げず、`HTTP_<status>` の code で返し、429 は1秒待って再試行する。Task 3 のテストで固定する。
3. **popup が途中で閉じる**（ログインの window、許可の dialog）→ 開き直した時に `auth/status` が `loginInProgress` と `notice` を正しく返す。Task 10 のテストで固定する。
4. **巨大な capture 画像**（4K の画面）→ 縮小の繰り返しが必ず終わり、1 MiB 以下か、縮められなければ `null`（画像なし）で送る。Task 12 のテストで固定する。
5. **同期中に作成した項目が、同期の結果にも含まれる** → cache で id が重複しない（upsert）。Task 8 のテストで固定する。

---

## File Structure

| file | 責務 |
| --- | --- |
| `vitest.config.ts`（新規） | vitest の設定（alias、node 環境、setup） |
| `src/test/setup.ts`、`src/test/chrome.ts`（新規） | TZ の固定、`chrome.*` の in-memory mock |
| `src/types/types.ts`（変更） | `SettingsType` の変更、DTO・cache・status の型 |
| `src/types/messages.ts`（新規） | popup と background が共有する message の型 |
| `src/utils/config.ts`（新規） | 接続先の検証・正規化、`configKey`、設定の読み込み |
| `src/utils/ReminderUtils.ts`（変更） | `oneMonthBefore`、`removeOldReminders` の修正、旧 API の class の削除 |
| `src/utils/bg.ts`（新規） | popup 側の `send()` と error の文言 |
| `src/utils/image.ts`（新規） | 画像の大きさの計算と縮小 |
| `src/background/serial.ts`（新規） | 直列化の primitive（auth mutex と queue に使う） |
| `src/background/gen.ts`（新規） | `authGen` と世代ごとの `AbortController` |
| `src/background/pkce.ts`（新規） | Base64URL、乱数、challenge、SHA-256 |
| `src/background/api.ts`（新規） | v2 client |
| `src/background/auth.ts`（新規） | token の取得・refresh・login・logout・status |
| `src/background/cache.ts`（新規） | queue、`serverCache`、`notified:<id>`、DTO の変換 |
| `src/background/alarms.ts`（新規） | alarm の再構築 |
| `src/background/sync.ts`（新規） | 書き込みの手順、一覧の同期 |
| `src/background/notify.ts`（新規） | `onAlarm` と通知の click の処理 |
| `src/background/messages.ts`（新規） | 送信元と入力の検証、振り分け |
| `src/background.ts`（変更） | listener の登録だけ |
| `src/App.tsx`、`src/components/Settings.tsx`（変更）、`src/components/ServerSettings.tsx`（新規） | popup の UI |
| `src/utils/nodataUtils.ts`（変更） | `resetAlerm` の削除 |
| `public/manifest.json`、`package.json`、`.github/workflows/build.yml`、`README.md`、`CLAUDE.md`（変更） | 設定と文書 |

---

### Task 1: テストの基盤と「1か月前」の修正

**Files:**
- Create: `vitest.config.ts`、`src/test/setup.ts`、`src/test/chrome.ts`、`src/utils/ReminderUtils.test.ts`
- Modify: `package.json`（`"test": "vitest run"`、devDependency `vitest`）、`.github/workflows/build.yml`（`npm run build` の前に `- run: npm test`）、`src/utils/ReminderUtils.ts`

**Interfaces:**
- Produces: `installChromeMock(): ChromeMock`（`src/test/chrome.ts`。`setup.ts` が `beforeEach` で呼び、`globalThis.chrome` に入れる）。`ChromeMock` は次を持つ: `storage.local` / `storage.session`（`get(keys?)`、`set(obj)`、`remove(keys)`、`setAccessLevel`、中身を見る `_data: Record<string, unknown>`）、`alarms`（`create(name, {when})`、`clear(name)`、`clearAll()`、`getAll()`）、`identity`（`getRedirectURL(p) => "https://test-ext-id.chromiumapp.org/" + p`、`launchWebAuthFlow: vi.fn()`）、`permissions`（`contains: vi.fn(async () => true)`、`request: vi.fn(async () => true)`）、`runtime.id = "test-ext-id"`、`runtime.sendMessage`、`notifications.create/clear`、`tabs.create`、各 event（`runtime.onMessage`、`runtime.onInstalled`、`alarms.onAlarm`、`notifications.onClicked`）の `addListener`（すべて `vi.fn`）。
- Produces: `oneMonthBefore(now: Date): Date`（`src/utils/ReminderUtils.ts`）

- [ ] **Step 1: vitest を入れ、設定を書く**

`npm install -D vitest@<確かめた版>`。`vitest.config.ts` は `@` の alias（`vite.config.ts` と同じ）、`test: { environment: "node", include: ["src/**/*.test.ts"], setupFiles: ["src/test/setup.ts"] }`。`setup.ts` は先頭で `process.env.TZ = "Asia/Tokyo"` にし、`beforeEach(() => { globalThis.chrome = installChromeMock() as unknown as typeof chrome })`、`afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })`。

- [ ] **Step 2: 失敗するテストを書く**（`src/utils/ReminderUtils.test.ts`）

```ts
const d = (s: string) => new Date(s);
it("oneMonthBefore: 存在しない日は前月の末日", () => {
  expect(oneMonthBefore(d("2026-03-31T09:30:00+09:00"))).toEqual(d("2026-02-28T09:30:00+09:00"));
  expect(oneMonthBefore(d("2028-03-31T09:30:00+09:00"))).toEqual(d("2028-02-29T09:30:00+09:00"));
  expect(oneMonthBefore(d("2027-01-31T09:30:00+09:00"))).toEqual(d("2026-12-31T09:30:00+09:00"));
  expect(oneMonthBefore(d("2026-05-15T09:30:00+09:00"))).toEqual(d("2026-04-15T09:30:00+09:00"));
});
it("removeOldReminders: ちょうど1か月前は残し、それより前は消す", () => {
  vi.useFakeTimers(); vi.setSystemTime(d("2026-05-15T09:30:00+09:00"));
  const r = (id: string, t: string) => ({ ...NO_DATA, id, reminderTime: t });
  const out = removeOldReminders([r("eq", "2026-04-15T09:30:00+09:00"), r("old", "2026-04-15T09:29:59+09:00")]);
  expect(out.map((x) => x.id)).toEqual(["eq"]);
});
```

- [ ] **Step 3: 失敗を確かめる**

Run: `npx vitest run src/utils/ReminderUtils.test.ts`
Expected: FAIL（`oneMonthBefore` が無い）

- [ ] **Step 4: `oneMonthBefore` を実装し、`removeOldReminders` の削除の基準に使う**

前月の同じ日を作り、月が繰り上がったら前月の末日（`new Date(y, m, 0)`）にする。時刻はそのまま。`removeOldReminders` の filter は `reminderTime >= oneMonthBefore(now)` を残す。

- [ ] **Step 5: テストが通ることを確かめ、`npm run lint && npm run build` も通す**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**（`test: vitest を導入し、1か月前の計算を直す`）

---

### Task 2: 共有の型と基礎の部品（設定、直列化、世代、PKCE）

**Files:**
- Create: `src/types/messages.ts`、`src/utils/config.ts`、`src/background/serial.ts`、`src/background/gen.ts`、`src/background/pkce.ts`、各 `*.test.ts`
- Modify: `src/types/types.ts`、`src/utils/ReminderUtils.ts`（`DEFAULT_SETTINGS`）

**Interfaces:**
- Produces（`src/types/types.ts`）:
  - `type ConnectionType = "local" | "server"`
  - `SettingsType`（spec「設定」の形）、`type ServerConfig = Pick<SettingsType, "apiBaseUrl" | "authBaseUrl" | "clientId" | "imageHost">`
  - `ThumbnailMeta { imageId: string; mime: string; bytes: number; sha256: string }`
  - `ReminderDto { id; url; title; reminderTime; autoOpen; webPush; hidden; revision: number; createdAt; updatedAt; thumbnail: ThumbnailMeta | null }`
  - `ServerCache { items: ReminderDto[]; images: Record<string, { imageId: string; sha256: string; dataUrl: string }>; syncedAt: number; configKey: string }`
  - `type AuthNoticeCode = "LOGIN_FAILED" | "LOGIN_CANCELLED" | "REFRESH_FAILED" | "LOGGED_OUT" | "REVOKE_FAILED" | "LOGOUT_PAGE_FAILED"`
  - `AuthStatus { configured: boolean; permitted: boolean; state: "LOGGED_OUT" | "LOGGED_IN" | "LOGIN_REQUIRED"; loginInProgress: boolean; notice: AuthNoticeCode | null }`
  - `type Fail = { ok: false; code: string; status?: number; message?: string }`（`status` は HTTP の応答があった時だけ。`message` は server の body の `message`）
  - `StoragePayloadType` は Task 12 で `ReminderUtils` と一緒に削除する（この task では残す）。
- Produces（`src/types/messages.ts`）: `type Message` = spec「message」の表の各行を `{ type: "...", ...入力 }` にした union（`config/save` は `{ config: ServerConfig }`、`mode/change` は `{ connectionType }`、`reminders/list` は `{ fresh?: boolean }`、`reminders/create` は `{ reminder: Reminder }`、`reminders/delete` は `{ id: string }`）。
- Produces（`src/utils/config.ts`）:
  - `normalizeConfig(c: ServerConfig): { ok: true; config: ServerConfig } | { ok: false; errors: Partial<Record<keyof ServerConfig, string>> }`
  - `configKey(c: ServerConfig): string`（4項目を `|` で連結）
  - `isConfigured(s: SettingsType): boolean`、`originPatterns(c: ServerConfig): string[]`（3つの `<origin>/*`）
  - `loadSettings(): Promise<SettingsType>`（`DEFAULT_SETTINGS` に storage の値を重ね、`url` などの未知の key を捨てる）
- Produces（`src/background/serial.ts`）: `createSerial(): <T>(fn: () => Promise<T>) => Promise<T>`（前の処理の失敗で鎖が止まらない）
- Produces（`src/background/gen.ts`）: `currentGen(): number`、`bumpGen(): number`（前の世代の `AbortController` を abort する）、`isCurrent(gen: number): boolean`、`signalFor(gen: number): AbortSignal`
- Produces（`src/background/pkce.ts`）: `base64url(bytes: Uint8Array): string`、`randomToken(): string`（32 byte）、`codeChallenge(verifier: string): Promise<string>`、`sha256Hex(data: ArrayBuffer | string): Promise<string>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// config.test.ts
expect(normalizeConfig({ apiBaseUrl: "https://a.example.com/", authBaseUrl: "https://b.example.com", clientId: "abc123", imageHost: "https://c.example.com" }))
  .toEqual({ ok: true, config: { apiBaseUrl: "https://a.example.com", authBaseUrl: "https://b.example.com", clientId: "abc123", imageHost: "https://c.example.com" } });
for (const bad of ["http://a.example.com", "https://a.example.com/path", "https://a.example.com?q=1", "https://a.example.com#h", "not a url"])
  expect(normalizeConfig({ ...good, apiBaseUrl: bad }).ok).toBe(false);
expect(normalizeConfig({ ...good, clientId: "ABC" }).ok).toBe(false);
// Review Focus 1
await chrome.storage.local.set({ settings: { autoOpen: true, webPush: false, connectionType: "server", url: "http://localhost:3000" } });
const s = await loadSettings();
expect(s).not.toHaveProperty("url"); expect(s.connectionType).toBe("server"); expect(isConfigured(s)).toBe(false);
// serial.test.ts: 2つ目は1つ目の完了後に始まり、1つ目の reject でも2つ目は動く
// gen.test.ts: bumpGen で前の signalFor(g).aborted が true、isCurrent(g) が false
// pkce.test.ts（RFC 7636 付録 B）
expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/utils/config.test.ts src/background`
Expected: FAIL（module が無い）

- [ ] **Step 3: 型と4つの module を実装する**

`normalizeConfig` は `new URL()` の `protocol === "https:"`、`pathname === "/"`、`search`・`hash` が空を条件にし、`origin` を返す。`clientId` は `/^[a-z0-9]+$/`。`DEFAULT_SETTINGS` に4項目（空文字）を足し、`connectionType: "local"` にする。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。続けて `npm run build` を通す。型の変更で壊れる既存の code は、Task 10・12・13 で書き換えるまでの暫定として次だけ直す。
- `new ReminderUtils(settings.url)`（`App.tsx`、`background.ts`）→ `settings.apiBaseUrl`
- `Settings.tsx` の URL の `Input` → `value={settings.apiBaseUrl}`、`onChange` で `apiBaseUrl` を更新
- `Settings.tsx` の `RadioGroup` の `onValueChange` → `value === "server" ? "server" : "local"` に絞ってから渡す

- [ ] **Step 5: Commit**（`feat: 設定・直列化・世代・PKCE の基礎を追加`）

---

### Task 3: v2 API client

**Files:**
- Create: `src/background/api.ts`、`src/background/api.test.ts`

**Interfaces:**
- Consumes: `isCurrent`、`signalFor`（Task 2）
- Produces:
  - `type TokenResult = { ok: true; token: string } | Fail`
  - `type ApiResult<T> = { ok: true; status: number; data: T; etag: string | null } | Fail`
  - `interface ApiDeps { baseUrl: string; gen: number; getToken: (gen: number, opts?: { force?: boolean }) => Promise<TokenResult>; sleep?: (ms: number) => Promise<void>; random?: () => number }`
  - `createApi(deps: ApiDeps)` が返す `{ listPage(cursor: string | null): Promise<ApiResult<{ items: ReminderDto[]; nextCursor: string | null }>>; getReminder(id): Promise<ApiResult<ReminderDto>>; createReminder(body: CreateBody): Promise<ApiResult<ReminderDto>>; patchReminder(id, patch: { hidden: true; thumbnail: null }, etag: string): Promise<ApiResult<ReminderDto>>; deleteReminder(id, etag): Promise<ApiResult<{ id: string; deleted: true; revision: number }>>; getThumbnailUrl(id): Promise<ApiResult<{ url: string; expiresAt: string; imageId: string; revision: number }>> }`
  - `type CreateBody = { id; url; title; reminderTime; autoOpen; webPush; hidden: false; thumbnail: string | null }`
  - 失敗の code: HTTP の応答があれば body の `code`、無ければ `HTTP_<status>`（`status` と、あれば `message` も付ける）。401 の再送の後の 401 は、body に関係なく `UNAUTHORIZED`（`status: 401`）。通信障害・timeout は GET で `NETWORK`、書き込みで `UNKNOWN_RESULT`（どちらも `status` 無し）。世代が違えば送らずに `STALE`（`status` 無し）。token が取れなければ `getToken` の code をそのまま返す。

- [ ] **Step 1: 失敗するテストを書く**（`fetch` は `vi.fn` を `vi.stubGlobal`、`sleep` は即時の `vi.fn`）

- `"送る前に世代を確かめる"`: `bumpGen()` の後の `listPage(null)` は `fetch` を呼ばずに `{ ok: false, code: "STALE" }`。
- `"Bearer と JSON を付ける"`: `createReminder` の request に `Authorization: Bearer t1`、`Content-Type: application/json`、`signal`。`getReminder("a/b")` の path が `/v2/reminders/a%2Fb`。
- `"401 で1回だけ force refresh して再送する"`: 401→200 で `getToken` が `{force: true}` 付きで1回、`fetch` 2回。401→401 で `{ ok: false, code: "UNAUTHORIZED", status: 401 }`、`fetch` 2回。
- `"429 は Retry-After と jitter で最大2回"`: `Retry-After: 3`、`random=()=>0.5` で `sleep(3500)`。3回とも 429 なら `fetch` 3回で失敗。
- Review Focus 2: `"JSON でない 429 は1秒待つ"`: body `"<html>"`、header 無し → `sleep(1000 + jitter)`、例外を投げない、最終的に `{ code: "HTTP_429", status: 429 }`。
- `"GET の通信障害は 0.5秒・1秒で最大2回、書き込みは再送しない"`: `fetch` が reject → `listPage` は3回呼んで `NETWORK`。`patchReminder` は1回で `UNKNOWN_RESULT`。503 の書き込みも `UNKNOWN_RESULT`。
- `"PATCH と DELETE に If-Match を付ける"`: `If-Match: "\"e1\""` をそのまま。成功時の `etag` は応答の `ETag`。
- `"403 は再試行しない"`: `fetch` 1回。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/background/api.test.ts`
Expected: FAIL

- [ ] **Step 3: `createApi` を実装する**

1つの内部の `request(method, path, { body?, ifMatch? })` に再試行の表（spec「API client」）を集める。fetch には `AbortSignal.any([AbortSignal.timeout(10_000), signalFor(gen)])`（Chrome 116 以上・Node 20.3 以上にある。TypeScript の lib に型が無ければ、`gen.ts` に `anySignal(signals: AbortSignal[]): AbortSignal` を1つ書いて Task 4 と共有する）。body の JSON の parse は try で囲む。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/background/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（`feat: v2 API client を追加`）

---

### Task 4: token の取得と refresh

**Files:**
- Create: `src/background/auth.ts`、`src/background/auth.refresh.test.ts`

**Interfaces:**
- Consumes: `createSerial`、`gen.ts`、`sha256Hex`、`loadSettings`、`configKey`、`isConfigured`（Task 2）
- Produces（`auth.ts`）:
  - `authLock: <T>(fn: () => Promise<T>) => Promise<T>`（auth mutex。`createSerial()` の1つの instance）
  - `getAccessToken(gen: number, opts?: { force?: boolean }): Promise<TokenResult>`（失敗の code は `NOT_CONFIGURED`、`LOGIN_REQUIRED`、`NETWORK`、`STALE`）
  - `clearAuth(): Promise<void>`（`authSession`・`authRefresh`・`refreshPending` を消す。呼び出し側が `authLock` の中で呼ぶ）
  - `getAuthStatus(): Promise<AuthStatus>`（spec「status」）
  - storage の key と形は spec「storage」の表のとおり（`authSession`、`authRefresh`、`authNotice`、`refreshPending`）

- [ ] **Step 1: 失敗するテストを書く**（`fetch` を stub。設定は storage に4項目を入れておく。`authRefresh = { refreshToken: "r1", configKey }`）

- `"期限まで30秒より多ければ token endpoint を呼ばない"`、`"30秒以下なら refresh する"`。
- `"同時の3回で token endpoint は1回"`: `Promise.all` で3回、`fetch` 1回、3つとも同じ token。
- `"新しい refresh token を access token より先に保存する"`: `storage.local.set` と `storage.session.set` の呼び出し順を記録して比べる。form は `grant_type=refresh_token&client_id=...&refresh_token=r1`、`Content-Type: application/x-www-form-urlencoded`、Basic 認証の header が無い。
- `"refresh_token の無い応答は失敗"`: `LOGIN_REQUIRED`、`authNotice.code === "REFRESH_FAILED"`、`authRefresh` が消える。
- `"token_type・expires_in が不正なら保存しない"`。
- `"invalid_grant で認証状態を消す"`、`"通信障害では消さない"`（`NETWORK`、`authRefresh` が残る、`refreshPending` が残る）。
- `"5xx は refreshPending を消して backoff で再送する"`。
- `"10秒を過ぎた refreshPending があれば送らない"`: `refreshPending = { refreshTokenHash: sha256Hex("r1"), firstSentAt: now - 11_000 }` で `fetch` を呼ばず `LOGIN_REQUIRED`。module を `vi.resetModules()` で読み直して（worker の再起動）も同じ。
- `"世代が変わった応答は捨てる"`: fetch の解決前に `bumpGen()` → storage が変わらず `STALE`。
- `"configKey が違う認証状態は使わずに消す"`。
- `getAuthStatus`: `authRefresh` が無く `authNotice.code === "REFRESH_FAILED"` なら `LOGIN_REQUIRED`、`authAttempt` が10分以内なら `loginInProgress: true`、`permitted` は `chrome.permissions.contains({ origins: originPatterns(...) })`。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/background/auth.refresh.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

single-flight は `Map<number, Promise<TokenResult>>`（世代ごと）。refresh の fetch は `AbortSignal.any([AbortSignal.timeout(4_000), signalFor(gen)])`、backoff は 0.5秒・1秒、`refreshPending.firstSentAt` から10秒を過ぎる再送はしない。保存・消去はすべて `authLock` の中で、書く直前に `isCurrent(gen)`。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/background/auth.refresh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（`feat: access token の取得と single-flight の refresh を追加`）

---

### Task 5: login（authorization code + PKCE）

**Files:**
- Modify: `src/background/auth.ts`
- Create: `src/background/auth.login.test.ts`

**Interfaces:**
- Consumes: `randomToken`、`codeChallenge`（Task 2）、`authLock`（Task 4）
- Produces: `login(gen: number): Promise<{ ok: true; gen: number } | Fail>`（失敗の code は `NOT_CONFIGURED`、`LOGIN_IN_PROGRESS`、`LOGIN_CANCELLED`、`LOGIN_FAILED`、`STALE`）。成功時に `authLock` の中で `bumpGen()` し、その新しい世代を `gen` で返す。cache と alarm の消去・同期の開始は、呼び出し側（Task 10）がこの `gen` を使って行う。`login` は queue に触らない。

- [ ] **Step 1: 失敗するテストを書く**（`launchWebAuthFlow` の mock は、渡された URL の `state` を読んで callback を返す）

- `"authorize の URL"`: `<authBase>/oauth2/authorize`、query は `response_type=code`、`client_id`、`redirect_uri=https://test-ext-id.chromiumapp.org/cognito`、`scope=openid reminder-api/read reminder-api/write`、`state`（43文字）、`code_challenge`、`code_challenge_method=S256`。`interactive: true`。
- `"code を交換して保存する"`: form は `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier`（challenge と対応）。`authRefresh` → `authSession` の順に保存、`authNotice` が消え、`currentGen()` が1つ進む。
- `"交換しない callback"`（each）: `launchWebAuthFlow` が reject（`LOGIN_CANCELLED`）、`undefined`（`LOGIN_CANCELLED`）、host 違い、path 違い（`/logout`）、`state` 違い、11分後、`error=access_denied`、`code` 無し（いずれも `LOGIN_FAILED`）。どれも token endpoint を呼ばず、`authAttempt` が消え、`authNotice.code` が上の code。
- `"応答の検証"`: `token_type: "bearer"`（小文字）や `expires_in: 0` は `LOGIN_FAILED` で保存しない。
- `"同時の2回の login で試行は1つ"`: 2つ目は `LOGIN_IN_PROGRESS`、`launchWebAuthFlow` は1回。
- `"古い試行の finally が新しい試行を消さない"`: 1回目の `authAttempt` を手で別の `state` に書き換えてから1回目を失敗させ、`authAttempt` が残る。
- `"logout 後に完了した login は保存しない"`: `launchWebAuthFlow` の解決前に `bumpGen()` → `STALE`、`authRefresh` が無い。
- `"許可が無ければ NOT_CONFIGURED"`: `permissions.contains` が `false`。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/background/auth.login.test.ts`
Expected: FAIL

- [ ] **Step 3: `login` を実装する**（spec「login」の1〜10。callback の照合は `new URL(returned)` の `origin + pathname` と `redirectUri` の比較）

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/background`
Expected: PASS

- [ ] **Step 5: Commit**（`feat: Cognito の PKCE login を追加`）

---

### Task 6: logout

**Files:**
- Modify: `src/background/auth.ts`
- Create: `src/background/auth.logout.test.ts`

**Interfaces:**
- Produces: `logout(clearLocal: (gen: number) => Promise<void>): Promise<{ revoked: boolean }>`。`clearLocal` は spec「logout」の3（cache と server の alarm の消去）で、revoke の後・logout の page を開く前に、1で進めた世代を渡して呼ぶ。`logout` は `authLock` を持ったまま `clearLocal` を呼ばない（Task 10 が `clearLocal` の中で queue を使うため）。

- [ ] **Step 1: 失敗するテストを書く**

- `"revoke の form"`: `POST <authBase>/oauth2/revoke`、`client_id` と `token=r1`。logout の page は `<authBase>/logout?client_id=<id>&logout_uri=https://test-ext-id.chromiumapp.org/logout`。
- `"revoke が失敗しても端末の状態は消える"`: fetch が reject → `revoked: false`、`authRefresh`・`authSession` が無い、`authNotice.code === "REVOKE_FAILED"`。
- `"logout page の失敗"`: `launchWebAuthFlow` が reject → `LOGOUT_PAGE_FAILED`。両方成功なら `LOGGED_OUT`。
- `"logout の後の API は LOGIN_REQUIRED"`: logout の直後の `getAccessToken(currentGen())`。
- `"revoke 中に成功した新しい login を消さない"`: revoke の fetch を保留し、その間に `login(currentGen())` を成功させ、revoke を解決 → `authRefresh` が新しい token のまま、`authNotice` を書かない。
- `"login の保存と logout の消去を交互にしても復活しない"`: login の保存の `storage.local.set` の後に logout を割り込ませる（`authLock` で順になることを確かめる）→ 最後に `authRefresh` も `authSession` も無い。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/background/auth.logout.test.ts` / Expected: FAIL

- [ ] **Step 3: `logout` を実装する**（spec「logout」の1〜5。3は `clearLocal(gen)` の呼び出し。テストでは `clearLocal` に `vi.fn` を渡し、revoke の後・page の前に1回、1の世代で呼ばれることも確かめる）

- [ ] **Step 4: テストが通ることを確かめる** — Run: `npx vitest run src/background` / Expected: PASS

- [ ] **Step 5: Commit**（`feat: logout を追加`）

---

### Task 7: cache・通知済みの記録・alarm の再構築

**Files:**
- Create: `src/background/cache.ts`、`src/background/alarms.ts`、`src/background/cache.test.ts`

**Interfaces:**
- Consumes: `createSerial`、`isCurrent`、`loadSettings`、`configKey`（Task 2）
- Produces（`cache.ts`）:
  - `queue: <T>(fn: () => Promise<T>) => Promise<T>`
  - `readCache(): Promise<ServerCache>`（無い、または `configKey` が今の設定と違えば、空の cache を返し、古いものは消す）
  - `writeCache(gen: number, cache: ServerCache): Promise<boolean>`（世代が違えば書かずに `false`）
  - `upsertItem(cache, dto, image?)`、`removeItem(cache, id)`: `ServerCache` を返す純粋関数
  - `clearServerCache(gen: number): Promise<boolean>`（世代が違えば消さずに `false`。古い login・logout の後処理が、新しい世代の cache を消さないため）
  - `markNotified(id: string): Promise<void>`（`notified:<id>` に `Date.now()`）、`getNotifiedIds(): Promise<Set<string>>`、`removeNotified(ids: string[]): Promise<void>`
  - `toReminders(cache: ServerCache, notified: Set<string>): Reminder[]`（spec「DTO から Reminder への変換」）
- Produces（`alarms.ts`）: `rebuildAlarms(gen: number): Promise<void>`（queue の中から呼ぶ前提。今のモードの一覧から、未来かつ `hidden:false`（server は通知済みも除く）の項目で alarm を作る。`clearAll()` を `await` してから作る。世代が違えば何もしない）、`clearServerAlarms(gen: number): Promise<void>`（今のモードが server の時だけ `clearAll()`）

- [ ] **Step 1: 失敗するテストを書く**

- `toReminders`: `imageId`・`sha256` が DTO と一致する時だけ data URL、違えば `NO_DATA.thumbnail`。`notified` にある id は `hidden: true`。
- `"notified の同時の記録がどちらも残る"`: `Promise.all([markNotified("a"), markNotified("b")])` → `getNotifiedIds()` が `{a, b}`。
- `readCache`: `configKey` が違う cache は空になり、storage から消える。
- `writeCache` と `clearServerCache`: `bumpGen()` の後に古い世代で呼ぶと `false` で、storage が変わらない。
- `upsertItem`: 同じ id を2回入れても1件（Review Focus 5）。
- `rebuildAlarms`: server モードで、未来・過去・`hidden:true`・通知済みの4項目 → 未来の1件だけ。local モードでは `reminders` から作る。世代が違えば `clearAll` を呼ばない。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/background/cache.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる** — Run: `npx vitest run src/background/cache.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**（`feat: server の cache と alarm の再構築を追加`）

---

### Task 8: 書き込みの手順（作成・非表示・削除）

**Files:**
- Create: `src/background/sync.ts`、`src/background/sync.write.test.ts`

**Interfaces:**
- Consumes: `createApi`（Task 3）、`getAccessToken`（Task 4）、`queue`・`readCache`・`writeCache`・`upsertItem`・`removeItem`・`toReminders`・`getNotifiedIds`（Task 7）、`rebuildAlarms`（Task 7）
- Produces（`sync.ts`）:
  - `apiFor(gen: number): Promise<ReturnType<typeof createApi>>`（設定の `apiBaseUrl` と `getAccessToken` で作る）
  - 公開の関数（queue の外から呼ぶ。API の通信は queue の外で行い、成功後に `queue(() => ...)` の中で `readCache` → 更新 → `writeCache` → `rebuildAlarms` をする）:
    - `createOnServer(gen: number, r: Reminder): Promise<{ ok: true; reminder: Reminder } | Fail>`
    - `hideOnServer(gen: number, id: string): Promise<{ ok: true } | Fail>`（`notify.ts` から呼ぶ）
    - `deleteOnServer(gen: number, id: string): Promise<{ ok: true } | Fail>`（user の削除。412 は `CONFLICT`）
  - queue の中から呼ぶ関数（Task 9 の同期が使う。queue に積まず、`writeCache` もしない。渡された `cache` を更新した新しい `ServerCache` を返す）:
    - `hideInQueue(gen: number, api: Api, cache: ServerCache, id: string): Promise<{ result: { ok: true } | Fail; cache: ServerCache }>`
    - `deleteInQueue(gen: number, api: Api, cache: ServerCache, id: string): Promise<{ result: { ok: true } | Fail; cache: ServerCache }>`（期限切れの整理。412 は GET からやり直す）
  - 通信と判定の本体（GET → 判定 → PATCH/DELETE → 412・404・`UNKNOWN_RESULT` の処理）は、公開の関数と `...InQueue` で共有する内部の関数に1つだけ書く。`type Api = ReturnType<typeof createApi>`。

- [ ] **Step 1: 失敗するテストを書く**（`createApi` を `vi.mock` で fake にし、route ごとの応答を並べる）

- 作成: `"201 で成功し cache に入る"`（body は spec の7 field と `hidden: false`。`thumbnail` が `NO_DATA.thumbnail` なら `null`、`createdAt` などは送らない）。`"UNKNOWN_RESULT → GET 200 で成功"`、`"UNKNOWN_RESULT → GET 404 → POST 1回だけ再送"`、`"409 → GET 404 で ALREADY_EXISTS"`、`"409 → GET 200 で成功"`。
- 非表示: `"最新が未来の時刻なら PATCH しない"`、`"すでに hidden かつ thumbnail null なら PATCH しない"`、`"412 で GET からやり直す（1回）"`、`"404 で cache から外す"`、`"UNKNOWN_RESULT → GET で両方の条件を満たせば成功"`。PATCH の body は `{ hidden: true, thumbnail: null }` だけ。
- 削除: `"user の 412 は cache を最新にして CONFLICT、DELETE は1回"`（`deleteOnServer`）、`"cleanup の 412 は GET からやり直す"`・`"cleanup で最新が1か月以内なら DELETE しない"`（`deleteInQueue`）、`"404 と UNKNOWN_RESULT → GET 404 は成功"`。
- 再入: `"queue の中から hideInQueue・deleteInQueue を呼んでも完了する"`（`queue(() => hideInQueue(...))` が timeout せずに解決する）。
- 世代: `"受け付けた後に bumpGen されたら API を送らず STALE"`（作成の前に `bumpGen()`）。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/background/sync.write.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装する**（spec「書き込みの手順」。期限の判定は `oneMonthBefore`）

- [ ] **Step 4: テストが通ることを確かめる** — Run: `npx vitest run src/background/sync.write.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**（`feat: v2 への書き込みの手順を追加`）

---

### Task 9: 一覧の同期

**Files:**
- Modify: `src/background/sync.ts`
- Create: `src/background/sync.list.test.ts`

**Interfaces:**
- Produces: `listReminders(gen: number, fresh: boolean): Promise<{ ok: true; reminders: Reminder[] } | (Fail & { reminders: Reminder[] })>`。`fresh` が `false` なら cache の変換だけ。`true` なら `syncedAt` から60秒以内は cache、それ以外は同期（世代ごとの single-flight、queue の中）。
- 内部: `pickRandom<T>(xs: T[], n: number, random = Math.random): T[]`（export してテストする）

- [ ] **Step 1: 失敗するテストを書く**

- `"空の items で nextCursor が残る page を読み続ける"`: 3 page（`[a]`+`c1`、`[]`+`c2`、`[b]`+`null`）→ cache は `[a, b]`。
- `"60秒以内は同期しない"`、`"同時の fresh は1回の同期"`。
- `"整理は書き込み30件まで"`: 期限切れ40件 → PATCH・DELETE の合計が30。`"1か月より前は DELETE だけ"`。
- `"画像は30件まで、sha256 と imageId が同じなら取り直さない"`。
- `"画像の照合"`（each）: URL の `imageId` 違い、origin が `imageHost` と違う、status 200 以外、`bytes` 違い、hash 違い → 保存しない。S3 の fetch に `Authorization` が無く、`redirect: "error"`。
- `"DTO の thumbnail が null、または DTO に無い id の画像を消す"`。
- `"notified から hidden:true と DTO に無い id を消す"`。
- `"同期中の作成が全件置き換えで消えない"`: 同期の `listPage` を保留する → `createOnServer` を開始して Promise を持つ（POST は即 201）→ `listPage` を解決する → 両方の Promise を待つ → cache に作成した項目が1件だけある。`listPage` の応答に作成した id を含める場合と含めない場合の両方で確かめる。
- `"同期中の config/save が完了する"`（lock の順）: 同期の `listPage` を保留し、`config/save` の処理（Task 10 と同じ `queue(() => authLock(...))`）を開始 → `listPage` を解決 → 両方が timeout せずに解決する。
- `"失敗した時は cache の変換と code を返す"`。
- `"同期の後に server の alarm を作り直す"`。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/background/sync.list.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装する**（spec「一覧の同期」の手順1〜6。整理には `hideInQueue`・`deleteInQueue` を使い、最後に1回 `writeCache`）

- [ ] **Step 4: テストが通ることを確かめる** — Run: `npx vitest run src/background` / Expected: PASS

- [ ] **Step 5: Commit**（`feat: v2 の一覧の同期を追加`）

---

### Task 10: message の受付・通知・background の配線

**Files:**
- Create: `src/background/messages.ts`、`src/background/notify.ts`、`src/background/messages.test.ts`、`src/background/notify.test.ts`
- Modify: `src/background.ts`（listener の登録だけに書き換える）

**Interfaces:**
- Consumes: Task 4〜9 のすべて
- Produces（`messages.ts`）:
  - `isTrustedSender(sender: chrome.runtime.MessageSender): boolean`
  - `isValidId(id: unknown): id is string`
  - `parseMessage(raw: unknown): { kind: "ok"; msg: Message } | { kind: "invalid" } | { kind: "unknown" }`
  - `handleMessage(msg: Message): Promise<unknown>`（世代は受け付けた時の `currentGen()` で固定する）
- Produces（`notify.ts`）: `handleAlarm(id: string): Promise<void>`、`handleNotificationClick(id: string): Promise<void>`（local モードの処理は今の `background.ts` のまま移す）
- `background.ts`: 起動時と `onInstalled` で `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`。`onInstalled` は `queue(() => rebuildAlarms(currentGen()))`。`onMessage` は送信元を確かめ、`unknown` は無視、`invalid` は `{ ok: false, code: "INVALID_MESSAGE" }`、それ以外は `handleMessage(msg).then(sendResponse)` で `return true`。

`handleMessage` の振り分け:

| type | 処理 |
| --- | --- |
| `auth/status` | `getAuthStatus()` |
| `auth/login` | `login(gen)`。成功なら返った `g` で `queue(async () => { if (await clearServerCache(g)) await clearServerAlarms(g) })` の後、`listReminders(g, true)` を待たずに始める |
| `auth/logout` | `logout((g) => queue(async () => { if (await clearServerCache(g)) await clearServerAlarms(g) }))`。`{ ok: true, revoked }` |
| `config/save` | `normalizeConfig` で再検証 → `queue(() => authLock(...))` の中で保存。`configKey` が変わったら `bumpGen()` した `g` で `clearAuth()`、`clearServerCache(g)`、`clearServerAlarms(g)` |
| `mode/change` | `queue` の中で保存、`bumpGen()`、`rebuildAlarms(currentGen())` |
| `alarms/reset` | `queue` の中で、受け付けた時の世代とモードが今と一致すれば `rebuildAlarms` |
| `reminders/*` | server モードでなければ `NOT_SERVER_MODE`。`list` → `listReminders`、`create` → `createOnServer`、`delete` → `deleteOnServer(gen, id)` |

- [ ] **Step 1: 失敗するテストを書く**

- `isTrustedSender`: `{ id: "test-ext-id", url: "chrome-extension://test-ext-id/popup.html" }` は true。`id` 違い、`url` が `https://example.com/`（content script）、`url` 無しは false。
- `isValidId`（each）: `""`、129 code point、`"a\u0000"`、`"a\u0085"`、`"\ud800"` は false。128 code point の絵文字の文字列と UUID は true。
- `parseMessage`: 未知の type は `unknown`。`reminders/create` の `reminder.url` が `ftp:` や 4097 文字、`title` が 1025 文字、`autoOpen` が `"true"` は `invalid`。`config/save` の不正な URL は `invalid`。
- `"local モードの reminders/list は NOT_SERVER_MODE"`。
- `"config/save で接続先が変わると認証と cache と alarm が消え、世代が進む"`。変わらなければ消さない。
- `"logout の revoke 中に成功した新しい login の cache と alarm を、logout の後処理が消さない"`。`"login の後処理の前に logout が来たら、login の後処理は何もしない"`。
- `"受け付けた後に config/save が来た作成は STALE で API を送らない"`。
- `"alarms/reset の受付の後に mode/change が来たら何もしない"`、`"mode/change の後に古いモードの alarm が残らない"`。
- `"進行中の server の同期が、切り替えた後の local の alarm を上書きしない"`。
- Review Focus 3: `"login の window を開いている間の auth/status は loginInProgress: true、取り消し後は notice: LOGIN_CANCELLED"`。
- `notify.test.ts`: `"通知済み・hidden・1分より先・cache に無い項目は通知しない"`、`"通知の前に notified:<id> を書く"`（`notifications.create` の呼び出し時に storage にある）、`"通知の後に hideOnServer を呼び、失敗しても例外を投げない"`、`"local モードは今の動作（hidden を true にして保存）"`。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/background/messages.test.ts src/background/notify.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストと build を通す** — Run: `npm test && npm run build` / Expected: PASS（`dist/assets/background.js` が出る）

- [ ] **Step 5: Commit**（`feat: background の message と通知を v2 に切り替える`）

---

### Task 11: manifest と extension ID

**Files:**
- Modify: `public/manifest.json`

- [ ] **Step 1: 鍵を repository の外に作る**

```bash
mkdir -p ~/.config/webpagereminder && chmod 700 ~/.config/webpagereminder
openssl genrsa -out ~/.config/webpagereminder/extension-key.pem 2048
openssl rsa -in ~/.config/webpagereminder/extension-key.pem -pubout -outform DER | base64 -w0   # → key
openssl rsa -in ~/.config/webpagereminder/extension-key.pem -pubout -outform DER | sha256sum | head -c32 | tr 0-9a-f a-p   # → extension ID
```

鍵が既にあれば作り直さない（ID が変わる）。devcontainer の home は作り直すと消えるので、owner に安全な場所へ移すよう報告する。

- [ ] **Step 2: manifest を spec「manifest」のとおりにする**

`permissions` から `identity.email` を外し、`host_permissions` を消し、`optional_host_permissions: ["https://*.amazonaws.com/*", "https://*.amazoncognito.com/*"]` と `key` を足す。

- [ ] **Step 3: 確かめる**

Run: `node -e "const m=require('./public/manifest.json');if(m.host_permissions||m.permissions.includes('identity.email')||!m.key||m.optional_host_permissions.length!==2)process.exit(1)" && test -f ~/.config/webpagereminder/extension-key.pem && ! git ls-files --others --cached | grep -q '\.pem$' && npm run build`
Expected: すべて exit 0（manifest が spec どおり、鍵が repository の外にあり、`.pem` が repository に無く、build が通る）。

- [ ] **Step 4: Commit**（`feat: manifest の権限を絞り、extension ID を固定する`）。ID と2つの URL（`https://<id>.chromiumapp.org/cognito`、`/logout`）を報告に残す。

---

### Task 12: popup の reminder の画面

**Files:**
- Create: `src/utils/bg.ts`、`src/utils/image.ts`、`src/utils/bg.test.ts`、`src/utils/image.test.ts`
- Modify: `src/App.tsx`、`src/utils/ReminderUtils.ts`（`ReminderUtils` class・`getUserId`・axios の import を削除）、`src/utils/nodataUtils.ts`（`resetAlerm` を削除）、`package.json`（`axios` を削除）

**Interfaces:**
- Consumes: `Message`（Task 2）、Task 10 の応答の形
- Produces（`bg.ts`）: `send<T>(msg: Message): Promise<T | Fail>`（`sendMessage` の reject は `{ ok: false, code: "NETWORK" }`）、`errorText(code: string, status?: number): string | null`（spec「error の表示」の表。`STALE` は `null`。`HTTP_429` は429の文言、status 403 は「権限がありません（<code>）」）
- Produces（`image.ts`）:
  - `decodedSize(dataUrl: string): number`
  - `type Reencoded = { dataUrl: string; width: number; height: number }`
  - `shrinkToLimit(dataUrl: string, reencode: (dataUrl: string) => Promise<Reencoded>, limit = 1_048_576): Promise<string | null>`: 1 MiB 以下ならそのまま返す。超えれば `reencode` を繰り返し、収まった時点の data URL を返す。`reencode` の結果の長い辺が 16px 未満になった時、または8回繰り返しても収まらない時は `null`（16px と8回は spec に無い、この計画で決めた打ち切りの条件）。
  - `canvasHalve(dataUrl: string): Promise<Reencoded>`（popup 用。幅と高さを半分にした JPEG quality 0.5）
- 画像なしの経路は1つにする: capture の失敗（`NO_DATA.thumbnail` の path）は縮小せず、そのまま `Reminder.thumbnail` に入れる。`shrinkToLimit` が `null` なら `Reminder.thumbnail = NO_DATA.thumbnail` にする。API の `null` への変換は Task 8 の `createOnServer` だけが行う。

- [ ] **Step 1: 失敗するテストを書く**

- `errorText`: 表の各 code の文言、`STALE` → `null`、未知 → `"エラー（X）"`。
- `send`: `chrome.runtime.sendMessage` が reject → `{ ok: false, code: "NETWORK" }`。
- `decodedSize`: `"data:image/png;base64,QUJD"` → 3、padding 付き → 正しい byte 数。
- Review Focus 4: `shrinkToLimit` に「呼ぶたびに data の長さと寸法を半分にする fake」を渡すと、4 MiB（4000×3000）は2回で収まる。「長さが変わらず寸法だけ半分になる fake」なら長い辺が 16px 未満になった時点で `null`。「長さも寸法も変わらない fake」なら8回で止まり `null`。1 MiB 以下は `reencode` を呼ばずにそのまま返す。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/utils` / Expected: FAIL

- [ ] **Step 3: `bg.ts`・`image.ts` を実装し、`App.tsx` を書き換える**

- 初期化: `loadSettings()`。server モードは `send({type:"reminders/list"})` で表示し、続けて `send({type:"reminders/list", fresh:true})` で更新する。失敗なら `reminders` を表示し `errorText` を Label に出す。local への自動の切り替えを削除する。
- 作成: server は `shrinkToLimit(capture, canvasHalve)` の後に `send({type:"reminders/create", reminder})`。失敗なら一覧を元に戻し error を出す。local は今のまま保存し、`send({type:"alarms/reset"})`。
- 削除: server は `send({type:"reminders/delete", id})`、`CONFLICT` なら `reminders/list` を読み直す。local は今のまま保存し、`alarms/reset`。
- 切断の後の読み直し: `send` が `NETWORK` を返したら、`App` の state の `needsReload` を `true` にする。次の操作（作成・削除・モードの切り替え）の前に、`needsReload` なら `reminders/list`（`fresh: true`）と `auth/status` を読み直して表示を更新し、`false` に戻してから操作する。開き直した時は初期化で両方を読む。
- `chrome.alarms` と `resetAlerm` の呼び出しをすべて消す。
- `StoragePayloadType` を `src/types/types.ts` から削除する。

- [ ] **Step 4: テストと build を通す** — Run: `npm test && npm run lint && npm run build && ! grep -rnE "chrome\.alarms|resetAlerm" src/App.tsx src/components src/utils && ! grep -rnE "axios|new ReminderUtils|getProfileUserInfo|StoragePayloadType" src package.json` / Expected: すべて exit 0。

- [ ] **Step 5: 手で確かめる**: server モードで service worker を `chrome://extensions` から停止した直後に作成を押す → error が出る → もう一度押すと、一覧と状態が読み直されてから作成される。

- [ ] **Step 6: Commit**（`feat: popup の reminder の操作を background の message に切り替える`）

---

### Task 13: 設定画面

**Files:**
- Create: `src/components/ServerSettings.tsx`
- Modify: `src/components/Settings.tsx`、`src/App.tsx`（props の受け渡し）

**Interfaces:**
- Consumes: `normalizeConfig`・`originPatterns`（Task 2）、`send`・`errorText`（Task 12）
- Produces:
  - `Settings` の props: `{ settings: SettingsType; onSettingsChange: (patch: Partial<Pick<SettingsType, "autoOpen" | "webPush">>) => void; onModeChange: (t: ConnectionType) => void }`。`App` は `onSettingsChange` で storage の今の値にその field だけを重ねて保存し、`onModeChange` で `send({type:"mode/change", connectionType})` の後に一覧を読み直す。
  - `ServerSettings` の props: `{ settings: SettingsType; onSaved: (c: ServerConfig) => void }`。入力中の4項目は component の state。

- [ ] **Step 1: `ServerSettings` を実装する**（spec「設定画面」）

- 4つの `Input`（既存の `@/components/ui/input`）と「保存」ボタン。保存は `normalizeConfig` → 欄ごとの error の表示 → `send({type:"config/save", config})` → `chrome.permissions.request({ origins: originPatterns(config) })`。
- 状態欄は `send({type:"auth/status"})` を開いた時と各操作の後に読み、次の文言にする: 未設定 / 許可なし（「許可する」ボタン）/ 未ログイン / ログイン中 / 要再ログイン / ログイン処理中。`notice` が `REVOKE_FAILED` なら「ログアウトしたが、server 側の失効は未完了（通信障害）」、`LOGOUT_PAGE_FAILED` なら「Cognito のログインの記録が残っている可能性がある」も出す。
- 「ログイン」「ログアウト」ボタンは状態に応じて片方を出す。
- 保存・ログイン・ログアウトの `send` が `NETWORK` を返したら、次にこの画面で操作する前に `auth/status` を読み直す（Task 12 の `needsReload` と同じ扱い。`App` から props で受け取らず、component の中の state で持つ）。
- callback URL と logout URL（`chrome.identity.getRedirectURL("cognito")`、`("logout")`）を `readOnly` の `Input` で出す。

- [ ] **Step 2: `Settings.tsx` を書き換える**

Connection Type の `RadioGroup` は `onModeChange`、Auto-open・Web Push は `onSettingsChange` に field だけを渡す。旧 `url` の `Input` を消し、server モードの時だけ `ServerSettings` を出す。

- [ ] **Step 3: build と lint を通す** — Run: `npm run lint && npm run build && npm test` / Expected: PASS

- [ ] **Step 4: 手で確かめる**

`dist/` を unpacked で読み込み、次を確かめる（実 AWS が無ければ、4項目に `https://api.example.amazonaws.com` などを入れて UI の動きだけ見る）。
- 不正な URL で欄の下に error が出て保存されない。
- 保存で許可の dialog が出る。拒否すると状態が「許可なし」で「許可する」ボタンが出る。
- callback URL が `https://<Task 11 の ID>.chromiumapp.org/cognito`。
- local と server を切り替えても例外が出ない（service worker の console）。

- [ ] **Step 5: Commit**（`feat: server の接続先とログインの設定画面を追加`）

---

### Task 14: README と CLAUDE.md、全体の確認

**Files:**
- Modify: `README.md`、`CLAUDE.md`（`AGENTS.md` は symlink なので触らない）

- [ ] **Step 1: README に server モードの節を足す**

operator から受け取る値（spec の handoff「接続先の値」の表の4つ）、operator に渡す値（`chrome_origin`、`callback_url`、`logout_url` と、Task 11 の ID を入れた実際の値）、設定の手順、旧版を `chrome://extensions` から削除すること（local のデータは引き継がない）。AWS の実際の値は書かない。

- [ ] **Step 2: `CLAUDE.md` を spec「CLAUDE.md」の完成後の文面で置き換える**

- [ ] **Step 3: 全体を確かめる**

Run: `npm ci && npm run lint && npm test && npm run build && test "$(wc -l < CLAUDE.md)" -lt 200 && test "$(readlink AGENTS.md)" = CLAUDE.md && ! grep -rnE "[\"'\`]/reminders[\"'\`]|getProfileUserInfo|key: await" src`
Expected: すべて exit 0（`CLAUDE.md` が 200 行未満、`AGENTS.md` が `CLAUDE.md` への symlink のまま、旧 route の文字列 `"/reminders"` と body の `key` の組み立てが残っていない）。

- [ ] **Step 4: Commit**（`docs: README と CLAUDE.md を v2 移行に合わせる`）

- [ ] **Step 5: push して PR を出す**

`git push -u origin feature-v2-cognito`、`gh pr create`。PR の本文に、Task 11 の ID と2つの URL、受け入れ確認（handoff の作業6）が未実施であることを書く。本文の末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
