# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default tseslint.config({
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

- Replace `tseslint.configs.recommended` to `tseslint.configs.recommendedTypeChecked` or `tseslint.configs.strictTypeChecked`
- Optionally add `...tseslint.configs.stylisticTypeChecked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and update the config:

```js
// eslint.config.js
import react from 'eslint-plugin-react'

export default tseslint.config({
  // Set the react version
  settings: { react: { version: '18.3' } },
  plugins: {
    // Add the react plugin
    react,
  },
  rules: {
    // other rules...
    // Enable its recommended rules
    ...react.configs.recommended.rules,
    ...react.configs['jsx-runtime'].rules,
  },
})
```

## server モード（reminder-server の v2 API、Cognito 認証）

保存先は設定画面で local（`chrome.storage.local`）か server を選ぶ。server モードは reminder-server の v2 API を Cognito の認証（Authorization Code + PKCE）で使う。AWS の実際の値はこの repository に書かない。

### 旧版の削除

manifest の `key` を固定したため extension ID が変わり、旧版とは別の拡張機能として扱われる。旧版の `chrome.storage.local`（local モードの reminder と設定）と alarm は引き継がない。通知が二重になるのを防ぐため、`chrome://extensions` で旧版を手で削除する。

### operator に渡す値

extension ID は `fjaeafgipmkmgnkkpfddkfnbanhkgglh`。Cognito の app client に次を登録してもらう。

| 値 | 内容 |
| --- | --- |
| `chrome_origin` | `chrome-extension://fjaeafgipmkmgnkkpfddkfnbanhkgglh`（API の CORS の許可 origin） |
| `callback_url` | `https://fjaeafgipmkmgnkkpfddkfnbanhkgglh.chromiumapp.org/cognito` |
| `logout_url` | `https://fjaeafgipmkmgnkkpfddkfnbanhkgglh.chromiumapp.org/logout` |

### operator から受け取る値

公開の設定で秘密ではない。username、password、token は設定に入れない。

| 値 | 形 |
| --- | --- |
| API base URL | `https://<api-id>.execute-api.<region>.amazonaws.com` |
| Cognito の auth base URL | `https://<prefix>.auth.<region>.amazoncognito.com` |
| Client ID | 小文字英数字 |
| 画像の host | `https://<images-bucket>.s3.<region>.amazonaws.com` |

scope は `openid reminder-api/read reminder-api/write` で固定。

### 設定の手順

1. `npm ci && npm run build` で `dist/` を作り、`chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」で `dist/` を読み込む（旧版は先に削除する）。
2. 拡張機能の設定画面で接続の種類に server を選ぶ。
3. 受け取った API base URL、Auth base URL、Client ID、Image host を入れて保存する。
4. 接続先へのアクセス許可を求められたら許可する。
5. 「ログイン」を押し、Cognito のログイン画面で認証する。
