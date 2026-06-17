import { describe, expect, it } from 'vitest';
import { isOutputAccepted, strictTextCompare, trimTrailingWhitespaceCompare } from '../src/comparator';

describe('text comparison modes', () => {
  it('keeps strict text comparison byte-for-byte', () => {
    expect(strictTextCompare('1\n', '1')).toBe(false);
    expect(strictTextCompare('1   \n', '1\n')).toBe(false);
    expect(isOutputAccepted('1\n', '1', 'strictText')).toBe(false);
  });

  it('ignores trailing whitespace and final newlines in OI-style comparison', () => {
    expect(trimTrailingWhitespaceCompare('1\n', '1')).toBe(true);
    expect(trimTrailingWhitespaceCompare('1   \n', '1')).toBe(true);
    expect(trimTrailingWhitespaceCompare('1\t\n', '1')).toBe(true);
    expect(trimTrailingWhitespaceCompare('1\r\n', '1\n')).toBe(true);
    expect(trimTrailingWhitespaceCompare('1\n\n', '1')).toBe(true);
    expect(isOutputAccepted('1   \n', '1', 'trimTrailingWhitespace')).toBe(true);
  });

  it('does not ignore leading spaces, inner spaces, or middle blank lines', () => {
    expect(trimTrailingWhitespaceCompare('1  2\n', '1 2\n')).toBe(false);
    expect(trimTrailingWhitespaceCompare(' 1\n', '1\n')).toBe(false);
    expect(trimTrailingWhitespaceCompare('1\n\n2\n', '1\n2\n')).toBe(false);
  });
});
