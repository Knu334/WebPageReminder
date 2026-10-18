# Chrome 拡張機能の reminder-server v2 API・Cognito 認証への移行 設計

作成日: 2026-10-19。

## 目的

reminder-server が旧 API（`POST/PUT /reminders`、body の `key` で識別、全件上書き）を廃止して 410 を返すようになった。server モードを v2 API（1件ごとの CRUD、ETag）と Cognito の認証（authorization code + PKCE）に移行する。local モードは今の動作を保つ。

## 正の文書

契約の正は reminder-server の repository（https://github.com/Knu334/reminder-server）の次の文書と code である。この repository の `docs/handoffs/` にある写しは gitignore の対象で、参照用である。

- `docs/handoffs/api-v2.md`: v2 API の route、DTO、ETag、error、制限
- `docs/handoffs/chrome-extension-cognito-auth.md`: MV3 の認証の要件
- `docs/handoffs/2026-10-18-chrome-extension-v2.md`: 作業の要約と順序

## 決めたこと

| 論点 | 決定 |
| --- | --- |
| データの持ち方 | local/server の切替を維持する。server モードは server を正とし、`chrome.storage.local` に cache（一覧、画像の bytes）を持つ。書き込みはオンラインの時だけ行い、offline の書き込み queue は作らない |
| 接続先の値 | 設定画面で入力する。build に埋め込まない |
| host の許可 | `optional_host_permissions` に置き、設定の保存時に入力された origin だけを `chrome.permissions.request` で求める |
| extension ID | 新しく RSA 鍵を生成し、公開鍵を manifest の `key` に入れる。秘密鍵は repository の外で owner が保管する |
| 通信の場所 | 認証と API の通信はすべて service worker で行う。popup は message で結果だけを受け取る |
| library | 追加しない。`fetch` と `crypto.subtle` で書く。axios は削除する |
| テスト | `vitest` を devDependency に加え、`chrome.*` と `fetch` を mock して unit test を書く |

## 範囲

含める:

1. 旧 API の `key`（Google のプロフィール ID）による識別を、Cognito の access token に置き換える。
2. 全件上書きを、1件ごとの POST・PATCH・DELETE と ETag に置き換える。書き込みは `await` して結果を扱う。
3. server の失敗時に local モードへ自動で切り替えて保存する動作を削除する。cache と error を表示する。
4. `<all_urls>` と `identity.email` を外す。
5. alarm と通知の click で通信せず、cache から読む。
6. 接続先の URL を https に限り、入力のたびの保存をやめて「保存」ボタンで確定する。
7. `removeOldReminders` の1か月前の計算のずれ（3/31 から1か月前が 3/3 になる）を直す。

含めない（別の PR）:

- `ReminderList` の sort の比較、background の `openedReminders`、`App.tsx` の DOM の直接操作、`DateTimePicker` の日の繰り上がり、build 用 tool の脆弱性、eslint の globals、`popup.html` の title。
- 実 AWS と Chrome での受け入れ確認（handoff の作業6）。operator と行う。

## 構成

```
popup (React)
  ├─ local モード: 今のまま chrome.storage.local の reminders を読み書きする
  └─ server モード: chrome.runtime.sendMessage → background
background (service worker)
  ├─ auth.ts      login / getAccessToken（single-flight refresh）/ logout / status
  ├─ api.ts       v2 client。認証の付与、再試行、error の分類
  ├─ cache.ts     server の一覧と画像の cache
  ├─ sync.ts      一覧の同期、期限切れの整理、画像の取得
  ├─ messages.ts  popup からの message の振り分け
  └─ background.ts alarm、通知、onInstalled（既存）
```

### manifest

- `permissions`: `storage`、`tabs`、`notifications`、`alarms`、`activeTab`、`unlimitedStorage`、`identity`、`scripting`。`identity.email` は外す。
- `host_permissions` は書かない。`<all_urls>` を外す。popup を開いた時の `executeScript` と `captureVisibleTab` は `activeTab` で足りる。
- `optional_host_permissions`: `https://*.amazonaws.com/*`、`https://*.amazoncognito.com/*`。
- `key`: 生成した公開鍵（Base64 の DER）。

