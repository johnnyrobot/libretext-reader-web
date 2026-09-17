/* Measure synthesis RTF on ANY machine, with nothing installed.
 *
 *   1. On the machine under test, open a page that carries the reader:
 *      https://library.libretexts.dev/social_psychology/13%3A_Competition_and_Cooperation_in_Our_Social_Worlds/13.01%3A_Conflict_Cooperation_Morality_and_Fairness/
 *   2. Open DevTools (F12, or Ctrl+Shift+J / Cmd+Opt+J) -> Console.
 *   3. Chrome may require you to type `allow pasting` once before it accepts a paste.
 *   4. Paste this whole file, press Enter, then run:   await rtf()
 *   5. Copy the JSON it prints.
 *
 * Nothing is downloaded that the reader would not download anyway, and nothing is
 * written to the page. First run fetches ~380 MB of model weights, so use a
 * connection you do not mind and expect a wait before the first number appears.
 *
 * It drives the DEPLOYED worker, unmodified, on real sentences from the page's
 * own speech.json, so it needs no local checkout and no model download beyond
 * what the reader would fetch anyway.
 *
 * WHY NOT CPU THROTTLING: DevTools' CPU throttle applies to the MAIN THREAD ONLY.
 * All synthesis happens in a worker, and ONNX Runtime's wasm threads are workers
 * of that worker, so the throttle never reaches any of them. Measured: 4.19x on
 * the main thread, 1.04x in the worker. Real hardware is the only way to answer it.
 * Real hardware is the only way to answer this.
 */
window.rtf = async function rtf(n = 6) {
  const t0 = performance.now();
  const man = await (await fetch('speech.json')).json();
  const sents = man.blocks.flatMap((b) => b.sentences)
    .filter((s) => s.speech && s.speech.length > 60).slice(0, n);
  if (!sents.length) throw new Error('no sentences on this page - is it an in-scope page?');

  const w = new Worker('/_assets/tts/engine.worker.js', { type: 'module' });
  const rows = [];
  await new Promise((resolve, reject) => {
    let i = 0, started = 0;
    const next = () => { started = performance.now(); w.postMessage({ type: 'synth', id: String(i), text: sents[i].speech }); };
    w.onmessage = ({ data }) => {
      if (data.type === 'ready') return next();
      if (data.type === 'error') return reject(new Error(data.message));
      if (data.type !== 'audio') return;                 // progress etc.
      const wall = (performance.now() - started) / 1000;
      const audio = data.samples.length / data.sampleRate;
      rows.push({ chars: sents[i].speech.length, audioS: +audio.toFixed(2), wallS: +wall.toFixed(2), rtf: +(wall / audio).toFixed(3) });
      i += 1;
      if (i >= sents.length) return resolve();
      next();
    };
    w.onerror = (e) => reject(new Error(e.message || 'worker failed'));
    w.postMessage({ type: 'init', voice: 'M1', lang: man.lang || 'en', manifestUrl: '/_assets/tts/manifest.json' });
  });
  w.terminate();

  const sorted = rows.map((r) => r.rtf).sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const result = {
    medianRTF: median,
    worstRTF: sorted[sorted.length - 1],
    // 0.500 is the budget, and it is a judgement value chosen by a human. The
    // correct response to failing hardware is a faster model, never a friendlier
    // threshold. WORST case is what decides whether playback stalls -- the
    // 4-sentence lookahead absorbs a slow sentence, not a slow machine.
    gateOnMedian: median < 0.5 ? 'PASS' : 'FAIL',
    gateOnWorst: sorted[sorted.length - 1] < 0.5 ? 'PASS' : 'FAIL',
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory || 'not reported',
    crossOriginIsolated: self.crossOriginIsolated,   // false => single-threaded => ~2x worse
    platform: navigator.userAgentData?.platform || navigator.platform,
    ua: navigator.userAgent,
    elapsedS: +((performance.now() - t0) / 1000).toFixed(1),
    rows,
  };
  console.table(rows);
  console.log(JSON.stringify(result, null, 1));
  return result;
};
console.log('ready - now run:  await rtf()');
