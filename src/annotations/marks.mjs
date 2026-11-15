import { matchesAnchor } from "../social-reading/anchor.mjs";

// Only ordinary inline prose is mapped. Rich media, controls, hidden text and
// runtime Listen wrappers need their own anchoring contract before support.
const INLINE = new Set(["SPAN", "A", "EM", "STRONG", "B", "I", "U", "S", "SMALL", "SUB", "SUP", "ABBR", "CITE", "Q", "CODE", "MARK", "BDI", "BDO", "WBR", "BR"]);
const NAMES = ["sr-personal", "sr-course", "sr-active"];

function passageMap(paragraph) {
  const units = [];
  let supported = true;
  function visit(node) {
    if (node.nodeType === 3) {
      for (let i = 0; i < node.data.length; i++)
        units.push({ char: node.data[i], start: [node, i], end: [node, i + 1] });
      return;
    }
    if (node.nodeType === 8) return;
    if (node.nodeType !== 1 || (node !== paragraph && !INLINE.has(node.nodeName)) ||
        node.hidden || node.hasAttribute("aria-hidden") || node.hasAttribute("contenteditable") ||
        [...node.attributes].some((a) => a.name.startsWith("data-tts")) ||
        [...node.classList].some((c) => c.startsWith("tts-")) ||
        node.style.display === "none" || node.style.visibility === "hidden") {
      supported = false;
      return;
    }
    if (node.nodeName === "BR") {
      const index = [...node.parentNode.childNodes].indexOf(node);
      units.push({ char: " ", start: [node.parentNode, index], end: [node.parentNode, index + 1] });
    } else for (const child of node.childNodes) visit(child);
  }
  visit(paragraph);
  if (!supported) return null;
  const normalized = [];
  for (let i = 0; i < units.length;) {
    const unit = units[i++];
    if (!/\s/.test(unit.char)) { normalized.push(unit); continue; }
    let end = unit.end;
    while (i < units.length && /\s/.test(units[i].char)) end = units[i++].end;
    if (normalized.length && i < units.length)
      normalized.push({ char: " ", start: unit.start, end });
  }
  return { text: normalized.map((u) => u.char).join(""), units: normalized };
}

/** Exact, non-mutating marks. jump() returns success and preserves caller focus. */
export function createMarkRenderer({ document: doc, main, manifest, onSelect = () => {} }) {
  const view = doc.defaultView;
  const registry = view?.CSS?.highlights;
  const HighlightClass = view?.Highlight;
  const owned = new Map();
  let records = [], visible = true, active = null, destroyed = false;

  function removeHighlights() {
    for (const [name, value] of owned) {
      if (registry?.get(name) === value) registry.delete(name);
    }
    owned.clear();
  }
  function resolve(record) {
    const anchor = record?.anchor;
    if (record?.orphan || !anchor || !Array.isArray(manifest?.blocks)) return null;
    const block = manifest.blocks.find((b) => b.block === anchor.block);
    if (!block || !/^p-(0|[1-9]\d*)$/.test(block.block) || typeof block.quote !== "string") return null;
    const expected = { book: manifest.book, page: manifest.page, revision: manifest.revision,
      block: block.block, quote: block.quote };
    if (Object.values(expected).some((v) => typeof v !== "string" || !v) || !matchesAnchor(anchor, expected)) return null;
    const paragraph = main.querySelectorAll("p")[Number(block.block.slice(2))];
    if (!paragraph?.isConnected || !main.contains(paragraph)) return null;
    const map = passageMap(paragraph);
    if (!map || map.text !== block.quote || !map.units.length) return null;
    const start = anchor.selector?.start ?? 0;
    const end = anchor.selector?.end ?? map.units.length;
    const range = doc.createRange();
    range.setStart(...map.units[start].start);
    range.setEnd(...map.units[end - 1].end);
    return { record, paragraph, range };
  }
  function paint() {
    removeHighlights();
    if (destroyed || !visible || !registry || typeof HighlightClass !== "function") return;
    const groups = new Map(NAMES.map((name) => [name, []]));
    for (const record of records) {
      const value = resolve(record);
      if (!value) continue;
      groups.get(record.kind === "course" || record.context?.course ? "sr-course" : "sr-personal").push(value.range);
    }
    const chosen = active && resolve(active);
    if (chosen) groups.get("sr-active").push(chosen.range);
    for (const [name, ranges] of groups) {
      if (!ranges.length) continue;
      const highlight = new HighlightClass(...ranges);
      registry.set(name, highlight);
      owned.set(name, highlight);
    }
  }
  function click(event) {
    if (destroyed || !visible || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !registry || typeof HighlightClass !== "function" || !doc.getSelection()?.isCollapsed ||
        event.target.closest?.("a,button,input,textarea,select,[contenteditable]")) return;
    paint();
    const caret = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    const fallback = caret ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.offsetNode ?? fallback?.startContainer;
    const offset = caret?.offset ?? fallback?.startOffset;
    if (!node || !main.contains(node)) return;
    const selected = records.filter((record) => {
      const value = resolve(record);
      if (!value) return false;
      try {
        if (![...value.range.getClientRects()].some((rect) =>
          rect.width !== 0 && rect.height !== 0 &&
          event.clientX >= rect.left && event.clientX < rect.right &&
          event.clientY >= rect.top && event.clientY < rect.bottom)) return false;
        if (value.range.comparePoint(node, offset) !== 0) return false;
        const tail = value.range.cloneRange();
        tail.setStart(node, offset);
        return !tail.collapsed;
      } catch { return false; }
    });
    if (selected.length) onSelect(selected);
  }
  const observer = view?.MutationObserver ? new view.MutationObserver(() => {
    // DOM Ranges are live: discard them as soon as a runtime transform occurs.
    // An explicit render/show/jump can rebuild only after full revalidation.
    active = null;
    removeHighlights();
  }) : null;
  observer?.observe(main, { subtree: true, childList: true, characterData: true, attributes: true });
  main.addEventListener("click", click);
  return {
    render(next) { if (!destroyed) { records = Array.isArray(next) ? [...next] : []; active = null; paint(); } },
    setVisible(value) { if (!destroyed) { visible = Boolean(value); paint(); } },
    jump(record) {
      if (destroyed) return false;
      paint();
      const value = resolve(record);
      if (!value) return false;
      active = record;
      paint();
      value.paragraph.scrollIntoView?.({ block: "center", behavior: "auto" });
      return true;
    },
    clear() { records = []; active = null; removeHighlights(); },
    destroy() { records = []; active = null; destroyed = true; removeHighlights(); main.removeEventListener("click", click); observer?.disconnect(); },
  };
}
