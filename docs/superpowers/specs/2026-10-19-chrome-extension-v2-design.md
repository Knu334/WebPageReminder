# Chrome 拡張機能の reminder-server v2 API・Cognito 認証への移行 設計

作成日: 2026-10-19。Codex の review（同日）を反映。

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
| host の許可 | `optional_host_permissions` に置き、入力された origin だけを `chrome.permissions.request` で求める |
| extension ID | 新しく RSA 鍵を生成し、公開鍵を manifest の `key` に入れる。秘密鍵は repository の外で owner が保管する |
| 通信の場所 | 認証、API の通信、server モードの cache と alarm の更新は、すべて service worker で行う。popup は message で結果だけを受け取る |
| library | 追加しない。`fetch` と `crypto.subtle` で書く。axios は削除する |
| テスト | `vitest` を devDependency に加え、`chrome.*` と `fetch` を mock して unit test を書く |

## 範囲

含める:

1. 旧 API の `key`（Google のプロフィール ID）による識別を、Cognito の access token に置き換える。
2. 全件上書きを、1件ごとの POST・PATCH・DELETE と ETag に置き換える。書き込みは `await` して結果を扱う。
3. server の失敗時に local モードへ自動で切り替えて保存する動作を削除する。cache と error を表示する。
4. `<all_urls>` と `identity.email` を外す。
5. alarm と通知の click では、通知とタブを開く判断を cache だけで行う。通知の後の server の更新は best effort とする。
6. 接続先の URL を https に限り、入力のたびの保存をやめて「保存」ボタンで確定する。
7. `removeOldReminders` の「1か月前」を「ローカル時刻の前月の同じ日・同じ時刻。その日が無い月は前月の末日（時刻は同じ）」と定義して直す（今は 3/31 の1か月前が 3/3 になる）。境界は「`reminderTime` が1か月前より前」なら削除の対象。
8. `resetAlerm` の `clearAll()` を `await` してから alarm を作る。

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
  ├─ api.ts       v2 client。認証の付与、timeout、再試行、error の分類
  ├─ cache.ts     server の一覧と画像の cache。書き換えは1本の queue で直列にする
  ├─ sync.ts      一覧の同期、期限切れの整理、画像の取得、書き込みの手順、alarm の再設定
  ├─ messages.ts  popup からの message の検証と振り分け
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
- `apiBaseUrl`、`authBaseUrl`、`imageHost` は `https:` の URL で、path・query・hash が無いことを検証する。値は `new URL(x).origin` に正規化して保存する。`clientId` は小文字英数字。
- 「保存」ボタンでは、次の順で行う。
  1. 検証する。不合格なら欄の下に error を出し、保存しない。
  2. 接続先の4項目を storage に保存する。4項目のどれかが変わったら、background に `config/changed` を送る。background は `authGen` を進め、認証状態と cache を消し、server モードの alarm を消す。
  3. 3つの origin（`<origin>/*`）を `chrome.permissions.request` で求める。
- 許可の dialog で popup が閉じても、設定は保存済みである。popup を開くたびに `chrome.permissions.contains` で確かめ、許可が無ければ状態欄に「許可する」ボタン（`chrome.permissions.request` を呼ぶ）を出す。
- 入力中の4項目は `Settings` component の state に置き、「保存」まで storage に書かない。Auto-open、Web Push、Connection Type は、今の storage の値にその field だけを上書きして即保存する（入力中の接続先を巻き込まない）。

### storage

| 置き場所 | key | 中身 |
| --- | --- | --- |
| `chrome.storage.session` | `authSession` | `{accessToken, expiresAt, configKey}` |
| `chrome.storage.session` | `authAttempt` | `{state, verifier, redirectUri, configKey, startedAt}` |
| `chrome.storage.session` | `logoutResult` | `{revoked: boolean, at}` |
| `chrome.storage.local` | `authRefresh` | `{refreshToken, configKey}` |
| `chrome.storage.local` | `settings` | `SettingsType` |
| `chrome.storage.local` | `reminders` | local モードの一覧（既存） |
| `chrome.storage.local` | `serverCache` | `{items: ReminderDto[], images: {[id]: {imageId, sha256, dataUrl}}, syncedAt, configKey}` |

