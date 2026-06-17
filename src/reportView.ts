import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import {
  ensureConfig,
  exists,
  getReportPath,
  getWorkspaceFolder,
  resolveWorkspacePath
} from './config';
import { t } from './i18n';
import { getDefaultProblemSource, getProblem, getProblemReportPath } from './problems';
import { explainRuntimeError, renderRuntimeErrorExplanation } from './runtimeErrorExplainer';
import { inferSampleSourceType } from './sampleFiles';
import { calculateEffectiveSampleScores, calculateJudgeScore } from './scoring';
import { JudgeReport, ProblemConfig, SampleConfig, SampleReport } from './types';
import { formatVerdictAcronym, formatVerdictFullName } from './verdict';

const maxSystemMessageLength = 12_000;

const openProblemReportPanels = new Map<string, {
  panel: vscode.WebviewPanel;
  workspaceFolder: vscode.WorkspaceFolder;
}>();

type JudgeReportViewModel = {
  status: string;
  statusText: string;
  earnedScore: number;
  totalScore: number;
  acceptedCount: number;
  totalCount: number;
  maxTimeMs?: number;
  maxMemoryKiB?: number;
  source: string;
  sourceName: string;
  judgeMode: string;
  ioMode: string;
  generatedAt: string;
  hasFailedCases: boolean;
  testcaseSections: JudgeReportTestcaseSectionViewModel[];
};

type JudgeReportTestcaseViewModel = {
  id: string;
  index: number;
  name: string;
  status: string;
  statusText: string;
  scoreEarned: number;
  scoreTotal: number;
  timeMs?: number;
  killedByTimeout?: boolean;
  hardKillLimitMs?: number;
  memoryKiB?: number;
  subtaskId?: string;
  systemMessage: string;
  sampleIndex?: number;
  hasCheckerOutput: boolean;
  defaultOpen: boolean;
};

type JudgeReportTestcaseSectionViewModel =
  | {
      kind: 'testcase';
      testcase: JudgeReportTestcaseViewModel;
    }
  | {
      kind: 'subtask';
      id: string;
      name: string;
      status: 'AC' | 'PARTIAL' | 'WA';
      statusText: string;
      scoreEarned: number;
      scoreTotal: number;
      passedCount: number;
      totalCount: number;
      defaultOpen: boolean;
      testcases: JudgeReportTestcaseViewModel[];
    };

export async function openLastReport(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const report = await readReport(workspaceFolder);
  if (!report) {
    vscode.window.showWarningMessage(t('noReport'));
    return;
  }

  await showReportPanel(context, workspaceFolder, report);
}

export async function openSampleDetail(context: vscode.ExtensionContext, sampleId?: number): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const config = await ensureConfig(workspaceFolder);
  const report = await readReport(workspaceFolder);
  const sample = config.samples.find((entry) => entry.index === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  await showSamplePanel(context, workspaceFolder, sample, report?.samples.find((entry) =>
    entry.id === sample.id || entry.index === sample.index || entry.name === sample.name
  ));
}

export async function openProblemReport(context: vscode.ExtensionContext, problemId: string): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const report = await readReportFile(getProblemReportPath(workspaceFolder, problemId));
  if (!report) {
    vscode.window.showWarningMessage(t('noReport'));
    return;
  }

  const problem = await getProblem(workspaceFolder, problemId);
  await showReportPanel(context, workspaceFolder, report, problemId, problem);
}

export async function refreshProblemReportPanel(problemId: string): Promise<void> {
  const entry = openProblemReportPanels.get(problemId);
  if (!entry) {
    return;
  }

  const report = await readReportFile(getProblemReportPath(entry.workspaceFolder, problemId));
  entry.panel.webview.html = renderPage(
    t('reportTitle'),
    report
      ? renderReportBody(entry.workspaceFolder, report, problemId, await getProblem(entry.workspaceFolder, problemId))
      : `<section><p>${escapeHtml(t('noReport'))}</p></section>`
  );
}

export async function openProblemSampleDetail(
  context: vscode.ExtensionContext,
  problemId: string,
  sampleId: number
): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  const report = await readReportFile(getProblemReportPath(workspaceFolder, problemId));
  const sample = problem.samples.find((entry) => entry.index === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  await showSamplePanel(context, workspaceFolder, sample, report?.samples.find((entry) =>
    entry.id === sample.id || entry.index === sample.index || entry.name === sample.name
  ), problemId);
}

async function readReport(workspaceFolder: vscode.WorkspaceFolder): Promise<JudgeReport | undefined> {
  const reportPath = getReportPath(workspaceFolder);
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return readReportFile(reportPath);
  } catch {
    return undefined;
  }
}

async function readReportFile(reportPath: string): Promise<JudgeReport | undefined> {
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
  } catch {
    return undefined;
  }
}

async function showReportPanel(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  report: JudgeReport,
  problemId?: string,
  problem?: ProblemConfig
): Promise<void> {
  const title = t('reportTitle');
  const panel = createPanel(context, title, problemId);
  if (problemId) {
    openProblemReportPanels.set(problemId, { panel, workspaceFolder });
    panel.onDidDispose(() => openProblemReportPanels.delete(problemId));
  }
  panel.webview.html = renderPage(title, renderReportBody(workspaceFolder, report, problemId, problem));
}

