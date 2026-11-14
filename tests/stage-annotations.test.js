import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const sha = (x) => createHash("sha256").update(x).digest("hex");
function fixture(quote = "A complete textbook paragraph.") {
  const root = mkdtempSync(join(tmpdir(), "reader-stamp-"));
  const stage = join(root, "stage");
  mkdirSync(join(stage, "book"), { recursive: true });
  const html = `<html><body><main id="main-content"><p>${quote}</p></main></body></html>`;
  writeFileSync(join(stage, "book/index.html"), html);
  const data = {
    schema: 1,
    origin: "https://library.libretexts.dev",
    books: [
      {
        key: "book",
        title: "Book",
        pages: [
          {
            id: "index.html",
            revision: "a".repeat(64),
            sourceSha256: sha(html),
            passages: [
              { block: "p-0", quote },
            ],
          },
        ],
      },
    ],
  };
  const catalog = JSON.stringify(data);
  writeFileSync(join(root, "catalog.json"), catalog);
  const args = [
    resolve("scripts/stage-annotations.mjs"),
    "--stage",
    stage,
    "--catalog",
    join(root, "catalog.json"),
    "--sha256",
    sha(catalog),
    "--output",
    join(root, "out.json"),
  ];
  return { root, stage, html, args };
}
it("preserves dollar sequences literally in the context stamp", () => {
  const text = "Math $$x$$ and $& dollars.";
  const f = fixture(text);
  try {
    execFileSync(process.execPath, f.args);
    const html = readFileSync(join(f.stage, "book/index.html"), "utf8");
    const stamp = JSON.parse(html.match(/id="sr-page-context">([\s\S]*?)<\/script>/)[1]);
    expect(stamp.blocks[0].quote).toBe(text);
    expect(stamp.blocks[0].quoteSha256).toBe(sha(text));
  } finally { rmSync(f.root, { recursive: true }); }
});
it("stamps public metadata outside unchanged main and publishes final file hashes", () => {
  const f = fixture();
  try {
    execFileSync(process.execPath, f.args);
    const result = readFileSync(join(f.stage, "book/index.html"), "utf8");
    expect(result.match(/<main[\s\S]*?<\/main>/)[0]).toBe(
      f.html.match(/<main[\s\S]*?<\/main>/)[0],
    );
    expect(result.indexOf("sr-page-context")).toBeGreaterThan(
      result.indexOf("</main>"),
    );
    const data = JSON.parse(readFileSync(join(f.root, "out.json"), "utf8"));
    expect(data.books[0].pages[0].sourceSha256).toBe(sha(result));
    expect(data.books[0].pages[0].revision).toBe("a".repeat(64));
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
it("refuses stale page hashes before changing source", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.stage, "book/index.html"), f.html + "changed");
    expect(() =>
      execFileSync(process.execPath, f.args, { stdio: "pipe" }),
    ).toThrow();
    expect(readFileSync(join(f.stage, "book/index.html"), "utf8")).toBe(
      f.html + "changed",
    );
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
it("refuses linked asset directories without writing outside stage", () => {
  const f = fixture();
  try {
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(f.stage, "_assets"));
    expect(() =>
      execFileSync(process.execPath, f.args, { stdio: "pipe" }),
    ).toThrow();
    expect(readFileSync(join(f.stage, "book/index.html"), "utf8")).toBe(f.html);
  } finally {
    rmSync(f.root, { recursive: true });
  }
});
