import { describe, it, expect, beforeEach } from 'vitest';
import { mountSentences, unmountSentences, setCurrent, resolveBlockElement, blockTextOf } from '../src/highlight.mjs';

function mainWith(inner) {
  document.body.innerHTML = `<main id="main-content">${inner}</main>`;
  return document.getElementById('main-content');
}

describe('highlight.mjs', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('resolves a block by its child-index path', () => {
    const root = mainWith('<div><p>Alpha.</p><p>Beta.</p></div>');
    expect(resolveBlockElement(root, [0, 1]).textContent).toBe('Beta.');
  });

  it('wraps each sentence in a span without changing the text', () => {
    const root = mainWith('<p>First one. Second one.</p>');
    const blocks = [{
      id: 'b0', kind: 'paragraph', text: 'First one. Second one.', anchor: { path: [0] },
      sentences: [
        { id: 'b0s0', display: 'First one.', offset: 0, length: 10 },
        { id: 'b0s1', display: 'Second one.', offset: 11, length: 11 },
      ],
    }];

    const map = mountSentences(root, blocks);

    expect(root.textContent).toBe('First one. Second one.');
    expect(map.get('b0s0').textContent).toBe('First one.');
    expect(map.get('b0s1').textContent).toBe('Second one.');
    expect(map.get('b0s0').dataset.ttsId).toBe('b0s0');
  });

  it('preserves inline markup inside a sentence', () => {
    const root = mainWith('<p>See the <a href="#x">study</a> now. Then stop.</p>');
    const blocks = [{
      id: 'b0', kind: 'paragraph', text: 'See the study now. Then stop.', anchor: { path: [0] },
      sentences: [
        { id: 'b0s0', display: 'See the study now.', offset: 0, length: 18 },
        { id: 'b0s1', display: 'Then stop.', offset: 19, length: 10 },
      ],
    }];

    mountSentences(root, blocks);

    expect(root.querySelector('a')).not.toBeNull();
    expect(root.querySelector('a').getAttribute('href')).toBe('#x');
  });

  it('marks exactly one sentence current at a time', () => {
    const root = mainWith('<p>One. Two.</p>');
    const blocks = [{
      id: 'b0', kind: 'paragraph', text: 'One. Two.', anchor: { path: [0] },
      sentences: [
        { id: 'b0s0', display: 'One.', offset: 0, length: 4 },
        { id: 'b0s1', display: 'Two.', offset: 5, length: 4 },
      ],
    }];
    const map = mountSentences(root, blocks);

    setCurrent(map, 'b0s0', { scroll: false });
    expect(root.querySelectorAll('.tts-current').length).toBe(1);

    setCurrent(map, 'b0s1', { scroll: false });
    expect(map.get('b0s1').classList.contains('tts-current')).toBe(true);
    expect(map.get('b0s0').classList.contains('tts-current')).toBe(false);

    setCurrent(map, null, { scroll: false });
    expect(root.querySelectorAll('.tts-current').length).toBe(0);
  });

  it('never adds aria-live to a highlight', () => {
    const root = mainWith('<p>One.</p>');
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: 'One.', anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: 'One.', offset: 0, length: 4 }],
    }]);
    setCurrent(map, 'b0s0', { scroll: false });
    expect(root.querySelector('[aria-live]')).toBeNull();
  });

  it('skips a block whose path no longer resolves', () => {
    const root = mainWith('<p>Only one.</p>');
    const map = mountSentences(root, [{
      id: 'b9', kind: 'paragraph', text: 'Missing.', anchor: { path: [7] },
      sentences: [{ id: 'b9s0', display: 'Missing.', offset: 0, length: 8 }],
    }]);
    expect(map.size).toBe(0);
  });

  it('skips notice blocks, which have no DOM text', () => {
    const root = mainWith('<table><tr><td>x</td></tr></table>');
    const map = mountSentences(root, [{
      id: 'b0', kind: 'notice', text: 'Table with 1 rows. Skipped.', anchor: { path: [0] },
      skipped: { reason: 'table', rows: 1, cells: 1 },
      sentences: [{ id: 'b0s0', display: '', speech: 'Table with 1 rows. Skipped.', offset: 0, length: 0 }],
    }]);
    expect(map.size).toBe(0);
  });

  // --- Stale manifest guard --------------------------------------------------
  //
  // Design spec S6: a stale manifest must degrade, not mis-highlight. The block
  // is located by child-index path, which survives content edits that change the
  // text -- so a resolved element is not proof the offsets still apply. MathJax
  // rewriting a formula in place produces the same mismatch on a fresh manifest.

  it('skips a block whose DOM text no longer matches the manifest', () => {
    const root = mainWith('<p>The page was edited since the build.</p>');
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: 'The page said something else.', anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: 'The page said something else.', offset: 0, length: 29 }],
    }]);
    expect(map.size).toBe(0);
  });

  it('reports which blocks it dropped so a caller can surface a degraded state', () => {
    const root = mainWith('<p>Changed.</p>');
    const dropped = [];
    mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: 'Original.', anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: 'Original.', offset: 0, length: 9 }],
    }], { onDrop: (block, reason) => dropped.push([block.id, reason]) });
    expect(dropped).toEqual([['b0', 'text-mismatch']]);
  });

  // ---- Math atoms: the token contract with pipeline/extract.py ----------------
  //
  // MathJax replaces `\(E\)` with an <mjx-container> whose own text is the
  // assistive MathML, not the source. The manifest carries `[[latex:<base64>]]`
  // in its place, and the walker contributes that token for the atom. Both
  // fixtures below are what CHTML output looks like after typesetting.
  const ATOM_E = '<mjx-container class="MathJax" jax="CHTML"><mjx-math><mjx-mi><mjx-c></mjx-c></mjx-mi></mjx-math>'
    + '<mjx-assistive-mml><math><mi>E</mi></math></mjx-assistive-mml></mjx-container>';
  const TOKEN_E = '[[latex:XChFXCk=]]';                   // \(E\)
  const ATOM_MC2 = '<mjx-container class="MathJax" jax="CHTML" display="true"><mjx-math></mjx-math>'
    + '<mjx-assistive-mml><math display="block"><mi>E</mi><mo>=</mo><mi>m</mi></math></mjx-assistive-mml></mjx-container>';
  const TOKEN_MC2 = '[[latex:XFtFID0gbWNeMlxd]]';         // \[E = mc^2\]

  it('renders a typeset block as its token text, ignoring assistive MathML', () => {
    const root = mainWith(`<p>Energy ${ATOM_E} is conserved.</p>`);
    const text = `Energy ${TOKEN_E} is conserved.`;
    expect(blockTextOf(root.firstElementChild, text)).toBe(text);
  });

  it('mounts a block whose equation MathJax has typeset', () => {
    const root = mainWith(`<p>Energy ${ATOM_E} is conserved. Then stop.</p>`);
    const text = `Energy ${TOKEN_E} is conserved. Then stop.`;
    const first = `Energy ${TOKEN_E} is conserved.`;
    const dropped = [];
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text, anchor: { path: [0] },
      sentences: [
        { id: 'b0s0', display: first, offset: 0, length: first.length },
        { id: 'b0s1', display: 'Then stop.', offset: first.length + 1, length: 10 },
      ],
    }], { onDrop: (b, why) => dropped.push(why) });

    expect(dropped).toEqual([]);
    expect(map.get('b0s0').querySelector('mjx-container')).not.toBeNull();
    expect(map.get('b0s1').textContent).toBe('Then stop.');
  });

  it('highlights a sentence that is exactly one display equation', () => {
    const root = mainWith(`<p>${ATOM_MC2}</p>`);
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: TOKEN_MC2, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: TOKEN_MC2, offset: 0, length: TOKEN_MC2.length }],
    }]);
    expect(map.size).toBe(1);
    expect(map.get('b0s0').firstElementChild.tagName.toLowerCase()).toBe('mjx-container');
  });

  it('mounts one sentence spanning two real atoms with prose between them', () => {
    // The common shape: "Both \(a\) and \(b\) are variables." -- two equations
    // in one sentence with ordinary text in between and after.
    const text = `Both ${TOKEN_E} and ${TOKEN_MC2} are variables.`;
    const root = mainWith(`<p>Both ${ATOM_E} and ${ATOM_MC2} are variables.</p>`);
    const dropped = [];
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: text, offset: 0, length: text.length }],
    }], { onDrop: (b, why) => dropped.push(why) });

    expect(dropped).toEqual([]);
    expect(map.size).toBe(1);
    const wrapped = map.get('b0s0');
    expect(wrapped.querySelectorAll('mjx-container').length).toBe(2);
    expect(wrapped.textContent.startsWith('Both ')).toBe(true);
    expect(wrapped.textContent.endsWith('are variables.')).toBe(true);
  });

  it('contributes nothing for an atom with no token at its offset (the preamble)', () => {
    const root = mainWith(`<p>${ATOM_E}Then \\(x\\) follows.</p>`);
    // The pipeline removed the preamble span, so the block text has no token there.
    expect(blockTextOf(root.firstElementChild, 'Then \\(x\\) follows.')).toBe('Then \\(x\\) follows.');
  });

  it('still drops a block MathJax has not typeset yet', () => {
    const root = mainWith('<p>Energy \\(E\\) is conserved.</p>');
    const dropped = [];
    mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: `Energy ${TOKEN_E} is conserved.`, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: `Energy ${TOKEN_E} is conserved.`, offset: 0, length: 30 }],
    }], { onDrop: (b, why) => dropped.push(why) });
    expect(dropped).toEqual(['text-mismatch']);
  });

  // ---- Empty atoms must not claim a token meant for the atom after them -------
  //
  // A \newcommand-only span renders to an empty <mjx-container> and the pipeline
  // removed its span from the block text, so there is no token for it. If an
  // empty container were allowed to consume whatever token sits at its offset,
  // it would steal the token that belongs to the real equation right after it:
  // the block's total text would still match (an empty claim plus a starved
  // real atom is the same string as the reverse), but the highlight range would
  // wrap the invisible container instead of the equation. An atom with no
  // rendered content must be skipped before it can claim a token.
  it('does not let an empty atom before a real equation claim its token', () => {
    const root = mainWith(`<p><mjx-container></mjx-container>${ATOM_E}</p>`);
    expect(blockTextOf(root.firstElementChild, TOKEN_E)).toBe(TOKEN_E);

    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: TOKEN_E, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: TOKEN_E, offset: 0, length: TOKEN_E.length }],
    }]);
    expect(map.size).toBe(1);
    const wrapped = map.get('b0s0');
    // Only the real equation is wrapped; the empty container stays outside it.
    expect(wrapped.children.length).toBe(1);
    expect(wrapped.firstElementChild.querySelector('mjx-assistive-mml')).not.toBeNull();
    expect(root.firstElementChild.firstElementChild.tagName.toLowerCase()).toBe('mjx-container');
    expect(root.firstElementChild.firstElementChild).not.toBe(wrapped);
  });

  it('claims its token from CHTML glyph structure alone, with no assistive MathML', () => {
    // Real MathJax CHTML draws glyphs via CSS on textless elements: this atom
    // has structure (an <mjx-c>) but no text anywhere and no assistive MathML
    // sibling -- textContent alone would wrongly call it empty.
    const atom = '<mjx-container class="MathJax" jax="CHTML"><mjx-math><mjx-mi><mjx-c></mjx-c></mjx-mi></mjx-math></mjx-container>';
    const root = mainWith(`<p>Energy ${atom} is conserved.</p>`);
    const text = `Energy ${TOKEN_E} is conserved.`;
    expect(blockTextOf(root.firstElementChild, text)).toBe(text);

    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: text, offset: 0, length: text.length }],
    }]);
    expect(map.size).toBe(1);
    expect(map.get('b0s0').querySelector('mjx-container')).not.toBeNull();
  });

  // ---- The mismatch guard is not a content check --------------------------
  //
  // blockTextOf reconstructs `expected` by construction: an atom contributes
  // "the token expected at its offset, or nothing" (see `placed`), so an atom
  // with no token left to claim still leaves the concatenated string equal to
  // `expected`. Two real, non-empty atoms in the DOM against one token in the
  // manifest -- the equation was edited or a second one added after the build
  // -- must still be caught, by comparing atom count to token count.
  it('drops a block whose non-empty atom count exceeds the manifest token count', () => {
    const root = mainWith(`<p>${ATOM_E}${ATOM_MC2}</p>`);
    // blockTextOf alone is fooled: it reconstructs `TOKEN_E` exactly, because
    // the second atom has no token left to claim and contributes nothing.
    expect(blockTextOf(root.firstElementChild, TOKEN_E)).toBe(TOKEN_E);

    const dropped = [];
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: TOKEN_E, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: TOKEN_E, offset: 0, length: TOKEN_E.length }],
    }], { onDrop: (b, why) => dropped.push(why) });

    expect(dropped).toEqual(['text-mismatch']);
    expect(map.size).toBe(0);
  });

  // A rendered SVG character: MathJax's SVG renderer wraps every expression in
  // structural <g data-mml-node="..."> grouping elements regardless of whether
  // anything is actually drawn, and represents an actual glyph as a <use>
  // referencing a <path> in <defs> -- the shape real MathJax SVG output emits.
  const SVG_GLYPH = '<mjx-container class="MathJax" jax="SVG"><svg>'
    + '<defs><path id="g1" d="M0 0"></path></defs>'
    + '<g data-mml-node="math"><g data-mml-node="mi"><use xlink:href="#g1"></use></g></g>'
    + '</svg></mjx-container>';
  // The same wrapper shape with no glyph inside it -- what a \newcommand-only
  // preamble span renders to under SVG output.
  const SVG_EMPTY = '<mjx-container class="MathJax" jax="SVG"><svg><g data-mml-node="math"></g></svg></mjx-container>';

  it('claims its token from SVG output, which carries no text at all', () => {
    const root = mainWith(`<p>${SVG_GLYPH}</p>`);
    expect(blockTextOf(root.firstElementChild, TOKEN_E)).toBe(TOKEN_E);

    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text: TOKEN_E, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: TOKEN_E, offset: 0, length: TOKEN_E.length }],
    }]);
    expect(map.size).toBe(1);
    expect(map.get('b0s0').querySelector('svg')).not.toBeNull();
  });

  it('does not let an SVG preamble wrapper with no glyph claim a token', () => {
    // Finding B (re-review correction): MathJax's SVG renderer always wraps a
    // \newcommand-only preamble in a structural <g data-mml-node="math">, so
    // "any element under <svg>" wrongly called it non-empty -- with the
    // atom-count guard from Finding 6, that made the whole block drop as
    // text-mismatch even though the preamble contributed no token to begin
    // with and the real equation right after it was untouched.
    const root = mainWith(`<p>${SVG_EMPTY}Energy ${SVG_GLYPH} is conserved.</p>`);
    const text = `Energy ${TOKEN_E} is conserved.`;
    const dropped = [];
    const map = mountSentences(root, [{
      id: 'b0', kind: 'paragraph', text, anchor: { path: [0] },
      sentences: [{ id: 'b0s0', display: text, offset: 0, length: text.length }],
    }], { onDrop: (b, why) => dropped.push(why) });

    expect(dropped).toEqual([]);
    expect(map.size).toBe(1);
    expect(map.get('b0s0').querySelector('svg')).not.toBeNull();
  });
});

