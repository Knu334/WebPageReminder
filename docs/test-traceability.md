# 要件とテストの対応表

設計（[spec](superpowers/specs/2026-10-19-chrome-extension-v2-design.md)）の要件 ID（`[R-…]`）と、名前にその ID を含む自動テスト（vitest）の対応。`npm run trace` がテストを実行して生成する。手で編集しない。CI は `npm run trace:check` で、この文書が最新であることを確かめる。テストの名前の先頭の ID は表示から省く。`src/test/` のテスト（この表の生成の道具のテスト）は要件 ID を持たないので、数と一覧から除く。

## 実行方法

```sh
npm test                                  # すべてのテスト
npx vitest run src/background/api.test.ts # 1 file
npm run trace                             # テストを実行し、この文書を作り直す
npm run trace:check                       # この文書が最新かを確かめる（CI）
```

CI（`.github/workflows/build.yml`）は build の前に `npm test` と `npm run trace:check` を実行する。

## テストの環境

| 項目 | 内容 |
| --- | --- |
| 実行環境 | Node（`vitest.config.ts` の `environment: "node"`）。DOM は無い |
| 対象 | `src/**/*.test.ts` |
| timezone | `Asia/Tokyo` に固定（`src/test/setup.ts`） |
| `chrome.*` | `src/test/chrome.ts` の in-memory の mock。テストごとに作り直す。`storage.local._data` / `storage.session._data` で中身を見る |
| `fetch` | `vi.stubGlobal` で差し替える。テストの後に `vi.unstubAllGlobals()` |
| module の状態 | `authGen` などを持つ module は、`vi.resetModules()` の後に `await import()` し直す（service worker の再起動の再現にも使う） |
| 時刻 | 必要なテストだけ `vi.useFakeTimers()`。テストの後に `vi.useRealTimers()` |

## 自動テストで確かめていないこと

次は手で確かめる（実 AWS と Chrome での受け入れ確認）。

- popup の画面（`App.tsx`、`Settings.tsx`、`ServerSettings.tsx`）: component のテストの基盤が無い
- `background.ts` の listener の登録（送信元の検証の配線、未知の type に応答しないこと）
- canvas での画像の縮小（`canvasHalve`）: DOM が要る
- 実際の Chrome の API の挙動: 許可の dialog、`launchWebAuthFlow`、user gesture、service worker の停止
- 実際の Cognito・API Gateway・S3 との通信

## 集計

| 項目 | 数 |
| --- | --- |
| 要件 | 157 |
| テストのある要件 | 141 |
| テストの無い要件 | 16 |
| テスト | 186 |
| 要件 ID の無いテスト | 0 |

## 要件ごとのテスト

### 範囲

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-SCOPE-07 | removeOldReminders の「1か月前」を「ローカル時刻の前月の同じ日・同じ時刻。その日が無い月は前月の末日（時刻は同じ）」と定義して直す（今は 3/31 の1か月前が 3/3 になる）。境界は「reminderTime が1… | [ReminderUtils.test.ts](../src/utils/ReminderUtils.test.ts) › oneMonthBefore: 存在しない日は前月の末日<br>[ReminderUtils.test.ts](../src/utils/ReminderUtils.test.ts) › removeOldReminders: ちょうど1か月前は残し、それより前は消す |
| R-SCOPE-08 | alarm の設定・解除は、local モードも含めて background の queue に集める。popup の resetAlerm と chrome.alarms の直接の呼び出しは削除する（今は clearAll() を aw… | [cache.test.ts](../src/background/cache.test.ts) › rebuildAlarms: local は reminders から作る<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset は今のモードの一覧から alarm を作り直す |

### manifest

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-MAN-01 | permissions: storage、tabs、notifications、alarms、activeTab、unlimitedStorage、identity、scripting。identity.email は外す。 | — |
| R-MAN-02 | host_permissions は書かない。&lt;all_urls&gt; を外す。popup を開いた時の executeScript と captureVisibleTab は activeTab で足りる。 | — |
| R-MAN-03 | optional_host_permissions: https://\*.amazonaws.com/\*、https://\*.amazoncognito.com/\*。 | — |
| R-MAN-04 | key: 生成した公開鍵（Base64 の DER）。 | — |

### 設定（SettingsType）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-CFG-01 | 旧 url は読み込み時に捨てる。 | [config.test.ts](../src/utils/config.test.ts) › config › loadSettings drops old url and does not throw |
| R-CFG-02 | apiBaseUrl、authBaseUrl、imageHost は https: の URL で、path・query・hash が無いことを検証する。値は new URL(x).origin に正規化して保存する。clientId は… | [messages.test.ts](../src/background/messages.test.ts) › parseMessage › config/save の不正な URL は invalid、正しければ正規化する<br>[config.test.ts](../src/utils/config.test.ts) › config › normalizes<br>[config.test.ts](../src/utils/config.test.ts) › config › rejects bad urls |
| R-CFG-03 | popup で検証する。不合格なら欄の下に error を出し、保存しない。 | — |
| R-CFG-04 | background に config/save を送る。background は auth mutex と queue の中で、再検証、4項目の保存、authGen の更新、認証状態・cache・server モードの alarm の消… | [messages.test.ts](../src/background/messages.test.ts) › config/save で接続先が変わらなければ消さない<br>[messages.test.ts](../src/background/messages.test.ts) › config/save で接続先が変わると認証と cache と alarm が消え、世代が進む<br>[messages.test.ts](../src/background/messages.test.ts) › config/save は4項目だけを保存し、他の field で settings を書き換えない |
| R-CFG-05 | popup が3つの origin（&lt;origin&gt;/\*）を chrome.permissions.request で求める。 | [config.test.ts](../src/utils/config.test.ts) › config › key and patterns |
| R-CFG-06 | 許可の dialog で popup が閉じても、設定は保存済みである。popup を開くたびに chrome.permissions.contains で確かめ、許可が無ければ状態欄に「許可する」ボタン（chrome.permissio… | — |
| R-CFG-07 | 2の途中で worker が止まった場合に備え、認証状態と cache は読むたびに configKey を今の設定と照合し、違えば使わずに消す。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › configKey が違う認証状態は使わずに消す<br>[cache.test.ts](../src/background/cache.test.ts) › readCache: configKey が違う cache は空になり消える |
| R-CFG-08 | 入力中の4項目は Settings component の state に置き、「保存」まで storage に書かない。Auto-open と Web Push は、今の storage の値にその field だけを上書きして即保存す… | — |
| R-CFG-09 | Connection Type の切り替えは background に mode/change を送る。background は queue の中で、保存、authGen の更新（進行中の旧モードの処理を無効にする）、chrome.ala… | [messages.test.ts](../src/background/messages.test.ts) › mode/change の後に古いモードの alarm が残らない<br>[messages.test.ts](../src/background/messages.test.ts) › 進行中の server の同期が、切り替えた後の local の alarm を上書きしない |

