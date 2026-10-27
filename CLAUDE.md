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
