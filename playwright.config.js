import { defineConfig } from '@playwright/test';

// TWO WAYS IN, AND THEY SERVE DIFFERENT THINGS.
//
// `TTS_BASE_URL` set   -- something upstream has already built this revision and is
//   serving it. Use that origin and start nothing.
// `TTS_BASE_URL` unset -- a person ran `npx playwright test` by hand. Serve `.stage`,
//   the copy scripts/stage-local.sh builds, on the fixed port below.
//
// THE VARIABLE IS LOAD-BEARING AND ITS ABSENCE IS SILENT. An automated caller rebuilds
// the code under test before serving it; `.stage` is whatever a person last built, and
// it can be days old. Falling back to it would run all thirteen tests green against a
// revision nobody asked about, and the suite would look strictly better while measuring
// something else entirely. That is why `dist/` is rebuilt rather than reused, one layer
// down, and tests/ pins both halves of this.
//
// The two stages are NOT interchangeable, which is the other reason not to guess: an
// upstream origin serves a revision somebody built on purpose, `.stage` serves whatever
// is on this disk.
//
// This paragraph used to say something else, and it was wrong in a way worth recording.
// It said `.stage`'s chem101 "carries boot.js" so the out-of-scope assertion fails there
// for a fixture reason, and that "an automated run stages
// pipeline/tests/fixtures/prose.html, unprocessed". The first half was true and is now
// fixed at the source -- stage-local.sh un-injects the fetched page before copying it
// into the out-of-scope book -- and the second half described a runner that does not
// exist in this repo: nothing stages prose.html, and `.stage` is the only way these
// tests have ever been run. A known-failing assertion explained by an imaginary green
// path is worse than a failing assertion, because it stops anyone from fixing it.
const GATE_BASE = process.env.TTS_BASE_URL;
const PORT = 8788;

export default defineConfig({
  testDir: 'tests/e2e',
  // Synthesis is genuinely multi-second, and a cold session creation loads
  // 380 MB from disk. These are real durations, not slack.
  timeout: 300_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: GATE_BASE || `http://127.0.0.1:${PORT}`,
    // The RTF gate passes only under cross-origin isolation (0.410 against
    // 0.912). Running the e2e suite without it would measure the wrong thing.
    launchOptions: { args: ['--enable-features=SharedArrayBuffer'] },
  },
  // Spread, not a `skip` flag: Playwright starts a webServer whenever the key is
  // present, so the key has to be absent rather than falsy.
  ...(GATE_BASE ? {} : {
    webServer: {
      command: `.venv/bin/python scripts/serve-local.py --root .stage --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}/_assets/tts/boot.js`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  }),
});