- `configKey` は、正規化した `apiBaseUrl`、`authBaseUrl`、`clientId`、`imageHost` を `|` でつないだ文字列。今の設定と違う認証状態・cache は使わずに消す。
- background の起動時と `onInstalled` で `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})` を呼ぶ。
- token を `chrome.storage.sync`、DOM、URL、log に置かない。

### 世代と直列化

- `authGen`: module 変数の世代番号。logout と `config/changed` で進める。service worker の再起動では 0 から始まるが、再起動を跨いで続く処理は無いので問題ない。
- 認証状態（`authSession`、`authRefresh`）を書く処理は、開始時の `authGen` を記録し、書く直前に一致を確かめる。違えば書かずに捨てる。
- `serverCache` と server モードの alarm を書き換える処理（同期、作成、削除、alarm 後の更新、消去）は、`cache.ts` の1本の Promise queue に積んで直列にする。各処理は開始時の `authGen` を記録し、cache に書く直前に一致を確かめる。

## 認証（`auth.ts`）

### login

popup の「ログイン」ボタンの message からだけ始める。起動時に開かない。

1. 設定の4項目がそろい、`chrome.permissions.contains` で許可があることを確かめる。無ければ `NOT_CONFIGURED`。
2. `authAttempt` があり `startedAt` から10分以内なら、`LOGIN_IN_PROGRESS` を返して新しい試行を始めない（試行は1件ずつ）。
3. `state` と `code_verifier` を、それぞれ `crypto.getRandomValues` の 32 byte を padding なしの Base64URL（43文字）にして作る。`code_challenge = BASE64URL(SHA256(ASCII(verifier)))`。
4. `redirectUri = chrome.identity.getRedirectURL("cognito")`。`authAttempt` を session に置き、開始時の `authGen` を記録する。
5. `URLSearchParams` で `response_type=code`、`client_id`、`redirect_uri`、`scope=openid reminder-api/read reminder-api/write`、`state`、`code_challenge`、`code_challenge_method=S256` を組み、`<authBase>/oauth2/authorize` を `launchWebAuthFlow({url, interactive: true})` で開く。popup は閉じてよい。処理は background で続き、popup は開き直した時に `auth/status` で結果を表示する。
6. 返った URL を検証する。次のどれかに当たれば交換へ進まない。
   - URL が `undefined`、または `launchWebAuthFlow` が reject した（取り消し）
   - origin と pathname が `redirectUri` と一致しない
   - `state` が `authAttempt.state` と一致しない
   - `startedAt` から10分を過ぎた
   - `error` param がある、または `code` が無い
7. `POST <authBase>/oauth2/token` に `Content-Type: application/x-www-form-urlencoded` で `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier` を送る。`client_secret` と Basic 認証は使わない。使用済みの code は再送しない。
8. 応答の `access_token`・`refresh_token` が文字列、`token_type === "Bearer"`、`expires_in` が正の数であることを検証する。
9. `authGen` が開始時と一致することを確かめる（違えば捨てる）。先に `authRefresh` を local に保存し、そのあと `authSession`（`expiresAt = now + expires_in * 1000`）を session に保存する。
10. 成否にかかわらず `finally` で、`authAttempt.state` が自分の `state` と一致する場合だけ `authAttempt` を消す。

### getAccessToken

- `authSession` があり、`configKey` が今の設定と一致し、`expiresAt - now > 30秒` なら、その access token を返す。
- そうでなければ refresh する。refresh の Promise は module 変数に1つだけ持ち、同時の呼び出しは同じ Promise を待つ（single-flight）。

### refresh

- `POST <authBase>/oauth2/token` に form で `grant_type=refresh_token`、`client_id`、`refresh_token` を送る。
- 成功の検証: `access_token` が文字列、`token_type === "Bearer"`、`expires_in` が正の数。`refresh_token` は、あれば文字列であること（rotation が有効なら返る）。
- 保存: `authGen` が開始時と一致することを確かめる（違えば捨てる）。応答に `refresh_token` があれば、新しい値を先に local へ保存する。そのあと `authSession` を session に保存する。保存が終わるまで、待っている API は再開しない。
- 400 で `error` が `invalid_grant`、`invalid_client`、`unauthorized_client`: `authGen` が一致する場合だけ、認証状態（`authRefresh`、`authSession`）を消し、`LOGIN_REQUIRED` を返す。
- 通信障害・timeout・5xx: jitter 付きの backoff（0.5秒、1秒、2秒）で最大3回。refresh token は消さず、`NETWORK` を返す。
- refresh token の期限は延びない（初回から30日）。期限切れは `invalid_grant` で扱う。

