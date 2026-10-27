# Web Page Reminder

開いている Web ページを、指定した時刻に通知・再表示する Chrome 拡張機能（Manifest V3）。

「あとで読む」「この時間にもう一度見る」をブックマークより手軽に予約できる。

## 機能

- popup を開くと、表示中のタブの URL・タイトル・スクリーンショットで reminder を作る
- 指定した時刻にデスクトップ通知を出す。設定で、その時刻にページを自動で開くこともできる
- 保存先を選べる
  - **Local**: ブラウザの中（`chrome.storage.local`）だけに保存する
  - **Server**: [reminder-server](https://github.com/Knu334/reminder-server) に保存し、複数の端末で共有する（Amazon Cognito でログインする）

## インストール

Chrome Web Store には公開していない。ソースから build して読み込む。

必要なもの: Node.js 22 以上、Google Chrome

```sh
npm ci
npm run build
```

1. Chrome で `chrome://extensions` を開き、「デベロッパー モード」を有効にする
2. 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選ぶ

> 2026-10 より前の版を使っていた場合は、先に旧版を削除する。extension ID が変わったため別の拡張機能として扱われ、旧版のデータは引き継がない。

## 使い方

1. 予約したいページを開き、ツールバーの拡張機能のアイコンを押す
2. 日時を選んで reminder を追加する
3. 設定（Settings）で、ページの自動表示（Auto-open webpage）と通知（Web Push notifications）を切り替えられる

### Server モード

設定の Connection Type で Server を選び、reminder-server の運用者から受け取った4つの値（API base URL、Auth base URL、Client ID、Image host）を入れて保存する。接続先へのアクセスを許可し、「ログイン」を押す。

運用者に登録してもらう Callback URL と Logout URL は、extension ID（`chrome://extensions` に表示される）から次の形で作る。

- Callback URL: `https://<extension-id>.chromiumapp.org/cognito`
- Logout URL: `https://<extension-id>.chromiumapp.org/logout`

## 開発

| コマンド | 内容 |
| --- | --- |
| `npm run build` | popup と service worker を `dist/` に出力する |
| `npm test` | unit test（vitest） |
| `npm run lint` | ESLint |

設計: [docs/superpowers/specs/2026-10-19-chrome-extension-v2-design.md](docs/superpowers/specs/2026-10-19-chrome-extension-v2-design.md)

不具合や要望は [Issues](https://github.com/Knu334/WebPageReminder/issues) へ。

## License

[MIT](LICENSE)