### 設定（`SettingsType`）

```ts
interface SettingsType {
  autoOpen: boolean;
  webPush: boolean;
  connectionType: "local" | "server";
  apiBaseUrl: string;   // https://<api-id>.execute-api.<region>.amazonaws.com
  authBaseUrl: string;  // https://<prefix>.auth.<region>.amazoncognito.com
  clientId: string;
  imageHost: string;    // https://<bucket>.s3.<region>.amazonaws.com
}
```

- 旧 `url` は読み込み時に捨てる。
- `apiBaseUrl`、`authBaseUrl`、`imageHost` は `https:` の URL で、path・query・hash が無いことを検証する。`clientId` は小文字英数字。
- 保存時に3つの origin（`<origin>/*`）を `chrome.permissions.request` で求める。拒否されたら保存しない。popup が許可の dialog で閉じた場合に備え、popup を開くたびに `chrome.permissions.contains` で状態を表示する。
- 接続先（4項目のどれか）が変わったら、認証状態と cache を消す。

### storage

| 置き場所 | key | 中身 |
| --- | --- | --- |
| `chrome.storage.session` | `authSession` | `{accessToken, expiresAt, configKey}` |
| `chrome.storage.session` | `authAttempt` | `{state, verifier, redirectUri, configKey, startedAt}` |
| `chrome.storage.local` | `authRefresh` | `{refreshToken, configKey}` |
| `chrome.storage.local` | `settings` | `SettingsType` |
| `chrome.storage.local` | `reminders` | local モードの一覧（既存） |
| `chrome.storage.local` | `serverCache` | `{items: ReminderDto[], images: {[id]: {imageId, sha256, dataUrl}}, syncedAt, configKey}` |

- `configKey` は `apiBaseUrl`、`authBaseUrl`、`clientId` を連結した文字列。今の設定と違う認証状態・cache は使わずに消す。
- background の起動時と `onInstalled` で `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})` を呼ぶ。
- token を `chrome.storage.sync`、DOM、URL、log に置かない。

## 認証（`auth.ts`）

### login

popup の「ログイン」ボタンの message からだけ始める。起動時に開かない。

1. 設定の4項目がそろい、`chrome.permissions.contains` で許可があることを確かめる。無ければ `NOT_CONFIGURED`。
2. `state` と `code_verifier` を、それぞれ `crypto.getRandomValues` の 32 byte を padding なしの Base64URL（43文字）にして作る。`code_challenge = BASE64URL(SHA256(ASCII(verifier)))`。
3. `redirectUri = chrome.identity.getRedirectURL("cognito")`。`authAttempt` を session に置く。新しい試行は古い試行を上書きする。
4. `URLSearchParams` で `response_type=code`、`client_id`、`redirect_uri`、`scope=openid reminder-api/read reminder-api/write`、`state`、`code_challenge`、`code_challenge_method=S256` を組み、`<authBase>/oauth2/authorize` を `launchWebAuthFlow({url, interactive: true})` で開く。popup は閉じてよい。処理は background で続き、popup は開き直した時に `auth/status` で結果を表示する。
5. 返った URL を検証する。次のどれかに当たれば交換へ進まない。
   - URL が `undefined`、または `launchWebAuthFlow` が reject した（取り消し）
   - origin と pathname が `redirectUri` と一致しない
   - `state` が `authAttempt.state` と一致しない
   - `startedAt` から10分を過ぎた
   - `error` param がある、または `code` が無い
6. `POST <authBase>/oauth2/token` に `Content-Type: application/x-www-form-urlencoded` で `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier` を送る。`client_secret` と Basic 認証は使わない。
7. 応答の `access_token`・`refresh_token` が文字列、`token_type === "Bearer"`、`expires_in` が正の数であることを検証する。
8. 先に `authRefresh` を local に保存し、そのあと `authSession`（`expiresAt = now + expires_in * 1000`）を session に保存する。
9. 成否にかかわらず `finally` で `authAttempt` を消す。

