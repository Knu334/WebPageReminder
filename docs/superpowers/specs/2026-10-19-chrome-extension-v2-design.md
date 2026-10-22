# Chrome 拡張機能の reminder-server v2 API・Cognito 認証への移行 設計

作成日: 2026-10-19。Codex の review（同日、3回）を反映。

要件の行の先頭の `[R-<領域>-<番号>]` は要件 ID である（領域: SCOPE 範囲、MAN manifest、CFG 設定、STO storage、GEN 世代と直列化、LOGIN、TOKEN getAccessToken、REFRESH、LOGOUT、STATUS、API API client、WRITE 書き込みの手順、SYNC 一覧の同期、DTO 変換、CRUD 作成と削除、ALARM alarm と通知、MSG message、UI 設定画面、PICK 日時の入力、ERR error の表示、LOG log）。自動テストは名前にこの ID を含め、`docs/test-traceability.md`（要件とテストの対応表）は `npm run trace` で ID とテストの名前から生成する。ID は製品の動作の要件だけに付け、文書や作業手順の成果物には付けない。ID は付け直さず、消した ID の番号も再利用しない（番号の欠けは想定どおり）。要件を足す時は領域の末尾の次の番号を使う。

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
7. [R-SCOPE-07] `removeOldReminders` の「1か月前」を「ローカル時刻の前月の同じ日・同じ時刻。その日が無い月は前月の末日（時刻は同じ）」と定義して直す（今は 3/31 の1か月前が 3/3 になる）。境界は「`reminderTime` が1か月前より前」なら削除の対象。
8. [R-SCOPE-08] alarm の設定・解除は、local モードも含めて background の queue に集める。popup の `resetAlerm` と `chrome.alarms` の直接の呼び出しは削除する（今は `clearAll()` を `await` せず、モードの切り替えとも競合する）。
9. `CLAUDE.md` を、公式のベストプラクティスに沿って書き直す（「CLAUDE.md」の節）。`AGENTS.md` は `CLAUDE.md` への symlink なので触らない。

含めない（別の PR）:

- `ReminderList` の sort の比較、background の `openedReminders`、build 用 tool の脆弱性、`popup.html` の title。
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

`auth.ts`、`api.ts`、`cache.ts`、`sync.ts`、`messages.ts` は `src/background/` に置く。entry の `src/background.ts` は今の場所のまま（`vite.config.background.ts` を変えない）。

### manifest

- [R-MAN-01] `permissions`: `storage`、`tabs`、`notifications`、`alarms`、`activeTab`、`unlimitedStorage`、`identity`、`scripting`。`identity.email` は外す。
- [R-MAN-02] `host_permissions` は書かない。`<all_urls>` を外す。popup を開いた時の `executeScript` と `captureVisibleTab` は `activeTab` で足りる。
- [R-MAN-03] `optional_host_permissions`: `https://*.amazonaws.com/*`、`https://*.amazoncognito.com/*`。
- [R-MAN-04] `key`: 生成した公開鍵（Base64 の DER）。

### 設定（`SettingsType`）

```ts
interface SettingsType {
  autoOpen: boolean;
  webPush: boolean;
  connectionType: "local" | "server";
  theme: "system" | "light" | "dark";
  apiBaseUrl: string;   // https://<api-id>.execute-api.<region>.amazonaws.com
  authBaseUrl: string;  // https://<prefix>.auth.<region>.amazoncognito.com
  clientId: string;
  imageHost: string;    // https://<bucket>.s3.<region>.amazonaws.com
}
```

- [R-CFG-01] 旧 `url` は読み込み時に捨てる。
- [R-CFG-02] `apiBaseUrl`、`authBaseUrl`、`imageHost` は `https:` の URL で、path・query・hash が無いことを検証する。値は `new URL(x).origin` に正規化して保存する。`clientId` は小文字英数字。
- 「保存」ボタンでは、次の順で行う。
  1. [R-CFG-03] popup で検証する。不合格なら欄の下に error を出し、保存しない。
  2. [R-CFG-04] background に `config/save` を送る。background は auth mutex と queue の中で、再検証、4項目の保存、`authGen` の更新、認証状態・cache・server モードの alarm の消去を1つの処理として行う。4項目が変わっていなければ保存だけ行う。
  3. [R-CFG-05] popup が3つの origin（`<origin>/*`）を `chrome.permissions.request` で求める。
- [R-CFG-06] 許可の dialog で popup が閉じても、設定は保存済みである。popup を開くたびに `chrome.permissions.contains` で確かめ、許可が無ければ状態欄に「許可する」ボタン（`chrome.permissions.request` を呼ぶ）を出す。
- [R-CFG-07] 2の途中で worker が止まった場合に備え、認証状態と cache は読むたびに `configKey` を今の設定と照合し、違えば使わずに消す。
- [R-CFG-08] 入力中の4項目は `Settings` component の state に置き、「保存」まで storage に書かない。Auto-open、Web Push、Theme は、今の storage の値にその field だけを上書きして即保存する（入力中の接続先を巻き込まない）。
- [R-CFG-09] Connection Type の切り替えは background に `mode/change` を送る。background は queue の中で、保存、`authGen` の更新（進行中の旧モードの処理を無効にする）、`chrome.alarms.clearAll()` の `await`、切り替え先のモードの一覧（local の `reminders` か `serverCache`）からの alarm の再構築を行う。

