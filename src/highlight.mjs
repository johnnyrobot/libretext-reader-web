/**
 * Map speech.json sentence offsets onto the live DOM.
 *
 * Sentences are wrapped in spans over the existing text nodes rather than
 * having their markup replaced, so links, emphasis and MathJax output inside a
 * sentence survive untouched. Display Text is never modified -- only wrapped.
 *
 * The offsets come from `pipeline/extract.py`, which computes a block's text as
 * `element.textContent` WITH EACH MATH SPAN REPLACED BY ITS TOKEN. MathJax
 * rewrites `\( ... \)` into an <mjx-container> at typeset time, so the raw span
 * is gone before the reader mounts; the pipeline puts `[[latex:<base64>]]` in
 * its place and this file treats each container as one atom whose text is the
 * token found at that offset.
 *
 * What `mountSentences`'s guard actually checks: that an equation atom is
 * PRESENT at every position the manifest expects one, in the right count and
 * document order, and that the surrounding text is unchanged. It does NOT
 * decode or compare what the DOM's equation actually says against the
 * manifest's token -- an atom contributes "the token the manifest says is
 * here" by construction (see `placed` below), so two equations with the same
 * atom count in the same positions are indistinguishable to this guard even
 * if their LaTeX differs. Recovering the real TeX from MathJax internals to
 * close that gap was considered and rejected (design doc §3, approach B):
 * MathJax's internal representation differs between the mirror and
 * production, and this file does not want that coupling.
 */

export function resolveBlockElement(root, path) {
  let node = root;
  for (const index of path) {
    const children = [...node.children];
    if (index >= children.length) return null;
    node = children[index];
  }
  return node === root ? null : node;
}

const MATH_TOKEN_AT = /^\[\[latex:[A-Za-z0-9+/=]+\]\]/;

function isAtom(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'mjx-container';
}

// `textContent` alone cannot tell an empty atom from a real one: MathJax's
// CHTML output draws glyphs via CSS on textless elements (<mjx-c> carries no
// text), so a real equation's textContent is non-empty ONLY because of the
// <mjx-assistive-mml> sibling -- a site-level MathJax config this repo does
// not own. So "has rendered content" means a glyph exists: an element under
// <mjx-math> (CHTML), or under the assistive <math>.
//
// SVG output needs its own, narrower test. MathJax's SVG renderer always
// wraps a rendered expression in structural <g data-mml-node="..."> grouping
// elements, glyph or not -- a \newcommand-only preamble renders as
// `<svg><g data-mml-node="math"></g></svg>`, an empty <g> with no glyph
// inside it, so testing for "any element under <svg>" (as this used to)
// finds that wrapper and wrongly calls the atom non-empty. The actual glyphs
// are <use> elements referencing a <path> in <defs>; requiring one of those
// is what actually distinguishes a rendered character from an empty
// wrapper. A \newcommand-only preamble is empty under BOTH renderers, but
// for different structural reasons -- CHTML because <mjx-math> has no
// children at all, SVG because its <g> wrapper has no <use>/<path> glyph
// inside it.
function isEmptyAtom(container) {
  return !container.querySelector('mjx-math > *, svg use, svg path, mjx-assistive-mml math > *');
}

// Depth-first: text nodes as themselves, an <mjx-container> as one atom whose
// subtree (CHTML glyph boxes AND the assistive MathML) is never entered. An
// atom with no rendered content (a \newcommand-only span, which the pipeline
// already dropped from the block text) is marked `empty` so `placed` below
// never lets it claim a token meant for a real equation next to it.
function* segments(element) {
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) yield { node: child, text: child.textContent ?? '' };
    else if (isAtom(child)) yield { node: child, atom: true, empty: isEmptyAtom(child) };
    else if (child.nodeType === Node.ELEMENT_NODE) yield* segments(child);
  }
}

// Each segment with the text it contributes and where it sits in the block.
// An atom contributes the token at its offset in `expected`, or nothing when
// there is none there (the page's \newcommand preamble renders to an empty
// container and the pipeline removed its span) or when the atom itself has no
// rendered content -- an empty atom must never claim a token that belongs to
// the next, real, atom.
function* placed(element, expected) {
  let consumed = 0;
  for (const segment of segments(element)) {
    const text = segment.atom
      ? (segment.empty ? '' : (MATH_TOKEN_AT.exec(expected.slice(consumed))?.[0] ?? ''))
      : segment.text;
    yield { ...segment, text, start: consumed, end: consumed + text.length };
    consumed += text.length;
  }
}

/** The element's text under the token contract. Exported for tests. */
export function blockTextOf(element, expected) {
  let out = '';
  for (const p of placed(element, expected)) out += p.text;
  return out;
}

// A global counterpart to MATH_TOKEN_AT, for counting how many tokens the
// manifest expects rather than matching the one at a fixed offset.
const MATH_TOKEN_G = /\[\[latex:[A-Za-z0-9+/=]+\]\]/g;