### logout

1. `authGen` を進める。以降、古い世代の処理は認証状態と cache に書けない。
2. `POST <authBase>/oauth2/revoke` に form で `client_id` と `token`（refresh token）を送る。200 なら `revoked = true`。通信障害・timeout・5xx なら `false`。
3. `finally` で `authRefresh`、`authSession`、`serverCache`、server モードの alarm を消し、`logoutResult` に `{revoked, at}` を保存する。
4. `launchWebAuthFlow({url: <authBase>/logout?client_id=<id>&logout_uri=<getRedirectURL("logout")>, interactive: true})` を開く。失敗しても logout は完了扱い。
5. popup に `{revoked}` を返す。popup が閉じていても、`auth/status` が `logoutResult` を返す。`revoked: false` なら「ログアウトしたが、server 側の失効は未完了（通信障害）」と表示する。次の login が成功したら `logoutResult` を消す。

### status

`auth/status` は `{configured, permitted, state: "LOGGED_OUT" | "LOGGED_IN" | "LOGIN_REQUIRED", loginInProgress, logoutResult}` を返す。`LOGGED_IN` は `authRefresh` があり `configKey` が一致すること。

## API client（`api.ts`）

- `request(method, path, {body, ifMatch})`: `getAccessToken()` の token を `Authorization: Bearer` で付ける。body は `Content-Type: application/json`。`{id}` は `encodeURIComponent` する。
- すべての fetch（API、Cognito、S3）に `AbortSignal.timeout(10_000)` を付ける。timeout は通信障害として扱う。
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

- **作成**: POST。201 なら成功。
  - `UNKNOWN_RESULT` なら GET で照合する。200 なら成功（id は client が作る UUID なので、自分の作成とみなす）。404 なら1回だけ POST し直す。
  - 409 なら GET で照合する。200 なら成功。404 なら、その id は削除済みで再利用できないため `ALREADY_EXISTS` の error を返す。
- **非表示にする（`hidden:true, thumbnail:null`）**: GET で最新の DTO と ETag を取る。
  - 最新の DTO で条件を判定し直す。すでに `hidden:true` かつ `thumbnail:null` なら何もしない。期限切れの整理から呼ばれた場合、`reminderTime` が今より後なら何もしない。
  - PATCH する。412 なら GET からやり直す（1回）。404 なら remote で消えたものとして cache から外す。
  - `UNKNOWN_RESULT` なら GET して、`hidden:true` かつ `thumbnail:null` なら成功。
- **削除**: GET で ETag を取る。期限切れの整理から呼ばれた場合、最新の DTO の `reminderTime` で条件を判定し直し、外れたら何もしない。DELETE する。412 なら GET からやり直す（1回）。404、または `UNKNOWN_RESULT` 後の GET が 404 なら成功。user の削除は後勝ちとする。
- 成功したら、queue の中で cache と alarm を更新する。
- 読んだ DTO をそのまま PATCH に送らない。

## 一覧の同期（`sync.ts`）

message:

- `reminders/list`（`fresh` 無し）: `serverCache` を `Reminder[]` に変換して返す。通信しない。
- `reminders/list` `{fresh: true}`: `syncedAt` から60秒以内なら、同期せずに cache を返す。そうでなければ同期の完了か失敗まで待ち、1回だけ応答する。同期中に別の `fresh` が来たら、同じ同期を待つ（single-flight）。
- popup は開いた時に、まず `fresh` 無しで呼んで表示し、続けて `fresh: true` で呼んで表示を更新する。popup が閉じても同期は background で続き、次に開いた時の cache に反映される。

同期の手順（queue の中で行う）:

1. `listPage` を直列に、`nextCursor` が `null` になるまで読む。`items` が空でも続ける。読み終わってから cache の `items` を全件置き換える（同期中の作成・削除は queue の後ろで待つので、巻き戻らない）。
2. 整理（1回の同期で、書き込みは合計30件まで。残りは次の同期）:
   - `reminderTime` が1か月より前の項目は、削除の手順で消す（PATCH はしない）。
   - それ以外で `reminderTime` が今より前、かつ `hidden:false` の項目は、非表示にする手順を行う。
