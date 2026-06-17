export type TextCompareMode = 'strictText' | 'trimTrailingWhitespace';

export function strictTextCompare(actual: string, expected: string): boolean {
  return actual === expected;
}

export function trimTrailingWhitespaceCompare(actual: string, expected: string): boolean {
  return normalizeOiText(actual) === normalizeOiText(expected);
}

export function isOutputAccepted(
  actual: string,
  expected: string,
  mode: TextCompareMode = 'trimTrailingWhitespace'
): boolean {
  return mode === 'strictText'
    ? strictTextCompare(actual, expected)
    : trimTrailingWhitespaceCompare(actual, expected);
}

export function normalizeOiText(value: string): string {
  const lines = value
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t \f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+$/gu, ''));

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}
