#!/usr/bin/env node
// Stamp a verified local stage. Never use a live document root.
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  realpath,
  lstat,
} from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
const { values } = parseArgs({
  options: {
    stage: { type: "string" },
    catalog: { type: "string" },
    sha256: { type: "string" },
    output: { type: "string" },
  },
});
for (const name of ["stage", "catalog", "sha256", "output"])
  if (!values[name]) throw Error(`--${name} is required`);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const stage = await realpath(values.stage),
  root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = await readFile(values.catalog);
if (sha(raw) !== values.sha256) throw Error("Catalog digest mismatch");
const catalog = JSON.parse(raw);
if (catalog.schema !== 1 || !Array.isArray(catalog.books))
  throw Error("Invalid catalog");
const pages = [];
for (const book of catalog.books)
  for (const page of book.pages) {
    const target = await realpath(join(stage, book.key, page.id));
    if (relative(stage, target).startsWith("..") || target === stage)
      throw Error("Page escapes stage");
    const bytes = await readFile(target);
    if (sha(bytes) !== page.sourceSha256)
      throw Error(`Source hash mismatch: ${book.key}/${page.id}`);
    const html = bytes.toString("utf8"),
      endMain = html.lastIndexOf("</main>");
    if (endMain < 0 || !html.includes("</body>"))
      throw Error("Expected existing main and body");
    const prefix = html.slice(0, endMain + 7);
    let suffix = html
      .slice(endMain + 7)
      .replace(
        /<script type="application\/json" id="sr-page-context">[\s\S]*?<\/script>\n?/g,
        "",
      )
      .replace(
        /<link rel="stylesheet" href="\/_assets\/reader\/annotations.css">\n?/g,
        "",
      )
      .replace(
        /<script type="module" src="\/_assets\/reader\/annotations.mjs"><\/script>\n?/g,
        "",
      );
    const manifest = {
      schema: "social-reading-page-v1",
      normalization: "js-whitespace-v1",
      book: book.key,
      page: page.id,
      revision: page.revision,
      blocks: page.passages.map((p) => ({ ...p, quoteSha256: sha(p.quote) })),
    };
    const stamp = `<script type="application/json" id="sr-page-context">${JSON.stringify(manifest).replaceAll("<", "\\u003c")}</script>\n<link rel="stylesheet" href="/_assets/reader/annotations.css">\n<script type="module" src="/_assets/reader/annotations.mjs"></script>\n`;
    const result = prefix + suffix.replace("</body>", stamp + "</body>");
    pages.push({ target, page, result });
  }
// Validate every page before changing any page; a stale source must not partly stamp a stage.
const assetRoot = join(stage, "_assets/reader");
// Asset paths must not follow links outside the verified stage either.
for (const name of [
  "_assets",
  "_assets/reader",
  "_assets/reader/social-reading",
  "_assets/reader/annotations.mjs",
  "_assets/reader/annotations.css",
  "_assets/reader/session-timer.mjs",
  "_assets/reader/social-reading/client.mjs",
  "_assets/reader/social-reading/anchor.mjs",
]) {
  try {
    if ((await lstat(join(stage, name))).isSymbolicLink())
      throw Error("Symlink in asset destination: " + name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await mkdir(join(assetRoot, "social-reading"), { recursive: true });
for (const name of [
  "annotations.mjs",
  "annotations.css",
  "session-timer.mjs",
  "social-reading/client.mjs",
  "social-reading/anchor.mjs",
])
  await copyFile(join(root, "src", name), join(assetRoot, name));
for (const { target, page, result } of pages) {
  await writeFile(target, result);
  page.sourceSha256 = sha(result);
}
const output = JSON.stringify(catalog, null, 2) + "\n";
await writeFile(values.output, output);
console.log(
  JSON.stringify({
    pages: pages.length,
    catalog: resolve(values.output),
    sha256: sha(output),
  }),
);
