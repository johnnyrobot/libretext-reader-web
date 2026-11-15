import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createMarkRenderer } from "../src/annotations/marks.mjs";

let renderer, highlights, main;
const manifest = {
  book: "biology", page: "cells", revision: "r1",
  blocks: [{ block: "p-0", quote: "A cell 🧬 has a membrane." }],
};
const record = (selector, changes = {}) => ({
  id: "private-1", kind: "personal", body: "private note",
  anchor: { book: "biology", page: "cells", revision: "r1", block: "p-0",
    quote: manifest.blocks[0].quote, ...(selector ? { selector } : {}), ...changes },
});
function setup(html = "<p>A <span>cell 🧬</span> has a membrane.</p>", context = manifest, onSelect = vi.fn()) {
  document.body.innerHTML = `<main>${html}</main><button>Notes</button>`;
  main = document.querySelector("main");
  renderer = createMarkRenderer({ document, main, manifest: context, onSelect });
  return onSelect;
}
beforeEach(() => {
  highlights = new Map();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", class extends Set { constructor(...ranges) { super(ranges); } });
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([{ left: 0, right: 100, top: 0, bottom: 20 }]);
  getSelection().removeAllRanges();
});
afterEach(() => { renderer?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("exact passage mark rendering", () => {
  it("highlights the saved UTF-16 range across inline nodes without mutating the passage", () => {
    setup();
    const original = main.innerHTML;
    renderer.render([record({ start: 2, end: 13, quote: "cell 🧬 has" })]);
    const [range] = highlights.get("sr-personal");
    expect(range.toString()).toBe("cell 🧬 has");
    expect(main.innerHTML).toBe(original);
    expect(main.textContent).toBe("A cell 🧬 has a membrane.");
  });
});

it("paints the selected exact quote when a list record is a clone of the rendered mark", () => {
  setup();
  const selected = record({ start: 2, end: 9, quote: "cell 🧬" });
  main.querySelector("p").scrollIntoView = vi.fn();
  renderer.render([{ ...selected }]);
  expect(renderer.jump(selected)).toBe(true);
  expect(highlights.get("sr-active")?.size).toBe(1);
  expect([...highlights.get("sr-active")][0].toString()).toBe("cell 🧬");
});

it("returns every overlapping exact mark at the clicked text point", () => {
  const onSelect = setup();
  const personal = record({ start: 2, end: 9, quote: "cell 🧬" });
  const course = { ...record({ start: 2, end: 13, quote: "cell 🧬 has" }), id: "thread-1", kind: "course" };
  renderer.render([personal, course]);
  Object.defineProperty(document, "caretPositionFromPoint", { configurable: true,
    value: () => ({ offsetNode: main.querySelector("span").firstChild, offset: 3 }) });
  main.querySelector("span").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
  expect(onSelect).toHaveBeenCalledWith([personal, course]);
  expect([...highlights.get("sr-course")][0].toString()).toBe("cell 🧬 has");
  delete document.caretPositionFromPoint;
});

it("removes stale visuals when runtime text changes and refuses a jump", async () => {
  setup();
  const saved = record();
  renderer.render([saved]);
  const p = main.querySelector("p");
  p.scrollIntoView = vi.fn();
  p.innerHTML = '<span class="tts-sentence" data-tts-id="1">A cell 🧬 has a membrane.</span>';
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(highlights.has("sr-personal")).toBe(false);
  expect(renderer.jump(saved)).toBe(false);
  expect(p.scrollIntoView).not.toHaveBeenCalled();
});

it("maps JS whitespace and BR boundaries without inserting spaces between adjacent wrappers", () => {
  const context = { ...manifest, blocks: [{ block: "p-0", quote: "Astronomy stars shine" }] };
  setup('<p> \tA<span>stro</span>nomy<br>\n<span>stars</span>\u00a0\u2003shine  </p>', context);
  const saved = record({ start: 8, end: 14, quote: "y star" }, { quote: "Astronomy stars shine" });
  const before = main.innerHTML;
  renderer.render([saved]);
  const [range] = highlights.get("sr-personal");
  expect(range.startContainer.data).toBe("nomy");
  expect(range.startOffset).toBe(3);
  expect(range.endContainer.data).toBe("stars");
  expect(range.endOffset).toBe(4);
  expect(main.innerHTML).toBe(before);
});

it.each([
  ["book", { book: "other" }], ["page", { page: "other" }],
  ["revision", { revision: "r2" }], ["block", { block: "p-1" }],
  ["whole canonical quote", { quote: "A changed cell." }],
  ["selection quote", { selector: { start: 2, end: 6, quote: "wrong" } }],
  ["surrogate start", { selector: { start: 8, end: 9, quote: "\uddec" } }],
  ["surrogate end", { selector: { start: 7, end: 8, quote: "\ud83e" } }],
  ["offset bounds", { selector: { start: 2, end: 200, quote: "cell" } }],
  ["noncanonical block spelling", { block: "p-00" }],
])("rejects a mismatched or invalid %s before rendering and jumping", (_label, changes) => {
  setup();
  const p = main.querySelector("p");
  p.scrollIntoView = vi.fn();
  const saved = record(undefined, changes);
  renderer.render([saved]);
  expect(highlights.size).toBe(0);
  expect(renderer.jump(saved)).toBe(false);
  expect(p.scrollIntoView).not.toHaveBeenCalled();
});

it("hides and restores records and keeps current focus during deliberate navigation", () => {
  setup();
  const saved = record();
  const p = main.querySelector("p");
  p.scrollIntoView = vi.fn();
  const button = document.querySelector("button");
  button.focus();
  renderer.render([saved]);
  expect(p.scrollIntoView).not.toHaveBeenCalled();
  renderer.setVisible(false);
  expect(highlights.size).toBe(0);
  expect(renderer.jump(saved)).toBe(true);
  expect(highlights.size).toBe(0);
  expect(document.activeElement).toBe(button);
  renderer.setVisible(true);
  expect([...highlights.get("sr-personal")][0].toString()).toBe("A cell 🧬 has a membrane.");
  expect(p.scrollIntoView).toHaveBeenCalledOnce();
});

it("preserves the active text selection and keyboard events", () => {
  const onSelect = setup();
  renderer.render([record()]);
  const range = document.createRange();
  range.selectNodeContents(main.querySelector("span"));
  getSelection().addRange(range);
  main.querySelector("span").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  main.dispatchEvent(key);
  expect(onSelect).not.toHaveBeenCalled();
  expect(getSelection().toString()).toBe("cell 🧬");
  expect(key.defaultPrevented).toBe(false);
});

it("keeps deliberate list navigation available without the Custom Highlight API", () => {
  vi.stubGlobal("Highlight", undefined);
  setup();
  const p = main.querySelector("p");
  p.scrollIntoView = vi.fn();
  const before = main.innerHTML;
  renderer.render([record()]);
  expect(highlights.size).toBe(0);
  expect(renderer.jump(record())).toBe(true);
  expect(p.scrollIntoView).toHaveBeenCalledOnce();
  expect(main.innerHTML).toBe(before);
});

it("clears owned visuals and retained records without deleting other highlights", () => {
  const onSelect = setup();
  const unrelated = new Set();
  highlights.set("listen", unrelated);
  renderer.render([record()]);
  renderer.jump(record());
  renderer.clear();
  renderer.setVisible(false);
  renderer.setVisible(true);
  expect([...highlights.keys()]).toEqual(["listen"]);
  expect(highlights.get("listen")).toBe(unrelated);
  renderer.destroy();
  main.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(renderer.jump(record())).toBe(false);
});

it.each(['<p>A <img alt="cell 🧬"> has a membrane.</p>',
  '<p>A <span hidden>cell 🧬</span> has a membrane.</p>',
  '<p>A <button>cell 🧬</button> has a membrane.</p>'])('does not guess ranges in unsupported content: %s', (html) => {
  setup(html);
  renderer.render([record()]);
  expect(highlights.size).toBe(0);
  expect(renderer.jump(record())).toBe(false);
});


it("ignores a nearest caret when the click is outside the marked text rectangles", () => {
  const onSelect = setup();
  renderer.render([record()]);
  Object.defineProperty(document, "caretPositionFromPoint", { configurable: true,
    value: () => ({ offsetNode: main.querySelector("span").firstChild, offset: 3 }) });
  main.querySelector("span").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 500 }));
  expect(onSelect).not.toHaveBeenCalled();
  delete document.caretPositionFromPoint;
});
