import { describe, expect, it } from 'vitest';
import { scoreClass, statusClass, statusLabel, verdictClass } from '../src/report/statusDisplay';

describe('report status display helpers', () => {
  it('keeps status and verdict CSS tokens stable', () => {
    expect(statusClass('AC')).toBe('status-ac');
    expect(statusClass('Checker Error')).toBe('status-checker-error');
    expect(verdictClass('Interactor Error')).toBe('verdict-interactor-error');
  });

  it('keeps score classes stable for passed, partial, skipped, and failed rows', () => {
    expect(scoreClass(10, 10, 'AC')).toBe('score-passed');
    expect(scoreClass(5, 10, 'WA')).toBe('score-partial verdict-wa');
    expect(scoreClass(0, 10, 'Skipped')).toBe('score-muted verdict-skipped');
    expect(scoreClass(0, 10, 'Not Run')).toBe('score-muted');
    expect(scoreClass(0, 10, 'RE')).toBe('score-failed verdict-re');
  });

  it('keeps report status labels using existing verdict acronym formatting', () => {
    expect(statusLabel('AC')).toBe('AC');
    expect(statusLabel('Wrong Answer')).toBe('WA');
    expect(statusLabel('Memory Limit Exceeded')).toBe('MLE');
  });
});
