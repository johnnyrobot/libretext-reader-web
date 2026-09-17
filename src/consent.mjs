/**
 * The consent gate. Nothing may fetch a model byte before this resolves true.
 *
 * The OpenRAIL-M link is deliberately here rather than in a repository file:
 * it is a use-restricted license and the person accepting the download is the
 * person it binds.
 */

const MODEL_LICENSE_URL = 'https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE';

// The Opus-MT checkpoint the ONNX export is quantized from. Linked rather than
// the export itself because the export carries no licence tag of its own -- see
// scripts/convert-mt-models.py, which resolves the licence through this repo and
// records which one it came from.
const MT_MODEL_URL = 'https://huggingface.co/Helsinki-NLP/opus-mt-en-es';

// Every other string this file interpolates is a literal or a number. `language`
// and `licence` are neither: they come from LANGUAGE_LABELS and pairs.json, and
// pairs.json is written by our own script TODAY -- exactly the kind of assumption
// that stops being true quietly. Same reason controls.mjs is fed off an
// allowlist rather than off the manifest.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Shared with controls.mjs, which puts the same number in the language menu.
 * Two independent roundings of the same bytes would eventually disagree, and a
 * menu that says 115 MB next to a dialog that says 116 MB reads as a bug in
 * whichever one the reader trusts less. */
export function formatBytes(bytes) {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

function card(inner) {
  const wrap = document.createElement('div');
  wrap.className = 'tts-dialog';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Listen to this page');
  wrap.innerHTML = `<div class="tts-dialog-card">${inner}</div>`;
  document.body.appendChild(wrap);
  return wrap;
}

export function requestConsent({ requiredBytes, quotaSufficient }) {
  return new Promise((resolve) => {
    const size = formatBytes(requiredBytes);
    const warning = quotaSufficient
      ? ''
      : `<p><strong>This browser may not have room for ${size}.</strong> The download can fail partway.</p>`;

    const dialog = card(`
      <h2>Listen to this page</h2>
      <p>This page can be read aloud by a voice that runs entirely on your device.
         Nothing you read or hear is sent anywhere.</p>
      <p>To do that, a <strong>${size}</strong> voice model is downloaded once and kept in this
         browser. You can delete it at any time.</p>
      ${warning}
      <p><small>Voice model: Supertonic 3 by Supertone, licensed under
        <a href="${MODEL_LICENSE_URL}" target="_blank" rel="noopener">OpenRAIL-M</a>
        (a licence with use restrictions). Runtime code under MIT.</small></p>
      <p>
        <button type="button" data-act="accept">Download and listen</button>
        <button type="button" data-act="decline">Not now</button>
      </p>
    `);

    dialog.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      dialog.remove();
      resolve(act === 'accept');
    });
    dialog.querySelector('[data-act="accept"]').focus();
  });
}

/**
 * A SECOND gate, and it is not a formality.
 *
 * A reader who accepted 383 MB for a voice has not thereby accepted another
 * 121 MB for Spanish. It is a separate download, of a separate model, under a
 * separate licence, made days later by someone who has forgotten the first
 * dialog -- so it is asked separately.
 *
 * The licence is named because this project's model choice was MADE on licence
 * grounds: NLLB is the obvious multilingual checkpoint and is out, because its
 * output is cc-by-nc-4.0 and cannot ship inside an MIT product. Opus-MT is
 * apache-2.0, which is the reason it is here, so the reader gets told which one
 * they are running.
 */
export function requestTranslationConsent({ language, requiredBytes, quotaSufficient, licence }) {
  return new Promise((resolve) => {
    const size = formatBytes(requiredBytes);
    const name = escapeHtml(language);
    const terms = escapeHtml(licence);
    const warning = quotaSufficient
      ? ''
      : `<p><strong>This browser may not have room for ${size}.</strong> The download can fail partway.</p>`;

    const dialog = card(`
      <h2>Listen in ${name}</h2>
      <p>This page can be translated and read aloud in ${name}, entirely on your device.
         Nothing you read or hear is sent anywhere.</p>
      <p>To do that, a <strong>${size}</strong> translation model is downloaded once and kept in
         this browser, separately from the voice. You can delete either at any time.</p>
      <p>Machine translation is not a substitute for a human translation. It will get some
         sentences wrong.</p>
      ${warning}
      <p><small>Translation model:
        <a href="${MT_MODEL_URL}" target="_blank" rel="noopener">Opus-MT (English to ${name})</a>
        by the Helsinki-NLP group, licensed under ${terms}. Runtime code under MIT.</small></p>
      <p>
        <button type="button" data-act="accept">Download and translate</button>
        <button type="button" data-act="decline">Not now</button>
      </p>
    `);

    dialog.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      dialog.remove();
      resolve(act === 'accept');
    });
    dialog.querySelector('[data-act="accept"]').focus();
  });
}