### storage

| 置き場所 | key | 中身 |
| --- | --- | --- |
| [R-STO-01] `chrome.storage.session` | `authSession` | `{accessToken, expiresAt, configKey}` |
| [R-STO-02] `chrome.storage.session` | `authAttempt` | `{state, verifier, redirectUri, configKey, startedAt}` |
| [R-STO-03] `chrome.storage.session` | `authNotice` | `{code, at}`。code は `LOGIN_FAILED`、`LOGIN_CANCELLED`、`REFRESH_FAILED`（確定した更新の失敗）、`LOGGED_OUT`、`REVOKE_FAILED`、`LOGOUT_PAGE_FAILED` のどれか。token や URL は入れない |
| [R-STO-04] `chrome.storage.local` | `authRefresh` | `{refreshToken, configKey}` |
| [R-STO-05] `chrome.storage.local` | `settings` | `SettingsType` |
| [R-STO-06] `chrome.storage.local` | `reminders` | local モードの一覧（既存） |
| [R-STO-07] `chrome.storage.local` | `serverCache` | `{items: ReminderDto[], images: {[id]: {imageId, sha256, dataUrl}}, syncedAt, configKey}` |
| [R-STO-08] `chrome.storage.local` | `notified:<id>` | 通知した時刻。server モードで通知済みの項目ごとに1つの key（1つの map にしないので、読んで書き直す競合が起きない）。cache の queue を通さずにすぐ書く。DTO が `hidden:true` になった id と、DTO に無い id の key は同期の時に `remove` する。以下、これらの key の集まりを `notifiedIds` と呼ぶ |
| [R-STO-09] `chrome.storage.session` | `refreshPending` | `{refreshTokenHash, firstSentAt}`。結果が不明な refresh の記録。token そのものは入れず、SHA-256 の hex を入れる |

- [R-STO-10] `configKey` は、正規化した `apiBaseUrl`、`authBaseUrl`、`clientId`、`imageHost` を `|` でつないだ文字列。今の設定と違う認証状態・cache は使わずに消す。
- [R-STO-11] background の起動時と `onInstalled` で `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})` を呼ぶ。
- [R-STO-12] token を `chrome.storage.sync`、DOM、URL、log に置かない。

### 世代と直列化

- [R-GEN-01] `authGen`: module 変数の世代番号。logout、login の成功、`config/save`（接続先が変わった時）、`mode/change` で進める。service worker の再起動では 0 から始まるが、再起動を跨いで続く処理は無いので問題ない。
- [R-GEN-02] 世代は、message を受け取った時点（alarm は発火した時点）で固定し、その処理の全体で使う。token を取った後、各 API の送信・再送の直前、認証状態・cache・alarm に書く直前に一致を確かめる。違えば、その時点で処理をやめて `STALE` を返す（すでに送った書き込みは取り消さない。次の同期で server の状態に合わせる）。
- [R-GEN-03] **auth mutex**: 認証状態（`authAttempt`、`authSession`、`authRefresh`、`authNotice`）の読み書きと消去は、`auth.ts` の1本の Promise chain に通す。世代の確認と保存は、同じ mutex の区間の中で行う。refresh の single-flight の Promise は世代ごとに持ち、別の世代の要求とは共有しない。
- [R-GEN-04] **queue**: `serverCache` とすべての alarm（local モードの分も含む）を書き換える処理（同期、作成、削除、alarm 後の更新、消去、モードの切り替え、`alarms/reset`）は、`cache.ts` の1本の Promise queue に積んで直列にする。`notifiedIds` は queue を通さない。
- [R-GEN-05] logout と `config/save` は、進行中の fetch を `AbortController` で中断する（世代ごとに1つ持つ）。

## 認証（`auth.ts`）

### login

[R-LOGIN-01] popup の「ログイン」ボタンの message からだけ始める。起動時に開かない。

1. [R-LOGIN-02] 設定の4項目がそろい、`chrome.permissions.contains` で許可があることを確かめる。無ければ `NOT_CONFIGURED`。
2. [R-LOGIN-03] auth mutex の中で、`authAttempt` があり `startedAt` から10分以内なら、`LOGIN_IN_PROGRESS` を返して新しい試行を始めない（試行は1件ずつ）。無ければ、同じ区間の中で3・4の `authAttempt` を作る（確認と予約を分けない）。
3. [R-LOGIN-04] `state` と `code_verifier` を、それぞれ `crypto.getRandomValues` の 32 byte を padding なしの Base64URL（43文字）にして作る。`code_challenge = BASE64URL(SHA256(ASCII(verifier)))`。
4. [R-LOGIN-05] `redirectUri = chrome.identity.getRedirectURL("cognito")`。`authAttempt` を session に置き、開始時の `authGen` を記録する。
5. [R-LOGIN-06] `URLSearchParams` で `response_type=code`、`client_id`、`redirect_uri`、`scope=openid reminder-api/read reminder-api/write`、`state`、`code_challenge`、`code_challenge_method=S256` を組み、`<authBase>/oauth2/authorize` を `launchWebAuthFlow({url, interactive: true})` で開く。popup は閉じてよい。処理は background で続き、popup は開き直した時に `auth/status` で結果を表示する。
6. [R-LOGIN-07] 返った URL を検証する。次のどれかに当たれば交換へ進まない。
   - URL が `undefined`、または `launchWebAuthFlow` が reject した（取り消し）。ただし reject の message が `Authorization page could not be loaded.` の時は失敗として扱う（Cognito が error の page を返すと、Chrome が window を閉じてこの message で reject するため。password の誤りなど）
   - origin と pathname が `redirectUri` と一致しない
   - `state` が `authAttempt.state` と一致しない
   - `startedAt` から10分を過ぎた
   - `error` param がある、または `code` が無い
