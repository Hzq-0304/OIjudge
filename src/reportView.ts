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
import { formatVerdictAcronym } from './verdict';

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
  return `<section class="reportHero status-surface ${statusClass(viewModel.status)}">
      <div>
        <span class="eyebrow">${escapeHtml(t('report.result'))}</span>
        <strong>${escapeHtml(viewModel.statusText)}</strong>
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
      <div class="testcaseTable" role="table" aria-label="${escapeHtml(t('report.testcase'))}">
        <div class="testcaseHeader" role="row">
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
      statusText: statusLabel(sample.status),
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
    testcaseSections
  };
}

function buildTestcaseSections(
  problem: ProblemConfig | undefined,
  testcases: JudgeReportTestcaseViewModel[],
  score: ReturnType<typeof calculateJudgeScore> | undefined
): JudgeReportTestcaseSectionViewModel[] {
  if (!problem?.subtasks?.length) {
    return testcases.map((testcase) => ({ kind: 'testcase', testcase }));
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
  for (const testcase of rootTestcases) {
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
      testcases: subtaskTestcases
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
  return formatVerdictAcronym(status);
}

function renderTestcaseSection(section: JudgeReportTestcaseSectionViewModel, problemId?: string): string {
  if (section.kind === 'testcase') {
    return renderTestcaseRow(section.testcase, problemId);
  }
  return `<details class="testcaseGroup subtask ${statusClass(section.status)}" open>
    <summary>
      <span class="testcaseName">${escapeHtml(section.name)}</span>
      <span class="statusPill ${statusClass(section.status)}">${escapeHtml(section.statusText)}</span>
      <span>${section.scoreEarned}/${section.scoreTotal}</span>
      <span>${escapeHtml(`passed ${section.passedCount}/${section.totalCount}`)}</span>
    </summary>
    <div class="testcaseGroupBody">
      ${section.testcases.map((testcase) => renderTestcaseRow(testcase, problemId, true)).join('')}
    </div>
  </details>`;
}

function renderTestcaseRow(testcase: JudgeReportTestcaseViewModel, problemId?: string, nested = false): string {
  const details = renderTestcaseDetails(testcase, problemId);
  return `<details class="testcaseRow ${nested ? 'nested' : ''} ${statusClass(testcase.status)}"${testcase.defaultOpen ? ' open' : ''}>
    <summary>
      <span class="testcaseName">${escapeHtml(t('report.testcaseNumber', { index: testcase.index }))}</span>
      <span class="statusPill ${statusClass(testcase.status)}">${escapeHtml(testcase.statusText)}</span>
      <span>${testcase.scoreEarned}/${testcase.scoreTotal}</span>
      <span>${escapeHtml(formatTestcaseDuration(testcase))}</span>
      <span>${escapeHtml(formatMemory(testcase.memoryKiB))}</span>
    </summary>
    ${details}
  </details>`;
}

function renderTestcaseDetails(testcase: JudgeReportTestcaseViewModel, problemId?: string): string {
  return `<div class="testcaseDetails">
    ${renderDetailBlock(t('report.systemInfo'), testcase.systemMessage) || renderDetailBlock(t('report.systemInfo'), t('report.noDetails'))}
    ${renderReportActionButtons(testcase.sampleIndex, problemId, testcase.status)}
  </div>`;
}

function renderDetailBlock(title: string, content: string | undefined): string {
  if (!content || !content.trim()) {
    return '';
  }
  return `<section class="detailBlock">
    <h3>${escapeHtml(title)}</h3>
    <pre>${escapeHtml(content.trimEnd())}</pre>
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
    <button data-command="input" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('input'))}</button>
    <button data-command="expected" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('expectedOutput'))}</button>
    <button data-command="output" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('runResult'))}</button>
    <button data-command="copyFreopen" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('debug.copyFreopenInput'))}</button>
    <button data-command="delete" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('delete'))}</button>
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
    ? `\n    <button data-command="diff" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('report.showDiff'))}</button>`
    : '';
  return `<div class="buttons">
    <button data-command="input" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('input'))}</button>
    <button data-command="expected" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('expectedOutput'))}</button>
    <button data-command="output" data-sample="${sampleValue}"${disabled}>${escapeHtml(t('runResult'))}</button>${diffButton}
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

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
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
    .testcaseTable {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      min-width: 720px;
      overflow: hidden;
      background: var(--vscode-sideBar-background);
    }
    .testcaseHeader,
    .testcaseRow summary {
      align-items: center;
      display: grid;
      grid-template-columns: minmax(150px, 1.4fr) minmax(130px, 1fr) 90px 90px 110px;
      gap: 12px;
      padding: 10px 14px;
    }
    .testcaseHeader > span,
    .testcaseRow summary > span {
      min-width: 0;
    }
    .testcaseHeader {
      background: var(--vscode-editorWidget-background);
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .testcaseRow {
      border-top: 1px solid var(--vscode-panel-border);
    }
    .testcaseGroup.subtask > summary {
      background: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground) 16%, transparent);
      font-weight: 700;
    }
    .testcaseRow summary {
      cursor: pointer;
      list-style: none;
    }
    .testcaseRow summary::-webkit-details-marker { display: none; }
    .testcaseName::before {
      content: '▸';
      color: var(--vscode-descriptionForeground);
      display: inline-block;
      margin-right: 8px;
      transition: transform 120ms ease;
    }
    .testcaseRow[open] .testcaseName::before { transform: rotate(90deg); }
    .testcaseRow.nested .testcaseName {
      padding-left: 18px;
    }
    .testcaseRow[open] summary {
      background: var(--vscode-list-hoverBackground);
      background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 18%, transparent);
    }
    .statusPill {
      border-radius: 999px;
      display: inline-flex;
      font-weight: 700;
      width: fit-content;
    }
    .testcaseDetails {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 12px 14px 14px 42px;
    }
    .testcaseGroupBody {
      border-top: 1px solid var(--vscode-panel-border);
    }
    .detailBlock {
      margin-bottom: 12px;
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
    .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    button {
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      padding: 4px 10px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled {
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
      border-radius: 4px;
      overflow-x: auto;
      padding: 10px;
      white-space: pre-wrap;
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
    document.addEventListener('click', (event) => {
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
