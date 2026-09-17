export const CACHE_NAME = 'libretexts-tts-v1';

// Translation models live in their OWN cache, not alongside the voice. A reader
// who wants their 121 MB of Spanish back must not have to throw away the 383 MB
// voice to get it, and vice versa -- deleteModels() deletes a whole cache.
export const MT_CACHE_NAME = 'libretexts-mt-v1';

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function assetUrl(manifestUrl, path) {
  return new URL(path, new URL(manifestUrl, self.location.href)).pathname;
}

async function readManifest(manifestUrl) {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`model manifest unavailable (${res.status})`);
  return res.json();
}

// Streams the body so progress reflects bytes actually arriving, not a single
// jump at the end. `total` falls back to the manifest size because the mirror
// serves gzip and Content-Length can be absent.
async function downloadWithProgress(url, expectedBytes, onChunk) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed for ${url} (${res.status})`);
  if (!res.body) return res.arrayBuffer();

  const total = Number(res.headers.get('content-length')) || expectedBytes;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onChunk(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out.buffer;
}

export async function ensureModels(manifestUrl, onProgress = () => {}, cacheName = CACHE_NAME) {
  const manifest = await readManifest(manifestUrl);
  const cache = await caches.open(cacheName);
  const out = {};

  for (const file of manifest.files) {
    const url = assetUrl(manifestUrl, file.path);
    onProgress({ file: file.path, phase: 'check', loaded: 0, total: file.bytes });

    // Verify before use, not only after download: Cache Storage can be evicted
    // or truncated under storage pressure, and a half-written 257 MB model
    // should re-download rather than crash session creation.
    const hit = await cache.match(url);
    if (hit) {
      const buffer = await hit.arrayBuffer();
      onProgress({ file: file.path, phase: 'verify', loaded: buffer.byteLength, total: file.bytes });
      if (await sha256Hex(buffer) === file.sha256) {
        out[file.name] = buffer;
        continue;
      }
    }

    const buffer = await downloadWithProgress(url, file.bytes, (loaded, total) =>
      onProgress({ file: file.path, phase: 'download', loaded, total }));

    onProgress({ file: file.path, phase: 'verify', loaded: buffer.byteLength, total: file.bytes });
    if (await sha256Hex(buffer) !== file.sha256) {
      throw new Error(`integrity check failed for ${file.path}`);
    }

    await cache.put(url, new Response(buffer));
    out[file.name] = buffer;
  }

  return out;
}

export async function modelsPresent(manifestUrl, cacheName = CACHE_NAME) {
  // caches.open() CREATES the cache. Asking whether the models are there must
  // not leave a named cache entry behind for a reader who then declines the
  // download -- a hard invariant, and the consent dialog's promise that a
  // cancel leaves nothing behind. Checking first also skips reading the
  // manifest entirely on the common cold path.
  if (!(await caches.has(cacheName))) return false;

  const manifest = await readManifest(manifestUrl);
  const cache = await caches.open(cacheName);
  for (const file of manifest.files) {
    if (!(await cache.match(assetUrl(manifestUrl, file.path)))) return false;
  }
  return true;
}

export async function deleteModels(cacheName = CACHE_NAME) {
  await caches.delete(cacheName);
}

export async function checkQuota(manifestUrl) {
  const manifest = await readManifest(manifestUrl);
  return checkQuotaFor(manifest.files.reduce((sum, f) => sum + f.bytes, 0));
}

/** The same answer for a size already known.
 *
 * Translation pairs carry their total in pairs.json precisely so the consent
 * gate can name a size WITHOUT touching the model's own manifest first. Going
 * through checkQuota() would fetch that manifest to add up numbers we were
 * already handed.
 *
 * Note what is NOT parameterised: `usage` is origin-wide and already counts
 * every cache, so this asks the same question for the voice and for a language
 * pair. There is no per-cache quota to ask about. */
export async function checkQuotaFor(required) {
  const { quota = 0, usage = 0 } = (await navigator.storage?.estimate?.()) ?? {};
  return { required, quota, usage, sufficient: quota === 0 || quota - usage > required * 1.1 };
}
