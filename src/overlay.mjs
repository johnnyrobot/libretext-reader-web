/**
 * Enter and leave Reader Mode.
 *
 * All state is one attribute on <html> plus one stylesheet. The DOM is never
 * rebuilt, so figures, tables, MathJax output and links stay exactly where they
 * are -- and exiting cannot leave the page half-transformed.
 */

const STYLESHEET_URL = '/_assets/tts/reader.css';

let savedScrollY = 0;

/**
 * Load the Reader Mode stylesheet as an external <link>.
 *
 * It has to be external. The mirror's CSP is `style-src 'self'` plus four
 * sha256 hashes for stylesheets that already exist -- there is no
 * 'unsafe-inline', so an injected <style> element would be blocked and Reader
 * Mode would open completely unstyled.
 *
 * Injecting it here rather than importing it into reader.mjs also keeps the
 * zero-cost-until-invoked guarantee: nothing fetches this file until the reader
 * has pressed the button.
 */
export function ensureStylesheet(href = STYLESHEET_URL) {
  if (document.querySelector(`link[data-tts-style]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.ttsStyle = '';
  document.head.appendChild(link);
}

export function openOverlay() {
  if (document.documentElement.dataset.ttsReader === 'on') return;
  savedScrollY = globalThis.scrollY ?? 0;
  document.documentElement.dataset.ttsReader = 'on';
}

export function closeOverlay() {
  if (document.documentElement.dataset.ttsReader !== 'on') return;
  delete document.documentElement.dataset.ttsReader;
  globalThis.scrollTo?.(0, savedScrollY);
}
