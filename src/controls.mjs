/** The transport bar. Real buttons with real names; keyboard reaches all of it. */

import { formatBytes } from './consent.mjs';

// Supertonic ships ten speaking styles. Two are offered: a ten-item menu of
// opaque codes is a worse choice than one clear pair, and each extra voice is
// another ~291 KB style file to fetch.
const VOICES = [['M1', 'Male'], ['F1', 'Female']];
const RATES = [0.75, 1, 1.25, 1.5];

export function mountControls(host, {
  onPlay, onPause, onNext, onPrev, onVoice, onRate, onExit,
  onLang = () => {}, languages = [],
}) {
  const bar = document.createElement('div');
  bar.className = 'tts-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Listening controls');

  // Rendered only when this deployment hosts translation models. An empty menu
  // that offers nothing but English is worse than no menu.
  //
  // Translated options say so. Offering machine-translated audio that nobody on
  // the project can verify, without saying it is machine output, misrepresents
  // it. English is the source and carries no such note.
  //
  // And each one says whether picking it starts in seconds or starts a 115 MB
  // download. That is the single most useful thing this menu can tell a reader,
  // and it is a cache lookup -- the caller does it and passes `stored`.
  const langControl = languages.length ? `
    <label>Language <select data-act="lang" aria-label="Language">
      <option value="en" selected>English</option>
      ${languages.map(({ code }) => `<option value="${code}"></option>`).join('')}
    </select></label>` : '';

  bar.innerHTML = `
    <button type="button" data-act="prev" aria-label="Previous sentence">⏮</button>
    <button type="button" data-act="toggle" aria-label="Play">▶</button>
    <button type="button" data-act="next" aria-label="Next sentence">⏭</button>
    <span class="tts-status" aria-hidden="true"></span>
    <span class="tts-spacer"></span>
    <label>Voice <select data-act="voice" aria-label="Voice">${
      VOICES.map(([value, label], i) => `<option value="${value}"${i === 0 ? ' selected' : ''}>${label}</option>`).join('')
    }</select></label>
    ${langControl}
    <label>Speed <select data-act="rate" aria-label="Speed">${
      RATES.map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r}×</option>`).join('')
    }</select></label>
    <span class="tts-badge" data-act="provider"></span>
    <button type="button" data-act="exit" aria-label="Exit reader mode">✕ Exit</button>
  `;

  const el = (act) => bar.querySelector(`[data-act="${act}"]`);

  /** What one language's option says. `stored` is the whole point of it. */
  function optionText({ label, bytes, stored }) {
    const cost = bytes ? `${formatBytes(bytes)} download` : 'download needed';
    return `${label} — machine translation (${stored ? 'downloaded' : cost})`;
  }

  function paintLanguage(entry) {
    // textContent, not innerHTML: the option text is now assembled from data
    // (a label, a byte count, a stored flag) rather than written out in full
    // here, and this is the one place that assembly reaches the DOM.
    const option = el('lang')?.querySelector(`option[value="${entry.code}"]`);
    if (option) option.textContent = optionText(entry);
  }

  for (const entry of languages) paintLanguage(entry);

  const toggle = el('toggle');
  const status = bar.querySelector('.tts-status');
  let playing = false;

  bar.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') (playing ? onPause : onPlay)();
    if (act === 'next') onNext();
    if (act === 'prev') onPrev();
    if (act === 'exit') onExit();
  });
  el('voice').addEventListener('change', (e) => onVoice(e.target.value));
  el('rate').addEventListener('change', (e) => onRate(Number(e.target.value)));
  if (languages.length) el('lang').addEventListener('change', (e) => onLang(e.target.value));

  const onKey = (event) => {
    if (event.target?.matches?.('input, select, textarea')) return;
    if (event.key === ' ') { event.preventDefault(); (playing ? onPause : onPlay)(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); onNext(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); onPrev(); }
    if (event.key === 'Escape') { event.preventDefault(); onExit(); }
  };
  document.addEventListener('keydown', onKey);

  host.appendChild(bar);

  return {
    setState({ playing: isPlaying, buffering, message }) {
      playing = isPlaying;
      toggle.textContent = isPlaying ? '⏸' : '▶';
      toggle.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      status.textContent = buffering ? message : '';
    },
    setProvider(provider) { el('provider').textContent = provider.toUpperCase(); },
    setVoice(voice) { el('voice').value = voice; },
    setLang(lang) { const select = el('lang'); if (select) select.value = lang; },

    /** Repaint one language after its model arrives.
     *
     * Called rather than rebuilt, because rebuilding the <select> while the
     * reader is looking at it would lose their selection -- and this fires
     * immediately after a download, which is exactly when they have just made
     * one. */
    setLanguageStored(code, stored) {
      const entry = languages.find((language) => language.code === code);
      if (!entry) return;
      entry.stored = stored;
      paintLanguage(entry);
    },
    destroy() { document.removeEventListener('keydown', onKey); bar.remove(); },
  };
}