7. [R-LOGIN-08] `POST <authBase>/oauth2/token` に `Content-Type: application/x-www-form-urlencoded` で `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier` を送る。`client_secret` と Basic 認証は使わない。使用済みの code は再送しない。
8. [R-LOGIN-09] 応答の `access_token`・`refresh_token` が文字列、`token_type === "Bearer"`、`expires_in` が正の数であることを検証する。
9. [R-LOGIN-10] auth mutex の中で、`authGen` が開始時と一致することを確かめる（違えば捨てる）。先に `authRefresh` を local に保存し、そのあと `authSession`（`expiresAt = now + expires_in * 1000`）を session に保存する。`authNotice` を消し、`authGen` を進める。
10. [R-LOGIN-11] 成否にかかわらず `finally` で、auth mutex の中で、`authAttempt.state` が自分の `state` と一致する場合だけ `authAttempt` を消す。取り消しなら `authNotice` に `LOGIN_CANCELLED`、検証や交換の失敗なら `LOGIN_FAILED` を残す。
11. [R-LOGIN-12] 成功したら queue の中で `serverCache` と server モードの alarm を消し、同期を始める（同じ接続先でも、ログインし直した利用者の cache を引き継がない）。

### getAccessToken

- [R-TOKEN-01] `authSession` があり、`configKey` が今の設定と一致し、`expiresAt - now > 30秒` なら、その access token を返す。
- [R-TOKEN-02] そうでなければ refresh する。refresh の Promise は module 変数に1つだけ持ち、同時の呼び出しは同じ Promise を待つ（single-flight）。

### refresh

- [R-REFRESH-01] `POST <authBase>/oauth2/token` に form で `grant_type=refresh_token`、`client_id`、`refresh_token` を送る。
- [R-REFRESH-02] 成功の検証: `access_token` と `refresh_token` が文字列、`token_type === "Bearer"`、`expires_in` が正の数。rotation が有効なので、`refresh_token` が無い応答は失敗（`REFRESH_FAILED`）として扱う。
- [R-REFRESH-03] 保存: auth mutex の中で、`authGen` が開始時と一致することを確かめる（違えば捨てる）。新しい `refresh_token` を先に local へ保存し、そのあと `authSession` を session に保存する。保存が終わるまで、待っている API は再開しない。
- [R-REFRESH-04] 400 で `error` が `invalid_grant`、`invalid_client`、`unauthorized_client`: auth mutex の中で、`authGen` が一致する場合だけ、認証状態（`authRefresh`、`authSession`）を消し、`authNotice` に `REFRESH_FAILED` を残し、`LOGIN_REQUIRED` を返す。
- 結果が不明な refresh（Cognito の再試行の猶予は10秒）:
  - [R-REFRESH-05] 送る前に、auth mutex の中で `refreshPending` を確かめる。同じ refresh token の記録があり、`firstSentAt` から10秒を過ぎていれば、送らずに認証状態を消し、`authNotice` に `REFRESH_FAILED` を残して `LOGIN_REQUIRED` を返す。記録が無ければ `{refreshTokenHash, firstSentAt: now}` を書いてから送る。
  - [R-REFRESH-06] HTTP の応答（成功・失敗とも）を受け取ったら、`refreshPending` を消す。
  - [R-REFRESH-07] 通信障害・timeout の時は `refreshPending` を残す。10秒以内なら backoff（0.5秒、1秒）で再送し、10秒を過ぎる再送はしない。refresh token は消さず、`NETWORK` を返す。
  - [R-REFRESH-08] 呼び出しや worker の再起動を跨いでも `refreshPending` で同じ判定をする。session storage なので Chrome の再起動では消えるが、その時はすでに10秒を過ぎており、次の refresh の `invalid_grant` でログインを案内する。
  - [R-REFRESH-09] 5xx は Cognito が処理しなかった応答として扱い、`refreshPending` を消して、上と同じ backoff で再送する。
- [R-REFRESH-10] refresh の fetch の timeout は 4秒（全体の10秒の例外。10秒の猶予の中で再送できるようにするため）。
- refresh token の期限は延びない（初回から30日）。期限切れは `invalid_grant` で扱う。

### logout