export function renderReportBody(
  workspaceFolder: vscode.WorkspaceFolder,
  report: JudgeReport,
  problemId?: string,
  problem?: ProblemConfig
): string {
  const viewModel = buildJudgeReportViewModel(report, problem);
  return `<section class="reportHero status-surface">
      <div>
        <span class="eyebrow">${escapeHtml(t('report.result'))}</span>
        <strong class="status ${statusClass(viewModel.status)}">${escapeHtml(viewModel.statusText)}</strong>
      </div>
      <div class="summaryGrid">
        <div><span>${escapeHtml(t('report.score'))}</span><strong>${viewModel.earnedScore}/${viewModel.totalScore}</strong></div>
        <div><span>${escapeHtml(t('report.accepted'))}</span><strong>${viewModel.acceptedCount}/${viewModel.totalCount}</strong></div>
        <div><span>${escapeHtml(t('report.maxTime'))}</span><strong>${escapeHtml(formatDuration(viewModel.maxTimeMs))}</strong></div>
        <div><span>${escapeHtml(t('report.maxMemory'))}</span><strong>${escapeHtml(formatMemory(viewModel.maxMemoryKiB))}</strong></div>
      </div>
    </section>
    <section class="metaStrip">
      <div><span>${escapeHtml(t('problem'))}</span><strong>${escapeHtml(problem?.name ?? '-')}</strong></div>
      <div><span>${escapeHtml(t('program'))}</span><strong>${escapeHtml(viewModel.sourceName)}</strong></div>
      <div><span>${escapeHtml(t('judgeMode'))}</span><strong>${escapeHtml(viewModel.judgeMode)}</strong></div>
      <div><span>${escapeHtml(t('ioMode'))}</span><strong>${escapeHtml(viewModel.ioMode)}</strong></div>
      <div><span>${escapeHtml(t('timeLimit'))}</span><strong>${report.timeLimitMs} ms</strong></div>
      <div><span>${escapeHtml(t('memoryLimit'))}</span><strong>${report.memoryLimitMb} MB</strong></div>
      ${isCheckerReport(report) ? `<div><span>${escapeHtml(t('checker'))}</span><strong>${escapeHtml(formatCheckerLine(report))}</strong></div>` : ''}
      ${getReportCheckerType(report) === 'plain' ? renderPlainCheckerProtocolSummary(report) : ''}
      <div><span>${escapeHtml(t('generated'))}</span><strong>${escapeHtml(viewModel.generatedAt)}</strong></div>
    </section>
    ${getReportCheckerType(report) === 'plain' ? `<section><h2>${escapeHtml(t('plainCheckerMode'))}</h2><p>${escapeHtml(formatPlainCheckerProtocol(report))}</p></section>` : ''}
    <section>
      <h2>${escapeHtml(t('source'))}</h2>
      <p class="path">${escapeHtml(viewModel.source)}</p>
    </section>
    <section>
      <h2>${escapeHtml(t('report.testcase'))}</h2>
      ${viewModel.hasFailedCases ? `<p class="reportHint">${escapeHtml(t('report.failedCasesFirstHint'))}</p>` : ''}
      <div class="testcaseTable" role="table" aria-label="${escapeHtml(t('report.testcase'))}">
        <div class="testcaseHeader visually-hidden" role="row">
          <span>${escapeHtml(t('report.testcase'))}</span>
          <span>${escapeHtml(t('status'))}</span>
          <span>${escapeHtml(t('report.score'))}</span>
          <span>${escapeHtml(t('time'))}</span>
          <span>${escapeHtml(t('memory'))}</span>
        </div>
        ${viewModel.testcaseSections.map((section) => renderTestcaseSection(section, problemId)).join('')}
      </div>
    </section>`;
}

function formatStack(report: JudgeReport): string {
  const stack = report.compile?.stack;
  if (!stack || !stack.enabled) {
    return t('stackDisabled');
  }
  return stack.sizeMb ? `${stack.sizeMb} MB` : '';
}

function formatJudgeMode(report: JudgeReport): string {
  if (isCheckerReport(report)) {
    return t('customChecker');
  }
  return report.judgeMode === 'strictText' ? t('strictTextCompare') : t('normalTextCompare');
}

function formatIoMode(report: JudgeReport): string {
  return report.ioMode === 'fileio' ? t('fileIo') : t('standardIo');
}

function formatSampleIoMode(sample: SampleReport): string {
  return sample.ioMode === 'fileio' ? t('fileIo') : t('standardIo');
}

function basename(filePath: string): string {
  return filePath.replace(/^.*[\\/]/u, '');
}

function buildJudgeReportViewModel(report: JudgeReport, problem?: ProblemConfig): JudgeReportViewModel {
  const score = problem ? calculateJudgeScore(problem, report.samples) : undefined;
  const effectiveScores = problem ? calculateEffectiveSampleScores(problem) : undefined;
  const testcases = report.samples.map((sample) => {
    const sampleIndex = getReportSampleIndex(sample);
    const scoreEarned = score?.sampleScores.get(sample.id) ?? sample.score ?? 0;
    const scoreTotal = effectiveScores?.sampleScores.get(sample.id)?.score ?? sample.scoreTotal ?? 0;
    return {
      id: sample.id,
      index: sample.index,
      name: sample.name || t('report.testcaseNumber', { index: sample.index }),
      status: sample.status,
      statusText: formatVerdictFullName(sample.status),
      scoreEarned,
      scoreTotal,
      timeMs: sample.timeMs ?? sample.elapsedMs,
      killedByTimeout: sample.killedByTimeout,
      hardKillLimitMs: sample.hardKillLimitMs,
      memoryKiB: getSampleMemoryKiB(sample),
      subtaskId: problem?.subtasks?.find((entry) => entry.sampleIds.includes(sample.id))?.id,
      systemMessage: buildSystemMessage(sample, report),
      sampleIndex,
      hasCheckerOutput: false,
      defaultOpen: false
    };
  });

  const testcaseSections = buildTestcaseSections(problem, testcases, score);

  return {
    status: getOverallStatus(report, score?.earnedScore),
    statusText: getOverallStatusText(report, score?.earnedScore),
    earnedScore: score?.earnedScore ?? report.score?.earned ?? 0,
    totalScore: score?.totalScore ?? report.score?.total ?? 100,
    acceptedCount: report.summary.accepted,
    totalCount: report.summary.total,
    maxTimeMs: getMaxTimeMs(report.samples),
    maxMemoryKiB: getMaxMemoryKiB(report.samples),
    source: report.source,
    sourceName: report.sourceName ?? basename(report.source || (problem ? getDefaultProblemSource(problem) : '') || ''),
    judgeMode: formatJudgeMode(report),
    ioMode: formatIoMode(report),
    generatedAt: new Date(report.generatedAt).toLocaleString(),
    hasFailedCases: testcases.some((testcase) => getReportCaseSortRank(testcase) < 2),
    testcaseSections
  };
}

