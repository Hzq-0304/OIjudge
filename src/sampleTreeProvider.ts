import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { exists } from './config';
import { t } from './i18n';
import { explainRuntimeError, renderRuntimeErrorExplanation } from './runtimeErrorExplainer';
import {
  ensureProblemsConfig,
  getDefaultProblemSource,
  getProblemGeneratorProgram,
  getProblemReportPath,
  getSampleGeneratedAnswerStatus,
  getSubtaskSamples,
  getUnassignedProblemSamples,
  hasProblemGeneratedAnswers,
  moveProblemSampleToSubtask,
  resolveProblemReferencePath
} from './problems';
import { getSampleFileStatus, inferSampleSourceType } from './sampleFiles';
import { isSetterModeEnabled } from './setterMode';
import { CheckerType, JudgeMode, JudgeReport, ProblemConfig, SampleReport, SampleStatus } from './types';

type NodeKind = 'group' | 'problem' | 'info' | 'sample' | 'subtask' | 'action';
type NodeGroup =
  | 'problems'
  | 'workspaceActions'
  | 'statement'
  | 'programs'
  | 'limits'
  | 'samples'
  | 'subtask'
  | 'setter'
  | 'actions'
  | 'sampleActions';

type TreeNode = {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  command?: vscode.Command;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  group?: NodeGroup;
  problemId?: string;
  subtaskId?: string;
  contextValue?: string;
  sampleId?: number;
  sampleStatus?: SampleStatus | 'Not Run';
  hasCheckerOutput?: boolean;
  answerPending?: boolean;
  hasGeneratedAnswer?: boolean;
  problemJudgeMode?: JudgeMode;
  problemCheckerType?: CheckerType;
};

const SAMPLE_TREE_MIME = 'application/vnd.code.tree.oijudger.samplesView';

export class SampleTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();

  readonly onDidChangeTreeData = this.emitter.event;
  readonly dragMimeTypes = [SAMPLE_TREE_MIME];
  readonly dropMimeTypes = [SAMPLE_TREE_MIME];

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.icon;
    item.command = element.command;
    item.contextValue = getContextValue(element);
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const config = await ensureProblemsConfig(workspaceFolder);
    if (!element) {
      return createRootNodes();
    }

    if (element.group === 'problems' && !element.problemId) {
      return config.problems.length > 0 ? config.problems.map(createProblemNode) : [createNoProblemsNode()];
    }

    if (element.group === 'workspaceActions') {
      return createWorkspaceActionNodes();
    }

    if (!element.problemId) {
      return [];
    }

    const problem = config.problems.find((entry) => entry.id === element.problemId);
    if (!problem) {
      return [];
    }

    switch (element.group) {
      case undefined:
        return createProblemChildren(workspaceFolder, problem);
      case 'statement':
        return createStatementNodes(workspaceFolder, problem);
      case 'programs':
        return createProgramNodes(workspaceFolder, problem);
      case 'limits':
        return createLimitNodes(problem);
      case 'samples':
        return createSampleContainerNodes(workspaceFolder, problem);
      case 'subtask':
        return createSampleNodes(workspaceFolder, problem, getSubtaskSamples(problem, element.subtaskId ?? ''));
      case 'setter':
        return createSetterNodes(workspaceFolder, problem);
      case 'actions':
        return createProblemActionNodes(problem);
      case 'sampleActions':
        return createSampleActionNodes(
          element.problemId,
          element.sampleId,
          element.sampleStatus,
          element.hasCheckerOutput,
          element.answerPending,
          element.hasGeneratedAnswer
        );
      default:
        return [];
    }
  }

  handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const samples = source
      .filter((node) => node.kind === 'sample' && node.problemId && node.sampleId !== undefined)
      .map((node) => ({
        problemId: node.problemId,
        sampleId: node.sampleId
      }));
    if (samples.length === 0) {
      return;
    }
    dataTransfer.set(SAMPLE_TREE_MIME, new vscode.DataTransferItem(JSON.stringify(samples)));
  }

  async handleDrop(
    target: TreeNode | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    if (!target || (target.group !== 'subtask' && target.group !== 'samples')) {
      return;
    }

    const item = dataTransfer.get(SAMPLE_TREE_MIME);
    if (!item) {
      return;
    }

    const raw = typeof item.value === 'string' ? item.value : await item.asString();
    const samples = JSON.parse(raw) as Array<{ problemId?: string; sampleId?: number }>;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    for (const sample of samples) {
      if (!sample.problemId || sample.sampleId === undefined || sample.problemId !== target.problemId) {
        continue;
      }
      const config = await ensureProblemsConfig(workspaceFolder);
      const problem = config.problems.find((entry) => entry.id === sample.problemId);
      const targetSample = problem?.samples.find((entry) => entry.index === sample.sampleId);
      if (!targetSample) {
        continue;
      }
      await moveProblemSampleToSubtask(
        workspaceFolder,
        sample.problemId,
        targetSample.id,
        target.group === 'subtask' ? target.subtaskId : undefined
      );
    }
    this.refresh();
  }
}

