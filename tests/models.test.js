import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureModels, modelsPresent, deleteModels, checkQuota, checkQuotaFor,
  CACHE_NAME, MT_CACHE_NAME,
} from '../src/models.mjs';

// SHA-256 of the three bytes [1,2,3], precomputed so the test asserts against a
// constant rather than against the implementation's own hashing.
const SHA_123 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';

// One backing store PER cache name, because the thing most worth testing about
// two caches is that they are actually two: a shared store would let every
// isolation assertion below pass while the real Cache Storage kept one bucket.
function fakeCaches() {
  const stores = new Map();
  const created = new Set();
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const cacheFor = (name) => {
    const store = storeFor(name);
    return {
      async match(url) { return store.has(url) ? new Response(store.get(url)) : undefined; },
      async put(url, res) { store.set(url, await res.arrayBuffer()); },
    };
  };
  return {
    storeFor,
    // The default cache's store, so tests that predate the cacheName parameter
    // read exactly as they did.
    store: storeFor(CACHE_NAME),
    created,
    api: {
      has: async (name) => created.has(name),
      open: async (name) => { created.add(name); return cacheFor(name); },
      keys: async () => [...created],
      delete: async (name) => { storeFor(name).clear(); created.delete(name); return true; },
    },
  };
}

function manifest() {
  return {
    version: 1,
    files: [{ name: 'ttsJson', path: 'onnx/tts.json', bytes: 3, sha256: SHA_123 }],
  };
}

// The shape scripts/convert-mt-models.py writes: same {version, files:[...]} the
// engine manifest uses, plus provenance keys this reader ignores by design.
function mtManifest() {
  return {
    version: 1,
    pair: 'en-es',
    source: { repo: 'Xenova/opus-mt-en-es', revision: 'deadbeef', licence: 'apache-2.0' },
    files: [
      { name: 'encoder', path: 'onnx/encoder_model_quantized.onnx', bytes: 3, sha256: SHA_123 },
      { name: 'decoder', path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 3, sha256: SHA_123 },
      { name: 'tokenizer', path: 'tokenizer.json', bytes: 3, sha256: SHA_123 },
      { name: 'vocab', path: 'vocab.json', bytes: 3, sha256: SHA_123 },
    ],
  };
}