1. [R-LOGOUT-01] auth mutex の中で、`authRefresh` の値を読み、`authGen` を進め、進行中の fetch を中断し、`authRefresh` と `authSession` を消す。以降、古い世代の処理は認証状態と cache に書けず、新しい API の操作は `LOGIN_REQUIRED` になる。
2. [R-LOGOUT-02] mutex の外で、1で読んだ refresh token を `POST <authBase>/oauth2/revoke` に form で `client_id` と `token` として送る。200 なら `revoked = true`。通信障害・timeout・5xx なら `false`。
3. [R-LOGOUT-03] queue の中で `serverCache` と server モードの alarm を消す。
4. [R-LOGOUT-04] `launchWebAuthFlow({url: <authBase>/logout?client_id=<id>&logout_uri=<getRedirectURL("logout")>, interactive: true})` を開く。失敗しても logout は完了扱い。
5. [R-LOGOUT-05] auth mutex の中で、`authGen` が1で進めた値のままの場合だけ、`authNotice` に結果を残す。revoke の失敗は `REVOKE_FAILED`、logout のページの失敗は `LOGOUT_PAGE_FAILED`、両方成功なら `LOGGED_OUT`。途中で新しい login が成功していれば、何も書かない（新しい認証状態を消さない）。
6. [R-LOGOUT-06] popup に `{revoked}` を返す。popup が閉じていても、`auth/status` が `authNotice` を返す。`REVOKE_FAILED` なら「ログアウトしたが、server 側の失効は未完了（通信障害）」、`LOGOUT_PAGE_FAILED` なら「Cognito のログインの記録が残っている可能性がある」と表示する。

### status

[R-STATUS-01] `auth/status` は `{configured, permitted, state: "LOGGED_OUT" | "LOGGED_IN" | "LOGIN_REQUIRED", loginInProgress, notice}` を返す。`LOGGED_IN` は `authRefresh` があり `configKey` が一致すること。`authRefresh` が無く `authNotice.code` が `REFRESH_FAILED` なら `LOGIN_REQUIRED`、それ以外で無ければ `LOGGED_OUT`。`notice` は `authNotice.code`。

## API client（`api.ts`）

- [R-API-01] `request(method, path, {body, ifMatch})`: `getAccessToken()` の token を `Authorization: Bearer` で付ける。body は `Content-Type: application/json`。`{id}` は `encodeURIComponent` する。
- [R-API-02] すべての fetch（API、Cognito、S3）に `AbortSignal.timeout(10_000)` を付ける。refresh だけは 4秒（「refresh」の節）。timeout は通信障害として扱う。
- [R-API-03] 戻り値は `{ok: true, status, data, etag}` か `{ok: false, status, code, message}`。`code` は body の `code`、無ければ status から決める（Gateway の error は形が違うため）。

| status | 動作 |
| --- | --- |
| [R-API-04] 401 | 強制的に refresh して1回だけ再送する。再び 401 なら `UNAUTHORIZED` |
| [R-API-05] 403 | 返す。再試行しない |
| [R-API-06] 429 | `Retry-After`（無ければ1秒）に 0〜1 秒の jitter を足し、最大2回再試行 |
| [R-API-07] 503・通信障害（GET） | jitter 付き backoff（0.5秒、1秒）で最大2回 |
| [R-API-08] 503・通信障害（POST・PATCH・DELETE） | 自動で再送しない。`UNKNOWN_RESULT` を返し、呼び出し側が GET で照合する |
| [R-API-09] その他 | そのまま返す |

関数:

- [R-API-10] `listPage(cursor)`: `GET /v2/reminders?limit=50&cursor=`
- [R-API-11] `getReminder(id)`: `GET /v2/reminders/{id}` → DTO と ETag
- [R-API-12] `createReminder(body)`: `POST /v2/reminders`
- [R-API-13] `patchReminder(id, patch, etag)`: `PATCH`、`If-Match: etag`
- [R-API-14] `deleteReminder(id, etag)`: `DELETE`、`If-Match: etag`
- [R-API-15] `getThumbnailUrl(id)`: `GET /v2/reminders/{id}/thumbnail-url`

[R-API-16] S3 の画像の fetch は `api.ts` を通さず、Bearer を付けない。

### 書き込みの手順（`sync.ts`）

- [R-WRITE-01] **作成**: POST。201 なら成功。
  - [R-WRITE-02] `UNKNOWN_RESULT` なら GET で照合する。200 なら成功（id は client が作る UUID なので、自分の作成とみなす）。404 なら1回だけ POST し直す。
  - [R-WRITE-03] 409 なら GET で照合する。200 なら成功。404 なら、その id は削除済みで再利用できないため `ALREADY_EXISTS` の error を返す。
- [R-WRITE-04] **非表示にする（`hidden:true, thumbnail:null`）**: GET で最新の DTO と ETag を取る。
  - [R-WRITE-05] 最新の DTO で条件を判定し直す。すでに `hidden:true` かつ `thumbnail:null` なら何もしない。呼び出し元（整理、alarm）にかかわらず、`reminderTime` が今より後なら何もしない。
  - [R-WRITE-06] PATCH する。412 なら GET からやり直す（1回）。404 なら remote で消えたものとして cache から外す。
  - [R-WRITE-07] `UNKNOWN_RESULT` なら GET して、`hidden:true` かつ `thumbnail:null` なら成功。
- [R-WRITE-08] **削除**: GET で ETag を取る。期限切れの整理から呼ばれた場合、最新の DTO の `reminderTime` で条件を判定し直し、外れたら何もしない。DELETE する。404、または `UNKNOWN_RESULT` 後の GET が 404 なら成功。
  - [R-WRITE-09] user の削除で 412 なら、GET した最新の DTO で cache を更新して `CONFLICT` を返す。自動では削除し直さない。popup は最新の内容を表示し、user がもう一度削除を押す。
  - [R-WRITE-10] 期限切れの整理で 412 なら、GET からやり直す（1回）。
