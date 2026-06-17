import type * as vscode from 'vscode';
import * as vscodeModule from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPage, renderReportBody } from '../src/reportView';
import { JudgeReport, ProblemConfig, SampleStatus } from '../src/types';

describe('report verdict display', () => {
  afterEach(() => {
    (vscodeModule.env as { language: string }).language = 'en';
  });

  it('shows verdict acronyms in the report summary and testcase table in Chinese UI', () => {
    (vscodeModule.env as { language: string }).language = 'zh-cn';
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('<strong class="status status-mle">MLE</strong>');
    expect(html).toContain('statusPill verdict-pill verdict-mle">MLE</span>');
    expect(html).toContain('statusPill verdict-pill verdict-wa">WA</span>');
    expect(html).toContain('statusPill verdict-pill verdict-ac">AC</span>');
    expect(html).not.toContain('内存超限');
    expect(html).not.toContain('答案错误');
    expect(html).not.toContain('statusPill verdict-pill verdict-ac">通过</span>');
    expect(html).not.toContain('<strong>通过</strong>');
  });

  it('keeps failed verdict color on status and score cells instead of the whole row', () => {
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('statusPill verdict-pill verdict-wa">WA</span>');
    expect(html).toContain('statusPill verdict-pill verdict-mle">MLE</span>');
    expect(html).toContain('scoreCell score-failed verdict-wa">0/0');
    expect(html).toContain('scoreCell score-failed verdict-mle">0/0');
    expect(html).toContain('<span class="metricCell">2 ms</span>');
    expect(html).toContain('<span class="metricCell">-</span>');
    expect(html).not.toContain('testcaseRow  status-wa');
    expect(html).not.toContain('testcaseRow  status-mle');
    expect(html).not.toContain('metricCell verdict-wa');
    expect(html).not.toContain('metricCell verdict-mle');
  });

  it('renders animated detail panels with card-style detail blocks', () => {
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('class="case-detail-panel');
    expect(html).toContain('class="case-detail-inner"');
    expect(html).toContain('class="detailBlock detail-card"');
    expect(html).toContain('class="detail-code"');
  });

  it('renders subtasks as grouped rows and indents child testcases', () => {
    const html = renderReportBody(workspace(), report(), 'A', problemWithSubtask());

    expect(html).toContain('class="testcaseGroup subtask-row"');
    expect(html).toContain('class="subtask-summary"');
    expect(html).toContain('statusPill verdict-pill verdict-wa">WA</span>');
    expect(html).toContain('class="testcaseRow nested-case"');
    expect(html).not.toContain('subtask-row status-wa');
  });

  it('includes CSS and JS hooks for smooth testcase expansion', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report()));

    expect(html).toContain('case-detail-panel');
    expect(html).toContain('transition:');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain("panel?.classList.toggle('expanded'");
    expect(html).toContain('panel.style.maxHeight');
    expect(html).not.toContain('style.display');
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

function problemWithSubtask(): ProblemConfig {
  return {
    id: 'A',
    name: 'A',
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    samples: [
      { id: 'sample-1', index: 1, name: 'Sample 1', input: '1.in', answer: '1.out' },
      { id: 'sample-2', index: 2, name: 'Sample 2', input: '2.in', answer: '2.out' },
      { id: 'sample-3', index: 3, name: 'Sample 3', input: '3.in', answer: '3.out' }
    ],
    subtasks: [{
      id: 'subtask-1',
      name: 'Subtask 1',
      sampleIds: ['sample-1', 'sample-2'],
      scoringMode: 'bundle'
    }],
    standard: 'c++17',
    judgeMode: 'trimTrailingWhitespace'
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
