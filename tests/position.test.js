import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { savePosition, loadPosition, clearPosition } from '../src/position.mjs';

describe('position.mjs', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('round-trips a sentence id for a page', () => {
    savePosition('book/page', 'b3s1');
    expect(loadPosition('book/page')).toBe('b3s1');
  });

  it('keeps pages separate', () => {
    savePosition('book/a', 'b1s0');
    savePosition('book/b', 'b9s0');
    expect(loadPosition('book/a')).toBe('b1s0');
  });

  it('returns null for a page never visited', () => {
    expect(loadPosition('book/never')).toBeNull();
  });

  it('ignores a position older than 30 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));
    savePosition('book/page', 'b1s0');
    vi.setSystemTime(new Date('2026-03-01'));
    expect(loadPosition('book/page')).toBeNull();
  });

  it('clearPosition forgets a page', () => {
    savePosition('book/page', 'b1s0');
    clearPosition('book/page');
    expect(loadPosition('book/page')).toBeNull();
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('tts:pos:book/page', 'not json');
    expect(loadPosition('book/page')).toBeNull();
  });
});
