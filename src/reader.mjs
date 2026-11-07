import { createEngine } from './engine.mjs';
import { createListenEngine } from './listen-engine.mjs';
import { createPlayer } from './player.mjs';
import { mountSentences, unmountSentences, setCurrent, markSkipped } from './highlight.mjs';
import { openOverlay, closeOverlay, ensureStylesheet } from './overlay.mjs';
import { mountControls } from './controls.mjs';
import {
  requestConsent, requestTranslationConsent, showProgress, showError, confirmDelete,
  chooseWhenSlow,
} from './consent.mjs';
import { savePosition, loadPosition } from './position.mjs';
import {
  modelsPresent, deleteModels, checkQuota, checkQuotaFor, removeRetiredCaches,
  MT_CACHE_NAME, PHONON_CACHE_NAME,
} from './models.mjs';
import { createTranslator, hostedPairs, translationStored } from './translator.mjs';
import { createTranslationQueue, MIN_RATE } from './translate-queue.mjs';
import { referenceSentenceIds } from './qa.mjs';
import { substituteMathSpeech } from './math-speech.mjs';

// Phonon 31M: the English voice, the one every reader downloads.
const PHONON_MANIFEST_URL = '/_assets/tts/phonon/manifest.json';
const PHONON_WORKER_URL = '/_assets/tts/phonon.worker.js';

// The voices that speak translations: each language's own Phonon 40M (CC BY-NC
// 4.0), exported from Johnny's Ollama copies and staged into phonon-<lang>/ by
// scripts/stage-phonon-lang.py (LT-216). The model speaks both voices: its own
// Male voice, and a Female voice file from Gradium's Apache 2.0 phonon-voices
// (LT-222, LT-234). Each is downloaded only
// when its language is first picked, run by the same worker as English, and
// cached beside it. Supertonic is gone, with no fallback (LT-217).
export const TRANSLATION_VOICES = Object.freeze(Object.fromEntries(['fr', 'de', 'es', 'pt'].map((lang) => [
  lang,
  Object.freeze({
    workerUrl: PHONON_WORKER_URL,
    manifestUrl: `/_assets/tts/phonon-${lang}/manifest.json`,
    cacheName: PHONON_CACHE_NAME,
  }),
])));

// Endonyms: the reader who wants Spanish reads Spanish. Also the allowlist of
// what Listen mode speaks besides English (LT-217): a hosted pair for any other
// language is never offered.
const LANGUAGE_LABELS = { es: 'español', fr: 'français', de: 'Deutsch', pt: 'português' };

/** The hosted translations a reader is offered: those in LANGUAGE_LABELS that
 * have a voice in `voices` to speak them. */
export function offeredPairs(pairs, voices) {
  return pairs.filter((p) => p.code in LANGUAGE_LABELS && p.code in voices);
}

let session = null;
// The entry still in progress. `session` is set only at the very end of entering,
// after the consent dialog and the download, so on its own it lets a second press
// start a second entry and stack a second dialog (LT-223).
let entering = null;

async function loadSpeechManifest() {
  const res = await fetch(new URL('speech.json', location.href).pathname);
  if (!res.ok) throw new Error('This page has no reading list.');
  return res.json();
}

/** One language's entry in the menu. Its size includes the translation voice
 * until that is stored, and it says "downloaded" only once nothing is left to
 * fetch: the language's model AND the voice (LT-214). `voiceBytes` is null when
 * the voice could not be sized: it is left out, and never reads as stored. */
export function languageOption({ code, bytes }, modelStored, voiceBytes) {
  return { code, label: LANGUAGE_LABELS[code], bytes: bytes + (voiceBytes ?? 0), stored: modelStored && voiceBytes === 0 };
}

/**
 * Switch the speaking voice mid-page.
 *
 * ORDER IS THE WHOLE FUNCTION, and it took two attempts to get right.
 *
 * The player caches synthesised audio and `request()` skips any sentence already
 * in that cache, so changing voice has to invalidate it or the lookahead's
 * already-rendered sentences keep playing in the previous voice. That much was
 * the first fix.
 *
 * What the first fix got wrong was putting `flushAudio()` AFTER
 * `await engine.setVoice(voice)`. The synthesis worker is single threaded and
 * processes messages in order, so setVoice queues behind whatever sentence it is
 * already rendering -- measured on the live page, `voiceSet` came back many
 * seconds later. In that window the pre-switch synthesis completes and is written
 * into the cache, legitimately, because the epoch has not been bumped yet. The
 * reader presses play and hears the voice they just changed away from.
 *
 * So the flush is synchronous and first. Posting setVoice before any new synth
 * request still holds -- the worker applies messages in order -- so the next
 * sentence is rendered in the new voice even if the reader presses play while
 * this promise is still pending.
 *
 * Exported because the ordering is the contract, and a contract nothing can test
 * is a comment. See tests/reader-voice.test.js.
 */