3. 画像（1回の同期で、取得は30件まで。残りは次の同期）:
   - DTO の `thumbnail` が `null` なら、cache の画像を消す。DTO に無い id の画像も消す。
   - `{imageId, sha256}` が cache と違う項目だけ取得する。手順は次のとおり。どれかが合わなければ保存せず、次の同期で取り直す。
     1. `getThumbnailUrl` を呼び、応答の `imageId` が DTO と一致することを確かめる。
     2. 署名 URL の origin が設定の `imageHost` と一致することを確かめる。
     3. `fetch(url, {redirect: "error"})`（Bearer なし）。status が 200 であること。
     4. SHA-256 を hex で計算し、DTO の `sha256` と照合する。
     5. data URL にして cache に保存する。
4. server モードの alarm を、cache の未来かつ `hidden:false` の項目で設定し直す。
5. `syncedAt` を更新する。

失敗した時は `{ok: false, code, reminders: <cache の変換>}` を返す。popup は一覧を表示し、error を Label に出す。

### DTO から `Reminder` への変換

- `thumbnail`: cache の data URL。無ければ `NO_DATA.thumbnail`。
- それ以外の field は DTO の値。`Reminder` 型は変えない。

## 作成と削除（popup → background）

- **作成**（`reminders/create`）: popup が今と同じ `Reminder` を作り、background に送る。background は次の body を組み立てて送る。
  - `id`、`url`、`title`、`reminderTime`、`autoOpen`、`webPush`、`hidden: false`
  - `thumbnail`: capture できた data URL。capture できず `NO_DATA.thumbnail`（同梱 png の path）になった場合は `null`。
  - decode 後の大きさが 1 MiB を超える画像は、popup が送る前に canvas で幅と高さを半分にして JPEG（quality 0.5）にし直し、収まるまで繰り返す。
  - 成功したら、queue の中で応答の DTO と送った画像（`imageId`・`sha256` は応答の値）を cache に入れ、alarm を作る。
- **削除**（`reminders/delete`）: 削除の手順で消し、queue の中で cache から外し、alarm を消す。
- popup は応答の `ok` を見て、失敗なら error を表示し、一覧を元に戻す。server モードでは popup は alarm を触らない（popup が閉じても background が処理を終える）。local モードは今のまま popup が alarm を扱う。

## alarm と通知（`background.ts`）

- server モードの `onAlarm` と `notifications.onClicked` は、`serverCache` から項目を探し、通知とタブの判断を cache だけで行う。通知とタブの処理は今のまま。
- `onAlarm` では通知の後、queue の中で cache の項目を `hidden:true` にし、画像を消す（再通知を防ぐ）。そのあと非表示にする手順を best effort で試す。失敗しても log（code と status だけ）を出して終わる。次の同期の整理で直る。
- `onInstalled` は、モードに応じて local の `reminders` か `serverCache` から alarm を設定し直す。

## message（`messages.ts`）

| type | 入力 | 出力 |
| --- | --- | --- |
| `auth/status` | — | status |
| `auth/login` | — | `{ok}` または `{ok:false, code}` |
| `auth/logout` | — | `{ok, revoked}` |
| `config/changed` | — | `{ok}` |
| `reminders/list` | `{fresh?: boolean}` | `{ok, reminders}` または `{ok:false, code, reminders}` |
| `reminders/create` | `Reminder` | `{ok, reminder}` または `{ok:false, code}` |
| `reminders/delete` | `{id}` | `{ok}` または `{ok:false, code}` |

- `sender.id === chrome.runtime.id` で、かつ `sender.url` が `chrome-extension://<自拡張の id>/` で始まる message だけを受け付ける。それ以外（content script、他の拡張）は無視する。
- type ごとに入力を実行時に検証する。未知の type は無視する。`reminders/*` は server モードでなければ `NOT_SERVER_MODE` を返す。`create` は各 field の型と大きさ（server の制限と同じ）、`delete` は `id` が1〜128文字の文字列であることを確かめる。不合格なら `INVALID_MESSAGE` を返し、API を呼ばない。
- API の body は、許可した field だけから組み立てる。
- token、署名 URL を popup に返さない。

## 設定画面（`Settings.tsx`）

- Auto-open、Web Push、Connection Type は今のまま（切り替えたら、その field だけを即保存）。
- server モードの時だけ表示する。
  - 入力欄: API base URL、Auth base URL、Client ID、Image host。
  - 「保存」ボタン: 「設定」の節の手順。検証の error は欄の下に出す。
  - 状態: 未設定 / 許可なし（「許可する」ボタン）/ 未ログイン / ログイン中 / 要再ログイン / ログイン処理中 / 失効は未完了。
  - 「ログイン」/「ログアウト」ボタン。
  - callback URL と logout URL（`getRedirectURL("cognito")`、`getRedirectURL("logout")`）を読み取り専用で表示する。

