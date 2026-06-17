import type * as vscode from 'vscode';
import * as vscodeModule from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { renderReportBody } from '../src/reportView';
import { JudgeReport, SampleStatus } from '../src/types';

describe('report verdict display', () => {
  afterEach(() => {
    (vscodeModule.env as { language: string }).language = 'en';
  });

  it('shows verdict acronyms in the report summary and testcase table in Chinese UI', () => {
    (vscodeModule.env as { language: string }).language = 'zh-cn';
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('<strong>MLE</strong>');
    expect(html).toContain('statusPill status-mle">MLE</span>');
    expect(html).toContain('statusPill status-wa">WA</span>');
    expect(html).toContain('statusPill status-ac">AC</span>');
    expect(html).not.toContain('内存超限');
    expect(html).not.toContain('答案错误');
    expect(html).not.toContain('statusPill status-ac">通过</span>');
    expect(html).not.toContain('<strong>通过</strong>');
  });

  it('shows the new judge mode labels in report metadata', () => {
    expect(renderReportBody(workspace(), {
      ...report(),
      judgeMode: 'strictText'
    })).toContain('<strong>Text Compare</strong>');
    expect(renderReportBody(workspace(), {
      ...report(),
      judgeMode: 'trimTrailingWhitespace'
    })).toContain('<strong>Text Compare (ignore trailing whitespace and final newlines)</strong>');
    expect(renderReportBody(workspace(), {
      ...report(),
      judgeMode: 'checker'
    })).toContain('<strong>Custom Checker</strong>');
  });
});

function workspace(): vscode.WorkspaceFolder {
  return {
    uri: { fsPath: 'E:\\Hzq Program\\OIjudge' }
  } as vscode.WorkspaceFolder;
}

function report(): JudgeReport {
  return {
    version: 1,
    generatedAt: '2026-06-16T00:00:00.000Z',
    source: 'main.cpp',
    sourceName: 'main.cpp',
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    summary: { accepted: 1, total: 3 },
    score: { earned: 1, total: 3 },
    samples: [
      sample('sample-1', 1, 'MLE'),
      sample('sample-2', 2, 'WA'),
      sample('sample-3', 3, 'AC')
    ],
    results: []
  };
}

function sample(id: string, index: number, status: SampleStatus) {
  return {
    id,
    index,
    name: `Sample ${index}`,
    input: `${index}.in`,
    answer: `${index}.out`,
    actualOutput: `${index}.txt`,
    status,
    timeMs: index,
    elapsedMs: index
  };
}