- [R-WRITE-11] 成功したら、queue の中で cache と alarm を更新する。
- [R-WRITE-12] 読んだ DTO をそのまま PATCH に送らない。

## 一覧の同期（`sync.ts`）

message:

- [R-SYNC-01] `reminders/list`（`fresh` 無し）: `serverCache` を `Reminder[]` に変換して返す。通信しない。
- [R-SYNC-02] `reminders/list` `{fresh: true}`: `syncedAt` から60秒以内なら、同期せずに cache を返す。そうでなければ同期の完了か失敗まで待ち、1回だけ応答する。同期中に別の `fresh` が来たら、同じ同期を待つ（single-flight）。
- [R-SYNC-03] popup は開いた時に `fresh: true` で呼び、応答が来てから一覧を表示する。応答までは作成のボタンを押せなくする（同期前の一覧が、同期中の作成・削除の表示を上書きしないため。一覧が無いので削除も押せない）。popup が閉じても同期は background で続き、次に開いた時の cache に反映される。

同期の手順（queue の中で行う）:

1. [R-SYNC-04] `listPage` を直列に、`nextCursor` が `null` になるまで読む。`items` が空でも続ける。読み終わってから cache の `items` を全件置き換える（同期中の作成・削除は queue の後ろで待つので、巻き戻らない）。
2. [R-SYNC-05] 整理（1回の同期で、書き込みは合計30件まで。対象は毎回順番を混ぜて選び、失敗した項目が後続を止めないようにする。残りは次の同期）:
   - [R-SYNC-06] `reminderTime` が1か月より前の項目は、削除の手順で消す（PATCH はしない）。
   - [R-SYNC-07] それ以外で `reminderTime` が今より前、かつ `hidden:false` の項目は、非表示にする手順を行う。
3. [R-SYNC-08] 画像（1回の同期で、取得は30件まで。対象は毎回順番を混ぜて選ぶ。残りは次の同期）:
   - [R-SYNC-09] DTO の `thumbnail` が `null` なら、cache の画像を消す。DTO に無い id の画像も消す。
   - [R-SYNC-10] `{imageId, sha256}` が cache と違う項目だけ取得する。手順は次のとおり。どれかが合わなければ保存せず、次の同期で取り直す。
     1. [R-SYNC-11] `getThumbnailUrl` を呼び、応答の `imageId` が DTO と一致することを確かめる。
     2. [R-SYNC-12] 署名 URL の origin が設定の `imageHost` と一致することを確かめる。
     3. [R-SYNC-13] `fetch(url, {redirect: "error"})`（Bearer なし）。status が 200 であること。
     4. [R-SYNC-14] 受け取った大きさが DTO の `bytes` と一致すること。SHA-256 を hex で計算し、DTO の `sha256` と照合する。
     5. [R-SYNC-15] data URL にして cache に保存する。
4. [R-SYNC-16] `notifiedIds` から、DTO が `hidden:true` になった id と DTO に無い id を消す。
5. [R-SYNC-17] server モードの alarm を、cache の未来かつ `hidden:false` の項目で設定し直す（server モードの時だけ。世代が違えば何もしない）。
6. [R-SYNC-18] `syncedAt` を更新する。

[R-SYNC-19] 失敗した時は `{ok: false, code, reminders: <cache の変換>}` を返す。popup は一覧を表示し、error を Label に出す。

### DTO から `Reminder` への変換

- [R-DTO-01] `thumbnail`: cache の画像の `imageId`・`sha256` が DTO の `thumbnail` と一致する時だけ、その data URL。一致しない、または画像が無ければ `NO_DATA.thumbnail`。
- [R-DTO-02] `hidden`: DTO の `hidden`、または id が `notifiedIds` にあれば `true`。
- [R-DTO-03] それ以外の field は DTO の値。`Reminder` 型は変えない。

## 作成と削除（popup → background）

- [R-CRUD-01] **作成**（`reminders/create`）: popup が今と同じ `Reminder` を作り、background に送る。background は次の body を組み立てて送る。
  - [R-CRUD-02] `id`、`url`、`title`、`reminderTime`、`autoOpen`、`webPush`、`hidden: false`
  - [R-CRUD-03] `thumbnail`: capture できた data URL。capture できず `NO_DATA.thumbnail`（同梱 png の path）になった場合は `null`。
  - [R-CRUD-04] decode 後の大きさが 1 MiB を超える画像は、popup が送る前に canvas で幅と高さを半分にして JPEG（quality 0.5）にし直し、収まるまで繰り返す。
  - [R-CRUD-05] 成功したら、queue の中で応答の DTO と送った画像（`imageId`・`sha256` は応答の値）を cache に入れ、alarm を作る。
- [R-CRUD-06] **削除**（`reminders/delete`）: 削除の手順で消し、queue の中で cache から外し、alarm を消す。
- [R-CRUD-07] popup は応答の `ok` を見て、失敗なら error を表示し、一覧を元に戻す。popup は alarm を触らない。
- [R-CRUD-08] local モードは、popup が今のまま `chrome.storage.local` の `reminders` を読み書きし、書いた後に `alarms/reset` を送る。background は queue の中で、受け付けた時のモードと世代が今と一致する時だけ、`clearAll()` を `await` してから、今のモードの一覧（local の `reminders` か `serverCache`）の未来かつ `hidden:false` の項目で alarm を作り直す。

## alarm と通知（`background.ts`）

