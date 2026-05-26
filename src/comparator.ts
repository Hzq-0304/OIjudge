export function isOutputAccepted(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}
