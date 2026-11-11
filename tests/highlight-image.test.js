// LT-537: an `image` block is spoken from the alt text and highlighted by
// outlining the <img> itself -- the page is never wrapped or rewritten.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountSentences, unmountSentences, setCurrent, markSkipped, imageText,
} from '../src/highlight.mjs';

function mainWith(inner) {
  document.body.innerHTML = `<main id="main-content">${inner}</main>`;
  return document.getElementById('main-content');
}

const imageBlock = (id, path, text, sentences = [text]) => {
  let offset = 0;
  return {
    id, kind: 'image', text, anchor: { path },
    sentences: sentences.map((display, i) => {
      const s = { id: `${id}s${i}`, display, speech: display, offset: text.indexOf(display, offset), length: display.length };
      offset = s.offset + s.length;
      return s;
    }),
  };
};

describe('image blocks (LT-537)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('builds the same text the pipeline does from the alt', () => {
    const img = document.createElement('img');
    img.setAttribute('alt', '  A   red\n\tflask  ');
    expect(imageText(img)).toBe('Image: A red flask');
    img.setAttribute('alt', 'A flask');
    expect(imageText(img)).toBe('Image: A flask');
    img.removeAttribute('alt');
    expect(imageText(img)).toBe(null);
  });

  it('maps every sentence of the description onto the image, without wrapping it', () => {
    const root = mainWith('<figure><img src="x.png" alt="A beaker. It is blue."><figcaption>Fig 1</figcaption></figure>');
    const before = root.innerHTML;
    const img = root.querySelector('img');

    const map = mountSentences(root, [imageBlock('b0', [0, 0], 'Image: A beaker. It is blue.', ['Image: A beaker.', 'It is blue.'])]);

    expect(map.get('b0s0')).toBe(img);
    expect(map.get('b0s1')).toBe(img);
    expect(root.innerHTML).toBe(before);
  });

  it('finds an image inside a paragraph whose sentences were wrapped first', () => {
    const root = mainWith('<p>Look here. <img alt="A red flask"> Then on.</p>');
    const img = root.querySelector('img');
    const map = mountSentences(root, [
      {
        id: 'b0', kind: 'paragraph', text: 'Look here.  Then on.', anchor: { path: [0] },
        sentences: [
          { id: 'b0s0', display: 'Look here.', offset: 0, length: 10 },
          { id: 'b0s1', display: 'Then on.', offset: 12, length: 8 },
        ],
      },
      imageBlock('b1', [0, 0], 'Image: A red flask'),
    ]);
    expect(map.get('b0s0').textContent).toBe('Look here.');
    expect(map.get('b1s0')).toBe(img);
  });

  it('drops an image whose alt changed since the build, or a path that is not an image', () => {
    const root = mainWith('<img alt="A blue flask"><p>Text.</p>');
    const dropped = [];
    const map = mountSentences(root, [
      imageBlock('b0', [0], 'Image: A red flask'),
      imageBlock('b1', [1], 'Image: Text.'),
    ], { onDrop: (block, why) => dropped.push([block.id, why]) });
    expect(map.size).toBe(0);
    expect(dropped).toEqual([['b0', 'text-mismatch'], ['b1', 'text-mismatch']]);
  });

  it('matches a formula in the alt through its math token, as the pipeline wrote it', () => {
    // MathJax never typesets an attribute, so the alt still holds `\\(F_{μ}\\)`
    // while the manifest holds its token (UTF-8 base64, as pipeline/extract.py).
    const span = '\\(F_{μ}\\)';
    const token = `[[latex:${Buffer.from(span, 'utf8').toString('base64')}]]`;
    const root = mainWith(`<img alt="The force ${span} between charges">`);
    const dropped = [];
    const map = mountSentences(root, [
      imageBlock('i0', [0], `Image: The force ${token} between charges`),
      imageBlock('i1', [0], 'Image: The force \\(G\\) between charges'),
    ], { onDrop: (block, why) => dropped.push([block.id, why]) });
    expect(map.get('i0s0')).toBe(root.querySelector('img'));
    expect(dropped).toEqual([['i1', 'text-mismatch']]);
  });

  it('outlines the current image and puts the page back exactly on unmount', () => {
    const root = mainWith('<img alt="A flask"><img class="wide" alt="A cat" title="Kitty"><p>One.</p>');
    const before = root.innerHTML;
    const map = mountSentences(root, [
      imageBlock('b0', [0], 'Image: A flask'),
      imageBlock('b1', [1], 'Image: A cat'),
      {
        id: 'b2', kind: 'paragraph', text: 'One.', anchor: { path: [2] },
        sentences: [{ id: 'b2s0', display: 'One.', offset: 0, length: 4 }],
      },
    ]);
    const [flask, cat] = root.querySelectorAll('img');
    flask.scrollIntoView = () => {};
    cat.scrollIntoView = () => {};

    setCurrent(map, 'b0s0');
    expect(flask.classList.contains('tts-current')).toBe(true);
    setCurrent(map, 'b1s0');
    expect(flask.classList.contains('tts-current')).toBe(false);
    expect(cat.classList.contains('tts-current')).toBe(true);
    markSkipped(map, 'b1s0');
    expect(cat.classList.contains('tts-skipped')).toBe(true);
    expect(cat.title).toBe('Kitty');

    unmountSentences(map);
    expect(root.innerHTML).toBe(before);
    expect(root.querySelectorAll('img').length).toBe(2);
  });
});