- [R-ALARM-01] server モードの `onAlarm` と `notifications.onClicked` は、`serverCache` から項目を探し、通知とタブの判断を cache だけで行う。通知とタブの処理は今のまま。
- [R-ALARM-02] `onAlarm` は、次のすべてを満たす時だけ通知する: 今のモードが server、cache に項目がある、`hidden:false`、id が `notifiedIds` に無い、`reminderTime` が今から1分後より前。
- [R-ALARM-03] 通知の直前に、queue を通さず `notifiedIds[id]` を書く（長い同期を待たずに再通知を防ぐ）。そのあと queue の中で、非表示にする手順を best effort で試す。失敗しても log（code と status だけ）を出して終わる。次の同期の整理で直る。
- 通知と `notifiedIds` の書き込みは原子的ではない。書き込みの後、通知の前に worker が止まると、その通知は出ない（重複より欠落を選ぶ）。
- [R-ALARM-05] `onInstalled` は、モードに応じて local の `reminders` か `serverCache` から alarm を設定し直す。

## message（`messages.ts`）

| type | 入力 | 出力 |
| --- | --- | --- |
| [R-MSG-01] `auth/status` | — | status |
| [R-MSG-02] `auth/login` | — | `{ok}` または `{ok:false, code}` |
| [R-MSG-03] `auth/logout` | — | `{ok, revoked}` |
| [R-MSG-04] `config/save` | `{apiBaseUrl, authBaseUrl, clientId, imageHost}` | `{ok}` または `{ok:false, code}` |
| [R-MSG-05] `mode/change` | `{connectionType}` | `{ok}` |
| [R-MSG-06] `alarms/reset` | — | `{ok}` |
| [R-MSG-07] `reminders/list` | `{fresh?: boolean}` | `{ok, reminders}` または `{ok:false, code, reminders}` |
| [R-MSG-08] `reminders/create` | `Reminder` | `{ok, reminder}` または `{ok:false, code}` |
| [R-MSG-09] `reminders/delete` | `{id}` | `{ok}` または `{ok:false, code}` |

- [R-MSG-10] `sender.id === chrome.runtime.id` で、かつ `sender.url` が `chrome-extension://<自拡張の id>/` で始まる message だけを受け付ける。それ以外（content script、他の拡張）は無視する。
- [R-MSG-11] type ごとに入力を実行時に検証する。未知の type は無視する。`reminders/*` は server モードでなければ `NOT_SERVER_MODE` を返す。`create` は各 field の型と大きさ（server の制限と同じ）、`delete` と `create` の `id` は1〜128 code point の文字列で、制御文字（U+0000〜U+001F、U+007F〜U+009F）と対になっていない surrogate を含まないことを確かめる。`config/save` は「設定」の節と同じ検証をする。不合格なら `INVALID_MESSAGE` を返し、API を呼ばない。
- [R-MSG-12] popup は `sendMessage` の reject（worker の停止などで channel が切れた）を `NETWORK` として表示し、次の操作か開き直しで `reminders/list` と `auth/status` を読み直す。
- [R-MSG-13] API の body は、許可した field だけから組み立てる。
- [R-MSG-14] token、署名 URL を popup に返さない。

## 設定画面（`Settings.tsx`）

- [R-UI-01] Auto-open と Web Push は今のまま（切り替えたら、その field だけを即保存）。Connection Type は `mode/change` で切り替える。
- [R-UI-02] server モードの時だけ表示する。
  - [R-UI-03] 入力欄: API base URL、Auth base URL、Client ID、Image host。
  - [R-UI-04] 「保存」ボタン: 「設定」の節の手順。検証の error は欄の下に出す。
  - [R-UI-05] 状態: 未設定 / 許可なし（「許可する」ボタン）/ 未ログイン / ログイン中 / 要再ログイン / ログイン処理中 / 失効は未完了。
  - [R-UI-06] 「ログイン」/「ログアウト」ボタン。
- [R-UI-07] Connection Type の次に Theme（System / Light / Dark）のラジオボタンを置く。既定は System で、OS の設定（`prefers-color-scheme`）に従い、popup を開いている間の切り替えにも追従する。storage の値が3つのどれでもなければ System とする。popup は描画の前に設定を読んでテーマを当てる。

## 日時の入力（`DateTimePicker.tsx`）

- [R-PICK-01] 年・月を変えて、その月に無い日になる時は月末にする（1/31 で2月を選ぶと 2/28。翌月に繰り上げない）。時・分は変えない。
- [R-PICK-02] 日の選択肢は、選んでいる年・月の日数だけにする。
- [R-PICK-03] YouTube の配信予定の「M月D日 H:MM」は、今年のその日時（秒は0）として読む。月と日は一度に設定し、今日の日付から繰り上げない。存在しない日時は読まない。

## error の表示

popup は `code` を次の文言にして Label に出す。