export function changeVoice(player, engine, voice) {
  player.pause();
  player.flushAudio();
  return engine.setVoice(voice);
}

/**
 * Switch the spoken language mid-page.
 *
 * Same hazard as changeVoice, plus one. The worker is single threaded and applies
 * messages in order, so `setLang` queues behind whatever sentence it is already
 * rendering; in that window the pre-switch synthesis completes and is written into
 * the cache legitimately. So the flush is synchronous and first.
 *
 * The extra hazard is the text itself. `player.request()` reads `sentence.speech`
 * at the moment it posts a synth message, so the swap must also land before any new
 * request -- otherwise the first sentence after the switch is rendered from the old
 * language's text under the new language's tag, which sounds like neither.
 *
 * `speechById` may be sparse: any id it omits keeps its English text, so a
 * sentence that could not be translated is spoken in English rather than skipped.
 * Client-side the map arrives dense, with the English source already filled in
 * for lines whose protected spans did not survive (see translateBatch); the
 * sparse contract still holds and is still what makes that safe. Pass `{}` to
 * return to English.
 *
 * Exported because the ordering is the contract. See tests/reader-voice.test.js.
 */
export function changeLanguage(player, engine, lang, speechById) {
  player.pause();
  player.flushAudio();
  player.setSpeechText(speechById);
  return engine.setLang(lang);
}

/** Percent of one file, for the download message. Whole numbers only; a
 * fractional percent on a 115 MB file changes faster than anyone can read. */
function percent({ loaded, total }) {
  return total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
}

/**
 * Recover from a failed language switch: put the reader back in English and
 * report the failure -- guaranteed, even if the recovery itself fails too.
 *
 * GUARDED ON PURPOSE. The recovery is not failure-free: exitReaderMode()
 * mid-switch terminates the engine, so this recovery's own engine.setLang('en')
 * posts to an already-terminated worker and never settles at all; and
 * changeLanguage's very first line, player.pause(), is not failure-free either
 * (stopSource() leaves source.disconnect() unguarded, so e.g. a closed
 * AudioContext throws there too). Either one would otherwise escape uncaught --
 * onLang is fire-and-forget from controls.mjs, so an unhandled rejection here
 * means NOTHING is ever shown to the reader, which is worse than the ordinary
 * single-failure case this exists to handle. Do not simplify this back to a
 * bare `await changeLanguage(...)`.
 *
 * Exported so the guarantee -- the ORIGINAL error always gets reported, exactly
 * once, regardless of what the recovery does -- can be tested directly. See
 * tests/reader-voice.test.js.
 */
export async function recoverToEnglish(player, engine, controls, error, reportError) {
  // Put the menu back where the reader can see what is actually playing.
  // A menu showing Spanish while English plays is worse than an error.
  controls.setLang('en');
  try {
    await changeLanguage(player, engine, 'en', {});
  } catch {
    // Recovery failed too. There is nothing more useful to do than report the
    // ORIGINAL error below rather than this second one.
  } finally {
    reportError(String(error?.message ?? error));
  }
}

/**
 * The language menu's handler: put the page into `lang`, or back into English.
 *
 * ENGLISH STOPS FIRST. Left playing, its lookahead keeps synthesising on the same
 * cores the translator needs for the whole wait: on the local copy German took
 * over 100 s and ended on "Deutsch is slow on this device", against about 15 s
 * paused. So the switch pauses and drops pending audio before anything prepares.
 * That costs nothing: changeLanguage drops the English audio anyway, and the
 * reader ended paused on every path before this too.
 *
 * A LATER PICK WINS. A cancelled download or voice load keeps running, so the
 * menu is usable again before an earlier pick settles. `current()` says whether
 * this pick is still the latest; once it is not, this call returns without
 * touching the menu, the voice, the status line or the error box, all of which
 * belong to the newer pick (LT-217).
 *
 * Exported so the order can be tested. See tests/reader-voice.test.js.
 */
