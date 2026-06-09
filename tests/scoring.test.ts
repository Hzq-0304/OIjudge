import { describe, expect, it } from 'vitest';
import { calculateEffectiveSampleScores, calculateJudgeScore } from '../src/scoring';
import { ProblemConfig, SampleConfig, SampleReport } from '../src/types';

describe('custom scoring', () => {
  it('distributes default total score as integers and favors later samples for remainders', () => {
    const problem = problemWithSamples([sample(1), sample(2), sample(3)]);

    const result = calculateEffectiveSampleScores(problem);

    expect(result.totalScore).toBe(100);
    expect([...result.sampleScores.values()].map((entry) => entry.score)).toEqual([33, 33, 34]);
    expect(result.errors).toEqual([]);
  });

  it('uses manual sample scores first and distributes the remaining total', () => {
    const problem = problemWithSamples([
      sample(1, { score: 10 }),
      sample(2),
      sample(3),
      sample(4),
      sample(5)
    ]);

    const result = calculateEffectiveSampleScores(problem);

    expect([...result.sampleScores.values()].map((entry) => entry.score)).toEqual([10, 22, 22, 23, 23]);
    expect(result.sampleScores.get('sample-1')?.manual).toBe(true);
    expect(result.sampleScores.get('sample-5')?.manual).toBe(false);
  });

  it('reports an error when manual sample scores exceed total score', () => {
    const problem = problemWithSamples([sample(1, { score: 80 }), sample(2, { score: 30 }), sample(3)]);

    const result = calculateEffectiveSampleScores(problem);

    expect(result.errors).toContain('score.manualTotalExceeded');
    expect(result.sampleScores.get('sample-3')?.score).toBe(0);
  });

  it('scores bundled subtasks only when every testcase passes', () => {
    const problem = {
      ...problemWithSamples([sample(1, { score: 10 }), sample(2, { score: 10 }), sample(3, { score: 5 })]),
      subtasks: [{
        id: 'subtask-1',
        name: 'Subtask 1',
        sampleIds: ['sample-1', 'sample-2'],
        scoringMode: 'bundle' as const
      }]
    };

    const failedBundle = calculateJudgeScore(problem, [
      report(1, 'sample-1', 'AC'),
      report(2, 'sample-2', 'WA'),
      report(3, 'sample-3', 'AC')
    ]);
    const passedBundle = calculateJudgeScore(problem, [
      report(1, 'sample-1', 'AC'),
      report(2, 'sample-2', 'AC'),
      report(3, 'sample-3', 'AC')
    ]);

    expect(failedBundle.earnedScore).toBe(5);
    expect(failedBundle.subtaskScores.get('subtask-1')).toEqual({ earned: 0, total: 20 });
    expect(passedBundle.earnedScore).toBe(25);
    expect(passedBundle.subtaskScores.get('subtask-1')).toEqual({ earned: 20, total: 20 });
  });
});

function problemWithSamples(samples: SampleConfig[]): ProblemConfig {
  return {
    id: 'A',
    name: 'A',
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    samples,
    standard: 'c++17'
  };
}

function sample(index: number, overrides: Partial<SampleConfig> = {}): SampleConfig {
  return {
    id: `sample-${index}`,
    index,
    name: `Sample ${index}`,
    input: `${index}.in`,
    answer: `${index}.out`,
    ...overrides
  };
}

function report(index: number, id: string, status: SampleReport['status']): SampleReport {
  return {
    id,
    index,
    name: `Sample ${index}`,
    status,
    timeMs: 1,
    elapsedMs: 1,
    input: `${index}.in`,
    answer: `${index}.out`,
    actualOutput: `${index}.txt`
  };
}
