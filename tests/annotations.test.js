import { describe, it, expect } from "vitest";
import { canonicalText, captureSelection } from "../src/annotations.mjs";
import { setCurrent } from "../src/highlight.mjs";
describe("annotation anchoring", () => {
  it("captures UTF-16 exact selections through inline wrappers without changing source", () => {
    document.body.innerHTML =
      "<main><p>A <span>cell 🧬</span> has a membrane.</p></main>";
    const main = document.querySelector("main"),
      p = main.querySelector("p"),
      original = p.innerHTML;
    const range = document.createRange();
    range.selectNodeContents(p.querySelector("span"));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const result = captureSelection(
      main,
      { blocks: [{ block: "p-0", quote: "A cell 🧬 has a membrane." }] },
      s,
    );
    expect(result.selector).toEqual({ start: 2, end: 9, quote: "cell 🧬" });
    expect(p.innerHTML).toBe(original);
  });
  it("refuses altered text and selections spanning paragraphs", () => {
    document.body.innerHTML =
      "<main><p>Translated paragraph.</p><p>Another paragraph.</p></main>";
    const main = document.querySelector("main"),
      ps = main.querySelectorAll("p");
    const r = document.createRange();
    r.selectNodeContents(ps[0]);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    expect(() =>
      captureSelection(
        main,
        { blocks: [{ block: "p-0", quote: "Original paragraph." }] },
        s,
      ),
    ).toThrow(/changed/);
    r.setEnd(ps[1].firstChild, 5);
    s.removeAllRanges();
    s.addRange(r);
    expect(() => captureSelection(main, { blocks: [] }, s)).toThrow(
      /one supported/,
    );
  });
  it("normalizes breaks without adding spaces between wrappers", () => {
    document.body.innerHTML = "<p>A<span>stro</span>nomy<br>stars</p>";
    expect(canonicalText(document.querySelector("p"))).toBe("Astronomy stars");
  });
  it("keeps highlighting without scrolling while composing", () => {
    const e = document.createElement("span");
    let calls = 0;
    e.scrollIntoView = () => calls++;
    document.documentElement.dataset.srComposing = "true";
    setCurrent(new Map([["a", e]]), "a");
    expect(e.classList.contains("tts-current")).toBe(true);
    expect(calls).toBe(0);
    delete document.documentElement.dataset.srComposing;
    setCurrent(new Map([["a", e]]), "a");
    expect(calls).toBe(1);
  });
});