export function sortCasesForReportDisplay<T extends { status: string }>(cases: readonly T[]): T[] {
  return cases
    .map((testcase, index) => ({ testcase, index }))
    .sort((left, right) => {
      const rankDelta = getReportCaseSortRank(left.testcase) - getReportCaseSortRank(right.testcase);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .map((entry) => entry.testcase);
}

function getReportCaseSortRank(testcase: { status: string }): number {
  if (testcase.status === 'AC' || testcase.status === 'Accepted') {
    return 2;
  }
  if (testcase.status === 'Skipped') {
    return 1;
  }
  return 0;
}

function buildTestcaseSections(
  problem: ProblemConfig | undefined,
  testcases: JudgeReportTestcaseViewModel[],
  score: ReturnType<typeof calculateJudgeScore> | undefined
): JudgeReportTestcaseSectionViewModel[] {
  if (!problem?.subtasks?.length) {
    return sortCasesForReportDisplay(testcases).map((testcase) => ({ kind: 'testcase', testcase }));
  }

  const grouped = new Map<string, JudgeReportTestcaseViewModel[]>();
  const rootTestcases: JudgeReportTestcaseViewModel[] = [];
  for (const testcase of testcases) {
    if (testcase.subtaskId) {
      const list = grouped.get(testcase.subtaskId) ?? [];
      list.push(testcase);
      grouped.set(testcase.subtaskId, list);
    } else {
      rootTestcases.push(testcase);
    }
  }

  const sections: JudgeReportTestcaseSectionViewModel[] = [];
  for (const testcase of sortCasesForReportDisplay(rootTestcases)) {
    sections.push({ kind: 'testcase', testcase });
  }

  for (const subtask of problem.subtasks) {
    const subtaskTestcases = grouped.get(subtask.id) ?? [];
    if (subtaskTestcases.length === 0) {
      continue;
    }
    const subtaskScore = score?.subtaskScores.get(subtask.id) ?? { earned: 0, total: 0 };
    const passedCount = subtaskTestcases.filter((testcase) => testcase.status === 'AC' || testcase.status === 'Scored').length;
    const totalCount = subtaskTestcases.length;
    const status = subtaskStatus(subtaskScore.earned, subtaskScore.total, passedCount, totalCount);
    sections.push({
      kind: 'subtask',
      id: subtask.id,
      name: subtask.name,
      status,
      statusText: subtaskStatusText(status),
      scoreEarned: subtaskScore.earned,
      scoreTotal: subtaskScore.total,
      passedCount,
      totalCount,
      defaultOpen: true,
      testcases: sortCasesForReportDisplay(subtaskTestcases)
    });
  }

  return sections;
}

function subtaskStatus(
  earned: number,
  total: number,
  passedCount: number,
  totalCount: number
): 'AC' | 'PARTIAL' | 'WA' {
  if (totalCount > 0 && passedCount === totalCount && earned >= total) {
    return 'AC';
  }
  if (earned > 0) {
    return 'PARTIAL';
  }
  return 'WA';
}

function subtaskStatusText(status: 'AC' | 'PARTIAL' | 'WA'): string {
  return formatVerdictFullName(status);
}

function renderTestcaseSection(section: JudgeReportTestcaseSectionViewModel, problemId?: string): string {
  if (section.kind === 'testcase') {
    return renderTestcaseRow(section.testcase, problemId);
  }
  return `<div class="testcaseGroup subtask-row" data-subtask-row>
    <button type="button" class="subtask-summary" aria-expanded="${section.defaultOpen ? 'true' : 'false'}">
      <span class="testcaseName">${escapeHtml(section.name)}</span>
      ${renderVerdictStatus(section.status, section.statusText)}
      <span class="infoCell scoreCell ${scoreClass(section.scoreEarned, section.scoreTotal, section.status)}"><span class="infoLabel">${escapeHtml(t('report.score'))}:</span> ${section.scoreEarned}/${section.scoreTotal}</span>
      <span class="infoCell metricCell"><span class="infoLabel">${escapeHtml(t('report.accepted'))}:</span> ${section.passedCount}/${section.totalCount}</span>
    </button>
    <div class="subtask-children-panel${section.defaultOpen ? ' expanded' : ''}" data-subtask-children aria-hidden="${section.defaultOpen ? 'false' : 'true'}">
      <div class="subtask-children-inner testcaseGroupBody">
        ${section.testcases.map((testcase) => renderTestcaseRow(testcase, problemId, true)).join('')}
      </div>
    </div>
  </div>`;
}

function renderTestcaseRow(testcase: JudgeReportTestcaseViewModel, problemId?: string, nested = false): string {
  const details = renderTestcaseDetails(testcase, problemId);
  const expanded = testcase.defaultOpen ? ' expanded' : '';
  return `<div class="testcaseRow${nested ? ' nested-case' : ''}" data-case-row>
    <button type="button" class="case-summary" aria-expanded="${testcase.defaultOpen ? 'true' : 'false'}">
      <span class="testcaseName">${escapeHtml(t('report.testcaseNumber', { index: testcase.index }))}</span>
      ${renderVerdictStatus(testcase.status, testcase.statusText)}
      <span class="infoCell scoreCell ${scoreClass(testcase.scoreEarned, testcase.scoreTotal, testcase.status)}"><span class="infoLabel">${escapeHtml(t('report.score'))}:</span> ${testcase.scoreEarned}</span>
      <span class="infoCell metricCell"><span class="infoLabel">${escapeHtml(t('time'))}:</span> ${escapeHtml(formatTestcaseDuration(testcase))}</span>
      <span class="infoCell metricCell"><span class="infoLabel">${escapeHtml(t('memory'))}:</span> ${escapeHtml(formatMemory(testcase.memoryKiB))}</span>
    </button>
    <div class="case-detail-panel${expanded}" data-case-detail aria-hidden="${testcase.defaultOpen ? 'false' : 'true'}">
      <div class="case-detail-inner">
        ${details}
      </div>
    </div>
  </div>`;
}

function renderVerdictStatus(status: string, statusText: string): string {
  return `<span class="statusPill verdict-pill ${verdictClass(status)}">${escapeHtml(statusText)}</span>`;
}

function renderTestcaseDetails(testcase: JudgeReportTestcaseViewModel, problemId?: string): string {
  return `${renderDetailBlock(t('report.systemInfo'), testcase.systemMessage) || renderDetailBlock(t('report.systemInfo'), t('report.noDetails'))}
    ${renderReportActionButtons(testcase.sampleIndex, problemId, testcase.status)}
  `;
}

function renderDetailBlock(title: string, content: string | undefined): string {
  if (!content || !content.trim()) {
    return '';
  }
  return `<section class="detailBlock detail-section">
    <h3 class="detail-section-title">${escapeHtml(title)}</h3>
    <pre class="detail-code">${escapeHtml(content.trimEnd())}</pre>
  </section>`;
}

async function showSamplePanel(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  report: SampleReport | undefined,
  problemId?: string
): Promise<void> {
  const status = report?.status ?? 'Not Run';
  const elapsed = report ? `${formatMs(report.timeMs ?? report.elapsedMs)} ms` : '-';
  const compareElapsed = report?.compareTimeMs !== undefined ? `${formatMs(report.compareTimeMs)} ms` : '-';
  const sourceType = inferSampleSourceType(workspaceFolder, sample);
  const title = t('sampleDetail', { sample: sample.name });
  const panel = createPanel(context, title, problemId);
  panel.webview.html = renderPage(
    title,
    `<section class="summary">
      <div><span>${escapeHtml(t('status'))}</span><strong class="status ${statusClass(status)}">${escapeHtml(statusLabel(status))}</strong></div>
      <div><span>${escapeHtml(t('elapsed'))}</span><strong>${escapeHtml(elapsed)}</strong></div>
      <div><span>${escapeHtml(t('compareTime'))}</span><strong>${escapeHtml(compareElapsed)}</strong></div>
      <div><span>${escapeHtml(t('source'))}</span><strong>${escapeHtml(t(sourceType === 'external' ? 'externalSample' : 'managedSample'))}</strong></div>
      ${report ? `<div><span>${escapeHtml(t('ioMode'))}</span><strong>${escapeHtml(formatSampleIoMode(report))}</strong></div>` : ''}
      ${report?.ioMode === 'fileio' && report.fileIo ? `<div><span>${escapeHtml(t('inputFile'))}</span><strong>${escapeHtml(report.fileIo.inputFileName)}</strong></div>
      <div><span>${escapeHtml(t('outputFile'))}</span><strong>${escapeHtml(report.fileIo.outputFileName)}</strong></div>` : ''}
      ${report?.status === 'Scored' ? `<div><span>${escapeHtml(t('checkerScore'))}</span><strong>${escapeHtml(report.checker?.scoreText ?? String(report.score ?? ''))}</strong></div>` : ''}
      ${report?.score !== undefined && report.scoreTotal !== undefined ? `<div><span>${escapeHtml(t('score.total'))}</span><strong>${report.score}/${report.scoreTotal}</strong></div>` : ''}
      <div><span>${escapeHtml(t('input'))}</span><strong>${escapeHtml(sample.input)}</strong></div>
      <div><span>${escapeHtml(t('answer'))}</span><strong>${escapeHtml(sample.answer)}</strong></div>
    </section>
    ${report ? renderRuntimeErrorDetails(report) : ''}
    ${report ? renderCheckerErrorDetails(report) : ''}
    ${report?.message ? `<section><h2>${escapeHtml(t('message'))}</h2><p>${escapeHtml(report.message)}</p></section>` : ''}
    <section>
      <h2>${escapeHtml(t('actions'))}</h2>
      ${renderActionButtons(sample.index, problemId, status, Boolean(report?.checker?.output || report?.checker?.stdout || report?.checker?.stderr))}
    </section>`
  );
}

function createPanel(context: vscode.ExtensionContext, title: string, problemId?: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'oijudgerReport',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [context.extensionUri]
    }
  );
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!problemId || typeof message !== 'object' || message === null) {
      return;
    }
    const typed = message as { command?: unknown; sampleId?: unknown };
    if (typeof typed.command !== 'string' || typeof typed.sampleId !== 'number') {
      return;
    }

    const commandMap: Record<string, string> = {
      input: 'oijudger.openSampleInput',
      expected: 'oijudger.openSampleAnswer',
      output: 'oijudger.openSampleUserOutput',
      diff: 'oijudger.openSampleDiff',
      copyFreopen: 'oijudger.copyTestcaseFreopenInput',
      delete: 'oijudger.deleteSample'
    };
    const command = commandMap[typed.command];
    if (command) {
      if (typed.command === 'diff') {
        await vscode.commands.executeCommand(command, {
          problemId,
          sampleId: typed.sampleId,
          sourceViewColumn: panel.viewColumn
        });
        return;
      }
      await vscode.commands.executeCommand(command, problemId, typed.sampleId);
    }
  });
  return panel;
}

