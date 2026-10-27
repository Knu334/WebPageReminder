// Pure helpers for scripts/trace.mjs (tested in src/test/trace.test.ts).

const TAG = /\[(R-[A-Z]+-\d{2})\]/;
const ID = /R-[A-Z]+-\d{2}/g;

// Markdown → plain text for a table cell: no code/bold/links, table pipes → " / ", escaped for a cell.
export function plain(s, max = 120) {
  let t = s
    .replace(/\s*\|\s*$/, "")
    .replace(/\s*\|\s*/g, " / ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .trim();
  if ([...t].length > max) t = [...t].slice(0, max - 1).join("") + "…";
  return escapeCell(t);
}

export function escapeCell(s) {
  return s.replace(/\|/g, "\\|").replace(/\*/g, "\\*").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Returns {reqs: [{id, section, desc}], duplicates: [id], multiTag: [line]} in document order. Ignores fenced code blocks.
export function parseSpec(text) {
  const reqs = [];
  const seen = new Set();
  const duplicates = [];
  const multiTag = [];
  let section = "";
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced) continue;
    const h = /^#{2,3}\s+(.*)$/.exec(line);
    if (h) section = h[1].replace(/`/g, "").trim();
    const m = TAG.exec(line);
    if (!m) continue;
    if (line.match(new RegExp(TAG, "g")).length > 1) multiTag.push(line.trim());
    if (seen.has(m[1])) duplicates.push(m[1]);
    seen.add(m[1]);
    reqs.push({ id: m[1], section, desc: plain(line.slice(m.index + m[0].length)) });
  }
  return { reqs, duplicates, multiTag };
}

export function extractIds(name) {
  return [...new Set(name.match(ID) ?? [])];
}

// Removes a leading ID prefix such as "R-API-01 R-API-02: " or "[R-API-01] " from one name segment.
export function stripIdPrefix(segment) {
  return segment.replace(/^(?:\[?R-[A-Z]+-\d{2}\]?[\s,:]*)+/, "");
}

// IDs referenced by tests that are not in the spec, as sorted "ID (test)" strings.
export function unknownIds(tests, specIds) {
  const known = new Set(specIds);
  return tests.flatMap((t) => t.ids.filter((id) => !known.has(id)).map((id) => `${id} (${t.file} › ${t.name})`)).sort();
}
