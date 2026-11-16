import { describe, it, expect } from "vitest";
import { setCurrent } from "../src/highlight.mjs";
describe("annotation and Listen coexistence", () => {
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
