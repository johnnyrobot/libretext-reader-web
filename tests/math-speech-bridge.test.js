// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { createConverter } from '../scripts/math-speech.mjs';

/**
 * The bridge is the only place SRE runs. These cases are the four LibreTexts
 * quirks the prototype found on one Chem 4B page (spec §4.3) plus mhchem and
 * align, so a regression in any of them is named here, not discovered on the
 * mirror.
 */
describe('math-speech bridge', () => {
  let converter;
  beforeAll(async () => { converter = await createConverter({ macros: { PageIndex: '1.4' } }); });

  it('speaks a plain equation in Clearspeak', () => {
    // SRE says "normal Delta" for \Delta (mathvariant=normal); the phrasing pass drops it later.
    expect(converter.speak('\\Delta U = q + w', false)).toMatch(/^(normal )?Delta U equals q plus w$/);
  });

  it('reads Delta as Delta, not triangle', () => {
    expect(converter.speak('\\Delta U', false)).not.toMatch(/triangle/);
  });

  it('speaks a subscript', () => {
    expect(converter.speak('U_{sys}', false)).toBe('U sub s y s');
  });

  it('speaks mhchem', () => {
    expect(converter.speak('\\ce{O_2}', false)).toMatch(/O sub 2/);
  });

  it('turns PageIndex into the page-number form', () => {
    expect(converter.speak('\\PageIndex{1}', false).replace(/\s+/g, '')).toBe('1.4.1');
  });

  it('speaks a ref as "Equation X" and never as question marks', () => {
    const out = converter.speak('\\ref{12.4.2}', false);
    // SRE reads a two-decimal-point number as "12.4" then ".2" with a space between,
    // the same digit-grouping quirk pinned in the PageIndex test above.
    expect(out).toBe('Equation 12.4 .2');
    expect(out).not.toMatch(/question mark/);
  });

  it('drops a label without adding a table wrapper', () => {
    expect(converter.speak('x = 1 \\label{eq1}', true)).toBe('x equals 1');
  });

  it('honours a macro from the preamble', () => {
    converter.define('\\newcommand{\\dU}{\\Delta U}');
    expect(converter.speak('\\dU = 0', false)).toMatch(/Delta U equals 0$/);
  });

  it('speaks a multi-line align line by line', () => {
    const out = converter.speak('\\begin{align} w &= -P \\Delta V \\\\[4pt] &= 284\\; J \\end{align}', true);
    expect(out).toMatch(/^2 lines Line 1: w equals negative P (normal )?Delta V Line 2: blank equals 284 J$/);
  });

  it('speaks long division R as the word remainder', () => {
    expect(converter.speak('1024 \\div 3 = 341\\; \\text{R} 1', false))
      .toBe('1024 divided by 3 equals 341 remainder 1');
  });

  it('leaves R alone when it is a constant, not a remainder', () => {
    // PV = nRT: R is the gas constant throughout Chem 4B. Only a digit-R-digit
    // sandwich is long division.
    expect(converter.speak('P V = n R T', false)).not.toMatch(/remainder/);
  });

  it('throws on an undefined control sequence instead of speaking the error', () => {
    expect(() => converter.speak('\\nosuchmacro{x}', false)).toThrow(/nosuchmacro|Undefined/);
  });
});