## error の表示

popup は `code` を次の文言にして Label に出す。

| code | 文言 |
| --- | --- |
| `NOT_CONFIGURED` | 接続先を設定してください |
| `LOGIN_REQUIRED`、`UNAUTHORIZED` | ログインしてください |
| `LOGIN_IN_PROGRESS` | ログインの処理中です |
| `NETWORK`、`SERVICE_UNAVAILABLE`、`UNKNOWN_RESULT` | 通信できません。時間をおいて再度お試しください |
| `OWNER_RATE_LIMIT_EXCEEDED`、429 | 操作が多すぎます。しばらく待ってください |
| `OWNER_STORAGE_LIMIT_EXCEEDED` | 保存できる上限（1000件・画像 128 MiB）を超えています |
| 403 の各 code | 権限がありません（<code>） |
| その他 | エラー（<code>） |

## log

token、認可 code、`state`、`verifier`、callback URL、署名 URL を log に出さない。`console.error` には code と status だけを出す。

## 採らないこと

| 指摘・案 | 理由 |
| --- | --- |
| 作成の照合で、GET した中身と送った内容を比べる | id は client が作る UUID で、衝突は事実上起きない。200 なら自分の作成とみなす |
| 署名 URL の早期失効時に URL を再発行する | URL は発行の直後に使う。失敗したら次の同期で取り直せば足りる |
| 同期の再開位置を保存する | 整理と画像は件数の上限で区切り、済んだものは次の同期で対象から外れる。最初から読み直しても先へ進む |
| offline の書き込み queue | 利用者は1人で、書き込みはオンラインの時だけで足りる |

## テスト

`vitest` を加え、`npm test` で動かす。CI の `build.yml` に `npm test` を加える。

- PKCE: verifier が43文字の Base64URL、challenge が RFC 7636 の付録 B の例と一致する。
- callback の検証: 取り消し、URL・path の不一致、`state` の不一致、期限切れ、`error` param、`code` 無しで交換しない。
- login: 試行中の2回目を拒否する。古い試行の `finally` が新しい試行を消さない。logout 後に完了した login は保存しない。
- token の応答の検証: `token_type`、`expires_in` が不正なら保存しない。
- refresh: 同時の3回の `getAccessToken` で token endpoint が1回だけ呼ばれる。新しい refresh token が access token より先に保存される。`invalid_grant` で認証状態が消える。通信障害・timeout では消えない。世代が変わった応答は捨てる。
- logout: revoke が失敗しても端末の状態が消え、`logoutResult.revoked` が `false` になる。
- API: 401 で1回だけ refresh・再送する。429 の `Retry-After` に従う。書き込みの通信障害で再送しない。
- 書き込みの手順: POST の 201 で成功する。412 で GET からやり直す。404 で cache から外す。POST の `UNKNOWN_RESULT` で GET 照合する。409 と GET 404 で `ALREADY_EXISTS`。整理は最新の DTO で条件を判定し直す。1か月を過ぎた項目は DELETE だけ。
- 同期: 空の `items` で `nextCursor` が残る page を読み続ける。60秒以内は同期しない。書き込みと画像はそれぞれ30件まで。同期中の作成が全件置き換えで消えない。`sha256`・`imageId` が同じなら取り直さない。照合が合わない画像、origin が違う URL は保存しない。
- `removeOldReminders` の1か月前の計算: 3/31 → 2/28（平年）・2/29（うるう年）、1/31 → 12/31、5/15 → 4/15、境界の等号。
- message の送信元の検証、入力の検証。

## extension ID と operator への引き渡し

1. `openssl genrsa` で鍵を作り、公開鍵（DER の Base64）を manifest の `key` に入れる。秘密鍵（`.pem`）は repository の外に置き、owner が保管する。
2. unpacked で読み込み、ID と `getRedirectURL` の2つの URL を確かめる。
3. operator に `chrome_origin`、`callback_url`、`logout_url` を渡す（README に手順を書く）。

## README

server モードの設定手順、operator に渡す値、operator から受け取る値を追記する。AWS の実際の値は書かない。