function createRootNodes(): TreeNode[] {
  return [
    {
      kind: 'group',
      label: t('problems'),
      icon: new vscode.ThemeIcon('book'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'problems'
    },
    {
      kind: 'group',
      label: t('workspaceActions'),
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'workspaceActions'
    }
  ];
}

function createProblemNode(problem: ProblemConfig): TreeNode {
  const defaultSource = getDefaultProblemSource(problem);
  return {
    kind: 'problem',
    label: problem.name,
    description: defaultSource ? path.basename(defaultSource) : t('noProgramSet'),
    tooltip: defaultSource ?? t('noProgramSet'),
    icon: new vscode.ThemeIcon('symbol-file'),
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    problemId: problem.id,
    problemJudgeMode: getProblemJudgeMode(problem),
    problemCheckerType: problem.checker?.type
  };
}

function createNoProblemsNode(): TreeNode {
  return {
    kind: 'info',
    label: t('noProblems'),
    description: t('addProblemFromCurrentFile'),
    icon: new vscode.ThemeIcon('circle-slash'),
    command: {
      command: 'oijudger.addProblemFromCurrentFile',
      title: t('addProblemFromCurrentFile')
    }
  };
}

async function createProblemChildren(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): Promise<TreeNode[]> {
  const samplesContextValue = await hasProblemGeneratedAnswers(workspaceFolder, problem)
    ? 'samplesGroupWithGeneratedOutputs'
    : 'samplesGroup';

  return [
    {
      kind: 'group',
      label: t('statement'),
      icon: new vscode.ThemeIcon('book'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'statement',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('programs'),
      icon: new vscode.ThemeIcon('file-code'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'programs',
      problemId: problem.id
    },
    clickableInfoNode(
      t('defaultProgramLine', { program: getDefaultProblemSource(problem) ? path.basename(getDefaultProblemSource(problem) ?? '') : t('noProgramSet') }),
      'file-code',
      t('clickChangeDefaultProgram'),
      'oijudger.setDefaultProgram',
      problem.id
    ),
    clickableInfoNode(
      t('compilerLine', { compiler: path.basename(problem.compiler.command || 'g++') }),
      'terminal',
      t('clickSelectCompiler'),
      'oijudger.selectProblemCompiler',
      problem.id
    ),
    clickableInfoNode(
      t('standardLine', { standard: problem.standard }),
      'settings',
      t('clickSetCppStandard'),
      'oijudger.setProblemStandard',
      problem.id
    ),
    createJudgeModeNode(problem),
    createIoModeNode(problem),
    ...createFileIoNodes(problem),
    ...(isSetterModeEnabled() ? [createStdInfoNode(workspaceFolder, problem)] : []),
    ...(getProblemJudgeMode(problem) === 'checker' ? [createCheckerInfoNode(workspaceFolder, problem)] : []),
    {
      kind: 'group',
      label: t('limits'),
      icon: new vscode.ThemeIcon('dashboard'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'limits',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('samples'),
      icon: new vscode.ThemeIcon('list-tree'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'samples',
      problemId: problem.id,
      contextValue: samplesContextValue
    },
    ...(isSetterModeEnabled() ? [{
      kind: 'group' as const,
      label: t('setterMode'),
      icon: new vscode.ThemeIcon('person'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'setter' as const,
      problemId: problem.id
    }] : []),
    {
      kind: 'group',
      label: t('actions'),
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'actions',
      problemId: problem.id
    }
  ];
}

function createLimitNodes(problem: ProblemConfig): TreeNode[] {
  return [
    actionNode(`${t('time')}: ${problem.limits.timeMs} ms`, 'oijudger.setProblemTimeLimit', 'watch', problem.id),
    actionNode(`${t('memory')}: ${problem.limits.memoryMb} MB`, 'oijudger.setProblemMemoryLimit', 'server', problem.id),
    actionNode(`${t('stack')}: ${formatStackLabel(problem)}`, 'oijudger.setStackSize', 'layers', problem.id)
  ];
}

function createIoModeNode(problem: ProblemConfig): TreeNode {
  const mode = getProblemIoMode(problem);
  const label = mode === 'fileio' ? t('fileIo') : t('standardIo');
  const fileIo = getProblemFileIo(problem);
  return {
    kind: 'info',
    label: `${t('ioMode')}: ${label}`,
    description: mode === 'fileio' ? `${fileIo.inputFileName} -> ${fileIo.outputFileName}` : undefined,
    tooltip: mode === 'fileio'
      ? `${t('inputFile')}: ${fileIo.inputFileName}\n${t('outputFile')}: ${fileIo.outputFileName}`
      : t('standardIo'),
    icon: new vscode.ThemeIcon(mode === 'fileio' ? 'files' : 'terminal'),
    problemId: problem.id,
    command: {
      command: 'oijudger.setIoMode',
      title: t('setIoMode'),
      arguments: [problem.id]
    }
  };
}

function createFileIoNodes(problem: ProblemConfig): TreeNode[] {
  if (getProblemIoMode(problem) !== 'fileio') {
    return [];
  }
  const fileIo = getProblemFileIo(problem);
  return [
    actionNode(`${t('inputFile')}: ${fileIo.inputFileName}`, 'oijudger.setFileIoNames', 'file', problem.id),
    actionNode(`${t('outputFile')}: ${fileIo.outputFileName}`, 'oijudger.setFileIoNames', 'file', problem.id)
  ];
}

async function createStatementNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  if (!problem.statement) {
    return [
      actionNode(`${t('statement')}: ${t('noStatementBound')}`, 'oijudger.bindStatement', 'link', problem.id)
    ];
  }

  const statementPath = resolveProblemReferencePath(workspaceFolder, problem.statement.path);
  const missing = !(await exists(statementPath));
  return [
    {
      kind: 'info',
      label: missing ? `${t('statement')}: ${t('statusMissing')}` : `${t('statement')}: ${path.basename(statementPath)}`,
      tooltip: statementPath,
      icon: missing
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon(statementIcon(problem.statement.type)),
      command: {
        command: 'oijudger.openStatement',
        title: t('openStatement'),
        arguments: [problem.id]
      }
    }
  ];
}

async function createProgramNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  const sources = problem.sources ?? [];
  if (sources.length === 0) {
    return [
      actionNode(`${t('programs')}: ${t('noPrograms')}`, 'oijudger.addProgramToProblem', 'file-add', problem.id)
    ];
  }

  const defaultSource = getDefaultProblemSource(problem);
  return Promise.all(sources.map(async (source) => {
    const sourcePath = resolveProblemReferencePath(workspaceFolder, source.path);
    const missing = !(await exists(sourcePath));
    return {
      kind: 'info',
      label: source.name ?? path.basename(sourcePath),
      description: missing ? t('statusMissing') : (source.path === defaultSource ? t('defaultProgram') : undefined),
      tooltip: sourcePath,
      icon: missing
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon('file-code')
    };
  }));
}

async function createSampleContainerNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  const unassignedSampleNodes = await createSampleNodes(
    workspaceFolder,
    problem,
    getUnassignedProblemSamples(problem),
    { showEmpty: false }
  );
  const subtaskNodes = await Promise.all(
    (problem.subtasks ?? []).map((subtask) => createSubtaskNode(workspaceFolder, problem, subtask))
  );
  const nodes = [...unassignedSampleNodes, ...subtaskNodes];
  return nodes.length > 0 ? nodes : [createEmptySamplesNode()];
}

async function createSubtaskNode(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  subtask: NonNullable<ProblemConfig['subtasks']>[number]
): Promise<TreeNode> {
  const result = subtask.lastResult;
  const generatorInput = await getSubtaskGeneratorInputStatus(workspaceFolder, subtask);
  const resultDescription = result?.status === 'passed'
    ? '✓'
    : result?.status === 'failed'
      ? `✗ ${result.passed}/${result.total}`
      : undefined;
  const description = generatorInput?.description ?? resultDescription;
  const contextValue = result?.status === 'passed'
    ? 'subtaskPassed'
    : result?.status === 'failed'
      ? 'subtaskFailed'
      : 'subtask';
  const resultTooltip = result
    ? t(result.status === 'passed' ? 'subtask.resultSummary' : 'subtask.resultFailedSummary', {
      passed: result.passed,
      total: result.total
    })
    : t('subtask.notRun');
  return {
    kind: 'subtask',
    label: subtask.name,
    description,
    tooltip: generatorInput?.tooltip
      ? `${generatorInput.tooltip}\n${resultTooltip}`
      : resultTooltip,
    icon: generatorInput?.missing
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : new vscode.ThemeIcon(result?.status === 'passed' ? 'pass-filled' : result?.status === 'failed' ? 'error' : 'symbol-namespace'),
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    group: 'subtask',
    problemId: problem.id,
    subtaskId: subtask.id,
    contextValue
  };
}

async function getSubtaskGeneratorInputStatus(
  workspaceFolder: vscode.WorkspaceFolder,
  subtask: NonNullable<ProblemConfig['subtasks']>[number]
): Promise<{ description: string; tooltip: string; missing: boolean } | undefined> {
  if (!isSetterModeEnabled() || !subtask.generatorInput) {
    return undefined;
  }

  const inputPath = resolveProblemReferencePath(workspaceFolder, subtask.generatorInput);
  const missing = !(await exists(inputPath));
  return {
    description: missing
      ? t('subtask.generatorInputMissingShort')
      : t('subtask.generatorInputStatus', { name: path.basename(inputPath) }),
    tooltip: missing ? `${t('subtask.generatorInputMissing')}: ${inputPath}` : inputPath,
    missing
  };
}

async function createSampleNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  samples: ProblemConfig['samples'],
  options: { showEmpty?: boolean } = {}
): Promise<TreeNode[]> {
  if (samples.length === 0) {
    return options.showEmpty === false ? [] : [createEmptySamplesNode()];
  }

  const report = await readReport(workspaceFolder, problem.id);
  return Promise.all(samples.map(async (sample) => {
    const sampleReport = report?.samples.find((entry) =>
      entry.id === sample.id || entry.index === sample.index || entry.name === sample.name
    );
    const fileStatus = await getSampleFileStatus(workspaceFolder, sample);
    const generatedAnswer = await getSampleGeneratedAnswerStatus(workspaceFolder, problem, sample);
    const hasGeneratedAnswer = generatedAnswer.exists;
    const answerPending = isSetterModeEnabled() && !fileStatus.inputMissing && fileStatus.answerMissing;
    const missing = fileStatus.inputMissing || (fileStatus.answerMissing && !answerPending);
    const status = missing ? 'Missing' : (sampleReport?.status ?? 'Not Run');
    const elapsed = sampleReport && !missing ? formatElapsed(sampleReport) : '';
    const description = hasGeneratedAnswer
      ? t('setter.generatedOutput.pending')
      : answerPending
        ? t('setter.sample.answerMissing')
        : formatSampleDescription(status, sampleReport, elapsed);
    const sourceType = inferSampleSourceType(workspaceFolder, sample);
    const missingDetail = fileStatus.missingPaths.length > 0
      ? answerPending
        ? `\n${t('setter.sample.generateAnswerHint')}: ${fileStatus.answerPath}`
        : `\n${t(sourceType === 'external' ? 'externalSampleMissing' : 'sampleMissing')}:\n${fileStatus.missingPaths.join('\n')}`
      : '';
    return {
      kind: 'sample',
      label: sample.name,
      description,
      tooltip: [
        `${t('sampleName')}: ${sample.name}`,
        `${t('internalId')}: ${sample.id}`,
        `${t('sampleInput')}: ${fileStatus.inputPath}`,
        `${t('expectedOutput')}: ${answerPending ? t('setter.sample.answerMissing') : fileStatus.answerPath}`,
        ...(hasGeneratedAnswer && generatedAnswer.path ? [`${t('setter.generatedOutput.status')}: ${generatedAnswer.path}`] : []),
        `${t('source')}: ${t(sourceType === 'external' ? 'externalSample' : 'managedSample')}${missingDetail}`,
        ...(sampleReport?.status === 'Scored' ? [
          `${t('status')}: ${t('statusScored')}`,
          `${t('checkerScore')}: ${sampleReport.checker?.scoreText ?? sampleReport.score ?? ''}`,
          `${t('checker')}: ${t('plainCheckerMode')}`,
          formatPlainCheckerProtocol(sampleReport.checker)
        ] : []),
        ...(sampleReport?.checker?.message ? [`${t('checker')}: ${sampleReport.checker.message}`] : []),
        ...(sampleReport?.checker?.output ? [`${t('checkerOutput')}: ${sampleReport.checker.output}`] : []),
        ...createRuntimeTooltipLines(sampleReport)
      ].join('\n'),
      icon: hasGeneratedAnswer
        ? new vscode.ThemeIcon('diff')
        : answerPending
        ? new vscode.ThemeIcon('warning')
        : status === 'Missing'
        ? new vscode.ThemeIcon(statusIcon(status), new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon(statusIcon(status)),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      group: 'sampleActions',
      problemId: problem.id,
      sampleId: sample.index,
      sampleStatus: status,
      hasCheckerOutput: Boolean(sampleReport?.checker?.output || sampleReport?.checker?.stdout || sampleReport?.checker?.stderr),
      answerPending,
      hasGeneratedAnswer
    };
  }));
}

function createEmptySamplesNode(): TreeNode {
  return {
    kind: 'info',
    label: t('subtask.empty'),
    icon: new vscode.ThemeIcon('beaker-stop')
  };
}

function createRuntimeTooltipLines(report: SampleReport | undefined): string[] {
  if (!report || report.status !== 'RE') {
    return [];
  }

  const explanation = getRuntimeExplanation(report);
  const lines = explanation
    ? ['', renderRuntimeErrorExplanation(explanation, { stderrEmpty: report.stderrPreview === '' })]
    : ['', `Runtime Error: ${t('unknownRuntimeError')}`];
  if (report.stdinError) {
    lines.push(`stdinError: ${report.stdinError}`);
  }
  if (report.stdoutError) {
    lines.push(`stdoutError: ${report.stdoutError}`);
  }
  if (report.stderrError) {
    lines.push(`stderrError: ${report.stderrError}`);
  }
  if (report.stderrPreview !== undefined) {
    lines.push(report.stderrPreview.trim() ? `stderr: ${report.stderrPreview}` : 'stderr is empty.');
  }
  if (
    report.exitCode === undefined &&
    report.signal === undefined &&
    !report.spawnError &&
    !report.runnerError
  ) {
    lines.push('Runtime Error: missing diagnostic information. This is an OI Judge internal issue. See Output Channel.');
  }
  return lines;
}

function formatSampleDescription(
  status: SampleStatus | 'Not Run',
  report: SampleReport | undefined,
  elapsed: string
): string {
  const explanation = report?.status === 'RE' ? getRuntimeExplanation(report) : undefined;
  if (status === 'Scored' && report?.checker?.scoreText !== undefined) {
    return report.checker.scoreText;
  }
  if (status === 'Checker Error' && report?.checker?.errorName) {
    return `${t('checkerError')}: ${report.checker.errorName}`;
  }
  const statusText = explanation ? `RE: ${explanation.englishName}` : statusLabel(status);
  return elapsed ? `${statusText}  ${elapsed}` : statusText;
}

function getRuntimeExplanation(report: SampleReport) {
  return explainRuntimeError({
    exitCode: report.runtimeError?.rawExitCode ?? report.exitCode,
    signal: report.runtimeError?.rawSignal ?? report.signal,
    spawnError: report.spawnError,
    runnerError: report.runnerError,
    platform: process.platform
  });
}

function createSampleActionNodes(
  problemId: string,
  sampleId: number | undefined,
  status: SampleStatus | 'Not Run' | undefined,
  hasCheckerOutput = false,
  answerPending = false,
  hasGeneratedAnswer = false
): TreeNode[] {
  if (sampleId === undefined) {
    return [];
  }

  const nodes = [
    sampleActionNode(t('openSampleInput'), 'oijudger.openSampleInput', 'go-to-file', problemId, sampleId)
  ];

  if (!answerPending) {
    nodes.push(sampleActionNode(t('openExpectedOutput'), 'oijudger.openSampleAnswer', 'go-to-file', problemId, sampleId));
  }

  if (status !== 'Missing' && !answerPending) {
    nodes.push(sampleActionNode(t('openUserOutput'), 'oijudger.openSampleUserOutput', 'output', problemId, sampleId));
  }

  if (status === 'WA') {
    nodes.push(sampleActionNode(t('openDiff'), 'oijudger.openSampleDiff', 'diff', problemId, sampleId));
  }
  if (hasCheckerOutput) {
    nodes.push(sampleActionNode(t('checkerOutput'), 'oijudger.openCheckerOutput', 'output', problemId, sampleId));
  }
  if (hasGeneratedAnswer) {
    nodes.push(sampleActionNode(t('setter.generatedOutput.viewCurrent'), 'oijudger.viewCurrentSampleAnswer', 'go-to-file', problemId, sampleId));
    nodes.push(sampleActionNode(t('setter.generatedOutput.viewGenerated'), 'oijudger.viewGeneratedSampleAnswer', 'preview', problemId, sampleId));
    nodes.push(sampleActionNode(t('setter.generatedOutput.compare'), 'oijudger.diffGeneratedSampleAnswer', 'diff', problemId, sampleId));
    nodes.push(sampleActionNode(t('setter.generatedOutput.apply'), 'oijudger.applyGeneratedSampleAnswer', 'check', problemId, sampleId));
    nodes.push(sampleActionNode(t('setter.generatedOutput.delete'), 'oijudger.deleteGeneratedSampleAnswer', 'trash', problemId, sampleId));
  }
  if (isSetterModeEnabled()) {
    nodes.push(sampleActionNode(t('generateAnswerWithStd'), 'oijudger.generateSampleAnswerWithStd', 'run', problemId, sampleId));
    nodes.push(sampleActionNode(t('setSampleName'), 'oijudger.setSampleName', 'tag', problemId, sampleId));
  }

  return nodes;
}

function createProblemActionNodes(problem: ProblemConfig): TreeNode[] {
  const checkerActions = getProblemJudgeMode(problem) === 'checker'
    ? [
      actionNode(t('setChecker'), 'oijudger.setChecker', 'verified', problem.id),
      ...(problem.checker?.type === 'plain' ? [
        actionNode(t('setPlainCheckerProtocol'), 'oijudger.setPlainCheckerProtocol', 'settings', problem.id)
      ] : []),
      actionNode(t('clearChecker'), 'oijudger.clearChecker', 'clear-all', problem.id),
      actionNode(t('openChecker'), 'oijudger.openChecker', 'go-to-file', problem.id),
      actionNode(t('importTestlib'), 'oijudger.importTestlib', 'cloud-download', problem.id),
      actionNode(t('openTestlib'), 'oijudger.openTestlib', 'book', problem.id)
    ]
    : [];

  return [
    ...checkerActions,
    actionNode(t('bindStatement'), 'oijudger.bindStatement', 'link', problem.id),
    actionNode(t('openStatement'), 'oijudger.openStatement', 'book', problem.id),
    actionNode(t('unbindStatement'), 'oijudger.unbindStatement', 'debug-disconnect', problem.id),
    actionNode(t('addProgram'), 'oijudger.addProgramToProblem', 'file-add', problem.id),
    actionNode(t('runDefaultProgram'), 'oijudger.runProblemSamples', 'run-all', problem.id),
    actionNode(t('runWithProgram'), 'oijudger.runSamplesWithProgram', 'run', problem.id),
    actionNode(t('openResultPanel'), 'oijudger.openProblemResultPanel', 'layout-panel', problem.id)
  ];
}

function createSetterNodes(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): TreeNode[] {
  return [
    createGeneratorInfoNode(workspaceFolder, problem),
    actionNode(t('setter.sample.addInput'), 'oijudger.addSetterInputSample', 'file-add', problem.id),
    actionNode(t('generateAllAnswersWithStd'), 'oijudger.generateAllSampleAnswersWithStd', 'run-all', problem.id),
    actionNode(t('selectStd'), 'oijudger.selectStdProgram', 'file-code', problem.id),
    actionNode(t('openStd'), 'oijudger.openStdProgram', 'go-to-file', problem.id),
    actionNode(t('clearStd'), 'oijudger.clearStdProgram', 'clear-all', problem.id),
    actionNode(t('selectGenerator'), 'oijudger.selectGeneratorProgram', 'file-code', problem.id),
    actionNode(t('openGenerator'), 'oijudger.openGeneratorProgram', 'go-to-file', problem.id),
    actionNode(t('clearGenerator'), 'oijudger.clearGeneratorProgram', 'clear-all', problem.id),
    infoNode(t('generatorGenerationNotImplemented'), 'info'),
    actionNode(t('setSampleName'), 'oijudger.setSampleName', 'tag', problem.id)
  ];
}

function createGeneratorInfoNode(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): TreeNode {
  const generator = getProblemGeneratorProgram(problem);
  const generatorPath = generator ? resolveProblemReferencePath(workspaceFolder, generator) : undefined;
  const missing = Boolean(generatorPath && !existsSync(generatorPath));
  const label = generatorPath
    ? `${t('generatorLabel')}: ${path.basename(generatorPath)}`
    : `${t('generatorLabel')}: ${t('generatorNotSet')}`;
  return {
    kind: 'info',
    label,
    description: missing ? t('statusMissing') : undefined,
    tooltip: generatorPath
      ? `${generatorPath}\n${t('generatorGenerationNotImplemented')}`
      : t('generatorGenerationNotImplemented'),
    icon: missing
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : new vscode.ThemeIcon('file-code'),
    problemId: problem.id,
    command: {
      command: generatorPath ? 'oijudger.openGeneratorProgram' : 'oijudger.selectGeneratorProgram',
      title: generatorPath ? t('openGenerator') : t('selectGenerator'),
      arguments: [problem.id]
    }
  };
}

function createStdInfoNode(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): TreeNode {
  const stdPath = problem.setter?.stdProgram
    ? resolveProblemReferencePath(workspaceFolder, problem.setter.stdProgram)
    : undefined;
  const missing = Boolean(stdPath && !existsSync(stdPath));
  const label = stdPath
    ? `${t('standardSolution')}: ${path.basename(stdPath)}`
    : `${t('standardSolution')}: ${t('stdNotSet')}`;
  return {
    kind: 'info',
    label,
    description: missing ? t('statusMissing') : undefined,
    tooltip: stdPath ? `${stdPath}\n${t('stdTooltip')}` : t('stdTooltip'),
    icon: missing
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : new vscode.ThemeIcon('file-code'),
    problemId: problem.id,
    command: {
      command: stdPath ? 'oijudger.openStdProgram' : 'oijudger.selectStdProgram',
      title: stdPath ? t('openStd') : t('selectStd'),
      arguments: [problem.id]
    }
  };
}

function createCheckerInfoNode(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): TreeNode {
  const checker = problem.checker;
  if (!checker?.enabled || checker.type === 'none') {
    return infoNode(`${t('checker')}: ${t('checkerNotSet')}`, 'circle-outline');
  }

  const checkerPath = checker.source
    ? resolveProblemReferencePath(workspaceFolder, checker.source)
    : undefined;
  const missing = !checkerPath || !existsSync(checkerPath);
  const checkerMode = checker.type === 'plain' ? t('plainCheckerMode') : t('testlibCheckerMode');
  const protocol = checker.type === 'plain' ? formatPlainCheckerProtocol(checker) : undefined;
  return {
    kind: 'info',
    label: missing
      ? `${t('checker')}: ${t('statusMissing')}`
      : `${t('checker')}: ${checkerMode} ${path.basename(checkerPath)}`,
    description: protocol,
    tooltip: checkerPath ?? t('checkerMissing'),
    icon: missing
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : new vscode.ThemeIcon('verified')
  };
}

function createJudgeModeNode(problem: ProblemConfig): TreeNode {
  const mode = getProblemJudgeMode(problem);
  const label = mode === 'checker' ? t('customChecker') : t('normalTextCompare');
  return {
    kind: 'info',
    label: `${t('judgeMode')}: ${label}`,
    tooltip: mode === 'checker' ? t('checkerOptionsOnlyInCustomMode') : t('normalCompareDescription'),
    icon: new vscode.ThemeIcon(mode === 'checker' ? 'verified' : 'diff'),
    problemId: problem.id,
    command: {
      command: 'oijudger.setJudgeMode',
      title: t('setJudgeMode'),
      arguments: [problem.id]
    }
  };
}

function createWorkspaceActionNodes(): TreeNode[] {
  return [
    actionNode(t('createProblem'), 'oijudger.createProblem', 'new-folder'),
    actionNode(t('addProblemFromCurrentFile'), 'oijudger.addProblemFromCurrentFile', 'file-code'),
    actionNode(t('addProblemFromFile'), 'oijudger.addProblemFromFile', 'file-add'),
    actionNode(t('refreshView'), 'oijudger.refreshView', 'refresh'),
    actionNode(t('importLegacyProblem'), 'oijudger.importLegacyProblem', 'repo-pull')
  ];
}

function infoNode(label: string, icon: string): TreeNode {
  return {
    kind: 'info',
    label,
    icon: new vscode.ThemeIcon(icon)
  };
}

function clickableInfoNode(
  label: string,
  icon: string,
  tooltip: string,
  command: string,
  problemId: string
): TreeNode {
  return {
    kind: 'info',
    label,
    tooltip,
    icon: new vscode.ThemeIcon(icon),
    problemId,
    command: {
      command,
      title: label,
      arguments: [problemId]
    }
  };
}

function actionNode(label: string, command: string, icon: string, problemId?: string): TreeNode {
  return {
    kind: 'action',
    label,
    icon: new vscode.ThemeIcon(icon),
    problemId,
    command: {
      command,
      title: label,
      arguments: problemId ? [problemId] : []
    }
  };
}

function sampleActionNode(
  label: string,
  command: string,
  icon: string,
  problemId: string,
  sampleId: number
): TreeNode {
  return {
    kind: 'action',
    label,
    icon: new vscode.ThemeIcon(icon),
    problemId,
    sampleId,
    command: {
      command,
      title: label,
      arguments: [problemId, sampleId]
    }
  };
}

async function readReport(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<JudgeReport | undefined> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
  } catch {
    return undefined;
  }
}

function formatElapsed(report: SampleReport): string {
  const timeMs = report.timeMs ?? report.elapsedMs;
  if (report.status === 'TLE') {
    return `>${formatMs(timeMs)}ms`;
  }
  return `${formatMs(timeMs)}ms`;
}

function formatStackLabel(problem: ProblemConfig): string {
  const stack = problem.stack ?? { auto: true, sizeMb: null };
  if (!stack.auto) {
    return t('stackDisabled');
  }
  if (stack.sizeMb) {
    return `${stack.sizeMb} MB`;
  }
  return `${t('stackFollowMemory')} ${problem.limits.memoryMb} MB`;
}

function formatMs(value: number): number {
  return Math.round(value);
}

function statusIcon(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return 'pass-filled';
    case 'WA':
    case 'Missing':
    case 'Output Missing':
      return 'error';
    case 'Scored':
      return 'question';
    case 'TLE':
    case 'MLE':
      return 'watch';
    case 'RE':
    case 'CE':
    case 'Checker Error':
    case 'Skipped':
    case 'ERR':
      return 'warning';
    case 'Not Run':
      return 'circle-outline';
  }
}

function statusLabel(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return t('statusAC');
    case 'WA':
      return t('statusWA');
    case 'TLE':
      return t('statusTLE');
    case 'RE':
      return t('statusRE');
    case 'CE':
      return t('statusCE');
    case 'Scored':
      return t('statusScored');
    case 'Checker Error':
      return t('checkerError');
    case 'MLE':
      return t('statusMLE');
    case 'Skipped':
      return t('statusSkipped');
    case 'Missing':
      return t('statusMissing');
    case 'Output Missing':
      return t('statusOutputMissing');
    case 'ERR':
      return t('statusERR');
    case 'Not Run':
      return t('notRun');
  }
}

