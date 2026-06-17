import type * as vscode from 'vscode';
import * as vscodeModule from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPage, renderReportBody } from '../src/reportView';
import { JudgeReport, ProblemConfig, SampleStatus } from '../src/types';

describe('report verdict display', () => {
  afterEach(() => {
    (vscodeModule.env as { language: string }).language = 'en';
  });

  it('keeps the report summary acronym and shows testcase verdict full names in Chinese UI', () => {
    (vscodeModule.env as { language: string }).language = 'zh-cn';
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('<strong class="status status-mle">MLE</strong>');
    expect(html).toContain('Memory Limit Exceeded');
    expect(html).toContain('Wrong Answer');
    expect(html).toContain('Accepted');
    expect(html).not.toContain('statusPill verdict-pill verdict-mle">MLE</span>');
    expect(html).not.toContain('statusPill verdict-pill verdict-wa">WA</span>');
    expect(html).not.toContain('statusPill verdict-pill verdict-ac">AC</span>');
    expect(html).not.toContain('内存超限');
    expect(html).not.toContain('答案错误');
    expect(html).not.toContain('statusPill verdict-pill verdict-ac">通过</span>');
    expect(html).not.toContain('<strong>通过</strong>');
  });

  it('renders testcase rows as labeled items without a visible table header', () => {
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('class="testcaseHeader visually-hidden"');
    expect(html).toContain('<span class="infoLabel">Score:</span> 0</span>');
    expect(html).toContain('<span class="infoLabel">Time:</span> 2 ms</span>');
    expect(html).toContain('<span class="infoLabel">Memory:</span> 3.40 MB</span>');
    expect(html).not.toContain('scoreCell score-failed verdict-wa">0/0');
    expect(html).not.toContain('scoreCell score-failed verdict-mle">0/0');
    expect(html).not.toContain('<span class="metricCell">2 ms</span>');
    expect(html).not.toContain('<span class="metricCell">-</span>');
  });

  it('does not add extra verdict symbols before full status names', () => {
    const html = renderReportBody(workspace(), report());

    expect(html).not.toContain('class="statusIcon"');
    expect(html).not.toContain('&#10003;');
    expect(html).not.toContain('&times;');
    expect(html).toContain('<span class="statusPill verdict-pill verdict-wa">Wrong Answer</span>');
    expect(html).toContain('<span class="statusPill verdict-pill verdict-ac">Accepted</span>');
  });

  it('does not show earned slash total as the main testcase score', () => {
    const html = renderReportBody(workspace(), {
      ...report(),
      summary: { accepted: 0, total: 1 },
      samples: [{ ...sample('sample-2', 2, 'WA'), score: 0, scoreTotal: 5 }]
    });

    expect(html).toContain('<span class="infoLabel">Score:</span> 0</span>');
    expect(html).not.toContain('>0/5</span>');
    expect(html).not.toContain('Score:</span> 0/5');
  });

  it('keeps failed verdict color on status and score cells instead of the whole row', () => {
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('statusPill verdict-pill verdict-wa');
    expect(html).toContain('Wrong Answer');
    expect(html).toContain('statusPill verdict-pill verdict-mle');
    expect(html).toContain('Memory Limit Exceeded');
    expect(html).toContain('scoreCell score-failed verdict-wa');
    expect(html).toContain('scoreCell score-failed verdict-mle');
    expect(html).toContain('infoCell metricCell"><span class="infoLabel">Time:</span> 2 ms</span>');
    expect(html).toContain('infoCell metricCell"><span class="infoLabel">Memory:</span> 3.40 MB</span>');
    expect(html).not.toContain('testcaseRow  status-wa');
    expect(html).not.toContain('testcaseRow  status-mle');
    expect(html).not.toContain('metricCell verdict-wa');
    expect(html).not.toContain('metricCell verdict-mle');
  });

  it('uses full names for additional verdicts such as TLE', () => {
    const html = renderReportBody(workspace(), {
      ...report(),
      summary: { accepted: 0, total: 1 },
      samples: [sample('sample-4', 4, 'TLE')]
    });

    expect(html).toContain('Time Limit Exceeded');
    expect(html).not.toContain('statusPill verdict-pill verdict-tle">TLE</span>');
  });

  it('renders flattened animated detail panels without an inner detail card', () => {
    const html = renderReportBody(workspace(), report());

    expect(html).toContain('class="case-detail-panel');
    expect(html).toContain('class="case-detail-inner"');
    expect(html).toContain('class="detailBlock detail-section"');
    expect(html).toContain('class="detail-section-title"');
    expect(html).toContain('class="detail-code"');
    expect(html).toContain('class="detail-action" data-command="input"');
    expect(html).toContain('class="detail-action" data-command="diff"');
    expect(html).toMatch(/class="case-detail-inner">\s*<section class="detailBlock detail-section"/);
    expect(html).not.toContain('detail-card');
    expect(html).not.toContain('testcaseDetails');
  });

  it('renders subtasks as grouped rows and indents child testcases', () => {
    const html = renderReportBody(workspace(), report(), 'A', problemWithSubtask());

    expect(html).toContain('class="testcaseGroup subtask-row"');
    expect(html).toContain('class="subtask-summary"');
    expect(html).toContain('class="subtask-children-panel expanded"');
    expect(html).toContain('class="subtask-children-inner testcaseGroupBody"');
    expect(html).toContain('statusPill verdict-pill verdict-wa');
    expect(html).toContain('Wrong Answer');
    expect(html).toContain('class="testcaseRow nested-case"');
    expect(html).not.toContain('subtask-row status-wa');
  });

  it('includes CSS and JS hooks for smooth testcase expansion', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report()));
    const expandDuration = cssDurationMs(html, '--oj-expand-duration');
    const driftDuration = cssDurationMs(html, '--oj-content-drift-duration');

    expect(html).toContain('case-detail-panel');
    expect(expandDuration).toBeGreaterThanOrEqual(600);
    expect(html).toContain('--oj-expand-duration: 650ms;');
    expect(html).toContain('--oj-expand-easing: cubic-bezier(0.22, 1, 0.36, 1);');
    expect(driftDuration).toBeGreaterThan(expandDuration);
    expect(html).toContain('--oj-content-drift-duration: 900ms;');
    expect(html).toContain('--oj-content-drift-easing: cubic-bezier(0.16, 1, 0.3, 1);');
    expect(html).toContain('--oj-content-start-opacity: 0.12;');
    expect(html).toContain('transition:');
    expect(html).toContain('transition: height var(--oj-expand-duration) var(--oj-expand-easing);');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain('panel.style.height = panel.scrollHeight +');
    expect(html).toContain("panel.style.height = 'auto';");
    expect(html).toContain("event.propertyName !== 'height'");
    expect(html).toContain('requestAnimationFrame(() => syncPanelHeight(subtaskPanel));');
    expect(html).not.toContain('style.maxHeight');
    expect(html).not.toContain('style.display');
  });

  it('fades and drifts expanded content without blur, scale, or filter animation', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report(), 'A', problemWithSubtask()));
    const driftOffset = cssPxValue(html, 'top');
    const startOpacity = cssVariableNumber(html, '--oj-content-start-opacity');

    expect(html).toContain('.case-detail-inner,');
    expect(html).toContain('.subtask-children-inner');
    expect(startOpacity).toBeGreaterThan(0);
    expect(startOpacity).toBeLessThan(1);
    expect(html).toContain('opacity: var(--oj-content-start-opacity);');
    expect(Math.abs(driftOffset)).toBeLessThanOrEqual(4);
    expect(html).toContain('top: -3px;');
    expect(html).toContain('top var(--oj-content-drift-duration) var(--oj-content-drift-easing),');
    expect(html).toContain('opacity var(--oj-content-drift-duration) var(--oj-content-drift-easing);');
    expect(html).toContain('.case-detail-panel.expanded .case-detail-inner');
    expect(html).toContain('.subtask-children-panel.expanded .subtask-children-inner');
    expect(html).toContain('opacity: 1;');
    expect(html).toContain('top: 0;');
    expect(html).not.toContain('scale(');
    expect(html).not.toContain('filter:');
    expect(html).not.toContain('blur(');
    expect(html).not.toContain('opacity var(--oj-expand-duration)');
    expect(html).not.toContain('will-change: transform');
    expect(html).not.toContain('transform var(--oj-expand-duration)');
  });

  it('disables report expansion motion for reduced motion preferences', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report(), 'A', problemWithSubtask()));

    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).toContain('.case-detail-panel,');
    expect(html).toContain('.subtask-children-panel,');
    expect(html).toContain('.case-detail-inner,');
    expect(html).toContain('.subtask-children-inner,');
    expect(html).toContain('transition: none;');
    expect(html).toContain('opacity: 1;');
    expect(html).toContain('top: 0;');
  });

  it('uses soft report detail actions instead of default solid VS Code buttons', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report()));

    expect(html).toContain('--oj-soft-button-bg');
    expect(html).toContain('--oj-soft-button-hover-bg');
    expect(html).toContain('--oj-soft-button-active-bg');
    expect(html).toContain('.detail-action');
    expect(html).toContain('background: var(--oj-soft-button-bg);');
    expect(html).not.toContain('background: var(--vscode-button-background);');
    expect(html).toContain('outline: 1px solid var(--vscode-focusBorder);');
  });

  it('keeps failure colors restrained and away from neutral metric columns', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report()));

    expect(html).toContain('--oj-score-failed');
    expect(html).toContain('.scoreCell.score-failed');
    expect(html).toContain('color: var(--oj-score-failed);');
    expect(html).toContain('statusPill verdict-pill verdict-wa');
    expect(html).toContain('Wrong Answer');
    expect(html).toContain('scoreCell score-failed verdict-wa');
    expect(html).toContain('infoCell metricCell"><span class="infoLabel">Time:</span> 2 ms</span>');
    expect(html).not.toContain('metricCell verdict-wa');
    expect(html).not.toContain('metricCell score-failed');
    expect(html).not.toContain('testcaseRow status-wa');
  });

  it('uses lightweight subtask grouping and a subtle nested testcase guide', () => {
    const html = renderPage('Report', renderReportBody(workspace(), report(), 'A', problemWithSubtask()));

    expect(html).toContain('--oj-border-subtle');
    expect(html).toContain('--oj-indent-guide');
    expect(html).toContain('--oj-row-text');
    expect(html).toContain('--oj-row-muted');
    expect(html).toContain('subtask-children-panel');
    expect(html).toContain('subtask-children-inner');
    expect(html).toContain('class="testcaseGroup subtask-row"');
    expect(html).toContain('class="subtask-summary"');
    expect(html).toContain('<span class="infoLabel">Score:</span> 0/66</span>');
    expect(html).toContain('<span class="infoLabel">Accepted:</span> 0/2</span>');
    expect(html).toContain('height var(--oj-expand-duration) var(--oj-expand-easing)');
    expect(html).toContain('border: 1px solid var(--oj-border-subtle);');
    expect(html).toContain('background: var(--oj-indent-guide);');
    expect(html).toContain('opacity: 0.72;');
    expect(html).not.toContain('subtask-row status-wa');
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

function cssDurationMs(html: string, variableName: string): number {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escapedName}:\\s*(\\d+)ms;`));
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

function cssVariableNumber(html: string, variableName: string): number {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escapedName}:\\s*(-?\\d+(?:\\.\\d+)?);`));
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

function cssPxValue(html: string, propertyName: string): number {
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escapedName}:\\s*(-?\\d+)px;`));
  expect(match).not.toBeNull();
  return Number(match?.[1]);
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
    elapsedMs: index,
    memoryKiB: index === 2 ? 3482 : undefined
  };
}