### getAccessToken

- `authSession` があり、`configKey` が今の設定と一致し、`expiresAt - now > 30秒` なら、その access token を返す。
- そうでなければ refresh する。refresh の Promise は module 変数に1つだけ持ち、同時の呼び出しは同じ Promise を待つ（single-flight）。
- `authGen`（module 変数の世代番号）を refresh の開始時に記録する。logout と接続先の変更で `authGen` を進める。応答時に世代が違えば、結果を保存せずに捨てる。

### refresh

- `POST <authBase>/oauth2/token` に form で `grant_type=refresh_token`、`client_id`、`refresh_token` を送る。
- 成功: login の7・8と同じ検証と保存の順番。応答に `refresh_token` があれば、新しい値を先に local へ保存する。
- 400 で `error` が `invalid_grant`、または `invalid_client`・`unauthorized_client`: 認証状態（`authRefresh`、`authSession`）を消し、`LOGIN_REQUIRED` を返す。
- 通信障害・5xx: jitter 付きの backoff（0.5秒、1秒、2秒）で最大3回。refresh token は消さず、`NETWORK` を返す。
- refresh token の期限は延びない（初回から30日）。期限切れは `invalid_grant` で扱う。

### logout

1. `authGen` を進める。
2. `POST <authBase>/oauth2/revoke` に form で `client_id` と `token`（refresh token）を送る。200 なら `revoked = true`。通信障害・5xx なら `false`。
3. `authRefresh`、`authSession`、`serverCache` を消す。
4. `launchWebAuthFlow({url: <authBase>/logout?client_id=<id>&logout_uri=<getRedirectURL("logout")>, interactive: true})` を開く。失敗しても logout は完了扱い。
5. popup に `{revoked}` を返す。`false` なら「ログアウトしたが、server 側の失効は未完了（通信障害）」と表示する。

### status

`auth/status` は `{configured, permitted, state: "LOGGED_OUT" | "LOGGED_IN" | "LOGIN_REQUIRED", lastRevokeFailed}` を返す。`LOGGED_IN` は `authRefresh` があり `configKey` が一致すること。

## API client（`api.ts`）

- `request(method, path, {body, ifMatch})`: `getAccessToken()` の token を `Authorization: Bearer` で付ける。body は `Content-Type: application/json`。`{id}` は `encodeURIComponent` する。
- 戻り値は `{ok: true, status, data, etag}` か `{ok: false, status, code, message}`。`code` は body の `code`、無ければ status から決める（Gateway の error は形が違うため）。

| status | 動作 |
| --- | --- |
| 401 | 強制的に refresh して1回だけ再送する。再び 401 なら `UNAUTHORIZED` |
| 403 | 返す。再試行しない |
| 429 | `Retry-After`（無ければ1秒）に 0〜1 秒の jitter を足し、最大2回再試行 |
| 503・通信障害（GET） | jitter 付き backoff（0.5秒、1秒）で最大2回 |
| 503・通信障害（POST・PATCH・DELETE） | 自動で再送しない。`UNKNOWN_RESULT` を返し、呼び出し側が GET で照合する |
| その他 | そのまま返す |

関数:

- `listPage(cursor)`: `GET /v2/reminders?limit=50&cursor=`
- `getReminder(id)`: `GET /v2/reminders/{id}` → DTO と ETag
- `createReminder(body)`: `POST /v2/reminders`
- `patchReminder(id, patch, etag)`: `PATCH`、`If-Match: etag`
- `deleteReminder(id, etag)`: `DELETE`、`If-Match: etag`
- `getThumbnailUrl(id)`: `GET /v2/reminders/{id}/thumbnail-url`

S3 の画像の fetch は `api.ts` を通さず、Bearer を付けない。

### 書き込みの手順（`sync.ts`）

