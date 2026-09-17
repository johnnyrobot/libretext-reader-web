import { describe, it, expect, beforeEach } from 'vitest';
import { openOverlay, closeOverlay } from '../src/overlay.mjs';

describe('overlay.mjs', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-tts-reader');
    document.body.innerHTML = '<main id="main-content"><p>Text.</p></main>';
    globalThis.scrollTo = () => {};
  });

  it('marks the document when open and unmarks it when closed', () => {
    openOverlay();
    expect(document.documentElement.dataset.ttsReader).toBe('on');
    closeOverlay();
    expect(document.documentElement.dataset.ttsReader).toBeUndefined();
  });

  it('is idempotent', () => {
    openOverlay();
    openOverlay();
    closeOverlay();
    closeOverlay();
    expect(document.documentElement.dataset.ttsReader).toBeUndefined();
  });

  it('never removes content from the page', () => {
    openOverlay();
    expect(document.querySelector('main#main-content p').textContent).toBe('Text.');
    closeOverlay();
    expect(document.querySelector('main#main-content p').textContent).toBe('Text.');
  });
});