| code | 文言 |
| --- | --- |
| [R-ERR-01] `NOT_CONFIGURED` | 接続先を設定してください |
| [R-ERR-02] `LOGIN_REQUIRED`、`UNAUTHORIZED` | ログインしてください |
| [R-ERR-03] `LOGIN_IN_PROGRESS` | ログインの処理中です |
| [R-ERR-04] `CONFLICT` | 別の端末で変更されています。最新の内容を確認して、もう一度操作してください |
| [R-ERR-05] `STALE` | 表示しない（設定やログインが変わったため、古い操作をやめた） |
| [R-ERR-06] `NETWORK`、`SERVICE_UNAVAILABLE`、`UNKNOWN_RESULT` | 通信できません。時間をおいて再度お試しください |
| [R-ERR-07] `OWNER_RATE_LIMIT_EXCEEDED`、429 | 操作が多すぎます。しばらく待ってください |
| [R-ERR-08] `OWNER_STORAGE_LIMIT_EXCEEDED` | 保存できる上限（1000件・画像 128 MiB）を超えています |
| [R-ERR-09] 403 の各 code | 権限がありません（<code>） |
| [R-ERR-10] その他 | エラー（<code>） |
| [R-ERR-11] `LOGIN_CANCELLED`、`LOGIN_FAILED` | 表示しない（状態欄の notice に出る） |

## log

[R-LOG-01] token、認可 code、`state`、`verifier`、callback URL、署名 URL を log に出さない。`console.error` には code と status だけを出す。例外として、`launchWebAuthFlow` の reject の message（Chrome の固定の文言で、URL や code を含まない）は出してよい。

## 採らないこと

| 指摘・案 | 理由 |
| --- | --- |
| 作成の照合で、GET した中身と送った内容を比べる | id は client が作る UUID で、衝突は事実上起きない。200 なら自分の作成とみなす |
| 署名 URL の早期失効時に URL を再発行する | URL は発行の直後に使う。失敗したら次の同期で取り直せば足りる |
| 同期の再開位置を保存する | 整理と画像は件数の上限で区切り、済んだものは次の同期で対象から外れる。最初から読み直しても先へ進む |
| offline の書き込み queue | 利用者は1人で、書き込みはオンラインの時だけで足りる |
| API 全体で request の予算を共有する | 利用者は1人。120回/分を超えた分は 429 の `Retry-After` で吸収する。整理と画像は件数の上限と順番の混ぜ合わせで先へ進む |
| alarm が指す予定と cache の予定を照合する（延期の検出） | この拡張機能には `reminderTime` を変える機能が無く、延期は起きない。`reminderTime` の判定し直しで足りる |
| 旧 extension ID の local データの移行 | owner の判断（2026-10-19）で移さない。旧版は手で削除する |

## テスト

`vitest` を加え、`npm test` で動かす。CI の `build.yml` に `npm test` を加える。

- PKCE: verifier が43文字の Base64URL、challenge が RFC 7636 の付録 B の例と一致する。
- callback の検証: 取り消し、URL・path の不一致、`state` の不一致、期限切れ、`error` param、`code` 無しで交換しない。
- login: 同時の2回の login で試行が1つだけ作られる。古い試行の `finally` が新しい試行を消さない。logout 後に完了した login は保存しない。login の成功で cache と server の alarm が消える。取り消しと失敗で `authNotice` が残る。
- auth mutex: login の保存と logout の消去を交互に起こしても、認証状態が復活しない。logout の revoke 中に成功した新しい login の状態を、logout の後半が消さない。
- 世代: message の受付の後に `config/save` が来た作成は、API を送らずに `STALE` になる。
- token の応答の検証: `token_type`、`expires_in` が不正なら保存しない。
- refresh: 同時の3回の `getAccessToken` で token endpoint が1回だけ呼ばれる。新しい refresh token が access token より先に保存される。`refresh_token` の無い応答は失敗。`invalid_grant` で認証状態が消える。通信障害・timeout では消えない。最初の送信から10秒を過ぎる再送をしない。世代が変わった応答は捨てる。
- logout: revoke が失敗しても端末の状態が消え、`authNotice` が `REVOKE_FAILED` になる。logout の後の API の操作は `LOGIN_REQUIRED`。
- モードの切り替え: 進行中の server の同期が、切り替えた後の local の alarm を上書きしない。
- alarm: `notifiedIds` にある項目、`hidden:true`、`reminderTime` が1分より先の項目は通知しない。通知の前に `notified:<id>` が書かれる。同時の2つの alarm の記録がどちらも残る。
- alarm の集約: `alarms/reset` の受付の後にモードが切り替わったら、何もしない。モードの切り替えの後に、古いモードの alarm が残らない。
- refresh の結果が不明: 通信障害の後、10秒を過ぎた次の呼び出し（worker の再起動の後を含む）では同じ token を送らず、`LOGIN_REQUIRED` になる。
- API: 401 で1回だけ refresh・再送する。429 の `Retry-After` に従う。書き込みの通信障害で再送しない。
- 書き込みの手順: POST の 201 で成功する。412 で GET からやり直す。404 で cache から外す。POST の `UNKNOWN_RESULT` で GET 照合する。409 と GET 404 で `ALREADY_EXISTS`。整理と alarm の非表示は最新の DTO で条件を判定し直す。1か月を過ぎた項目は DELETE だけ。user の削除の 412 は、cache を最新にして `CONFLICT`（自動で削除し直さない）。
- 同期: 空の `items` で `nextCursor` が残る page を読み続ける。60秒以内は同期しない。書き込みと画像はそれぞれ30件まで。同期中の作成が全件置き換えで消えない。`sha256`・`imageId` が同じなら取り直さない。照合が合わない画像（hash、`bytes`、`imageId`）、origin が違う URL は保存しない。DTO と `imageId` が違う cache の画像は表示しない。
- `removeOldReminders` の1か月前の計算: 3/31 → 2/28（平年）・2/29（うるう年）、1/31 → 12/31、5/15 → 4/15、境界の等号。
- message の送信元の検証、入力の検証。