- **作成**: POST。`UNKNOWN_RESULT` なら GET で照合する。200 なら成功、404 なら1回だけ POST し直す。409 は「すでに作成済みか、別の id」として GET で照合し、200 なら成功。
- **更新（`hidden:true, thumbnail:null` だけ）**: GET で ETag を取り、PATCH する。412 なら GET からやり直す（1回）。404 なら remote で消えたものとして cache から外す。`UNKNOWN_RESULT` なら GET して `hidden` が `true` なら成功。
- **削除**: GET で ETag を取り、DELETE する。412 なら GET からやり直す（1回）。404、または `UNKNOWN_RESULT` 後の GET が 404 なら成功。成功したら cache から外す。
- 読んだ DTO をそのまま PATCH に送らない。

## 一覧の同期（`sync.ts`）

`reminders/list` の message:

1. `serverCache` を `Reminder[]` に変換して、すぐに popup へ返す（`{ok: true, reminders, stale: true}`）。
2. `syncedAt` から60秒以内なら、ここで終わる。
3. そうでなければ同期する。popup は同期の後に `reminders/list` を `{fresh: true}` で再び呼び、結果で表示を更新する。同期中の重複は single-flight にする。

同期の手順:

1. `listPage` を直列に、`nextCursor` が `null` になるまで読む。`items` が空でも続ける。cache の `items` を全件置き換える。
2. 整理: `reminderTime` が今より前で `hidden:false` の項目は、更新の手順で `hidden:true, thumbnail:null` にする。`reminderTime` が1か月より前の項目は削除の手順で消す。直列に行う。
3. 画像: DTO の `thumbnail` が `null` なら cache の画像を消す。`{imageId, sha256}` が cache と違う項目だけ、`getThumbnailUrl` → 署名 URL の origin が設定の `imageHost` と一致することを確認（違えば取得しない）→ `fetch(url)`（Bearer なし）→ SHA-256 を hex で照合 → data URL にして cache に保存する。照合が合わなければ保存しない。DTO に無い id の画像は消す。
4. `syncedAt` を更新する。

失敗した時は `{ok: false, code, reminders: <cache の変換>}` を返す。popup は一覧を表示し、error を Label に出す。

### DTO から `Reminder` への変換

- `thumbnail`: cache の data URL。無ければ `NO_DATA.thumbnail`。
- それ以外の field は DTO の値。`Reminder` 型は変えない。

## 作成と削除（popup → background）

- **作成**（`reminders/create`）: popup が今と同じ `Reminder` を作る。server モードでは次の body を送る。
  - `id`、`url`、`title`、`reminderTime`、`autoOpen`、`webPush`、`hidden: false`
  - `thumbnail`: capture できた data URL。capture できず `NO_DATA.thumbnail`（同梱 png の path）になった場合は `null`。
  - decode 後の大きさが 1 MiB を超える画像は、送る前に popup の canvas で幅と高さを半分にして JPEG（quality 0.5）にし直し、収まるまで繰り返す。
  - 成功したら、応答の DTO と送った画像（`imageId`・`sha256` は応答の値）を cache に入れる。
- **削除**（`reminders/delete`）: 削除の手順で消す。
- popup は応答の `ok` を見て、失敗なら error を表示し、一覧を元に戻す。alarm の設定・解除は成功した時だけ行う。

## alarm と通知（`background.ts`）

- server モードの `onAlarm` と `notifications.onClicked` は、通信をせず `serverCache` から項目を探す。通知とタブの処理は今のまま。
- 通知の後、更新の手順で `hidden:true, thumbnail:null` を試す。失敗しても log（code と status だけ）を出して終わる。次の同期の整理で直る。
- `onInstalled` は、モードに応じて local の `reminders` か `serverCache` から alarm を設定し直す。
- popup の `resetAlerm` は今のまま使う。

## message（`messages.ts`）

