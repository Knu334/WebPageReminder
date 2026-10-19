# 自動テスト仕様書

`npm test`（vitest）で動く unit test が、何を保証しているかの一覧。設計（spec）は [`docs/superpowers/specs/2026-10-19-chrome-extension-v2-design.md`](superpowers/specs/2026-10-19-chrome-extension-v2-design.md)。この文書の節は spec の節に対応する。

2026-10-19 時点で 16 file、174 件。テストを足したり変えたりした時は、この文書も更新する。

## 実行

```sh
npm test                                  # すべて
npx vitest run src/background/api.test.ts # 1 file
```

CI（`.github/workflows/build.yml`）は build の前に `npm test` を実行する。

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

## 機能ごとの確認項目

表の「file」は `src/` からの path。

### 設定（spec「設定」）

| 確認すること | file |
| --- | --- |
| 接続先は `https:` で path・query・hash の無い URL だけを受け付け、origin に正規化する。Client ID は小文字英数字 | `utils/config.test.ts` |
| `configKey` は4項目の連結、許可を求める origin は3つ | `utils/config.test.ts` |
| 古い版の設定（`url` を持つ）を読んでも例外にならず、`url` を捨て、server モードは未設定になる | `utils/config.test.ts` |
| storage が空なら既定値（`connectionType: "local"`） | `utils/config.test.ts` |

### 直列化・世代・PKCE（spec「世代と直列化」、login の3）

| 確認すること | file |
| --- | --- |
| 直列化した処理は順に動き、前の処理の失敗で止まらない | `background/serial.test.ts` |
| 世代を進めると前の世代の通信が中断される | `background/gen.test.ts` |
| code challenge が RFC 7636 付録 B の例と一致する。乱数の token は43文字の Base64URL。SHA-256 の hex | `background/pkce.test.ts` |

### API client（spec「API client」）

| 確認すること | file |
| --- | --- |
| 送る前に世代を確かめ、違えば送らずに `STALE` | `background/api.test.ts` |
| `Authorization: Bearer`、JSON、id の encode | `background/api.test.ts` |
| 401 は1回だけ強制 refresh して再送し、再び 401 なら `UNAUTHORIZED`。強制 refresh は 401 の直後の1回だけ | `background/api.test.ts` |
| 429 は `Retry-After` と jitter で最大2回。JSON でない 429 は1秒待ち、`HTTP_429` を返す | `background/api.test.ts` |
| GET の通信障害は 0.5秒・1秒で最大2回。書き込みは再送せず `UNKNOWN_RESULT` | `background/api.test.ts` |
| PATCH・DELETE に `If-Match` | `background/api.test.ts` |
| 403 は再試行しない | `background/api.test.ts` |
| token が取れなければその code を返す。中断は `STALE` | `background/api.test.ts` |
| body の読み取りの失敗は通信障害、2xx で JSON が壊れていれば `BAD_RESPONSE` | `background/api.test.ts` |

### 認証: refresh と status（spec「getAccessToken」「refresh」「status」）

| 確認すること | file |
| --- | --- |
| 期限まで30秒より多ければ refresh しない。30秒以下なら refresh する。`force` は30秒の判定を飛ばす | `background/auth.refresh.test.ts` |
| 同時の3回の要求で token endpoint は1回 | `background/auth.refresh.test.ts` |
| 新しい refresh token を access token より先に保存する | `background/auth.refresh.test.ts` |
| `refresh_token` の無い応答、不正な `token_type`・`expires_in` は失敗にし、保存しない | `background/auth.refresh.test.ts` |
| `invalid_grant` で認証状態を消す。通信障害では消さない | `background/auth.refresh.test.ts` |
| 5xx は記録を消して backoff で再送する | `background/auth.refresh.test.ts` |
| 結果が不明な refresh から10秒を過ぎたら同じ token を送らない（worker の再起動の後も）。10秒以内なら再送する | `background/auth.refresh.test.ts` |
| 世代が変わった応答は捨てる。古い世代の呼び出しは `STALE` | `background/auth.refresh.test.ts` |
| 接続先が違う認証状態は使わずに消す。未設定は `NOT_CONFIGURED`、refresh token が無ければ `LOGIN_REQUIRED` | `background/auth.refresh.test.ts` |
| storage の例外でも throw しない | `background/auth.refresh.test.ts` |
| `auth/status` の `state`・`loginInProgress`・`permitted`・`notice` | `background/auth.refresh.test.ts` |