### storage

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-STO-01 | chrome.storage.session / authSession / {accessToken, expiresAt, configKey} | [auth.login.test.ts](../src/background/auth.login.test.ts) › code を交換して保存する |
| R-STO-02 | chrome.storage.session / authAttempt / {state, verifier, redirectUri, configKey, startedAt} | [auth.login.test.ts](../src/background/auth.login.test.ts) › 古い試行の finally が新しい試行を消さない |
| R-STO-03 | chrome.storage.session / authNotice / {code, at}。code は LOGIN_FAILED、LOGIN_CANCELLED、REFRESH_FAILED（確定した更新の失敗）、LOGGED_O… | [auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: 11分後<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: code 無し<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: error=access_denied<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: host 違い<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: path 違い<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: reject<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: state 違い<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: undefined<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke が失敗しても端末の状態は消える: 503<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke が失敗しても端末の状態は消える: reject<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 10秒を過ぎた refreshPending があれば送らない<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › invalid_grant で認証状態を消す<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › refresh_token の無い応答は失敗 |
| R-STO-04 | chrome.storage.local / authRefresh / {refreshToken, configKey} | [auth.login.test.ts](../src/background/auth.login.test.ts) › code を交換して保存する<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 新しい refresh token を access token より先に保存する |
| R-STO-05 | chrome.storage.local / settings / SettingsType | [config.test.ts](../src/utils/config.test.ts) › config › loadSettings defaults when empty |
| R-STO-06 | chrome.storage.local / reminders / local モードの一覧（既存） | [cache.test.ts](../src/background/cache.test.ts) › rebuildAlarms: local は reminders から作る<br>[notify.test.ts](../src/background/notify.test.ts) › local モードは今の動作（hidden を true にして保存） |
| R-STO-07 | chrome.storage.local / serverCache / {items: ReminderDto[], images: {[id]: {imageId, sha256, dataUrl}}, syncedAt, confi… | [sync.write.test.ts](../src/background/sync.write.test.ts) › 201 で成功し cache に入る |
| R-STO-08 | chrome.storage.local / notified:&lt;id&gt; / 通知した時刻。server モードで通知済みの項目ごとに1つの key（1つの map にしないので、読んで書き直す競合が起きない）。cache の queue… | [cache.test.ts](../src/background/cache.test.ts) › notified の同時の記録がどちらも残る |
| R-STO-09 | chrome.storage.session / refreshPending / {refreshTokenHash, firstSentAt}。結果が不明な refresh の記録。token そのものは入れず、SHA-256 の h… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › clearAuth は authSession・authRefresh・refreshPending を消す<br>[pkce.test.ts](../src/background/pkce.test.ts) › sha256Hex |
| R-STO-10 | configKey は、正規化した apiBaseUrl、authBaseUrl、clientId、imageHost を  /  でつないだ文字列。今の設定と違う認証状態・cache は使わずに消す。 | [cache.test.ts](../src/background/cache.test.ts) › readCache: configKey が違う cache は空になり消える<br>[config.test.ts](../src/utils/config.test.ts) › config › key and patterns |
| R-STO-11 | background の起動時と onInstalled で chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"}) を呼ぶ。 | [background.test.ts](../src/background.test.ts) › 起動時と onInstalled で setAccessLevel を呼ぶ |
| R-STO-12 | token を chrome.storage.sync、DOM、URL、log に置かない。 | [messages.test.ts](../src/background/messages.test.ts) › token と署名 URL を popup・storage.sync・log に出さない |

### 世代と直列化

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-GEN-01 | authGen: module 変数の世代番号。logout、login の成功、config/save（接続先が変わった時）、mode/change で進める。service worker の再起動では 0 から始まるが、再起動を跨いで… | [auth.login.test.ts](../src/background/auth.login.test.ts) › logout 後に完了した login は保存しない<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › login の保存と logout の消去を交互にしても復活しない<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke 中に成功した新しい login を消さない<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 世代が変わった応答は捨てる<br>[gen.test.ts](../src/background/gen.test.ts) › bumpGen aborts previous<br>[messages.test.ts](../src/background/messages.test.ts) › config/save で接続先が変わると認証と cache と alarm が消え、世代が進む |
| R-GEN-02 | 世代は、message を受け取った時点（alarm は発火した時点）で固定し、その処理の全体で使う。token を取った後、各 API の送信・再送の直前、認証状態・cache・alarm に書く直前に一致を確かめる。違えば、その時点で… | [api.test.ts](../src/background/api.test.ts) › token が取れなければ code を返し、abort は STALE<br>[api.test.ts](../src/background/api.test.ts) › 送る前に世代を確かめる<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 古い世代の呼び出しは STALE<br>[cache.test.ts](../src/background/cache.test.ts) › rebuildAlarms と clearServerAlarms: 古い世代は clearAll しない<br>[cache.test.ts](../src/background/cache.test.ts) › writeCache と clearServerCache は古い世代では何もしない<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset の受付の後に mode/change が来たら何もしない（→ local）<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset の受付の後に mode/change が来たら何もしない（→ server）<br>[messages.test.ts](../src/background/messages.test.ts) › login の後処理の前に logout が来たら、login の後処理は何もしない<br>[messages.test.ts](../src/background/messages.test.ts) › logout の revoke 中に成功した新しい login の cache と alarm を、logout の後処理が消さない<br>[messages.test.ts](../src/background/messages.test.ts) › 受け付けた後に config/save が来た作成は STALE で API を送らない<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › API の成功後に bumpGen されたら cache に書かず STALE<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › 受け付けた後に bumpGen されたら API を送らず STALE |
| R-GEN-03 | auth mutex: 認証状態（authAttempt、authSession、authRefresh、authNotice）の読み書きと消去は、auth.ts の1本の Promise chain に通す。世代の確認と保存は、同じ m… | [auth.logout.test.ts](../src/background/auth.logout.test.ts) › login の保存と logout の消去を交互にしても復活しない<br>[serial.test.ts](../src/background/serial.test.ts) › runs serially and survives rejection<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 同期中の config/save が完了する |
| R-GEN-04 | queue: serverCache とすべての alarm（local モードの分も含む）を書き換える処理（同期、作成、削除、alarm 後の更新、消去、モードの切り替え、alarms/reset）は、cache.ts の1本の Pro… | [messages.test.ts](../src/background/messages.test.ts) › 進行中の server の同期が、切り替えた後の local の alarm を上書きしない<br>[serial.test.ts](../src/background/serial.test.ts) › runs serially and survives rejection<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 同期中の作成が全件置き換えで消えない（応答に含む: false）<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 同期中の作成が全件置き換えで消えない（応答に含む: true）<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › queue の中から hideInQueue・deleteInQueue を呼んでも完了する |
| R-GEN-05 | logout と config/save は、進行中の fetch を AbortController で中断する（世代ごとに1つ持つ）。 | [gen.test.ts](../src/background/gen.test.ts) › bumpGen aborts previous |

### login

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-LOGIN-01 | popup の「ログイン」ボタンの message からだけ始める。起動時に開かない。 | — |
| R-LOGIN-02 | 設定の4項目がそろい、chrome.permissions.contains で許可があることを確かめる。無ければ NOT_CONFIGURED。 | [auth.login.test.ts](../src/background/auth.login.test.ts) › 許可が無ければ NOT_CONFIGURED |
| R-LOGIN-03 | auth mutex の中で、authAttempt があり startedAt から10分以内なら、LOGIN_IN_PROGRESS を返して新しい試行を始めない（試行は1件ずつ）。無ければ、同じ区間の中で3・4の authAttem… | [auth.login.test.ts](../src/background/auth.login.test.ts) › 同時の2回の login で試行は1つ<br>[messages.test.ts](../src/background/messages.test.ts) › login の window を開いている間の auth/status は loginInProgress: true、取り消し後は notice: LOGIN_CANCELLED |
| R-LOGIN-04 | state と code_verifier を、それぞれ crypto.getRandomValues の 32 byte を padding なしの Base64URL（43文字）にして作る。code_challenge = BASE6… | [pkce.test.ts](../src/background/pkce.test.ts) › RFC 7636 appendix B<br>[pkce.test.ts](../src/background/pkce.test.ts) › randomToken |
| R-LOGIN-05 | redirectUri = chrome.identity.getRedirectURL("cognito")。authAttempt を session に置き、開始時の authGen を記録する。 | [auth.login.test.ts](../src/background/auth.login.test.ts) › authorize の URL<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › code を交換して保存する |
| R-LOGIN-06 | URLSearchParams で response_type=code、client_id、redirect_uri、scope=openid reminder-api/read reminder-api/write、state、cod… | [auth.login.test.ts](../src/background/auth.login.test.ts) › authorize の URL |
| R-LOGIN-07 | 返った URL を検証する。次のどれかに当たれば交換へ進まない。 | [auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: 11分後<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: code 無し<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: error=access_denied<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: host 違い<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: path 違い<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: reject<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: state 違い<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換しない callback: undefined |
| R-LOGIN-08 | POST &lt;authBase&gt;/oauth2/token に Content-Type: application/x-www-form-urlencoded で grant_type=authorization_code、client_i… | [auth.login.test.ts](../src/background/auth.login.test.ts) › code を交換して保存する<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 交換が 400 なら LOGIN_FAILED で、code を再送しない |
| R-LOGIN-09 | 応答の access_token・refresh_token が文字列、token_type === "Bearer"、expires_in が正の数であることを検証する。 | [auth.login.test.ts](../src/background/auth.login.test.ts) › code を交換して保存する<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 応答の検証: expires_in 0<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › 応答の検証: token_type 小文字 |
| R-LOGIN-10 | auth mutex の中で、authGen が開始時と一致することを確かめる（違えば捨てる）。先に authRefresh を local に保存し、そのあと authSession（expiresAt = now + expires_… | [auth.login.test.ts](../src/background/auth.login.test.ts) › code を交換して保存する<br>[auth.login.test.ts](../src/background/auth.login.test.ts) › logout 後に完了した login は保存しない<br>[messages.test.ts](../src/background/messages.test.ts) › login の後処理の前に logout が来たら、login の後処理は何もしない |
| R-LOGIN-11 | 成否にかかわらず finally で、auth mutex の中で、authAttempt.state が自分の state と一致する場合だけ authAttempt を消す。取り消しなら authNotice に LOGIN_CANC… | [auth.login.test.ts](../src/background/auth.login.test.ts) › 古い試行の finally が新しい試行を消さない |
| R-LOGIN-12 | 成功したら queue の中で serverCache と server モードの alarm を消し、同期を始める（同じ接続先でも、ログインし直した利用者の cache を引き継がない）。 | [messages.test.ts](../src/background/messages.test.ts) › login の成功で古い cache を消して同期を始める |

### getAccessToken

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-TOKEN-01 | authSession があり、configKey が今の設定と一致し、expiresAt - now &gt; 30秒 なら、その access token を返す。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › configKey が違う認証状態は使わずに消す<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 期限まで30秒より多ければ token endpoint を呼ばない |
| R-TOKEN-02 | そうでなければ refresh する。refresh の Promise は module 変数に1つだけ持ち、同時の呼び出しは同じ Promise を待つ（single-flight）。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 30秒以下なら refresh する<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › authRefresh が無ければ LOGIN_REQUIRED<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › force は30秒の判定を飛ばす<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › storage の例外でも throw しない<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 同時の3回で token endpoint は1回<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 未設定なら NOT_CONFIGURED |

### refresh

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-REFRESH-01 | POST &lt;authBase&gt;/oauth2/token に form で grant_type=refresh_token、client_id、refresh_token を送る。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 新しい refresh token を access token より先に保存する |
| R-REFRESH-02 | 成功の検証: access_token と refresh_token が文字列、token_type === "Bearer"、expires_in が正の数。rotation が有効なので、refresh_token が無い応答は失敗… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › refresh_token の無い応答は失敗<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › token_type・expires_in が不正なら保存しない |
| R-REFRESH-03 | 保存: auth mutex の中で、authGen が開始時と一致することを確かめる（違えば捨てる）。新しい refresh_token を先に local へ保存し、そのあと authSession を session に保存する。保… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 世代が変わった応答は捨てる<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 新しい refresh token を access token より先に保存する |
| R-REFRESH-04 | 400 で error が invalid_grant、invalid_client、unauthorized_client: auth mutex の中で、authGen が一致する場合だけ、認証状態（authRefresh、authS… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › clearAuth は authSession・authRefresh・refreshPending を消す<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › invalid_grant で認証状態を消す |
| R-REFRESH-05 | 送る前に、auth mutex の中で refreshPending を確かめる。同じ refresh token の記録があり、firstSentAt から10秒を過ぎていれば、送らずに認証状態を消し、authNotice に REFR… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 10秒を過ぎた refreshPending があれば送らない |
| R-REFRESH-06 | HTTP の応答（成功・失敗とも）を受け取ったら、refreshPending を消す。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › invalid_grant で認証状態を消す<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 新しい refresh token を access token より先に保存する |
| R-REFRESH-07 | 通信障害・timeout の時は refreshPending を残す。10秒以内なら backoff（0.5秒、1秒）で再送し、10秒を過ぎる再送はしない。refresh token は消さず、NETWORK を返す。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 10秒を過ぎた refreshPending があれば送らない<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 10秒以内の refreshPending は再送する<br>[auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 通信障害では消さない |
| R-REFRESH-08 | 呼び出しや worker の再起動を跨いでも refreshPending で同じ判定をする。session storage なので Chrome の再起動では消えるが、その時はすでに10秒を過ぎており、次の refresh の inva… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 10秒以内の refreshPending は再送する |
| R-REFRESH-09 | 5xx は Cognito が処理しなかった応答として扱い、refreshPending を消して、上と同じ backoff で再送する。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › 5xx は refreshPending を消して backoff で再送する |
| R-REFRESH-10 | refresh の fetch の timeout は 4秒（全体の10秒の例外。10秒の猶予の中で再送できるようにするため）。 | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › refresh の fetch の timeout は4秒 |

### logout

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-LOGOUT-01 | auth mutex の中で、authRefresh の値を読み、authGen を進め、進行中の fetch を中断し、authRefresh と authSession を消す。以降、古い世代の処理は認証状態と cache に書けず、… | [auth.logout.test.ts](../src/background/auth.logout.test.ts) › logout の後の API は LOGIN_REQUIRED |
| R-LOGOUT-02 | mutex の外で、1で読んだ refresh token を POST &lt;authBase&gt;/oauth2/revoke に form で client_id と token として送る。200 なら revoked = true。通信… | [auth.logout.test.ts](../src/background/auth.logout.test.ts) › refresh token が無ければ revoke を送らない<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke が失敗しても端末の状態は消える: 503<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke が失敗しても端末の状態は消える: reject<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke の form |
| R-LOGOUT-03 | queue の中で serverCache と server モードの alarm を消す。 | [messages.test.ts](../src/background/messages.test.ts) › logout の revoke 中に成功した新しい login の cache と alarm を、logout の後処理が消さない |
| R-LOGOUT-04 | launchWebAuthFlow({url: &lt;authBase&gt;/logout?client_id=&lt;id&gt;&logout_uri=&lt;getRedirectURL("logout")&gt;, interactive: true}) を開く… | [auth.logout.test.ts](../src/background/auth.logout.test.ts) › logout page の失敗 |
| R-LOGOUT-05 | auth mutex の中で、authGen が1で進めた値のままの場合だけ、authNotice に結果を残す。revoke の失敗は REVOKE_FAILED、logout のページの失敗は LOGOUT_PAGE_FAILED、両… | [auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke が失敗しても端末の状態は消える: 503<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke が失敗しても端末の状態は消える: reject<br>[auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke 中に成功した新しい login を消さない |
| R-LOGOUT-06 | popup に {revoked} を返す。popup が閉じていても、auth/status が authNotice を返す。REVOKE_FAILED なら「ログアウトしたが、server 側の失効は未完了（通信障害）」、LOGOU… | [auth.logout.test.ts](../src/background/auth.logout.test.ts) › revoke の form<br>[messages.test.ts](../src/background/messages.test.ts) › logout の revoke 中に成功した新しい login の cache と alarm を、logout の後処理が消さない |

### status

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-STATUS-01 | auth/status は {configured, permitted, state: "LOGGED_OUT" / "LOGGED_IN" / "LOGIN_REQUIRED", loginInProgress, notice} を返… | [auth.refresh.test.ts](../src/background/auth.refresh.test.ts) › getAuthStatus<br>[messages.test.ts](../src/background/messages.test.ts) › login の window を開いている間の auth/status は loginInProgress: true、取り消し後は notice: LOGIN_CANCELLED |

### API client（api.ts）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-API-01 | request(method, path, {body, ifMatch}): getAccessToken() の token を Authorization: Bearer で付ける。body は Content-Type: appl… | [api.test.ts](../src/background/api.test.ts) › Bearer と JSON を付ける<br>[api.test.ts](../src/background/api.test.ts) › 送る前に世代を確かめる |
| R-API-02 | すべての fetch（API、Cognito、S3）に AbortSignal.timeout(10_000) を付ける。refresh だけは 4秒（「refresh」の節）。timeout は通信障害として扱う。 | [api.test.ts](../src/background/api.test.ts) › API の fetch に10秒の timeout を付ける<br>[messages.test.ts](../src/background/messages.test.ts) › Cognito・API・S3 のすべての fetch に10秒の timeout を付ける |
| R-API-03 | 戻り値は {ok: true, status, data, etag} か {ok: false, status, code, message}。code は body の code、無ければ status から決める（Gateway の… | [api.test.ts](../src/background/api.test.ts) › 2xx で JSON が壊れていれば BAD_RESPONSE<br>[api.test.ts](../src/background/api.test.ts) › body の読み取り失敗は通信障害として扱う<br>[api.test.ts](../src/background/api.test.ts) › token が取れなければ code を返し、abort は STALE |
| R-API-04 | 401 / 強制的に refresh して1回だけ再送する。再び 401 なら UNAUTHORIZED | [api.test.ts](../src/background/api.test.ts) › 401 で1回だけ force refresh して再送する<br>[api.test.ts](../src/background/api.test.ts) › force refresh は 401 の直後の1回だけ |
| R-API-05 | 403 / 返す。再試行しない | [api.test.ts](../src/background/api.test.ts) › 403 は再試行しない |
| R-API-06 | 429 / Retry-After（無ければ1秒）に 0〜1 秒の jitter を足し、最大2回再試行 | [api.test.ts](../src/background/api.test.ts) › 429 は Retry-After と jitter で最大2回<br>[api.test.ts](../src/background/api.test.ts) › JSON でない 429 は1秒待つ |
| R-API-07 | 503・通信障害（GET） / jitter 付き backoff（0.5秒、1秒）で最大2回 | [api.test.ts](../src/background/api.test.ts) › GET の通信障害は 0.5秒・1秒で最大2回、書き込みは再送しない<br>[api.test.ts](../src/background/api.test.ts) › body の読み取り失敗は通信障害として扱う |
| R-API-08 | 503・通信障害（POST・PATCH・DELETE） / 自動で再送しない。UNKNOWN_RESULT を返し、呼び出し側が GET で照合する | [api.test.ts](../src/background/api.test.ts) › GET の通信障害は 0.5秒・1秒で最大2回、書き込みは再送しない |
| R-API-09 | その他 / そのまま返す | [api.test.ts](../src/background/api.test.ts) › その他の status は再試行せず code と status を返す |
| R-API-10 | listPage(cursor): GET /v2/reminders?limit=50&cursor= | [api.test.ts](../src/background/api.test.ts) › listPage の query |
| R-API-11 | getReminder(id): GET /v2/reminders/{id} → DTO と ETag | [api.test.ts](../src/background/api.test.ts) › Bearer と JSON を付ける |
| R-API-12 | createReminder(body): POST /v2/reminders | [api.test.ts](../src/background/api.test.ts) › createReminder は POST /v2/reminders |
| R-API-13 | patchReminder(id, patch, etag): PATCH、If-Match: etag | [api.test.ts](../src/background/api.test.ts) › PATCH と DELETE に If-Match を付ける |
| R-API-14 | deleteReminder(id, etag): DELETE、If-Match: etag | [api.test.ts](../src/background/api.test.ts) › PATCH と DELETE に If-Match を付ける |
| R-API-15 | getThumbnailUrl(id): GET /v2/reminders/{id}/thumbnail-url | [api.test.ts](../src/background/api.test.ts) › getThumbnailUrl は GET /v2/reminders/{id}/thumbnail-url |
| R-API-16 | S3 の画像の fetch は api.ts を通さず、Bearer を付けない。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像を取得して data URL で保存する。S3 には Authorization を付けず redirect: error |

### 書き込みの手順（sync.ts）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-WRITE-01 | 作成: POST。201 なら成功。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 201 で成功し cache に入る |
| R-WRITE-02 | UNKNOWN_RESULT なら GET で照合する。200 なら成功（id は client が作る UUID なので、自分の作成とみなす）。404 なら1回だけ POST し直す。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › UNKNOWN_RESULT → GET 200 で成功<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › UNKNOWN_RESULT → GET 404 → POST 1回だけ再送 |
| R-WRITE-03 | 409 なら GET で照合する。200 なら成功。404 なら、その id は削除済みで再利用できないため ALREADY_EXISTS の error を返す。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 409 → GET 200 で成功<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › 409 → GET 404 で ALREADY_EXISTS |
| R-WRITE-04 | 非表示にする（hidden:true, thumbnail:null）: GET で最新の DTO と ETag を取る。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 412 で GET からやり直す（1回） |
| R-WRITE-05 | 最新の DTO で条件を判定し直す。すでに hidden:true かつ thumbnail:null なら何もしない。呼び出し元（整理、alarm）にかかわらず、reminderTime が今より後なら何もしない。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › すでに hidden かつ thumbnail null なら PATCH しない<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › 最新が未来の時刻なら PATCH しない |
| R-WRITE-06 | PATCH する。412 なら GET からやり直す（1回）。404 なら remote で消えたものとして cache から外す。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 404 で cache から外す<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › 412 が2回なら失敗を返す<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › 412 で GET からやり直す（1回） |
| R-WRITE-07 | UNKNOWN_RESULT なら GET して、hidden:true かつ thumbnail:null なら成功。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › UNKNOWN_RESULT → GET で両方の条件を満たせば成功<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › UNKNOWN_RESULT → GET で条件を満たさなければ UNKNOWN_RESULT |
| R-WRITE-08 | 削除: GET で ETag を取る。期限切れの整理から呼ばれた場合、最新の DTO の reminderTime で条件を判定し直し、外れたら何もしない。DELETE する。404、または UNKNOWN_RESULT 後の GET が… | [sync.write.test.ts](../src/background/sync.write.test.ts) › 404 と UNKNOWN_RESULT → GET 404 は成功<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › cleanup で最新が1か月以内なら DELETE しない<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › user の削除の成功で cache から外し alarm を消す |
| R-WRITE-09 | user の削除で 412 なら、GET した最新の DTO で cache を更新して CONFLICT を返す。自動では削除し直さない。popup は最新の内容を表示し、user がもう一度削除を押す。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › user の 412 は cache を最新にして CONFLICT、DELETE は1回 |
| R-WRITE-10 | 期限切れの整理で 412 なら、GET からやり直す（1回）。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › cleanup の 412 は GET からやり直す |
| R-WRITE-11 | 成功したら、queue の中で cache と alarm を更新する。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › user の削除の成功で cache から外し alarm を消す |
| R-WRITE-12 | 読んだ DTO をそのまま PATCH に送らない。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 412 で GET からやり直す（1回） |

### 一覧の同期（sync.ts）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-SYNC-01 | reminders/list（fresh 無し）: serverCache を Reminder[] に変換して返す。通信しない。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › fresh でなければ通信しない |
| R-SYNC-02 | reminders/list {fresh: true}: syncedAt から60秒以内なら、同期せずに cache を返す。そうでなければ同期の完了か失敗まで待ち、1回だけ応答する。同期中に別の fresh が来たら、同じ同期を待つ… | [sync.list.test.ts](../src/background/sync.list.test.ts) › 60秒以内は同期しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 同時の fresh は1回の同期 |
| R-SYNC-03 | popup は開いた時に、まず fresh 無しで呼んで表示し、続けて fresh: true で呼んで表示を更新する。popup が閉じても同期は background で続き、次に開いた時の cache に反映される。 | — |
| R-SYNC-04 | listPage を直列に、nextCursor が null になるまで読む。items が空でも続ける。読み終わってから cache の items を全件置き換える（同期中の作成・削除は queue の後ろで待つので、巻き戻らない）。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 同期中の作成が全件置き換えで消えない（応答に含む: false）<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 同期中の作成が全件置き換えで消えない（応答に含む: true）<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 空の items で nextCursor が残る page を読み続ける |
| R-SYNC-05 | 整理（1回の同期で、書き込みは合計30件まで。対象は毎回順番を混ぜて選び、失敗した項目が後続を止めないようにする。残りは次の同期）: | [sync.list.test.ts](../src/background/sync.list.test.ts) › pickRandom は重複なく n 件まで選ぶ<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 整理の1件の失敗が後続を止めない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 整理は書き込み30件まで |
| R-SYNC-06 | reminderTime が1か月より前の項目は、削除の手順で消す（PATCH はしない）。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 1か月より前は DELETE だけ |
| R-SYNC-07 | それ以外で reminderTime が今より前、かつ hidden:false の項目は、非表示にする手順を行う。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 整理の1件の失敗が後続を止めない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 整理は書き込み30件まで |
| R-SYNC-08 | 画像（1回の同期で、取得は30件まで。対象は毎回順番を混ぜて選ぶ。残りは次の同期）: | [sync.list.test.ts](../src/background/sync.list.test.ts) › pickRandom は重複なく n 件まで選ぶ<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像は30件まで、sha256 と imageId が同じなら取り直さない |
| R-SYNC-09 | DTO の thumbnail が null なら、cache の画像を消す。DTO に無い id の画像も消す。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › DTO の thumbnail が null、または DTO に無い id の画像を消す |
| R-SYNC-10 | {imageId, sha256} が cache と違う項目だけ取得する。手順は次のとおり。どれかが合わなければ保存せず、次の同期で取り直す。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: bytes 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: hash 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: imageId 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: origin 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: status 200 以外 なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像は30件まで、sha256 と imageId が同じなら取り直さない |
| R-SYNC-11 | getThumbnailUrl を呼び、応答の imageId が DTO と一致することを確かめる。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: bytes 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: hash 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: imageId 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: origin 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: status 200 以外 なら保存しない |
| R-SYNC-12 | 署名 URL の origin が設定の imageHost と一致することを確かめる。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: bytes 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: hash 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: imageId 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: origin 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: status 200 以外 なら保存しない |
| R-SYNC-13 | fetch(url, {redirect: "error"})（Bearer なし）。status が 200 であること。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: bytes 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: hash 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: imageId 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: origin 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: status 200 以外 なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像を取得して data URL で保存する。S3 には Authorization を付けず redirect: error |
| R-SYNC-14 | 受け取った大きさが DTO の bytes と一致すること。SHA-256 を hex で計算し、DTO の sha256 と照合する。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: bytes 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: hash 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: imageId 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: origin 違い なら保存しない<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 画像の照合: status 200 以外 なら保存しない |
| R-SYNC-15 | data URL にして cache に保存する。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 画像を取得して data URL で保存する。S3 には Authorization を付けず redirect: error |
| R-SYNC-16 | notifiedIds から、DTO が hidden:true になった id と DTO に無い id を消す。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › notified から hidden:true と DTO に無い id を消す |
| R-SYNC-17 | server モードの alarm を、cache の未来かつ hidden:false の項目で設定し直す（server モードの時だけ。世代が違えば何もしない）。 | [cache.test.ts](../src/background/cache.test.ts) › rebuildAlarms と clearServerAlarms: 古い世代は clearAll しない<br>[cache.test.ts](../src/background/cache.test.ts) › rebuildAlarms: server は未来・非表示でない・未通知の1件だけ<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 同期の後に server の alarm を作り直す |
| R-SYNC-18 | syncedAt を更新する。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 失敗した時は cache の変換と code を返す<br>[sync.list.test.ts](../src/background/sync.list.test.ts) › 空の items で nextCursor が残る page を読み続ける |
| R-SYNC-19 | 失敗した時は {ok: false, code, reminders: &lt;cache の変換&gt;} を返す。popup は一覧を表示し、error を Label に出す。 | [sync.list.test.ts](../src/background/sync.list.test.ts) › 失敗した時は cache の変換と code を返す |

### DTO から Reminder への変換

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-DTO-01 | thumbnail: cache の画像の imageId・sha256 が DTO の thumbnail と一致する時だけ、その data URL。一致しない、または画像が無ければ NO_DATA.thumbnail。 | [cache.test.ts](../src/background/cache.test.ts) › toReminders: thumbnail は imageId と sha256 が一致する時だけ、notified は hidden |
| R-DTO-02 | hidden: DTO の hidden、または id が notifiedIds にあれば true。 | [cache.test.ts](../src/background/cache.test.ts) › toReminders: thumbnail は imageId と sha256 が一致する時だけ、notified は hidden |
| R-DTO-03 | それ以外の field は DTO の値。Reminder 型は変えない。 | [cache.test.ts](../src/background/cache.test.ts) › toReminders: thumbnail と hidden 以外の field は DTO の値 |

### 作成と削除（popup → background）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-CRUD-01 | 作成（reminders/create）: popup が今と同じ Reminder を作り、background に送る。background は次の body を組み立てて送る。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 201 で成功し cache に入る |
| R-CRUD-02 | id、url、title、reminderTime、autoOpen、webPush、hidden: false | [sync.write.test.ts](../src/background/sync.write.test.ts) › 201 で成功し cache に入る |
| R-CRUD-03 | thumbnail: capture できた data URL。capture できず NO_DATA.thumbnail（同梱 png の path）になった場合は null。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › NO_DATA の thumbnail は null で送り、画像は cache に入れない |
| R-CRUD-04 | decode 後の大きさが 1 MiB を超える画像は、popup が送る前に canvas で幅と高さを半分にして JPEG（quality 0.5）にし直し、収まるまで繰り返す。 | [image.test.ts](../src/utils/image.test.ts) › decodedSize › counts bytes<br>[image.test.ts](../src/utils/image.test.ts) › shrinkToLimit › 4 MiB 4000x3000 fits after 2 halvings<br>[image.test.ts](../src/utils/image.test.ts) › shrinkToLimit › null when the long side drops under 16px<br>[image.test.ts](../src/utils/image.test.ts) › shrinkToLimit › returns input as is when within the limit<br>[image.test.ts](../src/utils/image.test.ts) › shrinkToLimit › stops after 8 iterations when nothing changes |
| R-CRUD-05 | 成功したら、queue の中で応答の DTO と送った画像（imageId・sha256 は応答の値）を cache に入れ、alarm を作る。 | [cache.test.ts](../src/background/cache.test.ts) › upsertItem は同じ id を1件にし、removeItem は画像も消す<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › 201 で成功し cache に入る |
| R-CRUD-06 | 削除（reminders/delete）: 削除の手順で消し、queue の中で cache から外し、alarm を消す。 | [cache.test.ts](../src/background/cache.test.ts) › upsertItem は同じ id を1件にし、removeItem は画像も消す<br>[sync.write.test.ts](../src/background/sync.write.test.ts) › user の削除の成功で cache から外し alarm を消す |
| R-CRUD-07 | popup は応答の ok を見て、失敗なら error を表示し、一覧を元に戻す。popup は alarm を触らない。 | [bg.test.ts](../src/utils/bg.test.ts) › makeCall › NETWORK marks disconnected and sets the error<br>[bg.test.ts](../src/utils/bg.test.ts) › makeCall › STALE sets no error text<br>[bg.test.ts](../src/utils/bg.test.ts) › makeCall › ok sets no error |
| R-CRUD-08 | local モードは、popup が今のまま chrome.storage.local の reminders を読み書きし、書いた後に alarms/reset を送る。background は queue の中で、受け付けた時のモード… | [cache.test.ts](../src/background/cache.test.ts) › rebuildAlarms: local は reminders から作る<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset の受付の後に mode/change が来たら何もしない（→ local）<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset の受付の後に mode/change が来たら何もしない（→ server）<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset は今のモードの一覧から alarm を作り直す |

### alarm と通知（background.ts）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-ALARM-01 | server モードの onAlarm と notifications.onClicked は、serverCache から項目を探し、通知とタブの判断を cache だけで行う。通知とタブの処理は今のまま。 | [notify.test.ts](../src/background/notify.test.ts) › 通知の click で cache の URL を開いて通知を消す |
| R-ALARM-02 | onAlarm は、次のすべてを満たす時だけ通知する: 今のモードが server、cache に項目がある、hidden:false、id が notifiedIds に無い、reminderTime が今から1分後より前。 | [notify.test.ts](../src/background/notify.test.ts) › 通知済み・hidden・1分より先・cache に無い項目は通知しない: 1分より先<br>[notify.test.ts](../src/background/notify.test.ts) › 通知済み・hidden・1分より先・cache に無い項目は通知しない: cache に無い<br>[notify.test.ts](../src/background/notify.test.ts) › 通知済み・hidden・1分より先・cache に無い項目は通知しない: hidden<br>[notify.test.ts](../src/background/notify.test.ts) › 通知済み・hidden・1分より先・cache に無い項目は通知しない: 通知済み |
| R-ALARM-03 | 通知の直前に、queue を通さず notifiedIds[id] を書く（長い同期を待たずに再通知を防ぐ）。そのあと queue の中で、非表示にする手順を best effort で試す。失敗しても log（code と status… | [notify.test.ts](../src/background/notify.test.ts) › 通知の前に notified:&lt;id&gt; を書く<br>[notify.test.ts](../src/background/notify.test.ts) › 通知の後に hideOnServer を呼び、失敗しても例外を投げない |
| R-ALARM-05 | onInstalled は、モードに応じて local の reminders か serverCache から alarm を設定し直す。 | [background.test.ts](../src/background.test.ts) › onInstalled は local モードの一覧から alarm を作り直す<br>[background.test.ts](../src/background.test.ts) › onInstalled は server モードの一覧から alarm を作り直す |

### message（messages.ts）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-MSG-01 | auth/status / — / status | [messages.test.ts](../src/background/messages.test.ts) › login の window を開いている間の auth/status は loginInProgress: true、取り消し後は notice: LOGIN_CANCELLED |
| R-MSG-02 | auth/login / — / {ok} または {ok:false, code} | [messages.test.ts](../src/background/messages.test.ts) › login の成功で古い cache を消して同期を始める |
| R-MSG-03 | auth/logout / — / {ok, revoked} | [messages.test.ts](../src/background/messages.test.ts) › logout の revoke 中に成功した新しい login の cache と alarm を、logout の後処理が消さない |
| R-MSG-04 | config/save / {apiBaseUrl, authBaseUrl, clientId, imageHost} / {ok} または {ok:false, code} | [messages.test.ts](../src/background/messages.test.ts) › config/save で接続先が変わらなければ消さない<br>[messages.test.ts](../src/background/messages.test.ts) › config/save で接続先が変わると認証と cache と alarm が消え、世代が進む<br>[messages.test.ts](../src/background/messages.test.ts) › config/save は4項目だけを保存し、他の field で settings を書き換えない<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › config/save の不正な URL は invalid、正しければ正規化する |
| R-MSG-05 | mode/change / {connectionType} / {ok} | [messages.test.ts](../src/background/messages.test.ts) › mode/change の後に古いモードの alarm が残らない |
| R-MSG-06 | alarms/reset / — / {ok} | [messages.test.ts](../src/background/messages.test.ts) › alarms/reset の受付の後に mode/change が来たら何もしない（→ local）<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset の受付の後に mode/change が来たら何もしない（→ server）<br>[messages.test.ts](../src/background/messages.test.ts) › alarms/reset は今のモードの一覧から alarm を作り直す |
| R-MSG-07 | reminders/list / {fresh?: boolean} / {ok, reminders} または {ok:false, code, reminders} | [messages.test.ts](../src/background/messages.test.ts) › local モードの reminders/list は NOT_SERVER_MODE |
| R-MSG-08 | reminders/create / Reminder / {ok, reminder} または {ok:false, code} | [messages.test.ts](../src/background/messages.test.ts) › 受け付けた後に config/save が来た作成は STALE で API を送らない |
| R-MSG-09 | reminders/delete / {id} / {ok} または {ok:false, code} | [messages.test.ts](../src/background/messages.test.ts) › local モードの reminders/list は NOT_SERVER_MODE<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › その他の入力の検証 |
| R-MSG-10 | sender.id === chrome.runtime.id で、かつ sender.url が chrome-extension://&lt;自拡張の id&gt;/ で始まる message だけを受け付ける。それ以外（content scri… | [messages.test.ts](../src/background/messages.test.ts) › isTrustedSender › 自拡張の page だけを受け付ける |
| R-MSG-11 | type ごとに入力を実行時に検証する。未知の type は無視する。reminders/\* は server モードでなければ NOT_SERVER_MODE を返す。create は各 field の型と大きさ（server の制限と… | [messages.test.ts](../src/background/messages.test.ts) › isValidId › "" は不可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › "\ud800" は不可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › "a\u0000" は不可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" は不可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › "a" は不可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › 1 は不可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › 123e4567-e89b-42d3-a456-426614174000 は可<br>[messages.test.ts](../src/background/messages.test.ts) › isValidId › 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀 は可<br>[messages.test.ts](../src/background/messages.test.ts) › local モードの reminders/list は NOT_SERVER_MODE<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › config/save の不正な URL は invalid、正しければ正規化する<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › reminders/create の 1 MiB を超える画像 は invalid<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › reminders/create の 1025 文字の title は invalid<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › reminders/create の 4097 文字の url は invalid<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › reminders/create の autoOpen が "true" は invalid<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › reminders/create の ftp の url は invalid<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › reminders/create の offset の無い reminderTime は invalid<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › その他の入力の検証<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › 未知の type は unknown<br>[messages.test.ts](../src/background/messages.test.ts) › parseMessage › 正しい reminders/create と境界の大きさは ok |
| R-MSG-12 | popup は sendMessage の reject（worker の停止などで channel が切れた）を NETWORK として表示し、次の操作か開き直しで reminders/list と auth/status を読み直す。 | [bg.test.ts](../src/utils/bg.test.ts) › makeCall › NETWORK marks disconnected and sets the error<br>[bg.test.ts](../src/utils/bg.test.ts) › makeCall › STALE sets no error text<br>[bg.test.ts](../src/utils/bg.test.ts) › makeCall › ok sets no error<br>[bg.test.ts](../src/utils/bg.test.ts) › send › maps a rejected sendMessage to NETWORK<br>[bg.test.ts](../src/utils/bg.test.ts) › send › returns the response |
| R-MSG-13 | API の body は、許可した field だけから組み立てる。 | [sync.write.test.ts](../src/background/sync.write.test.ts) › 201 で成功し cache に入る |
| R-MSG-14 | token、署名 URL を popup に返さない。 | [messages.test.ts](../src/background/messages.test.ts) › token と署名 URL を popup・storage.sync・log に出さない |

### 設定画面（Settings.tsx）

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-UI-01 | Auto-open と Web Push は今のまま（切り替えたら、その field だけを即保存）。Connection Type は mode/change で切り替える。 | — |
| R-UI-02 | server モードの時だけ表示する。 | — |
| R-UI-03 | 入力欄: API base URL、Auth base URL、Client ID、Image host。 | — |
| R-UI-04 | 「保存」ボタン: 「設定」の節の手順。検証の error は欄の下に出す。 | — |
| R-UI-05 | 状態: 未設定 / 許可なし（「許可する」ボタン）/ 未ログイン / ログイン中 / 要再ログイン / ログイン処理中 / 失効は未完了。 | — |
| R-UI-06 | 「ログイン」/「ログアウト」ボタン。 | — |
| R-UI-07 | callback URL と logout URL（getRedirectURL("cognito")、getRedirectURL("logout")）を読み取り専用で表示する。 | — |

### error の表示

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-ERR-01 | NOT_CONFIGURED / 接続先を設定してください | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-02 | LOGIN_REQUIRED、UNAUTHORIZED / ログインしてください | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-03 | LOGIN_IN_PROGRESS / ログインの処理中です | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-04 | CONFLICT / 別の端末で変更されています。最新の内容を確認して、もう一度操作してください | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-05 | STALE / 表示しない（設定やログインが変わったため、古い操作をやめた） | [bg.test.ts](../src/utils/bg.test.ts) › errorText › hides STALE and formats unknown |
| R-ERR-06 | NETWORK、SERVICE_UNAVAILABLE、UNKNOWN_RESULT / 通信できません。時間をおいて再度お試しください | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-07 | OWNER_RATE_LIMIT_EXCEEDED、429 / 操作が多すぎます。しばらく待ってください | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-08 | OWNER_STORAGE_LIMIT_EXCEEDED / 保存できる上限（1000件・画像 128 MiB）を超えています | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-09 | 403 の各 code / 権限がありません（&lt;code&gt;） | [bg.test.ts](../src/utils/bg.test.ts) › errorText › maps the spec table |
| R-ERR-10 | その他 / エラー（&lt;code&gt;） | [bg.test.ts](../src/utils/bg.test.ts) › errorText › hides STALE and formats unknown |

### log

| 要件 ID | 要件 | テスト |
| --- | --- | --- |
| R-LOG-01 | token、認可 code、state、verifier、callback URL、署名 URL を log に出さない。console.error には code と status だけを出す。 | [messages.test.ts](../src/background/messages.test.ts) › 想定外の例外は reject せず INTERNAL を返す<br>[notify.test.ts](../src/background/notify.test.ts) › 通知の後に hideOnServer を呼び、失敗しても例外を投げない |

## 要件 ID の無いテスト

なし。
