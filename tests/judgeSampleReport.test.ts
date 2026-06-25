import * as path from 'path';
import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import {
  createSampleReport,
  createSkippedSampleReport,
  deriveRunResultRel,
  getSampleOutputPaths
} from '../src/judge/sampleReport';
import { SampleConfig } from '../src/types';

describe('judge sample report builders', () => {
  it('derives run-result paths without changing report field semantics', () => {
    expect(deriveRunResultRel('.vscode/.OIJudge/problems/A/outputs/sample-1/useroutput.txt'))
      .toBe('.vscode/.OIJudge/problems/A/outputs/sample-1/run-result.txt');
    expect(deriveRunResultRel('.oitest/outputs/1.out')).toBe('.oitest/outputs/1.run-result.txt');
    expect(deriveRunResultRel('custom-output.txt')).toBe('custom-output.txt.run-result.txt');
  });

  it('creates normal sample reports with resolved paths and diagnostics', () => {
    const report = createSampleReport(
      workspace('workspace root'),
      sample({ sourceType: 'external' }),
      'WA',
      12.6,
      2,
      'outputs/1.out',
      'outputs/1.err',
      'outputs/1.diff',
      { exitCode: 0, ioMode: 'stdio', stderrPreview: 'preview' },
      'Wrong Answer',
      0
    );

    expect(report).toMatchObject({
      id: 'sample-1',
      index: 1,
      name: 'Sample 1',
      status: 'WA',
      timeMs: 12.6,
      compareTimeMs: 2,
      elapsedMs: 13,
      actualOutput: 'outputs/1.out',
      output: 'outputs/1.out',
      stderr: 'outputs/1.err',
      runResult: 'outputs/1.run-result.txt',
      diff: 'outputs/1.diff',
      sampleSourceType: 'external',
      exitCode: 0,
      ioMode: 'stdio',
      stderrPreview: 'preview',
      score: 0,
      message: 'Wrong Answer'
    });
    expect(report.input).toBe(path.join(path.resolve('workspace root'), 'samples', '1.in'));
    expect(report.answer).toBe(path.join(path.resolve('workspace root'), 'samples', '1.out'));
  });

  it('resolves legacy and problem output paths in the same shape judge expects', () => {
    const workspaceFolder = workspace('workspace root');
    const legacy = getSampleOutputPaths(workspaceFolder, sample(), undefined);
    const problem = getSampleOutputPaths(workspaceFolder, sample(), 'problem-a');

    expect(legacy.outputRel).toBe('.vscode/.OIJudge/outputs/1.out');
    expect(legacy.stderrRel).toBe('.vscode/.OIJudge/outputs/1.err');
    expect(legacy.runResultRel).toBe('.vscode/.OIJudge/outputs/1.run-result.txt');
    expect(legacy.runDirRel).toBe('.vscode/.OIJudge/outputs/1-run');
    expect(legacy.diffRel).toBe('.vscode/.OIJudge/outputs/1.diff');
    expect(legacy.outputPath).toBe(path.join(path.resolve('workspace root'), '.vscode', '.OIJudge', 'outputs', '1.out'));

    expect(problem.outputRel).toBe('.vscode/.OIJudge/problems/problem-a/outputs/sample-1/useroutput.txt');
    expect(problem.stderrRel).toBe('.vscode/.OIJudge/problems/problem-a/outputs/sample-1/stderr.txt');
    expect(problem.runResultRel).toBe('.vscode/.OIJudge/problems/problem-a/outputs/sample-1/run-result.txt');
    expect(problem.runDirRel).toBe('.vscode/.OIJudge/problems/problem-a/outputs/sample-1/run');
    expect(problem.diffRel).toBe('.vscode/.OIJudge/problems/problem-a/outputs/sample-1/diff.txt');
  });

  it('creates skipped sample reports with reason metadata and zero score', () => {
    const report = createSkippedSampleReport(
      workspace('workspace root'),
      sample(),
      'problem-a',
      'fileio',
      {
        reason: 'dependency_failed',
        message: 'Skipped because dependency Subtask 1 did not pass.',
        subtask: { id: 'subtask-2', name: 'Subtask 2', sampleIds: ['sample-1'] },
        dependency: { id: 'subtask-1', name: 'Subtask 1', sampleIds: [] }
      }
    );

    expect(report.status).toBe('Skipped');
    expect(report.timeMs).toBe(0);
    expect(report.elapsedMs).toBe(0);
    expect(report.score).toBe(0);
    expect(report.killedByTimeout).toBe(false);
    expect(report.ioMode).toBe('fileio');
    expect(report.message).toBe('Skipped because dependency Subtask 1 did not pass.');
    expect(report.skip).toEqual({
      reason: 'dependency_failed',
      subtaskId: 'subtask-2',
      subtaskName: 'Subtask 2',
      dependencyId: 'subtask-1',
      dependencyName: 'Subtask 1'
    });
  });
});

function workspace(fsPath: string): vscode.WorkspaceFolder {
  const root = path.resolve(fsPath);
  return {
    uri: { fsPath: root, scheme: 'file' },
    name: path.basename(root),
    index: 0
  } as vscode.WorkspaceFolder;
}

function sample(overrides: Partial<SampleConfig> = {}): SampleConfig {
  return {
    id: 'sample-1',
    index: 1,
    name: 'Sample 1',
    input: path.join('samples', '1.in'),
    answer: path.join('samples', '1.out'),
    ...overrides
  };
}