### 認証: login（spec「login」）

| 確認すること | file |
| --- | --- |
| authorize の URL（redirect URI、scope、state、PKCE） | `background/auth.login.test.ts` |
| code を交換し、refresh token → access token の順に保存し、世代を進める | `background/auth.login.test.ts` |
| 取り消し・URL の不一致・state の不一致・10分の超過・`error`・`code` 無しの callback では交換しない | `background/auth.login.test.ts` |
| 交換の応答が不正なら保存しない。交換の失敗で code を再送しない | `background/auth.login.test.ts` |
| 同時の2回の login で試行は1つ。古い試行の後始末が新しい試行を消さない | `background/auth.login.test.ts` |
| logout の後に完了した login は保存しない | `background/auth.login.test.ts` |
| 接続先の許可が無ければ `NOT_CONFIGURED` | `background/auth.login.test.ts` |

### 認証: logout（spec「logout」）

| 確認すること | file |
| --- | --- |
| revoke の form、logout page の URL、後処理（cache と alarm の消去）の順番 | `background/auth.logout.test.ts` |
| revoke や logout page が失敗しても端末の認証状態は消え、`notice` に結果が残る | `background/auth.logout.test.ts` |
| refresh token が無ければ revoke を送らない | `background/auth.logout.test.ts` |
| logout の後の API は `LOGIN_REQUIRED` | `background/auth.logout.test.ts` |
| revoke 中に成功した新しい login を消さない（新しい login で revoke を中断しない） | `background/auth.logout.test.ts` |
| login の保存と logout の消去が交互に起きても、認証状態が復活しない | `background/auth.logout.test.ts` |

### cache と alarm（spec「storage」「DTO から Reminder への変換」）

| 確認すること | file |
| --- | --- |
| 画像は `imageId` と `sha256` が一致する時だけ表示し、通知済みの項目は非表示にする | `background/cache.test.ts` |
| 同時の2つの通知済みの記録がどちらも残る | `background/cache.test.ts` |
| 接続先が違う cache は空として扱い、消す | `background/cache.test.ts` |
| 古い世代は cache を書かず、消さない | `background/cache.test.ts` |
| 同じ id は1件にまとめる。項目を消すと画像も消える | `background/cache.test.ts` |
| alarm は今のモードの一覧から、未来で非表示でない（server は未通知の）項目だけで作る。古い世代では作り直さない | `background/cache.test.ts` |

### 書き込みの手順（spec「書き込みの手順」）

| 確認すること | file |
| --- | --- |
| 作成: 201 で cache に入る。画像が無ければ `thumbnail: null` で送る | `background/sync.write.test.ts` |
| 作成: `UNKNOWN_RESULT` → GET 200 で成功、GET 404 で1回だけ再送。409 → GET 404 で `ALREADY_EXISTS`、GET 200 で成功 | `background/sync.write.test.ts` |
| 非表示: 最新が未来の時刻、またはすでに非表示なら PATCH しない | `background/sync.write.test.ts` |
| 非表示: 412 は GET から1回だけやり直す。404 は cache から外す。`UNKNOWN_RESULT` は GET で照合する | `background/sync.write.test.ts` |
| 削除（user）: 412 は cache を最新にして `CONFLICT`。成功で cache と alarm から外す | `background/sync.write.test.ts` |
| 削除（整理）: 412 は GET からやり直す。最新が1か月以内なら消さない。404 は成功 | `background/sync.write.test.ts` |
| 同期の queue の中から呼んでも止まらない | `background/sync.write.test.ts` |
| 受付の後に世代が変わったら送らない。送った後なら cache に書かない（`STALE`） | `background/sync.write.test.ts` |

### 一覧の同期（spec「一覧の同期」）

