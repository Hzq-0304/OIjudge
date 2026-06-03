import { describe, expect, it } from 'vitest';
import { createProblemSampleAddModeItems } from '../src/extension';

describe('sample add QuickPick items', () => {
  it('keeps manual, file import, and batch import modes available', () => {
    const items = createProblemSampleAddModeItems();

    expect(items.map((item) => item.mode)).toEqual(['manual', 'files', 'batch']);
    expect(items.every((item) => item.label && item.description)).toBe(true);
  });
});