describe('highlight.mjs — re-entering Reader Mode', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // BUG: Exit Reader Mode, then re-enter -> "Nothing on this page could be matched
  // to the reading list."
  //
  // exitReaderMode() tears down the player, the controls and the engine, but never
  // undoes what mountSentences did to the DOM. The <span class="tts-sentence">
  // wrappers stay. textContent is unchanged by wrapping, so the text-mismatch guard
  // does NOT fire -- the failure is one layer further in: the text is now split
  // across span boundaries, so Range.surroundContents() throws for every sentence
  // and each one is skipped by the catch. elements ends up empty, sentences.length
  // is 0, and reader.mjs reports the page as unmatchable.
  const BLOCKS = [{
    id: 'b0', kind: 'paragraph', text: 'First one. Second one.', anchor: { path: [0] },
    sentences: [
      { id: 'b0s0', display: 'First one.', offset: 0, length: 10 },
      { id: 'b0s1', display: 'Second one.', offset: 11, length: 11 },
    ],
  }];

  it('mounts the same sentences again after an unmount', () => {
    const root = mainWith('<p>First one. Second one.</p>');

    const first = mountSentences(root, BLOCKS);
    expect(first.size).toBe(2);

    unmountSentences(first);
    const second = mountSentences(root, BLOCKS);

    expect(second.size).toBe(2);
    expect(second.get('b0s0').textContent).toBe('First one.');
    expect(second.get('b0s1').textContent).toBe('Second one.');
  });

  it('unmounting restores the DOM to exactly what it was', () => {
    const root = mainWith('<p>First one. <em>Second</em> one.</p>');
    const before = root.innerHTML;

    const map = mountSentences(root, [{
      ...BLOCKS[0], text: 'First one. Second one.',
    }]);
    expect(root.innerHTML).not.toBe(before);

    unmountSentences(map);
    expect(root.innerHTML).toBe(before);
  });

  it('unmounting is safe to call twice', () => {
    const root = mainWith('<p>First one. Second one.</p>');
    const map = mountSentences(root, BLOCKS);
    unmountSentences(map);
    expect(() => unmountSentences(map)).not.toThrow();
    expect(root.textContent).toBe('First one. Second one.');
  });
});