export async function switchLanguage(lang, {
  player, engine, controls, startTranslating, stopTranslating, startStreaming, reportError,
  current = () => true,
}) {
  let superseded = false;
  try {
    // Whatever was being translated is for a language the reader has just
    // left. Stopping FIRST also means a failure below cannot leave a queue
    // running against a language nothing is listening to.
    stopTranslating();

    if (lang === 'en') {
      await changeLanguage(player, engine, 'en', {});
      if (!current()) superseded = true;
      return;
    }

    player.pause();
    player.flushAudio();
    const ready = await startTranslating(lang, current);
    if (!current()) { superseded = true; return; }
    if (ready === null) {
      // Declined, or cancelled mid-download, or told the device is too slow
      // and picked English. Not an error: they answered the question. Put
      // the page and the menu back in the language that is actually playing,
      // silently.
      //
      // Stopped HERE rather than at each of the three places that return
      // null, because only the slow-device one has a queue running by then
      // and the next one added might too -- and a queue left running
      // translates a book nobody is listening to, which is the exact battery
      // cost the window bound exists to avoid.
      stopTranslating();
      await changeLanguage(player, engine, 'en', {});
      if (!current()) { superseded = true; return; }
      controls.setLang('en');
      return;
    }
    await changeLanguage(player, engine, lang, ready);
    if (!current()) { superseded = true; return; }
    startStreaming();
  } catch (error) {
    // Most likely the newer pick tore this one's queue or voice down.
    if (!current()) { superseded = true; return; }
    stopTranslating();
    await recoverToEnglish(player, engine, controls, error, reportError);
  } finally {
    // Clear the progress line on BOTH paths. Leaving "Translating into
    // español…" up after a failure says the opposite of what the error says.
    if (!superseded) controls.setState({ playing: false, buffering: false, message: '' });
  }
}

export function enterReaderMode() {
  if (session) return Promise.resolve();
  // Cleared however entering ends -- declined, cancelled or failed -- so the
  // button still works the next time it is pressed.
  entering ??= runEntry().finally(() => { entering = null; });
  return entering;
}

