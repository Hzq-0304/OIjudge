import { describe, expect, it } from 'vitest';
import { compareCrossPlatformMetrics, CrossPlatformMetricResult } from '../src/crossPlatformMetrics';

describe('cross-platform metric comparison', () => {
  it('accepts stable AC results with finite time and memory', () => {
    const result = compareCrossPlatformMetrics(baseline(), {
      ...baseline(),
      platform: 'linux',
      cases: [{ name: 'sum-array-small', verdict: 'AC', timeMs: 20, memoryKb: 2048 }]
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails only on clear correctness or schema anomalies', () => {
    const result = compareCrossPlatformMetrics(undefined, {
      ...baseline(),
      cases: [
        { name: 'wa', verdict: 'WA', timeMs: 1, memoryKb: 1 },
        { name: 'bad-time', verdict: 'AC', timeMs: Number.POSITIVE_INFINITY, memoryKb: 1 },
        { name: 'negative-time', verdict: 'AC', timeMs: -1, memoryKb: 1 },
        { name: 'bad-memory', verdict: 'AC', timeMs: 1, memoryKb: -1 }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'wa: verdict is WA, expected AC',
      'bad-time: timeMs must be a finite number',
      'negative-time: timeMs must not be negative',
      'bad-memory: memoryKb must not be negative'
    ]));
  });

  it('allows unsupported memory when explicitly marked', () => {
    const result = compareCrossPlatformMetrics(undefined, {
      ...baseline(),
      cases: [{ name: 'sum-array-small', verdict: 'AC', timeMs: 12, memoryKb: null, memorySupported: false }]
    });

    expect(result.ok).toBe(true);
  });

  it('reports wide performance drift as warnings instead of failures', () => {
    const result = compareCrossPlatformMetrics(baseline(), {
      ...baseline(),
      cases: [{ name: 'sum-array-small', verdict: 'AC', timeMs: 3000, memoryKb: 4096 }]
    });

    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain('sum-array-small');
  });
});

function baseline(): CrossPlatformMetricResult {
  return {
    platform: 'win32',
    arch: 'x64',
    node: process.version,
    compiler: 'g++',
    cases: [{ name: 'sum-array-small', verdict: 'AC', timeMs: 10, memoryKb: 2048 }],
    summary: { totalTimeMs: 10, maxMemoryKb: 2048 }
  };
}