| type | 入力 | 出力 |
| --- | --- | --- |
| `auth/status` | — | status |
| `auth/login` | — | `{ok}` または `{ok:false, code}` |
| `auth/logout` | — | `{ok, revoked}` |
| `reminders/list` | `{fresh?: boolean}` | `{ok, reminders, stale?}` または `{ok:false, code, reminders}` |
| `reminders/create` | `Reminder` | `{ok, reminder}` または `{ok:false, code}` |
| `reminders/delete` | `{id}` | `{ok}` または `{ok:false, code}` |

- `sender.id === chrome.runtime.id` で、かつ `sender.url` が `chrome-extension://<自拡張の id>/` で始まる message だけを受け付ける。それ以外（content script、他の拡張）は無視する。
- token、署名 URL を popup に返さない。

## 設定画面（`Settings.tsx`）

- Auto-open、Web Push、Connection Type は今のまま（切り替えたら即保存）。
- server モードの時だけ表示する。
  - 入力欄: API base URL、Auth base URL、Client ID、Image host。
  - 「保存」ボタン: 検証、許可の要求、保存。検証の error は欄の下に出す。
  - 状態: 未設定 / 許可なし / 未ログイン / ログイン中 / 要再ログイン / 失効は未完了。
  - 「ログイン」/「ログアウト」ボタン。
  - callback URL と logout URL（`getRedirectURL("cognito")`、`getRedirectURL("logout")`）を読み取り専用で表示する。

## error の表示

popup は `code` を次の文言にして Label に出す。

| code | 文言 |
| --- | --- |
| `NOT_CONFIGURED` | 接続先を設定してください |
| `LOGIN_REQUIRED`、`UNAUTHORIZED` | ログインしてください |
| `NETWORK`、`SERVICE_UNAVAILABLE`、`UNKNOWN_RESULT` | 通信できません。時間をおいて再度お試しください |
| `OWNER_RATE_LIMIT_EXCEEDED`、429 | 操作が多すぎます。しばらく待ってください |
| `OWNER_STORAGE_LIMIT_EXCEEDED` | 保存できる上限（1000件・画像 128 MiB）を超えています |
| 403 の各 code | 権限がありません（<code>） |
| その他 | エラー（<code>） |

## log

token、認可 code、`state`、`verifier`、callback URL、署名 URL を log に出さない。`console.error` には code と status だけを出す。

## テスト

`vitest` を加え、`npm test` で動かす。CI の `build.yml` に `npm test` を加える。

- PKCE: verifier が43文字の Base64URL、challenge が RFC 7636 の付録 B の例と一致する。
- callback の検証: 取り消し、URL・path の不一致、`state` の不一致、期限切れ、`error` param、`code` 無しで交換しない。
- token の応答の検証: `token_type`、`expires_in` が不正なら保存しない。
- refresh: 同時の3回の `getAccessToken` で token endpoint が1回だけ呼ばれる。新しい refresh token が access token より先に保存される。`invalid_grant` で認証状態が消える。通信障害では消えない。世代が変わった応答は捨てる。
- API: 401 で1回だけ refresh・再送する。429 の `Retry-After` に従う。書き込みの通信障害で再送しない。
- 書き込みの手順: 412 で GET からやり直す。404 で cache から外す。POST の `UNKNOWN_RESULT` で GET 照合する。
- 同期: 空の `items` で `nextCursor` が残る page を読み続ける。60秒以内は同期しない。画像の `sha256` が同じなら取り直さない。照合が合わない画像を保存しない。
- `removeOldReminders` の1か月前の計算（3/31、1/31）。
- message の送信元の検証。

## extension ID と operator への引き渡し

1. `openssl genrsa` で鍵を作り、公開鍵（DER の Base64）を manifest の `key` に入れる。秘密鍵（`.pem`）は repository の外に置き、owner が保管する。
2. unpacked で読み込み、ID と `getRedirectURL` の2つの URL を確かめる。
3. operator に `chrome_origin`、`callback_url`、`logout_url` を渡す（README に手順を書く）。

## README

server モードの設定手順、operator に渡す値、operator から受け取る値を追記する。AWS の実際の値は書かない。
