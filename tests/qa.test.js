import { describe, it, expect } from 'vitest';
import {
  SHORT_RATIO, isDegenerate, isImplausiblyShort, referenceSentenceIds, shouldFallBack,
} from '../src/qa.mjs';

/**
 * What survives of the QA gate without back-translation (build plan step 10).
 *
 * The degeneracy cases are ported from pipeline/tests/test_qa.py. The rest are
 * new, because the rest is new: the length check had to be recalibrated against
 * SPANISH output rather than against an English round trip, and the reference
 * holdback had never run client-side.
 */

describe('isDegenerate — the collapse checks that need only one side', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['one word looped', 'the the the the the the the the'],
    ['one letter repeated', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ])('catches %s', (_name, text) => {
    expect(isDegenerate(text)).toBe(true);
  });

  it('catches a short phrase repeated back to back', () => {
    // The single-word check cannot see this: it has four unique words.
    expect(isDegenerate('over the lazy dog over the lazy dog over the lazy dog')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(isDegenerate('A perfectly normal sentence about cats.')).toBe(false);
    expect(isDegenerate('Una frase perfectamente normal sobre gatos.')).toBe(false);
  });

  it('sees letters in a non-Latin script', () => {
    // An ASCII letter class finds NO letters here and passes the loop as healthy.
    // Nine of the shipped languages are written in Cyrillic or Greek.
    expect(isDegenerate('дддддддддддд')).toBe(true);
  });

  it('does not count a placeholder as content', () => {
    // A sentence whose entire translation collapsed to its own mask is empty in
    // every sense that matters, and restore() would turn it back into a bare URL
    // read aloud with no sentence around it.
    expect(isDegenerate('[[URL0]]')).toBe(true);
  });

  it('does not fire on a short real sentence', () => {
    // Three identical-length words is not a loop, and this book is full of
    // table cells and headings that are two or three words long.
    expect(isDegenerate('¿Qué haces?')).toBe(false);
  });
});

describe('isImplausiblyShort — calibrated on the 9,407 deployed pairs', () => {
  it('fires on gross truncation', () => {
    const source = 'The guide was commissioned by the Attorney General and consisted '
      + 'of recommendations for collecting eyewitness evidence.';
    expect(isImplausiblyShort(source, 'La guía.')).toBe(true);
  });

  it('leaves the tersest legitimate pair in the corpus alone', () => {
    // Measured minimum over 9,407 gate-vetted pairs is 0.47, and it is Spanish
    // doing ordinary Spanish things -- dropping the subject pronoun and the
    // do-support English needs and Spanish does not. A floor tight enough to
    // catch a mild shortening drops sentences like this one.
    expect(isImplausiblyShort('What do you do?', '¿Qué haces?')).toBe(false);
    expect(4 * SHORT_RATIO).toBeLessThan(2);
  });

  it('leaves a longer-than-source translation alone', () => {
    // Spanish runs longer than English far more often than shorter: the median
    // ratio over the corpus is 1.09.
    expect(isImplausiblyShort('Fairness matters.', 'La equidad es importante.')).toBe(false);
  });

  it('says nothing about an empty source', () => {
    // Division by zero dressed as a quality judgement. isDegenerate is what
    // catches an empty translation; this check has no opinion.
    expect(isImplausiblyShort('', '')).toBe(false);
  });

  it('counts words, not placeholders — a formula-heavy sentence can still collapse', () => {
    // Placeholders survive a collapse: they are opaque tokens the model copies
    // through. Counting them as words means a sentence whose PROSE is entirely
    // gone still scores 5/9 and passes, because the five surviving [[MATH]]
    // tokens carry the ratio. Stripping them first is what makes the check see
    // that every real word was lost. pipeline/qa._word_count strips for the same
    // reason, and the two have to agree about what a word is.
    const source = 'The [[MATH0]] [[MATH1]] [[MATH2]] [[MATH3]] [[MATH4]] value is fixed.';
    const collapsed = '[[MATH0]] [[MATH1]] [[MATH2]] [[MATH3]] [[MATH4]]';
    expect(isImplausiblyShort(source, collapsed)).toBe(true);

    // And the healthy version of the same sentence is left alone.
    const fine = 'El valor [[MATH0]] [[MATH1]] [[MATH2]] [[MATH3]] [[MATH4]] es fijo.';
    expect(isImplausiblyShort(source, fine)).toBe(false);
  });
});

describe('referenceSentenceIds — the structural holdback', () => {
  const page = (blocks) => blocks;

  it('withholds sentences under a References heading', () => {
    const ids = referenceSentenceIds(page([
      { kind: 'heading', text: 'References' },
      { kind: 'paragraph', sentences: [{ id: 'b1s0' }, { id: 'b1s1' }] },
    ]));
    expect([...ids]).toEqual(['b1s0', 'b1s1']);
  });

  it('matches the singular "Reference"', () => {
    // Exactly one heading in this book says it, and a plural-only pattern misses
    // a whole bibliography with nothing to signal it.
    const ids = referenceSentenceIds(page([
      { kind: 'heading', text: 'Reference' },
      { kind: 'paragraph', sentences: [{ id: 'b1s0' }] },
    ]));
    expect(ids.has('b1s0')).toBe(true);
  });

  it('does not match a heading that merely contains the word', () => {
    // "References to Prior Work" and "Cross-Cultural References" are ordinary
    // sections. A false positive here mutes real prose to English silently.
    for (const text of ['References to Prior Work', 'Cross-Cultural References']) {
      const ids = referenceSentenceIds(page([
        { kind: 'heading', text },
        { kind: 'paragraph', sentences: [{ id: 'b1s0' }] },
      ]));
      expect(ids.has('b1s0')).toBe(false);
    }
  });

  it('stops at the next heading, not at the end of the page', () => {
    // The manifest carries no heading LEVEL, so running to end-of-page would mute
    // a real section that happens to follow the bibliography.
    const ids = referenceSentenceIds(page([
      { kind: 'heading', text: 'References' },
      { kind: 'paragraph', sentences: [{ id: 'b1s0' }] },
      { kind: 'heading', text: 'Glossary' },
      { kind: 'paragraph', sentences: [{ id: 'b3s0' }] },
    ]));
    expect(ids.has('b1s0')).toBe(true);
    expect(ids.has('b3s0')).toBe(false);
  });

  it('does not withhold the heading itself', () => {
    // Hearing "Referencias" just before the English citations start is what tells
    // a listener the switch was deliberate rather than broken.
    const ids = referenceSentenceIds(page([
      { kind: 'heading', text: 'References', sentences: [{ id: 'b0s0' }] },
      { kind: 'paragraph', sentences: [{ id: 'b1s0' }] },
    ]));
    expect(ids.has('b0s0')).toBe(false);
  });
});

describe('shouldFallBack — the one place the decision is made', () => {
  it('is true when either check fires, false otherwise', () => {
    expect(shouldFallBack('A normal sentence here.', '')).toBe(true);
    expect(shouldFallBack('A normal sentence about fairness and cooperation.', 'La.')).toBe(true);
    expect(shouldFallBack('Fairness matters.', 'La equidad es importante.')).toBe(false);
  });
});