| 確認すること | file |
| --- | --- |
| 空の page でも `nextCursor` があれば読み続ける | `background/sync.list.test.ts` |
| `fresh` でなければ通信しない。60秒以内は同期しない。同時の要求は1回の同期にまとめる | `background/sync.list.test.ts` |
| 整理の書き込みは30件まで。1か月より前は削除だけ。1件の失敗で後続が止まらない | `background/sync.list.test.ts` |
| 画像の取得は30件まで。同じ画像は取り直さない | `background/sync.list.test.ts` |
| 画像の取得は Authorization を付けず `redirect: "error"`。`imageId`・origin・status・大きさ・hash のどれかが合わなければ保存しない | `background/sync.list.test.ts` |
| 不要になった画像と通知済みの記録を消す | `background/sync.list.test.ts` |
| 同期中に作成した項目が消えず、重複もしない | `background/sync.list.test.ts` |
| 同期中の `config/save` が止まらずに完了する（lock の順） | `background/sync.list.test.ts` |
| 失敗した時は cache の一覧と code を返す。同期の後に alarm を作り直す | `background/sync.list.test.ts` |

### message の受付（spec「message」「設定」「作成と削除」）

| 確認すること | file |
| --- | --- |
| 自拡張の page からの message だけを受け付ける | `background/messages.test.ts` |
| id は1〜128 code point で、制御文字と対になっていない surrogate を含まない | `background/messages.test.ts` |
| 作成の各 field の型と大きさ（URL、title、時刻、画像 1 MiB）を検証する。未知の type は無視する | `background/messages.test.ts` |
| local モードの `reminders/*` は `NOT_SERVER_MODE` | `background/messages.test.ts` |
| `config/save`: 接続先が変われば認証・cache・alarm を消して世代を進める。変わらなければ消さない。4項目以外を保存しない | `background/messages.test.ts` |
| login の成功で古い cache を消して同期を始める。logout・login の後処理が互いの新しい状態を消さない | `background/messages.test.ts` |
| 受付の後に `config/save` が来た作成は送らない | `background/messages.test.ts` |
| `alarms/reset` と `mode/change` が競合しても古いモードの alarm が残らない。進行中の同期が切り替え後の alarm を上書きしない | `background/messages.test.ts` |
| login の window を開いている間の status は処理中で、取り消すと `LOGIN_CANCELLED` が残る | `background/messages.test.ts` |
| 想定外の例外でも reject せず `INTERNAL` を返す | `background/messages.test.ts` |

### alarm と通知（spec「alarm と通知」）

| 確認すること | file |
| --- | --- |
| 通知済み・非表示・1分より先・cache に無い項目は通知しない | `background/notify.test.ts` |
| 通知の前に通知済みの記録を書く | `background/notify.test.ts` |
| 通知の後に server の非表示を試し、失敗しても例外を投げない | `background/notify.test.ts` |
| local モードは非表示にして保存する（従来の動作） | `background/notify.test.ts` |
| 通知の click で cache の URL を開き、通知を消す | `background/notify.test.ts` |

### popup の部品（spec「作成と削除」「error の表示」）

| 確認すること | file |
| --- | --- |
| error の code を spec の表の文言にする。`STALE` は表示しない | `utils/bg.test.ts` |
| background との通信が切れたら `NETWORK` にし、次の操作の前に読み直す印を付ける | `utils/bg.test.ts` |
| 1 MiB 以下の画像はそのまま。4 MiB は2回の縮小で収まる。長い辺が 16px 未満、または8回で収まらなければ画像なし | `utils/image.test.ts` |

### 1か月前の計算（spec「範囲」の7）

| 確認すること | file |
| --- | --- |
| 存在しない日は前月の末日（3/31 → 2/28・うるう年は 2/29、1/31 → 12/31） | `utils/ReminderUtils.test.ts` |
| ちょうど1か月前は残し、それより前は消す | `utils/ReminderUtils.test.ts` |

## 自動テストで確かめていないこと

次は手で確かめる（実 AWS と Chrome での受け入れ確認）。

- popup の画面（`App.tsx`、`Settings.tsx`、`ServerSettings.tsx`）: component のテストの基盤が無い
- `background.ts` の listener の登録（送信元の検証の配線、未知の type に応答しないこと）
- canvas での画像の縮小（`canvasHalve`）: DOM が要る
- 実際の Chrome の API の挙動: 許可の dialog、`launchWebAuthFlow`、user gesture、service worker の停止
- 実際の Cognito・API Gateway・S3 との通信
