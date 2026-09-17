import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountControls } from '../src/controls.mjs';

function handlers() {
  return {
    onPlay: vi.fn(), onPause: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(),
    onVoice: vi.fn(), onRate: vi.fn(), onExit: vi.fn(),
  };
}

function press(key) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

// A FACTORY, not a constant: setLanguageStored mutates the entries it is given,
// which is how the menu repaints without being rebuilt. A shared array would
// carry one test's download into the next one.
const LANGS = () => [
  { code: 'es', label: 'español', bytes: 121_097_315, stored: false },
  { code: 'fr', label: 'français', bytes: 121_097_315, stored: true },
];

describe('controls.mjs', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('gives every control an accessible name', () => {
    const h = handlers();
    const controls = mountControls(document.body, h);
    for (const button of document.querySelectorAll('.tts-bar button')) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
    expect(document.querySelector('.tts-bar').getAttribute('aria-label')).toBe('Listening controls');
    controls.destroy();
  });

  it('toggles between play and pause on the same button', () => {
    const h = handlers();
    const controls = mountControls(document.body, h);
    const toggle = document.querySelector('[data-act="toggle"]');

    toggle.click();
    expect(h.onPlay).toHaveBeenCalledTimes(1);

    controls.setState({ playing: true, buffering: false, message: '' });
    toggle.click();
    expect(h.onPause).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-label')).toBe('Pause');
    controls.destroy();
  });

  it('drives play, next, prev and exit from the keyboard', () => {
    const h = handlers();
    const controls = mountControls(document.body, h);

    press(' ');
    press('ArrowRight');
    press('ArrowLeft');
    press('Escape');

    expect(h.onPlay).toHaveBeenCalledTimes(1);
    expect(h.onNext).toHaveBeenCalledTimes(1);
    expect(h.onPrev).toHaveBeenCalledTimes(1);
    expect(h.onExit).toHaveBeenCalledTimes(1);
    controls.destroy();
  });

  it('shows the buffering message rather than nothing', () => {
    const h = handlers();
    const controls = mountControls(document.body, h);
    controls.setState({ playing: true, buffering: true, message: 'Preparing audio…' });
    expect(document.querySelector('.tts-status').textContent).toBe('Preparing audio…');
    controls.setState({ playing: true, buffering: false, message: '' });
    expect(document.querySelector('.tts-status').textContent).toBe('');
    controls.destroy();
  });

  it('surfaces the active execution provider', () => {
    const h = handlers();
    const controls = mountControls(document.body, h);
    controls.setProvider('webgpu');
    expect(document.querySelector('[data-act="provider"]').textContent).toBe('WEBGPU');
    controls.destroy();
  });

  it('offers exactly two voices, named rather than coded', () => {
    const controls = mountControls(document.body, handlers());
    const options = [...document.querySelectorAll('[data-act="voice"] option')];
    expect(options.map((o) => o.textContent)).toEqual(['Male', 'Female']);
    expect(options.map((o) => o.value)).toEqual(['M1', 'F1']);
    expect(document.querySelector('[data-act="voice"]').value).toBe('M1');
    controls.destroy();
  });

  it('destroy removes the bar and unbinds the keyboard', () => {
    const h = handlers();
    const controls = mountControls(document.body, h);
    controls.destroy();
    press(' ');
    expect(document.querySelector('.tts-bar')).toBeNull();
    expect(h.onPlay).not.toHaveBeenCalled();
  });

  it('renders no language control when the page ships only English', () => {
    const controls = mountControls(document.body, handlers());
    expect(document.querySelector('[data-act="lang"]')).toBeNull();
    controls.destroy();
  });

  it('lists English first, then every shipped language', () => {
    const controls = mountControls(document.body, { ...handlers(), languages: LANGS() });
    const options = [...document.querySelectorAll('[data-act="lang"] option')];
    expect(options.map((o) => o.value)).toEqual(['en', 'es', 'fr']);
    expect(document.querySelector('[data-act="lang"]').value).toBe('en');
    controls.destroy();
  });

  it('marks translated options as machine output and leaves English unmarked', () => {
    const controls = mountControls(document.body, { ...handlers(), languages: LANGS() });
    const options = [...document.querySelectorAll('[data-act="lang"] option')];
    expect(options[0].textContent).toBe('English');
    expect(options[1].textContent).toContain('español');
    expect(options[1].textContent).toContain('machine translation');
    controls.destroy();
  });

  it('reports the chosen language', () => {
    const h = { ...handlers(), onLang: vi.fn(), languages: LANGS() };
    const controls = mountControls(document.body, h);
    const select = document.querySelector('[data-act="lang"]');
    select.value = 'fr';
    select.dispatchEvent(new Event('change'));
    expect(h.onLang).toHaveBeenCalledWith('fr');
    controls.destroy();
  });

  it('setLang moves the menu without firing the handler', () => {
    const h = { ...handlers(), onLang: vi.fn(), languages: LANGS() };
    const controls = mountControls(document.body, h);
    controls.setLang('es');
    expect(document.querySelector('[data-act="lang"]').value).toBe('es');
    expect(h.onLang).not.toHaveBeenCalled();
    controls.destroy();
  });

  it('says whether picking a language starts a download, and how big', () => {
    // The single most useful thing this menu can tell a reader, and it is a
    // cache lookup: "starts in three seconds" or "starts after a 115 MB
    // download".
    const controls = mountControls(document.body, { ...handlers(), languages: LANGS() });
    const options = [...document.querySelectorAll('[data-act="lang"] option')];

    expect(options[1].textContent).toBe('español — machine translation (115 MB download)');
    expect(options[2].textContent).toBe('français — machine translation (downloaded)');
    controls.destroy();
  });

  it('repaints one language after its model arrives, keeping the selection', () => {
    // Fired immediately after a download, which is exactly when the reader has
    // just made a selection. Rebuilding the <select> would drop it.
    const controls = mountControls(document.body, { ...handlers(), languages: LANGS() });
    const select = document.querySelector('[data-act="lang"]');
    select.value = 'es';

    controls.setLanguageStored('es', true);

    expect(select.querySelector('option[value="es"]').textContent)
      .toBe('español — machine translation (downloaded)');
    expect(select.value).toBe('es');
    expect(select.querySelectorAll('option')).toHaveLength(3);
    controls.destroy();
  });

  it('ignores a language it is not showing', () => {
    const controls = mountControls(document.body, { ...handlers(), languages: LANGS() });
    expect(() => controls.setLanguageStored('de', true)).not.toThrow();
    expect([...document.querySelectorAll('[data-act="lang"] option')]).toHaveLength(3);
    controls.destroy();
  });

  it('says a download is needed when it does not know the size', () => {
    // A pairs.json written before sizes were recorded. Saying nothing about the
    // cost would be worse than saying it is unknown.
    const controls = mountControls(document.body, {
      ...handlers(), languages: [{ code: 'es', label: 'español' }],
    });
    expect(document.querySelector('option[value="es"]').textContent)
      .toBe('español — machine translation (download needed)');
    controls.destroy();
  });

  it('gives the language control an accessible name', () => {
    const controls = mountControls(document.body, { ...handlers(), languages: LANGS() });
    expect(document.querySelector('[data-act="lang"]').getAttribute('aria-label')).toBe('Language');
    controls.destroy();
  });
});
