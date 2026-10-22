import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// globals は実行環境ごとに分ける。TS では no-undef が off なので、効くのは主に no-global-assign
const worker = ['src/background.ts', 'src/background/**/*.ts']
const node = ['*.config.ts', 'vite.config.*.ts', 'src/**/*.test.ts', 'src/test/**/*.ts']

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // globals は block の間で足し合わされるので、重ならないよう ignores で外す
  // src/utils/ と src/types/ は background からも import されるが、browser にまとめる
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [...worker, ...node],
    languageOptions: { globals: globals.browser },
  },
  {
    files: worker,
    ignores: node,
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: node,
    languageOptions: { globals: globals.node },
  },
  {
    extends: [js.configs.recommended],
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