## extension ID と operator への引き渡し

1. `openssl genrsa` で鍵を作り、公開鍵（DER の Base64）を manifest の `key` に入れる。秘密鍵（`.pem`）は repository の外に置き、owner が保管する。
2. unpacked で読み込み、ID と `getRedirectURL` の2つの URL を確かめる。`key` を入れると ID が変わり、別の拡張機能として扱われる。旧 ID の `chrome.storage.local`（local モードの reminder と設定）と alarm は引き継がない。二重の通知を防ぐため、旧版は `chrome://extensions` から手で削除する（README に書く）。
3. operator に `chrome_origin`、`callback_url`、`logout_url` を渡す（README に手順を書く）。

## README

server モードの設定手順、operator に渡す値、operator から受け取る値を追記する。AWS の実際の値は書かない。

## CLAUDE.md

### 方針（出典: https://code.claude.com/docs/en/memory 、https://code.claude.com/docs/en/best-practices ）

- 書くのは、code を読んでも分からないことだけ: command、既定と違う規約、構成の落とし穴、運用ルール。ディレクトリ構成の説明、言語の一般的な慣習、頻繁に変わる情報は書かない。判定は「この行を消したら agent が間違えるか」。
- 200 行未満。見出しと箇条書き。指示は検証できる形にする（例: 「commit 前に `npm test` を実行する」）。
- 強調（`IMPORTANT`）は、守られないと被害が大きい1〜2行だけに付ける。
- `AGENTS.md` は `CLAUDE.md` への symlink で、Codex も同じ内容を読む。そのため Claude Code だけに通じる書き方（skill 名、`@` の import）を避ける。
- 機密情報の扱いは、agent 共通の規則として本文に短く書く。Claude Code の hooks（`.claude/hooks/check-bash-command.sh`）と `settings.json` の deny は、Claude Code だけに効く追加の強制手段と位置付ける。
- 存在しない `/github-workflow` skill への参照を消し、手順を本文に書く。

### `CLAUDE.md`（完成後の文面）

```markdown
## プロジェクト概要

Web ページを指定した時刻に開く・通知する Chrome 拡張機能（Manifest V3、React + TypeScript + Vite）。
保存先は local（`chrome.storage.local`）か server（reminder-server の v2 API、Cognito 認証）を設定で選ぶ。

- 設計: `docs/superpowers/specs/2026-10-19-chrome-extension-v2-design.md`
- server の契約の正: https://github.com/Knu334/reminder-server の `docs/handoffs/api-v2.md`、`docs/handoffs/chrome-extension-cognito-auth.md`。この repository の `docs/handoffs/` は gitignore 対象の写し

## コマンド

- `npm ci`: 依存の導入（Node 22 以上。`.nvmrc` は 24）
- `npm run build`: popup（`vite.config.ts`）と service worker（`vite.config.background.ts`）を `dist/` に出力
- `npm run lint` / `npm test`（vitest）
- 動作確認: `chrome://extensions` で `dist/` を「パッケージ化されていない拡張機能」として読み込む

## 構成の注意

- build は2段。2段目は `emptyOutDir: false` で、1段目の出力に `assets/background.js` を足す
- `public/manifest.json` はそのまま `dist/` にコピーされる
- server の API と Cognito への通信は service worker（`src/background/`）だけで行う。popup は `chrome.runtime.sendMessage` で結果だけを受け取る（API Gateway が `chrome-extension://` の CORS を受け付けないため）

## 規約

- IMPORTANT: manifest の `key` を変えない。extension ID が変わり、Cognito に登録した callback URL と logout URL が使えなくなる
- token・認可 code・署名 URL を、protocol 上必要な callback と通信先を除き、`chrome.storage.sync`、DOM、ページの URL、log に転載・保存しない。log には error の code と status だけを出す
- `host_permissions` に `<all_urls>` を足さない。接続先は `optional_host_permissions` と `chrome.permissions.request` で許可する

## 機密情報

- `.env*`、Terraform の state・plan・tfvars、AWS の認証情報、reminder-server の `reminders.json` を、この repository に持ち込まない・読まない・commit しない
- AWS の account ID、ARN、bucket 名、実際の URL を commit、issue、PR、会話に書かない（伏せる）
- manifest の `key` に対応する秘密鍵（`.pem`）を repository に置かない

## 作業ルール

- `node_modules` `dist` 配下は原則参照しない。参照が必要な場合はユーザーに許可を得てから行う
- commit の前に `npm run lint`、`npm test`、`npm run build` を実行し、すべて通ることを確かめる

## GitHub ワークフロー

- main から `feature-<概要>` ブランチを作り（`git checkout -b`）、commit して push し、`gh pr create` で PR を出す。main に直接 commit しない
- local の操作（branch、commit、push、rebase）は `git`、GitHub の操作（PR、issue、CI の確認）は `gh` CLI を使う
- IMPORTANT: `git push --force` と `git reset --hard` は使わない
```

Resume Watchdog は `.claude/rules/resume-watchdog.md`（Claude Code が自動で読み込む）のままにし、`CLAUDE.md` には書かない。
