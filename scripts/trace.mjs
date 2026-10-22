// Generates docs/test-traceability.md from the spec's [R-…] tags and vitest test names.
// Usage: node scripts/trace.mjs [--check]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeCell, extractIds, parseSpec, stripIdPrefix, unknownIds } from "./trace-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = "docs/superpowers/specs/2026-10-19-chrome-extension-v2-design.md";
const OUT = "docs/test-traceability.md";
const TOOLING = "src/test/"; // tests of the test tooling itself; they carry no requirement IDs
const check = process.argv.includes("--check");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runTests() {
  const tmp = path.join(os.tmpdir(), `trace-vitest-${process.pid}.json`);
  try {
    const r = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${tmp}`], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (!fs.existsSync(tmp)) fail(`vitest did not write a report (exit ${r.status})`);
    const report = JSON.parse(fs.readFileSync(tmp, "utf8"));
    if (r.status !== 0 || !report.success) {
      const failed = report.testResults.flatMap((f) =>
        f.assertionResults.filter((a) => a.status === "failed").map((a) => `  ${path.relative(root, f.name)} › ${a.fullName}`),
      );
      fail(`tests failed; fix them before running trace\n${failed.join("\n")}`);
    }
    return report.testResults
      .flatMap((f) =>
        f.assertionResults
          .filter((a) => a.status === "passed")
          .map((a) => {
            const segments = [...a.ancestorTitles, a.title];
            const full = segments.join(" ");
            return {
              file: path.relative(root, f.name).split(path.sep).join("/"),
              name: segments.map(stripIdPrefix).join(" › "),
              ids: extractIds(full),
            };
          }),
      )
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const show = (t) => `[${path.posix.basename(t.file)}](../${t.file}) › ${escapeCell(t.name)}`;

const FIXED = `## 実行方法

\`\`\`sh
npm test                                  # すべてのテスト
npx vitest run src/background/api.test.ts # 1 file
npm run trace                             # テストを実行し、この文書を作り直す
npm run trace:check                       # この文書が最新かを確かめる（CI）
\`\`\`

CI（\`.github/workflows/build.yml\`）は build の前に \`npm test\` と \`npm run trace:check\` を実行する。

## テストの環境

| 項目 | 内容 |
| --- | --- |
| 実行環境 | Node（\`vitest.config.ts\` の \`environment: "node"\`）。DOM は無い |
| 対象 | \`src/**/*.test.ts\` |
| timezone | \`Asia/Tokyo\` に固定（\`src/test/setup.ts\`） |
| \`chrome.*\` | \`src/test/chrome.ts\` の in-memory の mock。テストごとに作り直す。\`storage.local._data\` / \`storage.session._data\` で中身を見る |
| \`fetch\` | \`vi.stubGlobal\` で差し替える。テストの後に \`vi.unstubAllGlobals()\` |
| module の状態 | \`authGen\` などを持つ module は、\`vi.resetModules()\` の後に \`await import()\` し直す（service worker の再起動の再現にも使う） |
| 時刻 | 必要なテストだけ \`vi.useFakeTimers()\`。テストの後に \`vi.useRealTimers()\` |

## 自動テストで確かめていないこと

次は手で確かめる（実 AWS と Chrome での受け入れ確認）。

- popup の画面（\`App.tsx\`、\`Settings.tsx\`、\`ServerSettings.tsx\`）: component のテストの基盤が無い
- \`background.ts\` の listener の登録（送信元の検証の配線、未知の type に応答しないこと）
- canvas での画像の縮小（\`canvasHalve\`）: DOM が要る
- 実際の Chrome の API の挙動: 許可の dialog、\`launchWebAuthFlow\`、user gesture、service worker の停止
- 実際の Cognito・API Gateway・S3 との通信
`;

function render(reqs, tests) {
  const byId = new Map(reqs.map((r) => [r.id, []]));
  for (const t of tests) for (const id of t.ids) byId.get(id).push(t);
  const covered = reqs.filter((r) => byId.get(r.id).length > 0).length;
  const noId = tests.filter((t) => t.ids.length === 0 && !t.file.startsWith(TOOLING));
  const out = [
    "# 要件とテストの対応表",
    "",
    `設計（[spec](${path.posix.relative("docs", SPEC)})）の要件 ID（\`[R-…]\`）と、名前にその ID を含む自動テスト（vitest）の対応。\`npm run trace\` がテストを実行して生成する。手で編集しない。CI は \`npm run trace:check\` で、この文書が最新であることを確かめる。テストの名前の先頭の ID は表示から省く。\`${TOOLING}\` のテスト（この表の生成の道具のテスト）は要件 ID を持たないので、数と一覧から除く。`,
    "",
    FIXED,
    "## 集計",
    "",
    "| 項目 | 数 |",
    "| --- | --- |",
    `| 要件 | ${reqs.length} |`,
    `| テストのある要件 | ${covered} |`,
    `| テストの無い要件 | ${reqs.length - covered} |`,
    `| テスト | ${tests.filter((t) => !t.file.startsWith(TOOLING)).length} |`,
    `| 要件 ID の無いテスト | ${noId.length} |`,
    "",
    "## 要件ごとのテスト",
  ];
  let section;
  for (const r of reqs) {
    if (r.section !== section) {
      section = r.section;
      out.push("", `### ${section}`, "", "| 要件 ID | 要件 | テスト |", "| --- | --- | --- |");
    }
    const ts = byId.get(r.id);
    out.push(`| ${r.id} | ${r.desc} | ${ts.length ? ts.map(show).join("<br>") : "—"} |`);
  }
  out.push("", "## 要件 ID の無いテスト", "");
  out.push(...(noId.length ? noId.map((t) => `- ${show(t)}`) : ["なし。"]));
  return out.join("\n") + "\n";
}

const { reqs, duplicates, multiTag } = parseSpec(fs.readFileSync(path.join(root, SPEC), "utf8"));
if (multiTag.length) fail(`more than one requirement ID on a spec line:\n  ${multiTag.join("\n  ")}`);
if (duplicates.length) fail(`duplicate requirement IDs in the spec:\n  ${duplicates.join("\n  ")}`);
const tests = runTests();
const unknown = unknownIds(tests, reqs.map((r) => r.id));
if (unknown.length) fail(`tests reference IDs that are not in the spec:\n  ${unknown.join("\n  ")}`);

const md = render(reqs, tests);
const outPath = path.join(root, OUT);
if (check) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  if (current !== md) fail(`${OUT} is out of date; run npm run trace`);
  console.log(`${OUT} is up to date`);
} else {
  fs.writeFileSync(outPath, md);
  console.log(`wrote ${OUT}: ${reqs.length} requirements, ${tests.length} tests`);
}