describe('models.mjs', () => {
  let caches_;

  beforeEach(() => {
    caches_ = fakeCaches();
    vi.stubGlobal('caches', caches_.api);
  });

  it('downloads a missing file, verifies it, and caches it', async () => {
    const body = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('manifest.json')) return Response.json(manifest());
      return new Response(body);
    }));

    const seen = [];
    const out = await ensureModels('/_assets/tts/manifest.json', (p) => seen.push(p.phase));

    expect(new Uint8Array(out.ttsJson)).toEqual(body);
    expect(caches_.store.size).toBe(1);
    expect(seen).toContain('download');
  });

  it('serves a cached file without re-downloading it', async () => {
    const body = new Uint8Array([1, 2, 3]);
    caches_.store.set('/_assets/tts/onnx/tts.json', body.buffer);
    const fetchSpy = vi.fn(async (url) => {
      if (String(url).endsWith('manifest.json')) return Response.json(manifest());
      throw new Error('should not download a cached file');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await ensureModels('/_assets/tts/manifest.json');

    expect(new Uint8Array(out.ttsJson)).toEqual(body);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // manifest only
  });

  it('re-downloads a cached file whose hash does not match', async () => {
    caches_.store.set('/_assets/tts/onnx/tts.json', new Uint8Array([9, 9, 9]).buffer);
    const good = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('manifest.json')) return Response.json(manifest());
      return new Response(good);
    }));

    const out = await ensureModels('/_assets/tts/manifest.json');

    expect(new Uint8Array(out.ttsJson)).toEqual(good);
  });

  it('rejects when a fresh download fails verification', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('manifest.json')) return Response.json(manifest());
      return new Response(new Uint8Array([7, 7, 7]));
    }));

    await expect(ensureModels('/_assets/tts/manifest.json')).rejects.toThrow(/integrity/i);
  });

  it('does not create the cache just by asking whether models are present', async () => {
    // caches.open() creates the cache. Checking presence must not, or a reader
    // who declines the download is left with a named cache entry -- a hard
    // invariant 3 says no cache entry before an explicit click, and the consent
    // dialog promises a cancel leaves nothing behind.
    const fetchSpy = vi.fn(async () => Response.json(manifest()));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await modelsPresent('/_assets/tts/manifest.json')).toBe(false);
    expect(caches_.created.has(CACHE_NAME)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing cached: no need to read the manifest
  });

  it('reports presence and deletes', async () => {
    caches_.store.set('/_assets/tts/onnx/tts.json', new Uint8Array([1, 2, 3]).buffer);
    caches_.created.add(CACHE_NAME);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(manifest())));

    expect(await modelsPresent('/_assets/tts/manifest.json')).toBe(true);
    await deleteModels();
    expect(caches_.store.size).toBe(0);
  });

  it('answers the quota question from a size already known, without a fetch', async () => {
    // pairs.json carries each pair's total precisely so the consent gate can
    // name a size BEFORE touching anything of the model's. Going through
    // checkQuota() would fetch that manifest to add up numbers we were handed.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1000, usage: 100 }) } });

    await expect(checkQuotaFor(500)).resolves.toEqual({
      required: 500, quota: 1000, usage: 100, sufficient: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // 900 available against 800 needed plus the 10% margin: not enough.
    await expect(checkQuotaFor(820)).resolves.toMatchObject({ sufficient: false });
  });

  it('treats an unknown quota as sufficient rather than blocking on it', async () => {
    // Safari has reported 0 here. Refusing to download because the browser will
    // not say how much room it has would be worse than trying and failing.
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } });
    await expect(checkQuotaFor(999_999_999)).resolves.toMatchObject({ sufficient: true });
  });

  it('checkQuota still totals a manifest, through the same answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(mtManifest())));
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1000, usage: 0 }) } });
    await expect(checkQuota('/_assets/tts/mt/en-es/manifest.json'))
      .resolves.toMatchObject({ required: 12, sufficient: true });
  });

  it('puts translation models in their own cache, leaving the voice untouched', async () => {
    // The whole reason for a second cache: deleteModels() deletes a WHOLE cache,
    // so a reader reclaiming 121 MB of Spanish must not lose the 383 MB voice.
    caches_.store.set('/_assets/tts/onnx/tts.json', new Uint8Array([1, 2, 3]).buffer);
    caches_.created.add(CACHE_NAME);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('manifest.json')) return Response.json(mtManifest());
      return new Response(new Uint8Array([1, 2, 3]));
    }));

    const out = await ensureModels('/_assets/tts/mt/en-es/manifest.json', () => {}, MT_CACHE_NAME);

    expect(Object.keys(out).sort()).toEqual(['decoder', 'encoder', 'tokenizer', 'vocab']);
    expect(caches_.storeFor(MT_CACHE_NAME).size).toBe(4);
    expect([...caches_.storeFor(MT_CACHE_NAME).keys()])
      .toContain('/_assets/tts/mt/en-es/onnx/encoder_model_quantized.onnx');
    expect(caches_.store.size).toBe(1); // the voice, exactly as it was
  });

  it('deletes one cache without touching the other', async () => {
    caches_.store.set('/_assets/tts/onnx/tts.json', new Uint8Array([1, 2, 3]).buffer);
    caches_.storeFor(MT_CACHE_NAME).set('/_assets/tts/mt/en-es/vocab.json',
      new Uint8Array([1, 2, 3]).buffer);
    caches_.created.add(CACHE_NAME);
    caches_.created.add(MT_CACHE_NAME);

    await deleteModels(MT_CACHE_NAME);

    expect(caches_.storeFor(MT_CACHE_NAME).size).toBe(0);
    expect(caches_.store.size).toBe(1);
  });

  it('does not create the translation cache just by asking about it', async () => {
    // Same invariant as the voice, checked separately: the MT download is its
    // own consent gate, so declining it must also leave nothing behind.
    const fetchSpy = vi.fn(async () => Response.json(mtManifest()));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await modelsPresent('/_assets/tts/mt/en-es/manifest.json', MT_CACHE_NAME)).toBe(false);
    expect(caches_.created.has(MT_CACHE_NAME)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
