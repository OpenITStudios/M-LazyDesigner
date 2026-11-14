// Node 24 source-only regression; NOT_EXECUTED under the repository hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFiniteEditorNumber } from './rustNumericInput.ts';

test('empty or incomplete inputs never coerce to zero', () => {
  for (const value of ['', ' ', '\t', '+', '-', '.', '+.', '1e', '1e+']) {
    assert.equal(parseFiniteEditorNumber(value), null, value);
  }
});

test('nonfinite and nondecimal input is refused', () => {
  for (const value of ['Infinity', 'NaN', '0x10', '1,000', '1_000', '1e999', '1abc']) {
    assert.equal(parseFiniteEditorNumber(value), null, value);
  }
});

test('valid zero, decimals and exponents are preserved', () => {
  for (const [input, expected] of [['0', 0], ['-0', -0], ['.25', 0.25], ['4.', 4],
    ['-3.25', -3.25], ['1e2', 100], [' +2.5 ', 2.5]]) {
    assert.equal(parseFiniteEditorNumber(input), expected, input);
  }
});