function renderSampleCard(
  workspaceFolder: vscode.WorkspaceFolder,
  report: JudgeReport,
  sample: SampleReport,
  problemId?: string
): string {
  const outputPath = resolveWorkspacePath(workspaceFolder, sample.output ?? sample.actualOutput);
  const sourceType = sample.sampleSourceType ?? 'managed';
  const sampleIndex = getReportSampleIndex(sample);
  return `<article class="sample">
    <div class="sampleHead">
      <strong>${escapeHtml(sample.name)}</strong>
      <span class="status ${statusClass(sample.status)}">${escapeHtml(statusLabel(sample.status))}</span>
    </div>
    <dl>
      <dt>${escapeHtml(t('elapsed'))}</dt><dd>${formatSampleDuration(sample)}</dd>
      <dt>${escapeHtml(t('compareTime'))}</dt><dd>${formatDuration(sample.compareTimeMs)}</dd>
      <dt>${escapeHtml(t('source'))}</dt><dd>${escapeHtml(t(sourceType === 'external' ? 'externalSample' : 'managedSample'))}</dd>
      ${sample.status === 'Scored' ? `<dt>${escapeHtml(t('checkerScore'))}</dt><dd>${escapeHtml(sample.checker?.scoreText ?? String(sample.score ?? ''))}</dd>` : ''}
      ${sample.score !== undefined && sample.scoreTotal !== undefined ? `<dt>${escapeHtml(t('score.total'))}</dt><dd>${sample.score}/${sample.scoreTotal}</dd>` : ''}
      ${sample.checker?.message ? `<dt>${escapeHtml(t('checker'))}</dt><dd>${escapeHtml(sample.checker.message)}</dd>` : ''}
      <dt>${escapeHtml(t('ioMode'))}</dt><dd>${escapeHtml(formatSampleIoMode(sample))}</dd>
      ${sample.ioMode === 'fileio' && sample.fileIo ? `<dt>${escapeHtml(t('runDirectory'))}</dt><dd>${escapeHtml(sample.fileIo.runDir ?? '-')}</dd>
      <dt>${escapeHtml(t('inputFile'))}</dt><dd>${escapeHtml(sample.fileIo.inputFileName)}</dd>
      <dt>${escapeHtml(t('outputFile'))}</dt><dd>${escapeHtml(sample.fileIo.outputFileName)}</dd>` : ''}
      <dt>${escapeHtml(t('input'))}</dt><dd>${escapeHtml(sample.input)}</dd>
      <dt>${escapeHtml(t('answer'))}</dt><dd>${escapeHtml(sample.answer)}</dd>
      <dt>${escapeHtml(t('userOutput'))}</dt><dd>${escapeHtml(sample.output ?? sample.actualOutput)}</dd>
    </dl>
    ${sample.message ? `<p>${escapeHtml(sample.message)}</p>` : ''}
    ${renderRuntimeErrorDetails(sample)}
    ${renderCheckerErrorDetails(sample)}
    <p class="path">${escapeHtml(outputPath)}</p>
    ${renderActionButtons(sampleIndex, problemId, sample.status, isCheckerReport(report) && Boolean(sample.checker?.output || sample.checker?.stdout || sample.checker?.stderr))}
  </article>`;
}

function renderRuntimeErrorDetails(sample: SampleReport): string {
  if (sample.status !== 'RE') {
    return '';
  }

  const explanation = explainRuntimeError({
    exitCode: sample.runtimeError?.rawExitCode ?? sample.exitCode,
    signal: sample.runtimeError?.rawSignal ?? sample.signal,
    spawnError: sample.spawnError,
    runnerError: sample.runnerError,
    platform: process.platform
  });
  if (!explanation) {
    return '';
  }

  return `<section class="runtimeError">
    <h2>${escapeHtml(t('runtimeErrorDetails'))}</h2>
    <pre>${escapeHtml(renderRuntimeErrorExplanation(explanation, { stderrEmpty: sample.stderrPreview === '' }))}</pre>
  </section>`;
}

function renderCheckerErrorDetails(sample: SampleReport): string {
  if (sample.status !== 'Checker Error' || !sample.checker?.errorName) {
    return '';
  }

  const checker = sample.checker;
  const errorName = checker.errorName ?? 'Checker Error';
  const exitCode = checker.exitCode !== undefined && checker.exitCode !== null
    ? `<p><strong>${escapeHtml(t('exitCode'))}:</strong> ${checker.exitCode}${checker.exitCodeHex ? ` (${escapeHtml(checker.exitCodeHex)})` : ''}</p>`
    : '';
  return `<section class="runtimeError">
    <h2>${escapeHtml(t('checkerError'))}: ${escapeHtml(errorName)}</h2>
    ${exitCode}
    ${checker.message ? `<pre>${escapeHtml(checker.message)}</pre>` : ''}
  </section>`;
}