/**
 * This device cannot translate as fast as it reads aloud. Ask what to do.
 *
 * Not an error dialog and deliberately not phrased as one: nothing has failed,
 * the machine is just slow, and both answers are reasonable. The two options are
 * the two real ones -- wait for the translation to get ahead, or listen in
 * English now. Refusing outright is not offered, because a reader who is willing
 * to wait should be allowed to; what is NOT offered is the third thing, playing
 * on and stalling mid-sentence, which is the outcome this dialog exists to
 * prevent.
 *
 * The measured rate is quoted in sentences per MINUTE. "0.4 sentences a second"
 * is a number nobody can picture; "about 24 sentences a minute" is a pace.
 *
 * @param {{language: string, rate: number|null}} options
 * @returns {Promise<'wait'|'english'>}
 */
export function chooseWhenSlow({ language, rate }) {
  return new Promise((resolve) => {
    const name = escapeHtml(language);
    // `rate` is null before the first batch has been timed. Saying nothing about
    // the speed is better than saying "null sentences a minute", and the choice
    // on offer does not depend on the number.
    // Kept on one line on purpose: a template literal preserves the newline and
    // the indentation after it, so wrapping this phrase puts a line break inside
    // "sentences a minute". The browser collapses it and a reader never notices;
    // anything reading textContent -- a test, a screen reader's buffer -- does.
    const pace = `<strong>${Math.round(rate * 60)} sentences a minute</strong>`;
    const measured = rate
      ? `<p>This device is translating about ${pace} — slower than the page is being `
        + 'read aloud, so the reading would keep stopping to wait.</p>'
      : '<p>This device is translating more slowly than the page is being read aloud, '
        + 'so the reading would keep stopping to wait.</p>';

    const dialog = card(`
      <h2>${name} is slow on this device</h2>
      ${measured}
      <p>You can wait for the translation to get ahead, or listen in English now.
         The ${name} model stays downloaded either way.</p>
      <p>
        <button type="button" data-act="english">Listen in English</button>
        <button type="button" data-act="wait">Wait for ${name}</button>
      </p>
    `);

    dialog.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      dialog.remove();
      resolve(act === 'english' ? 'english' : 'wait');
    });
    dialog.querySelector('[data-act="english"]').focus();
  });
}

/** @param {{title?: string}} options -- the voice and a translation model are
 * very different waits, and a bar that does not say which one it is describing
 * is a lie about what is happening. */
export function showProgress({ title = 'Preparing the voice' } = {}) {
  const dialog = card(`
    <h2 class="tts-progress-title"></h2>
    <p class="tts-progress-file">Starting…</p>
    <progress class="tts-progress-bar" max="100" value="0"></progress>
    <p><button type="button" data-act="cancel">Cancel</button></p>
  `);
  // textContent, not interpolation: the title carries a language name that comes
  // from data, and every other string in this file that does is escaped too.
  dialog.querySelector('.tts-progress-title').textContent = title;
  const fileLabel = dialog.querySelector('.tts-progress-file');
  const bar = dialog.querySelector('.tts-progress-bar');
  let cancelled = false;
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-act="cancel"]')) { cancelled = true; dialog.remove(); }
  });
  return {
    update({ file, loaded, total, phase }) {
      fileLabel.textContent = phase === 'verify' ? `Checking ${file}…` : `Downloading ${file}…`;
      bar.value = total ? Math.round((loaded / total) * 100) : 0;
    },
    cancelled: () => cancelled,
    close: () => dialog.remove(),
  };
}

export function showError(message) {
  const dialog = card(`
    <h2>The voice could not start</h2>
    <p class="tts-error-message"></p>
    <p><button type="button" data-act="ok">Close</button></p>
  `);
  // textContent, not interpolation: the message can carry an engine string.
  dialog.querySelector('.tts-error-message').textContent = message;
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-act="ok"]')) dialog.remove();
  });
  return { close: () => dialog.remove() };
}

export function confirmDelete({ what = 'voice' } = {}) {
  return new Promise((resolve) => {
    const subject = escapeHtml(what);
    const dialog = card(`
      <h2>Delete the stored ${subject}?</h2>
      <p>The ${subject} model will be removed from this browser. You can download it again later.</p>
      <p>
        <button type="button" data-act="yes">Delete</button>
        <button type="button" data-act="no">Keep it</button>
      </p>
    `);
    dialog.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      dialog.remove();
      resolve(act === 'yes');
    });
  });
}
