import { describe, expect, it } from 'vitest';
import { classifyRunResult } from '../src/judge';
import type { ProcessResult } from '../src/types';

describe('classifyRunResult', () => {
  it('classifies memory above the configured limit as MLE', () => {
    expect(classifyRunResult(result({ memoryBytes: 256 * 1024 * 1024 + 1 }), 256)).toBe('MLE');
  });

  it('does not classify memory exactly at the configured limit as MLE', () => {
    expect(classifyRunResult(result({ memoryBytes: 256 * 1024 * 1024 }), 256)).toBeUndefined();
  });

  it('keeps output and time limit verdicts before MLE', () => {
    expect(classifyRunResult(result({ outputLimitExceeded: true, memoryBytes: 300 * 1024 * 1024 }), 256)).toBe('OLE');
    expect(classifyRunResult(result({ timedOut: true, memoryBytes: 300 * 1024 * 1024 }), 256)).toBe('TLE');
  });
});

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return {
    stdout: '',
    stderr: '',
    code: 0,
    signal: null,
    timedOut: false,
    killedByTimeout: false,
    timeMs: 1,
    elapsedMs: 1,
    ...overrides
  };
}