function renderActionButtons(
  sampleId: number | undefined,
  problemId: string | undefined,
  status: string,
  _hasCheckerOutput: boolean
): string {
  if (status === 'CE') {
    return '';
  }
  const disabled = problemId && sampleId !== undefined ? '' : ' disabled';
  const sampleValue = sampleId ?? '';
  return `<div class="buttons">
    <button class="detail-action" data-command="input" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('input'))}</button>
    <button class="detail-action" data-command="expected" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('expectedOutput'))}</button>
    <button class="detail-action" data-command="output" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('runResult'))}</button>
    <button class="detail-action" data-command="copyFreopen" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('debug.copyFreopenInput'))}</button>
    <button class="detail-action" data-command="delete" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('delete'))}</button>
  </div>`;
}

function renderReportActionButtons(
  sampleId: number | undefined,
  problemId: string | undefined,
  status: string
): string {
  if (status === 'CE') {
    return '';
  }
  const disabled = problemId && sampleId !== undefined ? '' : ' disabled';
  const sampleValue = sampleId ?? '';
  const diffButton = status === 'WA'
    ? `\n    <button class="detail-action" data-command="diff" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('report.showDiff'))}</button>`
    : '';
  return `<div class="buttons">
    <button class="detail-action" data-command="input" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('input'))}</button>
    <button class="detail-action" data-command="expected" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('expectedOutput'))}</button>
    <button class="detail-action" data-command="output" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('runResult'))}</button>${diffButton}
  </div>`;
}

function isCheckerReport(report: JudgeReport): boolean {
  return report.judgeMode === 'checker' || report.judgeMode === 'testlib' || report.judgeMode === 'plain';
}

function getReportCheckerType(report: JudgeReport): 'testlib' | 'plain' | undefined {
  if (report.checkerType === 'testlib' || report.checkerType === 'plain') {
    return report.checkerType;
  }
  if (report.judgeMode === 'testlib' || report.judgeMode === 'plain') {
    return report.judgeMode;
  }
  return report.checker?.type === 'testlib' || report.checker?.type === 'plain' ? report.checker.type : undefined;
}

function formatCheckerLine(report: JudgeReport): string {
  const type = getReportCheckerType(report);
  const typeLabel = type === 'plain' ? t('plainCheckerMode') : type === 'testlib' ? t('testlibCheckerMode') : t('checkerNotSet');
  return report.checker?.source ? `${typeLabel}: ${basename(report.checker.source)}` : typeLabel;
}

function renderPlainCheckerProtocolSummary(report: JudgeReport): string {
  const options = getPlainCheckerProtocol(report);
  return `<div><span>${escapeHtml(t('verdictLine'))}</span><strong>${escapeHtml(t(options.verdictPosition === 'firstLine' ? 'plainVerdictFirstLine' : 'plainVerdictLastLine'))}</strong></div>
      <div><span>${escapeHtml(t('acceptedToken'))}</span><strong>${escapeHtml(options.acceptedToken)}</strong></div>
      <div><span>${escapeHtml(t('wrongAnswerToken'))}</span><strong>${escapeHtml(options.wrongAnswerToken)}</strong></div>`;
}

function formatPlainCheckerProtocol(report: JudgeReport): string {
  const options = getPlainCheckerProtocol(report);
  return [
    `${t('verdictLine')}: ${t(options.verdictPosition === 'firstLine' ? 'plainVerdictFirstLine' : 'plainVerdictLastLine')}`,
    `${t('acceptedToken')}: ${options.acceptedToken}`,
    `${t('wrongAnswerToken')}: ${options.wrongAnswerToken}`
  ].join('\n');
}

function getPlainCheckerProtocol(report: JudgeReport): {
  verdictPosition: 'firstLine' | 'lastLine';
  acceptedToken: string;
  wrongAnswerToken: string;
} {
  const firstPlainSample = report.samples.find((sample) => sample.checker?.type === 'plain' && sample.checker.verdictPosition);
  return {
    verdictPosition: report.checker?.plain?.verdictPosition ?? firstPlainSample?.checker?.verdictPosition ?? 'lastLine',
    acceptedToken: report.checker?.plain?.acceptedToken ?? firstPlainSample?.checker?.acceptedToken ?? 'AC',
    wrongAnswerToken: report.checker?.plain?.wrongAnswerToken ?? firstPlainSample?.checker?.wrongAnswerToken ?? 'WA'
  };
}

