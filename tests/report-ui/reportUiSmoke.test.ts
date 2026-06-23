import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { renderPage, renderReportBody } from '../../src/reportView';
import { JudgeReport, ProblemConfig, SampleReport, SampleStatus } from '../../src/types';
import { writeText } from '../cross-platform/helpers';
import * as path from 'path';

describe('report UI smoke regression', () => {
  it('renders key report DOM, verdict labels, expansion hooks, and subtask-local failed-first ordering', async () => {
    const html = renderPage('Cross Platform Report', renderReportBody(workspace(), report(), 'sum-array', problem()));
    const artifactPath = await writeText(path.join(process.cwd(), '.tmp', 'oijudge-cross-platform', 'report-html', 'report-ui-smoke.html'), html);

    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('class="reportHero');
    expect(html).toContain('class="summaryGrid"');
    expect(html).toContain('class="testcaseTable"');
    expect(html).toContain('class="testcaseRow');
    expect(html).toContain('Accepted');
    expect(html).toContain('Wrong Answer');
    expect(html).toContain('Time Limit Exceeded');
    expect(html).toContain('Memory Limit Exceeded');
    expect(html).toContain('<span class="infoLabel">Score:</span>');
    expect(html).toContain('<span class="infoLabel">Time:</span>');
    expect(html).toContain('<span class="infoLabel">Memory:</span>');
    expect(html).toContain('case-detail-panel');
    expect(html).toContain('class="case-summary"');
    expect(html).toContain('data-case-detail');
    expect(html).toContain('data-command="saveFailedCaseAsSample"');
    expect(html).toContain('Save as Sample');
    expect(html).toContain('togglePanel');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain('addEventListener');
    expect(html).not.toMatch(/https?:\/\//u);
    expect(html).not.toMatch(/src=["'][^"']*\\/u);

    expect(subtaskCaseOrder(html, 'Subtask 1')).toEqual([2, 1]);
    expect(subtaskCaseOrder(html, 'Subtask 2')).toEqual([3, 4]);
    expect(html.indexOf('Subtask 1')).toBeLessThan(html.indexOf('Subtask 2'));
    expect(artifactPath).toContain('report-ui-smoke.html');
  });
});

function workspace(): vscode.WorkspaceFolder {
  return {
    uri: { fsPath: path.join(process.cwd(), 'Cross Platform Workspace'), scheme: 'file' },
    name: 'Cross Platform Workspace',
    index: 0
  } as vscode.WorkspaceFolder;
}

function problem(): ProblemConfig {
  return {
    version: 1,
    id: 'sum-array',
    name: 'sum-array',
    standard: 'c++17',
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    judgeMode: 'trimTrailingWhitespace',
    samples: [1, 2, 3, 4].map((index) => ({
      id: `sample-${index}`,
      index,
      name: `Sample ${index}`,
      input: `${index}.in`,
      answer: `${index}.out`
    })),
    subtasks: [
      { id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1', 'sample-2'], scoringMode: 'sum' },
      { id: 'subtask-2', name: 'Subtask 2', sampleIds: ['sample-3', 'sample-4'], scoringMode: 'sum' }
    ],
    score: { total: 100 }
  };
}

function report(): JudgeReport {
  const samples = [
    sample(1, 'AC', 25),
    sample(2, 'WA', 0),
    sample(3, 'TLE', 0),
    sample(4, 'MLE', 0)
  ];
  return {
    version: 1,
    generatedAt: new Date('2026-06-18T00:00:00.000Z').toISOString(),
    source: path.join('src with spaces', 'sum-array.cpp'),
    sourceName: 'sum-array.cpp',
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    judgeMode: 'trimTrailingWhitespace',
    summary: { accepted: 1, total: 4, wrongAnswer: 1, scored: 0, checkerError: 0 },
    score: { earned: 25, total: 100 },
    samples,
    results: samples
  };
}

function sample(index: number, status: SampleStatus, score: number): SampleReport {
  return {
    id: `sample-${index}`,
    index,
    name: `Sample ${index}`,
    status,
    timeMs: index * 3,
    elapsedMs: index * 3,
    memoryKiB: 1024 * index,
    input: `${index}.in`,
    answer: `${index}.out`,
    actualOutput: `${index}.out.txt`,
    output: status === 'AC' ? '42\n' : '0\n',
    stderr: status === 'AC' ? '' : 'diagnostic\n',
    diff: status === 'AC' ? '' : '- expected\n+ actual\n',
    score,
    scoreTotal: 25
  };
}

function subtaskCaseOrder(html: string, subtaskName: string): number[] {
  const start = html.indexOf(subtaskName);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('class="testcaseGroup subtask-row"', start + subtaskName.length);
  return [...(next >= 0 ? html.slice(start, next) : html.slice(start)).matchAll(/Testcase #(\d+)/g)].map((match) => Number(match[1]));
}
