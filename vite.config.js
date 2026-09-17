import { readFileSync, statSync } from 'node:fs';
import { defineConfig } from 'vite';

const BOOT_BYTE_CAP = 1024;

/**
 * Emit `src/boot.js` and `src/reader.css` as plain files.
 *
 * **boot.js is deliberately not bundled.** It has no static imports -- the one
 * dynamic import names a deployed URL the browser resolves at runtime -- so
 * bundling buys nothing and costs a lot: Vite wraps any dynamic import in its
 * `__vitePreload` helper (modulepreload detection, CSP nonce lookup, a
 * preload-error event), roughly 850 bytes of machinery for a single import of a
 * known URL. That alone pushed boot.js past NF1's 1 KB cap, and
 * `build.modulePreload: false` does not remove it. Copying the file verbatim
 * does, and it keeps the one script a non-user runs legible to anyone
 * inspecting the mirror.
 *
 * **reader.css cannot be `import './reader.css'` either.** Vite emits an entry
 * chunk's CSS as a separate asset and expects an HTML file to link it; there is
 * no HTML file here, so the stylesheet would be built and never loaded. Nor can
 * it be inlined into a <style> element at runtime: the mirror's CSP is
 * `style-src 'self'` plus four sha256 hashes, with no 'unsafe-inline'. So it
 * ships as a plain file and `overlay.mjs` injects a <link> to it on entry.
 */
function emitStaticAssets() {
  const path = (name) => new URL(`./src/${name}`, import.meta.url);

  return {
    name: 'libretexts-emit-static-assets',
    generateBundle() {
      const bootBytes = statSync(path('boot.js')).size;
      if (bootBytes > BOOT_BYTE_CAP) {
        // NF1: this is the entire cost to a visitor who never presses the button.
        this.error(`src/boot.js is ${bootBytes} bytes, over the ${BOOT_BYTE_CAP}-byte cap`);
      }
      for (const name of ['boot.js', 'reader.css']) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(path(name), 'utf8') });
      }
    },
  };
}

/**
 * Point transformers.js's bundled ONNX Runtime at the ORT we stage, and refuse to
 * emit a 23 MB wasm binary into the reader bundle.
 *
 * `transformers.web.js` contains `new URL("/ort-wasm-simd-threaded.asyncify.wasm",
 * import.meta.url)`. Vite resolves that as an asset reference and copies the
 * 23.5 MB binary into dist/_assets/tts/, where stage-local.sh's `cp dist/...`
 * would carry it onto the mirror -- unused, because the worker sets
 * `env.backends.onnx.wasm.wasmPaths` explicitly, and shipped anyway.
 *
 * Rewriting it to the staged path is better than merely dropping it: the
 * fallback then resolves somewhere correct instead of somewhere absent.
 *
 * A regex over a vendored bundle is fragile by nature, so the failure is made
 * loud rather than silent -- generateBundle refuses any emitted .wasm asset. If
 * a future transformers.js writes that URL differently, the build stops with the
 * file named, instead of quietly growing by 23 MB again.
 */
const ORT_WASM_BASE = '/_assets/tts/ort-mt/';

function stageOrtWasmOutOfBundle() {
  const pattern = /new URL\("\/?([\w.-]+\.wasm)",\s*import\.meta\.url\)/g;

  return {
    name: 'libretexts-ort-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@huggingface/transformers')) return null;
      pattern.lastIndex = 0;
      if (!pattern.test(code)) return null;
      pattern.lastIndex = 0;
      return { code: code.replace(pattern, (_, file) => JSON.stringify(ORT_WASM_BASE + file)), map: null };
    },
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (name.endsWith('.wasm')) {
          this.error(
            `${name} was emitted into the reader bundle. The ORT wasm is served from ` +
            `${ORT_WASM_BASE}; this plugin's rewrite no longer matches the source.`,
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [emitStaticAssets(), stageOrtWasmOutOfBundle()],
  build: {
    target: 'es2022',
    outDir: 'dist/_assets/tts',
    emptyOutDir: true,
    rollupOptions: {
      // reader.mjs is reached only through boot.js's dynamic import of a
      // deployed URL, which rollup cannot follow. Without this its exports look
      // unused and the entry is tree-shaken to an empty file that fails at
      // runtime with "enterReaderMode is not a function".
      preserveEntrySignatures: 'strict',
      input: {
        reader: 'src/reader.mjs',
        'engine.worker': 'src/engine.worker.mjs',
        'translate.worker': 'src/translate.worker.mjs',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  // tests/e2e is Playwright's; vitest must not try to collect it.
  // Discovery is an ALLOWLIST, and the excludes are belt-and-braces.
  //
  // vitest's default include is `**/*.{test,spec}.*`, so ANY .spec.js anywhere in
  // the tree is collected -- and Playwright specs throw "test() called here" the
  // moment vitest imports one. Stray copies of tests/ turn up for ordinary reasons
  // (a scratch directory, a second checkout), and each one used to need another
  // exclude, which holds only until the next directory nobody predicted. Naming
  // what IS a unit test ends the category.
  test: {
    environment: 'happy-dom',
    include: ['tests/*.test.js'],
    exclude: ['**/tests/e2e/**', '**/node_modules/**', '.stage/**'],
  },
});