function getReportSampleIndex(sample: SampleReport): number | undefined {
  if (typeof sample.index === 'number' && Number.isFinite(sample.index) && sample.index > 0) {
    return sample.index;
  }

  const rawId = (sample as { id?: unknown }).id;
  if (typeof rawId === 'number' && Number.isFinite(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === 'string') {
    const idMatch = /^sample-(\d+)$/iu.exec(rawId);
    if (idMatch) {
      return Number(idMatch[1]);
    }
  }

  const nameMatch = /\bSample\s+(\d+)\b/iu.exec(sample.name);
  return nameMatch ? Number(nameMatch[1]) : undefined;
}

export function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      --oj-card-bg: var(--vscode-editorWidget-background);
      --oj-row-bg: var(--vscode-editor-background);
      --oj-row-hover-bg: var(--vscode-list-hoverBackground);
      --oj-border: var(--vscode-panel-border);
      --oj-border-subtle: var(--vscode-panel-border);
      --oj-detail-bg: var(--vscode-editor-background);
      --oj-soft-button-bg: var(--vscode-list-hoverBackground);
      --oj-soft-button-hover-bg: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground));
      --oj-soft-button-active-bg: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
      --oj-soft-button-border: var(--vscode-panel-border);
      --oj-indent-guide: var(--vscode-panel-border);
      --oj-row-text: var(--vscode-foreground);
      --oj-row-muted: var(--vscode-descriptionForeground);
      --oj-expand-duration: 650ms;
      --oj-expand-easing: cubic-bezier(0.22, 1, 0.36, 1);
      --oj-content-drift-duration: 900ms;
      --oj-content-drift-easing: cubic-bezier(0.16, 1, 0.3, 1);
      --oj-content-start-opacity: 0.12;
      --oj-muted: var(--vscode-descriptionForeground);
      --oj-text: var(--vscode-foreground);
      --oj-ac: var(--vscode-testing-iconPassed, #3fb950);
      --oj-wa: var(--vscode-errorForeground, var(--vscode-testing-iconFailed, #ff7b72));
      --oj-score-failed: var(--vscode-descriptionForeground);
      --oj-tle: #d29922;
      --oj-mle: #bc8cff;
      --oj-re: #f0883e;
      --oj-border-subtle: color-mix(in srgb, var(--vscode-panel-border) 36%, transparent);
      --oj-detail-bg: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-editorWidget-background) 6%);
      --oj-soft-button-bg: color-mix(in srgb, var(--vscode-editorWidget-background) 88%, var(--vscode-foreground) 12%);
      --oj-soft-button-hover-bg: color-mix(in srgb, var(--vscode-editorWidget-background) 80%, var(--vscode-foreground) 20%);
      --oj-soft-button-active-bg: color-mix(in srgb, var(--vscode-editorWidget-background) 74%, var(--vscode-foreground) 26%);
      --oj-soft-button-border: color-mix(in srgb, var(--vscode-panel-border) 68%, transparent);
      --oj-indent-guide: color-mix(in srgb, var(--vscode-panel-border) 42%, transparent);
      --oj-row-text: color-mix(in srgb, var(--vscode-foreground) 84%, var(--vscode-descriptionForeground) 16%);
      --oj-row-muted: color-mix(in srgb, var(--vscode-descriptionForeground) 86%, var(--vscode-editor-background) 14%);
      --oj-wa: color-mix(in srgb, var(--vscode-errorForeground, var(--vscode-testing-iconFailed, #ff7b72)) 72%, var(--vscode-foreground) 28%);
      --oj-score-failed: color-mix(in srgb, var(--oj-wa) 54%, var(--vscode-descriptionForeground) 46%);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 20px;
    }
    h1 { font-size: 22px; margin: 0 0 18px; }
    h2 { font-size: 14px; margin: 0 0 10px; }
    h3 { font-size: 12px; margin: 0 0 8px; }
    section { margin-bottom: 20px; }
    .reportHero,
    .metaStrip {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: var(--vscode-sideBar-background);
      margin-bottom: 16px;
      padding: 16px;
    }
    .reportHero {
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(180px, 0.8fr) minmax(280px, 2fr);
    }
    .reportHero strong {
      display: block;
      font-size: 26px;
      line-height: 1.2;
      margin-top: 4px;
    }
    .eyebrow,
    .metaStrip span,
    .summaryGrid span {
      color: var(--vscode-descriptionForeground);
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .summaryGrid,
    .metaStrip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
    }
    .summary div,
    .sample {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-sideBar-background);
    }
    .summary span,
    dt {
      color: var(--vscode-descriptionForeground);
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .summary strong { font-size: 16px; }
    .reportHint {
      color: var(--oj-row-muted);
      font-size: 12px;
      margin: -6px 0 8px;
    }
    .testcaseTable {
      border: 1px solid var(--oj-border);
      border-radius: 10px;
      min-width: 720px;
      overflow: hidden;
      background: var(--oj-row-bg);
    }
    .visually-hidden {
      border: 0;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      height: 1px;
      margin: -1px;
      overflow: hidden;
      padding: 0;
      position: absolute;
      white-space: nowrap;
      width: 1px;
    }
    .testcaseHeader,
    .case-summary,
    .subtask-summary {
      align-items: center;
      display: grid;
      grid-template-columns: minmax(120px, 1.15fr) minmax(150px, max-content) minmax(82px, max-content) minmax(96px, max-content) minmax(112px, max-content);
      gap: 12px;
      padding: 11px 14px;
    }
    .testcaseHeader > span,
    .case-summary > span,
    .subtask-summary > span {
      min-width: 0;
    }
    .testcaseHeader {
      background: var(--oj-card-bg);
      color: var(--oj-muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .testcaseRow {
      border-top: 1px solid var(--oj-border);
    }
    .case-summary {
      background: transparent;
      border: 0;
      border-radius: 0;
      color: var(--oj-text);
      cursor: pointer;
      font: inherit;
      list-style: none;
      text-align: left;
      width: 100%;
    }
    .case-summary:hover {
      background: var(--oj-row-hover-bg);
    }
    .subtask-row {
      border-top: 1px solid var(--oj-border-subtle);
      margin: 4px 6px;
    }
    .subtask-summary {
      background: var(--oj-detail-bg);
      border: 1px solid var(--oj-border-subtle);
      border-radius: 7px;
      color: var(--oj-text);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      text-align: left;
      width: 100%;
    }
    .subtask-summary:hover {
      background: var(--oj-row-hover-bg);
    }
    .subtask-summary {
      padding: 9px 12px;
    }
    .testcaseName::before {
      content: '▸';
      color: var(--oj-muted);
      display: inline-block;
      margin-right: 8px;
      transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
    }
    .case-summary[aria-expanded="true"] .testcaseName::before,
    .subtask-summary[aria-expanded="true"] .testcaseName::before {
      transform: rotate(90deg);
    }
    .nested-case .testcaseName {
      padding-left: 34px;
      position: relative;
    }
    .nested-case .testcaseName::after {
      background: var(--oj-indent-guide);
      content: '';
      height: 16px;
      left: 18px;
      opacity: 0.72;
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 1px;
    }
    .statusPill {
      align-items: center;
      display: inline-flex;
      gap: 6px;
      font-weight: 700;
      min-width: 0;
      white-space: nowrap;
      width: fit-content;
    }
    .testcaseName {
      color: var(--oj-row-text);
      font-weight: 520;
      min-width: 0;
    }
    .infoCell {
      color: var(--oj-row-muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .infoLabel {
      color: var(--oj-row-muted);
      font-weight: 500;
    }
    .scoreCell,
    .metricCell {
      font-variant-numeric: tabular-nums;
    }
    .scoreCell {
      font-weight: 650;
    }
    .score-passed { color: var(--oj-ac); }
    .score-failed,
    .score-partial { color: var(--oj-score-failed); }
    .score-muted { color: var(--oj-muted); }
    .verdict-ac { color: var(--oj-ac); }
    .verdict-wa,
    .verdict-ce,
    .verdict-err,
    .verdict-missing,
    .verdict-checker-error,
    .verdict-output-missing { color: var(--oj-wa); }
    .verdict-tle,
    .verdict-ole { color: var(--oj-tle); }
    .verdict-mle { color: var(--oj-mle); }
    .verdict-re { color: var(--oj-re); }
    .verdict-partial,
    .verdict-scored { color: var(--vscode-testing-iconQueued, #d29922); }
    .verdict-not-run { color: var(--oj-muted); }
    .scoreCell.score-failed,
    .scoreCell.score-partial { color: var(--oj-score-failed); }
    .case-detail-panel,
    .subtask-children-panel {
      height: 0;
      overflow: hidden;
      transition: height var(--oj-expand-duration) var(--oj-expand-easing);
    }
    .case-detail-inner {
      background: var(--oj-detail-bg);
      border-top: 1px solid var(--oj-border-subtle);
      padding: 2px 12px 10px 42px;
    }
    .case-detail-inner,
    .subtask-children-inner {
      opacity: var(--oj-content-start-opacity);
      position: relative;
      top: -3px;
      transition:
        top var(--oj-content-drift-duration) var(--oj-content-drift-easing),
        opacity var(--oj-content-drift-duration) var(--oj-content-drift-easing);
    }
    .case-detail-panel.expanded .case-detail-inner,
    .subtask-children-panel.expanded .subtask-children-inner {
      opacity: 1;
      top: 0;
    }
    .subtask-children-inner {
      padding: 4px 0 6px;
    }
    .testcaseGroupBody {
      border-top: 0;
      margin: 0 2px 4px;
    }
    .detailBlock {
      margin-bottom: 10px;
    }
    .detail-section {
      padding-top: 8px;
    }
    .detail-section-title {
      color: var(--oj-muted);
      font-size: 12px;
      font-weight: 600;
      margin: 0 0 8px;
      text-transform: uppercase;
    }
    dl {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: 4px 8px;
      margin: 0;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .buttons button,
    .detail-action {
      background: var(--oj-soft-button-bg);
      border: 1px solid var(--oj-soft-button-border);
      border-radius: 6px;
      color: var(--vscode-foreground);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      line-height: 1.4;
      padding: 4px 9px;
    }
    .buttons button:hover,
    .detail-action:hover {
      background: var(--oj-soft-button-hover-bg);
    }
    .buttons button:active,
    .detail-action:active {
      background: var(--oj-soft-button-active-bg);
    }
    .buttons button:focus-visible,
    .detail-action:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .buttons button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .status { font-weight: 700; }
    .status-ac { color: var(--vscode-testing-iconPassed); }
    .status-wa,
    .status-tle,
    .status-re,
    .status-ce,
    .status-err,
    .status-missing,
    .status-checker-error,
    .status-output-missing { color: var(--vscode-testing-iconFailed); }
    .status-partial,
    .status-scored { color: var(--vscode-testing-iconQueued); }
    .status-not-run { color: var(--vscode-descriptionForeground); }
    .path {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      border-radius: 6px;
      margin: 0;
      overflow-x: auto;
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    @media (prefers-reduced-motion: reduce) {
      .case-detail-panel,
      .subtask-children-panel,
      .case-detail-inner,
      .subtask-children-inner,
      .testcaseName::before {
        transition: none;
      }
      .case-detail-inner,
      .subtask-children-inner,
      .testcaseName::before {
        opacity: 1;
        top: 0;
        transform: none;
      }
    }
    @media (max-width: 780px) {
      .reportHero { grid-template-columns: 1fr; }
      section:has(.testcaseTable) {
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
  <script>
    const vscode = acquireVsCodeApi();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preparePanel = (panel) => {
      if (!panel) {
        return;
      }
      panel.style.height = panel.classList.contains('expanded') ? 'auto' : '0px';
      panel.setAttribute('aria-hidden', panel.classList.contains('expanded') ? 'false' : 'true');
    };
    const syncPanelHeight = (panel) => {
      if (!panel) {
        return;
      }
      if (panel.classList.contains('expanded') && panel.style.height !== 'auto') {
        panel.style.height = panel.scrollHeight + 'px';
      }
    };
    const expandPanel = (panel) => {
      if (!panel) {
        return;
      }
      panel.classList.add('expanded');
      panel.setAttribute('aria-hidden', 'false');
      if (prefersReducedMotion.matches) {
        panel.style.height = 'auto';
        return;
      }
      panel.style.height = panel.getBoundingClientRect().height + 'px';
      panel.offsetHeight;
      requestAnimationFrame(() => {
        panel.style.height = panel.scrollHeight + 'px';
      });
    };
    const collapsePanel = (panel) => {
      if (!panel) {
        return;
      }
      panel.setAttribute('aria-hidden', 'true');
      if (prefersReducedMotion.matches) {
        panel.classList.remove('expanded');
        panel.style.height = '0px';
        return;
      }
      panel.style.height = panel.scrollHeight + 'px';
      panel.offsetHeight;
      requestAnimationFrame(() => {
        panel.classList.remove('expanded');
        panel.style.height = '0px';
      });
    };
    const togglePanel = (panel, expanded) => {
      if (expanded) {
        expandPanel(panel);
      } else {
        collapsePanel(panel);
      }
    };
    document.querySelectorAll('[data-case-detail], [data-subtask-children]').forEach((panel) => {
      preparePanel(panel);
      panel.addEventListener('transitionend', (event) => {
        if (event.propertyName !== 'height') {
          return;
        }
        if (panel.classList.contains('expanded')) {
          panel.style.height = 'auto';
        }
      });
    });
    window.addEventListener('resize', () => {
      document.querySelectorAll('[data-case-detail].expanded, [data-subtask-children].expanded').forEach((panel) => {
        panel.style.height = 'auto';
      });
    });
    document.addEventListener('click', (event) => {
      const summary = event.target.closest('.case-summary');
      if (summary) {
        const row = summary.closest('[data-case-row]');
        const panel = row?.querySelector('[data-case-detail]');
        const subtaskPanel = row?.closest('[data-subtask-children]');
        const expanded = summary.getAttribute('aria-expanded') === 'true';
        summary.setAttribute('aria-expanded', String(!expanded));
        togglePanel(panel, !expanded);
        requestAnimationFrame(() => syncPanelHeight(subtaskPanel));
        return;
      }
      const subtaskSummary = event.target.closest('.subtask-summary');
      if (subtaskSummary) {
        const row = subtaskSummary.closest('[data-subtask-row]');
        const panel = row?.querySelector('[data-subtask-children]');
        const expanded = subtaskSummary.getAttribute('aria-expanded') === 'true';
        subtaskSummary.setAttribute('aria-expanded', String(!expanded));
        togglePanel(panel, !expanded);
        return;
      }
      const button = event.target.closest('button[data-command][data-sample]');
      if (!button || button.disabled) {
        return;
      }
      vscode.postMessage({
        command: button.dataset.command,
        sampleId: Number(button.dataset.sample)
      });
    });
  </script>
</body>
</html>`;
}

function statusClass(status: string): string {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function verdictClass(status: string): string {
  return `verdict-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function scoreClass(earned: number, total: number, status: string): string {
  if (status === 'AC' || (status === 'Scored' && total > 0 && earned >= total)) {
    return 'score-passed';
  }
  if (earned > 0 && earned < total) {
    return `score-partial ${verdictClass(status)}`;
  }
  if (status === 'Not Run') {
    return 'score-muted';
  }
  return `score-failed ${verdictClass(status)}`;
}

function getOverallStatus(report: JudgeReport, earnedScore: number | undefined): string {
  if (report.samples.some((sample) => sample.status === 'RE')) {
    return 'RE';
  }
  if (report.samples.some((sample) => sample.status === 'CE')) {
    return 'CE';
  }
  if (report.samples.some((sample) => sample.status === 'OLE')) {
    return 'OLE';
  }
  if (report.samples.some((sample) => sample.status === 'TLE')) {
    return 'TLE';
  }
  if (report.samples.some((sample) => sample.status === 'MLE')) {
    return 'MLE';
  }
  if (report.samples.some((sample) => sample.status === 'Checker Error' || sample.status === 'ERR')) {
    return 'ERR';
  }
  const totalScore = report.score?.total ?? 100;
  const finalEarned = earnedScore ?? report.score?.earned;
  if (report.summary.accepted === report.summary.total && (finalEarned === undefined || finalEarned >= totalScore)) {
    return 'AC';
  }
  if (finalEarned !== undefined && finalEarned > 0 && finalEarned < totalScore) {
    return 'PARTIAL';
  }
  return 'WA';
}

function getOverallStatusText(report: JudgeReport, earnedScore: number | undefined): string {
  const status = getOverallStatus(report, earnedScore);
  return statusLabel(status);
}

function getMaxTimeMs(samples: SampleReport[]): number | undefined {
  const values = samples
    .map((sample) => sample.timeMs ?? sample.elapsedMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : undefined;
}

function getSampleMemoryKiB(sample: SampleReport): number | undefined {
  const raw = (sample as { memoryKiB?: unknown; memoryKb?: unknown; memory?: unknown }).memoryKiB
    ?? (sample as { memoryKb?: unknown }).memoryKb
    ?? (sample as { memory?: unknown }).memory;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  const bytes = (sample as { memoryBytes?: unknown }).memoryBytes;
  if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0) {
    return Math.ceil(bytes / 1024);
  }
  return undefined;
}

function getMaxMemoryKiB(samples: SampleReport[]): number | undefined {
  const values = samples
    .map(getSampleMemoryKiB)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function formatMemory(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }

  const memoryMiB = value / 1024;
  if (memoryMiB < 10) {
    return `${memoryMiB.toFixed(2)} MB`;
  }
  if (memoryMiB < 100) {
    return `${memoryMiB.toFixed(1)} MB`;
  }
  return `${Math.round(memoryMiB)} MB`;
}

function formatBytesAsMb(value: number): string {
  const mib = value / 1024 / 1024;
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB`;
}

function buildSystemMessage(sample: SampleReport, report: JudgeReport): string {
  if (sample.status === 'CE') {
    return truncateSystemMessage(formatCompileErrorSystemMessage(report));
  }
  if (sample.status === 'WA') {
    return buildWrongAnswerSystemMessage(sample);
  }
  if (sample.status === 'TLE') {
    return 'Time Limit Exceeded';
  }
  if (sample.status === 'OLE') {
    return buildOutputLimitSystemMessage(sample);
  }
  if (sample.status === 'RE') {
    return buildRuntimeErrorSystemMessage(sample);
  }
  const lines: string[] = [];
  if (sample.status === 'MLE') {
    lines.push('Memory limit exceeded.');
  } else if (sample.exitCode !== undefined && sample.exitCode !== null) {
    lines.push(t('report.exitCode', { code: sample.exitCode }));
  } else if (sample.signal) {
    lines.push(`Terminated by signal ${sample.signal}.`);
  } else if (sample.status === 'AC' || sample.status === 'Scored') {
    lines.push(t('report.exitCode', { code: 0 }));
  }
  if (sample.killedByTimeout) {
    lines.push('Process was killed by timeout.');
  }
  if (sample.stdinError) {
    lines.push(`stdinError: ${sample.stdinError}`);
  }
  if (sample.stdoutError) {
    lines.push(`stdoutError: ${sample.stdoutError}`);
  }
  if (sample.stderrError) {
    lines.push(`stderrError: ${sample.stderrError}`);
  }
  if (sample.spawnError) {
    lines.push(`spawnError: ${sample.spawnError}`);
  }
  if (sample.runnerError) {
    lines.push(`runnerError: ${sample.runnerError}`);
  }
  if (sample.compareError) {
    lines.push(`compareError: ${sample.compareError}`);
  }
  return lines.join('\n') || t('report.noDetails');
}

function buildRuntimeErrorSystemMessage(sample: SampleReport): string {
  const lines: string[] = [];
  if (sample.exitCode !== undefined && sample.exitCode !== null) {
    lines.push(t('report.exitCode', { code: sample.exitCode }));
  } else if (sample.signal) {
    lines.push(`Terminated by signal ${sample.signal}.`);
  } else {
    lines.push(t('report.noDetails'));
  }
  if (sample.stderrPreview?.trim()) {
    lines.push('', sample.stderrPreview.trimEnd());
  }
  return lines.join('\n');
}

function buildWrongAnswerSystemMessage(sample: SampleReport): string {
  const checkerMessage = buildCheckerMessage(sample);
  if (checkerMessage) {
    return checkerMessage;
  }
  return sample.message?.trim() || t('report.noDetails');
}

function buildOutputLimitSystemMessage(sample: SampleReport): string {
  const limit = sample.outputLimitBytes ?? 256 * 1024 * 1024;
  return [
    'Output Limit Exceeded',
    `Output exceeded ${formatBytesAsMb(limit)}.`
  ].join('\n');
}

function formatCompileErrorSystemMessage(report: JudgeReport): string {
  const output = [report.compile?.stderr, report.compile?.stdout]
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .join('\n');
  return output ? `Compile Error\n\n${output.trimEnd()}` : 'Compile Error';
}

function truncateSystemMessage(value: string): string {
  if (value.length <= maxSystemMessageLength) {
    return value;
  }
  return `${value.slice(0, maxSystemMessageLength).trimEnd()}\n\nOutput truncated.`;
}

function buildCheckerMessage(sample: SampleReport): string | undefined {
  const checker = sample.checker;
  if (!checker) {
    return undefined;
  }
  return [
    checker.message,
    checker.output,
    checker.stdout,
    checker.stderr,
    checker.finalLine ? `finalLine: ${checker.finalLine}` : undefined,
    checker.verdictLine ? `verdictLine: ${checker.verdictLine}` : undefined,
    checker.scoreText ? `score: ${checker.scoreText}` : undefined
  ].filter((entry): entry is string => Boolean(entry && entry.trim())).join('\n');
}

function formatMs(value: number | undefined): number | string {
  return value === undefined ? '-' : Math.round(value);
}

function formatDuration(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value)} ms`;
}

function formatSampleDuration(sample: Pick<SampleReport, 'timeMs' | 'elapsedMs' | 'killedByTimeout' | 'hardKillLimitMs'>): string {
  const timeMs = sample.killedByTimeout && sample.hardKillLimitMs !== undefined
    ? sample.hardKillLimitMs
    : sample.timeMs ?? sample.elapsedMs;
  const prefix = sample.killedByTimeout ? '>' : '';
  return timeMs === undefined ? '-' : `${prefix}${Math.round(timeMs)} ms`;
}

function formatTestcaseDuration(testcase: Pick<JudgeReportTestcaseViewModel, 'timeMs' | 'killedByTimeout' | 'hardKillLimitMs'>): string {
  const timeMs = testcase.killedByTimeout && testcase.hardKillLimitMs !== undefined
    ? testcase.hardKillLimitMs
    : testcase.timeMs;
  const prefix = testcase.killedByTimeout ? '>' : '';
  return timeMs === undefined ? '-' : `${prefix}${Math.round(timeMs)} ms`;
}

function statusLabel(status: string): string {
  return formatVerdictAcronym(status);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