async function runEntry() {
  const manifest = await loadSpeechManifest();
  const root = document.getElementById('main-content');
  if (!root) return;

  // Before the consent gate, not after it. The consent dialog is styled by the
  // same stylesheet, and loading it afterwards renders the first thing a reader
  // ever sees as an unstyled block at the foot of the page -- with focus()
  // scrolling them into the bibliography to reach the button.
  //
  // This still costs a visitor who never presses the button nothing: it runs
  // only from enterReaderMode, which only a click reaches.
  ensureStylesheet();

  // A reader from before LT-217 may still hold Supertonic's ~380 MB.
  removeRetiredCaches().catch(() => {});

  if (!(await modelsPresent(PHONON_MANIFEST_URL, PHONON_CACHE_NAME))) {
    const { required, sufficient } = await checkQuota(PHONON_MANIFEST_URL);
    if (!(await requestConsent({ requiredBytes: required, quotaSufficient: sufficient }))) return;
    await navigator.storage?.persist?.();
  }

  openOverlay();

  // Blocks the manifest no longer describes are dropped rather than
  // mis-highlighted (design spec S6). Count them so the state is visible.
  let staleBlocks = 0;
  const elements = mountSentences(root, manifest.blocks, { onDrop: () => { staleBlocks += 1; } });

  // Only sentences that actually mounted are listenable. Reading a sentence
  // aloud while nothing highlights is worse than skipping it, and a notice
  // block has no DOM text to highlight at all.
  // `display` rides along unused by the player, for the translator: the
  // build-time pipeline translates sentence.display, NOT sentence.speech, and it
  // is right to. `speech` has already been through the ENGLISH spoken-form pass,
  // so translating it yields Spanish sentences containing English number words.
  // It is also what makes step 9's diff against the build-time tracks comparable
  // at all -- same source text, same ids.
  const sentences = manifest.blocks.flatMap((block) =>
    block.sentences
      .filter((s) => elements.has(s.id))
      // `||`, not `??`. A `notice` block carries `display: ""` -- present and
      // empty, not absent -- so `??` keeps the empty string and hands the
      // translator nothing. Unreachable from here today, because mountSentences
      // drops notice blocks and this list is filtered by what mounted; reachable
      // the moment any block type arrives with an empty display. The oracle-diff
      // harness made exactly this mistake and produced 146 sentences of
      // convincing-looking garbage. pipeline/translate.source_sentences uses
      // `or` for the same reason.
      .map((s) => ({ id: s.id, speech: s.speech, display: s.display || s.speech })));

  if (!sentences.length) {
    closeOverlay();
    showError('Nothing on this page could be matched to the reading list.');
    return;
  }

  // English on Phonon 31M; a language's voice is created only when it is picked.
  const engine = createListenEngine({
    english: createEngine({ workerUrl: PHONON_WORKER_URL, manifestUrl: PHONON_MANIFEST_URL }),
    createOther: (lang) => createEngine(TRANSLATION_VOICES[lang]),
  });
  const progress = showProgress();
  let provider = 'wasm';
  try {
    // No lang: the page is always read in English first. pipeline/tts_manifest.py
    // never passes one, so every manifest says 'en'; a non-English source book
    // would need its own engine route before it could ship.
    ({ provider } = await engine.init({
      voice: 'M1',
      onProgress: (p) => progress.update(p),
    }));
  } catch (error) {
    progress.close();
    engine.terminate();
    // Put the page back here and on a cancel below, as exitReaderMode does:
    // wrapped sentences left behind fail the next entry with "Nothing on this
    // page could be matched to the reading list" (LT-223).
    unmountSentences(elements);
    closeOverlay();
    showError(String(error?.message ?? error));
    return;
  }
  progress.close();

  // A cancel must leave nothing running (design spec 8.5). ONNX Runtime cannot
  // abort a load in flight, so the honest behaviour is to finish the load and
  // then tear it down rather than to pretend it stopped early.
  if (progress.cancelled()) {
    engine.terminate();
    unmountSentences(elements);
    closeOverlay();
    return;
  }

  // Which languages this DEPLOYMENT can translate into, not which tracks this
  // PAGE has: with translation client-side there are no tracks on disk, so
  // manifest.languages describes something that no longer exists.
  const pairs = offeredPairs(await hostedPairs(), TRANSLATION_VOICES);

  /** Which of them are already downloaded -- a cache lookup, and the difference
   * between "starts in three seconds" and "starts after a 40 MB download".
   *
   * Costs nothing on the common path: modelsPresent checks caches.has() before
   * caches.open(), so a reader who has never downloaded a language does not even
   * fetch a manifest here, and no cache entry is created by the asking. */
  // A lookup that fails counts as "not stored": the menu then quotes a download
  // and picking the language asks first, which is the safe way to be wrong, and
  // a failed fetch here cannot stop an English reader.
  const stored = await Promise.all(pairs.map((p) => translationStored(p.pair).catch(() => false)));

  /** A language's voice download, 0 once it is stored. That language's size
   * includes it until then, in the menu and in the dialog alike. It fetches the
   * voice's manifest (a few KB), never its weights. */
  async function translationVoiceBytes(lang) {
    const { manifestUrl, cacheName } = TRANSLATION_VOICES[lang];
    if (await modelsPresent(manifestUrl, cacheName)) return 0;
    return (await checkQuota(manifestUrl)).required;
  }
  // Only the menu needs these now, so a manifest that will not load must not
  // stop an English reader: that size is unknown (null) until consent asks again.
  const voiceBytes = Object.fromEntries(await Promise.all(pairs.map(async (p) =>
    [p.code, await translationVoiceBytes(p.code).catch(() => null)])));
  const modelStored = new Set(pairs.filter((p, i) => stored[i]).map((p) => p.code));

  let translator = null;
  let controls;
  let queue = null;
  // Batches land while the reader is still in English -- the queue starts before
  // the swap so the prefix can be ready when it happens. Until the swap, results
  // accumulate in the queue and go nowhere near the player, or the engine would
  // be asked to speak Spanish text under an English tag.
  let streaming = false;

  const positionOf = new Map(sentences.map((s, i) => [s.id, i]));

  /**
   * Ask before downloading a language, and only when there is something to
   * download. Resolves false if the reader says no.
   *
   * A SECOND gate on purpose. Accepting 155 MB for a voice is not accepting
   * another 40 MB for Spanish: different model, different licence, and quite
   * possibly a different day. The size and licence come from pairs.json, which is
   * why they are recorded there -- naming a size means knowing it BEFORE
   * fetching anything of the model's.
   */
  async function consentToDownload(hosted) {
    // modelsPresent must not create the cache just by asking (models.mjs's
    // invariant, tested): a reader who declines leaves nothing behind.
    const voice = voiceBytes[hosted.code] = await translationVoiceBytes(hosted.code);
    if (!voice && await translationStored(hosted.pair)) return true;

    // The translation model's size is stated even in the rare case it is stored
    // and only the voice is missing (a reader who deleted the voice): it then
    // over-states, never under-states, what is fetched.
    const { sufficient } = await checkQuotaFor(hosted.bytes + voice);
    const accepted = await requestTranslationConsent({
      language: LANGUAGE_LABELS[hosted.code],
      requiredBytes: hosted.bytes,
      quotaSufficient: sufficient,
      licence: hosted.licence ?? 'a permissive licence',
      voiceBytes: voice,
    });
    if (accepted) await navigator.storage?.persist?.();
    return accepted;
  }

  /**
   * Start translating around the cursor and resolve once enough is ready to play.
   *
   * Returns the SPARSE map of what is translated so far -- everything else stays
   * English, which is the contract `setSpeechText` already has. The queue keeps
   * running afterwards and upgrades sentences in place through
   * `player.updateSpeechText`, which is why that function exists.
   *
   * Returns null when the reader declined the download. That is not an error and
   * must not be reported as one -- they answered the question.
   *
   * Playback does not start in English and improve. A reader who picked Spanish
   * and hears five English sentences reads that as broken, not as loading.
   *
   * Also returns null once `current()` says the reader has picked again, at
   * each wait, so a superseded pick neither replaces the newer pick's voice
   * nor starts a queue for it.
   */
  async function startTranslating(lang, current = () => true) {
    const hosted = pairs.find((p) => p.code === lang);
    if (!hosted) throw new Error(`This reader has no ${LANGUAGE_LABELS[lang] ?? lang} translation.`);
    const label = LANGUAGE_LABELS[hosted.code];

    if (!(await consentToDownload(hosted)) || !current()) return null;

    // TWO waits, told apart deliberately. A 40 MB download gets the same modal
    // progress bar the voice gets, because it is the same kind of wait and can
    // be cancelled. Translation gets the status line, because it is seconds and
    // the reader is already looking at a working page. One bar meaning both
    // would be a lie about which is happening.
    translator ??= createTranslator();
    const download = showProgress({ title: `Preparing ${label}` });
    try {
      await translator.init({ pair: hosted.pair, onProgress: (p) => download.update(p) });
    } finally {
      download.close();
    }
    // The menu said "230 MB download" a moment ago and it is no longer true.
    // Repainted rather than rebuilt: the reader is looking at this select right
    // now, and rebuilding it would drop their selection.
    modelStored.add(hosted.code);
    controls.setLanguageStored(hosted.code, !voiceBytes[hosted.code]);
    // The worker cannot abort a load in flight, so the honest behaviour is the
    // same as the voice's: finish the load, then stop. What was downloaded stays
    // cached -- cancel means "not now", not "undo the consent I just gave".
    if (download.cancelled() || !current()) return null;

    // This language's voice, loaded when it is picked and kept until another
    // language replaces it.
    if (!engine.prepared(lang)) {
      const voiceLoad = showProgress({ title: `Preparing the ${label} voice` });
      try {
        await engine.prepare(lang, { onProgress: (p) => voiceLoad.update(p) });
      } finally {
        voiceLoad.close();
      }
      if (voiceBytes[lang]) {
        voiceBytes[lang] = 0;
        controls.setLanguageBytes(lang, hosted.bytes);
        if (modelStored.has(lang)) controls.setLanguageStored(lang, true);
      }
      if (voiceLoad.cancelled() || !current()) return null;
    }

    const report = (p) => controls.setState({
      playing: false,
      buffering: true,
      message: `Translating into ${label} (${percent(p)}%)`,
    });

    controls.setState({ playing: false, buffering: true, message: `Translating into ${label}…` });

    // Kept local: a newer pick can replace or clear the shared `queue` while
    // this one is still starting.
    const q = createTranslationQueue({
      sentences,
      // A bibliography is not translated: author surnames, journal titles and
      // years are proper nouns, and the real checkpoint renamed a journal
      // (`Psychological Science` -> `Ciencia Psicologica`) and an author
      // (`Sidanius` -> `Sidanio`) when it was allowed to try. This is the
      // structural half of what survives of the build-time QA gate; the
      // sentence-level half lives in translate.worker.mjs.
      //
      // Computed off `manifest.blocks` rather than off `sentences`, because the
      // rule is about a HEADING and where it sits in the document, and
      // `sentences` has already dropped every block that did not mount.
      skip: referenceSentenceIds(manifest.blocks),
      // Translated lines come back with the MATH token restored verbatim; the
      // words for it live in the manifest (see src/math-speech.mjs).
      translate: async (lines) => (await translator.translate(lines))
        .map((line) => substituteMathSpeech(line, manifest.mathSpeech)),
      cursor: () => positionOf.get(player.currentId()) ?? 0,
      onBatch: (partial) => { if (streaming) player.updateSpeechText(partial); },
      onProgress: (p) => report({ phase: 'translate', loaded: p.ahead, total: p.window }),
      // Only reachable AFTER the prefix resolved -- before that the rejected
      // prefix is the failure and onLang's catch handles it. Here the reader is
      // already listening in Spanish, so tearing the page back to English would
      // be a bigger disruption than the untranslated remainder. Say what
      // happened, keep what works.
      onError: (error) => {
        if (!streaming) return;
        queue = null;
        showError(`Translation stopped: ${String(error?.message ?? error)}`);
      },
      // The translator has lost the race while the reader was listening. Pause
      // FIRST, then ask: carrying on until the dialog is answered is the stall
      // this exists to prevent, and it would happen behind the dialog where the
      // reader cannot see why the audio stopped.
      onFallingBehind: async (measured) => {
        if (!streaming) return;
        const wasPlaying = player.isPlaying();
        if (wasPlaying) player.pause();
        controls.setState({ playing: false, buffering: true, message: `Waiting for ${label}…` });
        if (await chooseWhenSlow({ language: label, rate: measured.rate }) === 'english') {
          // The reader ANSWERED a question; nothing failed. So this is the quiet
          // path back to English, not recoverToEnglish -- which reports an error
          // and would tell them something went wrong when they made a choice.
          stopTranslating();
          await changeLanguage(player, engine, 'en', {});
          controls.setLang('en');
          controls.setState({ playing: false, buffering: false, message: '' });
          if (wasPlaying) await player.play();
          return;
        }
        // Waiting means waiting for the window to refill, not resuming into the
        // same silence they just chose to sit through.
        await queue?.ready();
        controls.setState({ playing: false, buffering: false, message: '' });
        if (wasPlaying) await player.play();
      },
    });

    queue = q;
    await q.start();
    if (!current()) return null;

    // The prefix wait was a real measurement of THIS device on THIS page, and it
    // is the only one available before a word is spoken. A device that cannot
    // keep up is told so now rather than three sentences into a reading that
    // will keep stopping -- refusing to start beats starting and stalling.
    const measured = q.status();
    if (measured.rate !== null && measured.rate < MIN_RATE
        && await chooseWhenSlow({ language: label, rate: measured.rate }) === 'english') {
      return null;
    }
    return q.textById();
  }

  /**
   * Move the cursor, and do not start speaking until the text there is ready.
   *
   * The same rule as the initial switch, applied to the only other place the
   * cursor jumps. Without it a reader who clicks a paragraph in chapter 9 hears
   * one English sentence first: the queue re-prioritises the moment the cursor
   * moves, but `player.request()` is already synthesising, and
   * `updateSpeechText` deliberately will not cut audio out from under a
   * sentence that has started.
   *
   * It pauses, so it puts the reader back where it found them. `queue.ready()`
   * never rejects, so a failed queue produces English audio rather than a player
   * that will not start.
   */
  async function seekAndCatchUp(id) {
    const resume = player.isPlaying();
    if (resume) player.pause();
    await player.seekTo(id);
    if (streaming && queue) {
      await queue.ready();
      // Clear the catch-up message explicitly. Resuming would clear it as a side
      // effect of the player reporting state, but a reader who was PAUSED when
      // they clicked gets no such event and would be left staring at
      // "Translating into español (100%)" with nothing happening.
      controls.setState({ playing: false, buffering: false, message: '' });
    }
    if (resume) await player.play();
  }

  let langTurn = 0;

  function stopTranslating() {
    streaming = false;
    queue?.stop();
    queue = null;
  }

  const player = createPlayer({
    engine,
    sentences,
    onSentenceChange: (id) => {
      setCurrent(elements, id);
      if (id) savePosition(manifest.pageId, id);
      // Every cursor move, including a seek: the queue schedules against the
      // cursor, so it has to be told the cursor moved. Cheap and idempotent, so
      // it is called from the one place all of them go through rather than from
      // each of play, next, prev and seekTo.
      queue?.wake();
    },
    onStateChange: (state) => controls?.setState(state),
    // Phonon's length guard skipped it rather than play nonsense (LT-214).
    onSentenceSkipped: (id) => markSkipped(elements, id),
  });

  controls = mountControls(document.body, {
    // Play waits for the window at the cursor too, not just a seek. Otherwise a
    // reader who clicks a paragraph and immediately presses play beats
    // seekAndCatchUp's own wait to it and hears the English they would have
    // heard without any of this. ready() resolves synchronously when the window
    // is already full, so the ordinary case costs nothing.
    onPlay: async () => {
      if (streaming && queue) await queue.ready();
      await player.play();
    },
    onPause: () => player.pause(),
    onNext: () => player.next(),
    onPrev: () => player.prev(),
    onVoice: (voice) => changeVoice(player, engine, voice),
    onRate: (rate) => player.setRate(rate),
    onExit: () => exitReaderMode(),
    // `pairs` is already offeredPairs(): only codes in LANGUAGE_LABELS reach
    // controls.mjs's unescaped bar.innerHTML, and only languages a voice can
    // speak reach the menu. pairs.json is written by our own script today,
    // which is exactly the kind of assumption that stops being true quietly.
    languages: pairs.map((p) => languageOption(p, modelStored.has(p.code), voiceBytes[p.code])),
    // Each pick is numbered so an earlier one still loading knows it has been
    // replaced (see switchLanguage).
    onLang: (lang) => {
      const turn = ++langTurn;
      return switchLanguage(lang, {
        player, engine, controls, startTranslating, stopTranslating,
        current: () => turn === langTurn,
        // Only now may batches reach the player: before the swap the engine is
        // still tagged English. Anything that landed during the swap is in the
        // queue but not in the player, so one catch-up call rather than a race to
        // get the ordering right.
        startStreaming: () => { streaming = true; player.updateSpeechText(queue.textById()); },
        reportError: showError,
      });
    },
  });
  controls.setProvider(provider);

  // The timing budget is met only under cross-origin isolation: 0.410 RTF isolated
  // against 0.912 without. A header misconfiguration doubles RTF and reads as
  // a broken feature rather than a broken deploy, so say which one it is.
  if (!self.crossOriginIsolated) {
    controls.setState({
      playing: false,
      buffering: true,
      message: 'Single-threaded — audio may not keep up',
    });
  } else if (staleBlocks) {
    controls.setState({
      playing: false,
      buffering: true,
      message: `${staleBlocks} paragraph${staleBlocks === 1 ? '' : 's'} changed since this page was built`,
    });
  }

  function onSentenceClick(event) {
    const id = event.target.closest('.tts-sentence')?.dataset.ttsId;
    if (id) seekAndCatchUp(id);
  }
  root.addEventListener('click', onSentenceClick);

  const resumeAt = loadPosition(manifest.pageId);
  if (resumeAt && elements.has(resumeAt)) {
    await player.seekTo(resumeAt);
    setCurrent(elements, resumeAt);
  }

  // `translator` is read through the closure rather than captured by value:
  // it does not exist yet for a reader who never leaves English, and it must
  // still be torn down for one who does.
  session = {
    engine, player, controls, root, onSentenceClick, elements,
    disposeTranslation: () => { stopTranslating(); translator?.terminate(); },
  };
}

export function exitReaderMode() {
  if (!session) return;
  session.root.removeEventListener('click', session.onSentenceClick);
  session.player.dispose();
  session.controls.destroy();
  session.engine.terminate();
  session.disposeTranslation();
  setCurrent(session.elements, null, { scroll: false });
  // AND PUT THE PAGE BACK. Everything above releases something we own; this is
  // the only line that undoes something we did to the reader's document. Leaving
  // the sentence spans behind made the next entry fail with "Nothing on this page
  // could be matched to the reading list" -- our own leftover state, reported as
  // a problem with their page.
  unmountSentences(session.elements);
  closeOverlay();
  session = null;
}

export { deleteModels, confirmDelete, MT_CACHE_NAME, PHONON_CACHE_NAME };
