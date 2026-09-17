import { describe, it, expect } from 'vitest';
import { substituteMathSpeech, FALLBACK_SPEECH } from '../src/math-speech.mjs';

// Port of pipeline/math_speech.substitute_math: the client-side translation path
// restores the MATH placeholder to its token, and this is what turns the token
// into words. Every translated track speaks the equation in ENGLISH by rule.
const TOKEN = '[[latex:XChcRGVsdGEgVSA9IHEgKyB3XCk=]]';   // \(\Delta U = q + w\)

describe('substituteMathSpeech', () => {
  it('replaces a token with its English speech', () => {
    expect(substituteMathSpeech(`La energía obedece ${TOKEN} siempre.`, { [TOKEN]: 'Delta U equals q plus w' }))
      .toBe('La energía obedece Delta U equals q plus w siempre.');
  });

  it('never voices base64 when the map is missing an entry', () => {
    const out = substituteMathSpeech(`Ver ${TOKEN}.`, {});
    expect(out).toBe(`Ver ${FALLBACK_SPEECH}.`);
    expect(out).not.toContain('latex:');
  });

  it('is a no-op on prose', () => {
    expect(substituteMathSpeech('plain', {})).toBe('plain');
  });
});