// How many non-empty math atoms the element's subtree actually renders. Used
// alongside blockTextOf: that function reconstructs `expected` by construction
// (an atom always contributes "the token expected here, or nothing"), so an
// extra or missing atom can still leave the concatenated string byte-identical
// to `expected` -- see the guard's comment in mountSentences. Counting atoms
// independently of the text they were assigned catches that case.
function countNonEmptyAtoms(element) {
  let count = 0;
  for (const segment of segments(element)) {
    if (segment.atom && !segment.empty) count += 1;
  }
  return count;
}

// Walks the element's segments accumulating character counts so a (offset,
// length) pair from the manifest becomes a Range, even when the sentence spans
// several nodes because of inline markup. A boundary that lands exactly on an
// atom is placed before or after the whole container: a sentence boundary can
// never fall inside a token, and a container fully inside a range is legal for
// surroundContents.
function rangeFor(element, expected, offset, length) {
  const range = document.createRange();
  const end = offset + length;
  let startSet = false;

  for (const p of placed(element, expected)) {
    if (p.atom) {
      if (!p.text) continue;
      if (!startSet && offset === p.start) { range.setStartBefore(p.node); startSet = true; }
      if (startSet && end === p.end) { range.setEndAfter(p.node); return range; }
      continue;
    }
    if (!startSet && offset >= p.start && offset <= p.end) {
      range.setStart(p.node, offset - p.start);
      startSet = true;
    }
    if (startSet && end <= p.end) {
      range.setEnd(p.node, end - p.start);
      return range;
    }
  }
  return startSet ? range : null;
}

export function mountSentences(root, blocks, { onDrop = () => {} } = {}) {
  const elements = new Map();

  for (const block of blocks) {
    if (block.kind === 'notice') continue;

    const element = resolveBlockElement(root, block.anchor?.path ?? []);
    if (!element) { onDrop(block, 'unresolved-path'); continue; }

    // A child-index path survives edits that change the text, so resolving is
    // not proof the offsets still apply. Design spec S6: a stale manifest must
    // degrade, not mis-highlight. Same guard catches MathJax having rewritten a
    // formula in place after the manifest was built.
    // A typeset equation matches through the token contract described in the header.
    //
    // blockTextOf alone is not enough for a block with math: an atom
    // contributes "the token expected at its offset, or nothing", so an atom
    // with no token left to claim (one more real equation than the manifest
    // expects) still reconstructs `expected` byte for byte -- see the header
    // comment. Comparing the non-empty atom count against the token count in
    // `expected` catches that case.
    if (typeof block.text === 'string') {
      const textMatches = blockTextOf(element, block.text) === block.text;
      const expectedTokenCount = (block.text.match(MATH_TOKEN_G) ?? []).length;
      const atomCountMatches = countNonEmptyAtoms(element) === expectedTokenCount;
      if (!textMatches || !atomCountMatches) {
        onDrop(block, 'text-mismatch');
        continue;
      }
    }

    // Wrap from the end backwards so earlier offsets stay valid as we mutate.
    for (const sentence of [...block.sentences].reverse()) {
      if (!sentence.length) continue;
      const range = rangeFor(element, block.text, sentence.offset, sentence.length);
      if (!range) continue;

      const span = document.createElement('span');
      span.className = 'tts-sentence';
      span.dataset.ttsId = sentence.id;
      try {
        range.surroundContents(span);
      } catch {
        // The sentence straddles an element boundary in a way surroundContents
        // rejects. Skip it rather than corrupting the page; it stays readable,
        // it just is not individually seekable.
        continue;
      }
      elements.set(sentence.id, span);
    }
  }

  return elements;
}

/**
 * Undo `mountSentences`, restoring the DOM to exactly what it was.
 *
 * WHY THIS HAS TO EXIST. `exitReaderMode` used to tear down the player, the
 * controls and the engine and stop there -- everything it owned, and nothing it
 * had done to the reader's page. The <span class="tts-sentence"> wrappers stayed.
 *
 * Re-entering then re-ran mountSentences over a DOM whose text was already split
 * across those spans. `textContent` is unchanged by wrapping, so the
 * text-mismatch guard never fired; the failure landed one layer in, where
 * `Range.surroundContents()` rejects a range that partially selects a non-Text
 * node. In Chromium every sentence hit that path, `elements` came back empty, and
 * reader.mjs reported "Nothing on this page could be matched to the reading
 * list." -- a page-content error for what was really leftover state of our own.
 *
 * Measured before the fix: happy-dom kept 286 sentences on the first entry and
 * 110 on the second; Chromium kept 286 and then none. Both are wrong; only one
 * was visible.
 *
 * `normalize()` is the load-bearing half. Removing a span leaves its former
 * contents as separate adjacent text nodes, and a range over the JOIN of two
 * text nodes is exactly what surroundContents refuses -- so unwrapping without
 * normalising would leave the page looking restored and still unmountable.
 */
export function unmountSentences(elements) {
  const touched = new Set();
  for (const span of elements.values()) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    touched.add(parent);
  }
  for (const parent of touched) parent.normalize();
  elements.clear();
}

export function setCurrent(elements, id, { scroll = true } = {}) {
  for (const element of elements.values()) element.classList.remove('tts-current');
  if (id === null || id === undefined) return;

  const element = elements.get(id);
  if (!element) return;
  element.classList.add('tts-current');

  if (!scroll) return;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
}
