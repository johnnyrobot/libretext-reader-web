/**
 * Turn a `[[latex:<base64>]]` token into the words the manifest recorded for it.
 *
 * Port of pipeline/math_speech.substitute_math. The client-side translator masks
 * the token as MATH, the checkpoint never sees it, and restore() puts the token
 * back -- so without this a Spanish track would read base64 aloud. The words are
 * the ENGLISH Clearspeak from speech.json, by rule (spec §6): SRE has no locale
 * for three of the nine shipped languages and falls back to English silently,
 * and one explicit rule beats a silent one.
 */
export const FALLBACK_SPEECH = 'an equation';

const MATH_TOKEN_RE = /\[\[latex:[A-Za-z0-9+/=]+\]\]/g;

export function substituteMathSpeech(text, mathSpeech = {}) {
  return text.replace(MATH_TOKEN_RE, (token) => mathSpeech[token] ?? FALLBACK_SPEECH);
}