function statementIcon(type: string): string {
  switch (type) {
    case 'markdown':
      return 'markdown';
    case 'pdf':
      return 'file-pdf';
    case 'text':
      return 'file-text';
    default:
      return 'file';
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getProblemJudgeMode(problem: ProblemConfig): JudgeMode {
  return problem.judgeMode ?? (problem.checker?.enabled && problem.checker.type !== 'none' ? 'checker' : 'normal');
}

type PlainProtocolSource = {
  plain?: {
    verdictPosition?: 'firstLine' | 'lastLine';
    acceptedToken?: string;
    wrongAnswerToken?: string;
  };
  verdictPosition?: 'firstLine' | 'lastLine';
  acceptedToken?: string;
  wrongAnswerToken?: string;
};

function formatPlainCheckerProtocol(checker: PlainProtocolSource | undefined): string {
  const verdictPosition = checker?.plain?.verdictPosition ?? checker?.verdictPosition ?? 'lastLine';
  const acceptedToken = checker?.plain?.acceptedToken ?? checker?.acceptedToken ?? 'AC';
  const wrongAnswerToken = checker?.plain?.wrongAnswerToken ?? checker?.wrongAnswerToken ?? 'WA';
  return `${t('protocol')}: ${t(verdictPosition === 'firstLine' ? 'plainVerdictFirstLineShort' : 'plainVerdictLastLineShort')}, AC=${acceptedToken}, WA=${wrongAnswerToken}`;
}

function getProblemIoMode(problem: ProblemConfig): 'stdio' | 'fileio' {
  return problem.ioMode === 'fileio' ? 'fileio' : 'stdio';
}

function getProblemFileIo(problem: ProblemConfig): { inputFileName: string; outputFileName: string } {
  return {
    inputFileName: problem.fileIo?.inputFileName || 'input.txt',
    outputFileName: problem.fileIo?.outputFileName || 'output.txt'
  };
}

function getContextValue(element: TreeNode): string {
  if (element.contextValue) {
    return element.contextValue;
  }
  if (element.kind === 'sample') {
    if (element.hasGeneratedAnswer) {
      return 'sampleWithGeneratedOutput';
    }
    if (element.answerPending) {
      return 'sampleAnswerPending';
    }
    if (element.hasCheckerOutput && element.sampleStatus !== 'Missing') {
      return element.sampleStatus === 'WA' ? 'sampleWaChecker' : 'sampleChecker';
    }
    return element.sampleStatus === 'Missing'
      ? 'sampleMissing'
      : element.sampleStatus === 'WA'
        ? 'sampleWa'
        : 'sample';
  }
  if (element.kind === 'problem') {
    if (element.problemJudgeMode === 'checker' && element.problemCheckerType === 'plain') {
      return 'oijudgerProblemPlainChecker';
    }
    return element.problemJudgeMode === 'checker' ? 'oijudgerProblemChecker' : 'oijudgerProblemNormal';
  }
  return `oijudger${capitalize(element.kind)}`;
}
