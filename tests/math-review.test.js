import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { review, reviewerAvailable } from '../scripts/math-review.mjs';

/**
 * Ollama Cloud speaks the same /api/tags and /api/generate as a local daemon,
 * and differs only in wanting a bearer token. These pin that the token is sent
 * when OLLAMA_API_KEY is set and that nothing is sent when it is not -- a local
 * daemon must keep working with no key in the environment.
 */
describe('math-review auth', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_HOST;
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), headers: opts.headers ?? {} });
      return {
        ok: true,
        json: async () => ({
          models: [{ name: 'gpt-oss:120b' }],
          response: '{"verdict":"good","note":"fine"}',
        }),
      };
    });
  });

  afterEach(() => {
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_HOST;
    vi.restoreAllMocks();
  });

  const auth = (h) => new Headers(h).get('authorization');

  it('sends no authorization header without a key', async () => {
    await review('x^2', 'x squared', 'gpt-oss:120b');
    expect(auth(calls[0].headers)).toBe(null);
  });

  it('sends a bearer token when OLLAMA_API_KEY is set', async () => {
    process.env.OLLAMA_API_KEY = 'test-key-123';
    await review('x^2', 'x squared', 'gpt-oss:120b');
    expect(auth(calls[0].headers)).toBe('Bearer test-key-123');
  });

  it('authenticates the availability probe too', async () => {
    process.env.OLLAMA_API_KEY = 'test-key-123';
    expect(await reviewerAvailable('gpt-oss:120b')).toBe(true);
    expect(auth(calls[0].headers)).toBe('Bearer test-key-123');
  });
});


/**
 * The reviewer is a cloud model. A local daemon is still reachable, but only by
 * asking for it explicitly -- it is never what you get by default.
 */
describe('math-review host', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_HOST;
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ models: [], response: '{"verdict":"good","note":""}' }) };
    });
  });

  afterEach(() => {
    delete process.env.OLLAMA_HOST;
    vi.restoreAllMocks();
  });

  it('talks to Ollama Cloud by default', async () => {
    await review('x', 'x', 'gpt-oss:120b');
    expect(calls[0]).toBe('https://ollama.com/api/generate');
  });

  it('honours an explicit OLLAMA_HOST, so a local daemon is still reachable', async () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    await review('x', 'x', 'qwen3.5:9b');
    expect(calls[0]).toBe('http://localhost:11434/api/generate');
  });
});


/**
 * A verdict is a function of the PROMPT as much as of the model and the text.
 * Without the prompt in the key, sharpening the rubric leaves every cached row
 * answering the old question, silently and forever.
 */
describe('math-review cache key', () => {
  it('changes when the prompt changes', async () => {
    const { cacheKey, PROMPT } = await import('../scripts/math-review.mjs');
    const a = cacheKey('\\frac12', 'one half', 'gemma4:31b', PROMPT);
    const b = cacheKey('\\frac12', 'one half', 'gemma4:31b', PROMPT + ' extra rule');
    expect(a).not.toBe(b);
  });

  it('is stable for the same inputs', async () => {
    const { cacheKey, PROMPT } = await import('../scripts/math-review.mjs');
    expect(cacheKey('x', 'x', 'gemma4:31b', PROMPT)).toBe(cacheKey('x', 'x', 'gemma4:31b', PROMPT));
  });
});
