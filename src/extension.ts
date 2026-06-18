import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import {
  addExternalSample,
  addSample,
  clearOutputs,
  ensureConfig,
  exists,
  getOiJudgeDataRelPath,
  getOITestDir,
  getWorkspaceFolder,
  initProblem,
  isCppFile,
  resolveWorkspacePath,
  setMemoryLimit,
  setStackConfig,
  setTimeLimit,
  validatePositiveInteger
} from './config';
import { compileSource } from './compiler';
import { ensureCompilerConfigured, findCompiler, pickCompilerPath, selectCompiler } from './compilerDetection';
import { t } from './i18n';
import { runAllSamples } from './judge';
import {
  PlainCheckerProtocolValidationIssue,
  resolvePlainCheckerOptions,
  validatePlainCheckerProtocol,
  validatePlainCheckerToken
} from './plainCheckerParser';
import { validateFileIoName as validateFileIoNameValue } from './fileIo';
import { explainRuntimeError, renderRuntimeErrorExplanation } from './runtimeErrorExplainer';
import {
  openLastReport,
  openProblemReport,
  openProblemSampleDetail,
  openSampleDetail,
  refreshProblemReportPanel
} from './reportView';
import {
  addProgramToProblem,
  batchAddExternalProblemSamples,
  addEmptyProblemSample,
  addExternalProblemSample,
  addProblemSample,
  addProblemInputSample,
  addProblemFromSource,
  addProblemGenerator,
  addProblemGeneratorInputs,
  applyAllGeneratedAnswersForProblem,
  applyGeneratedAnswerForSample,
  bindProblemStatement,
  clearProblemSubtaskGeneratorInput,
  clearProblemSubtaskGenerator,
  clearProblemStdProgram,
  createProblemSubtaskGeneratorInputFile,
  createProblemSubtask,
  createProblem,
  deleteProblemSubtask,
  deleteGeneratedAnswerForSample,
  deleteProblemSample,
  ensureProblemsConfig,
  getDefaultProblemSource,
  getSubtaskSamples,
  getSampleGeneratedAnswerStatus,
  getProblem,
  getProblemGenerator,
  getProblemGeneratorProgram,
  getProblemGeneratorInput,
  getProblemGeneratorInputs,
  getProblemGenerators,
  getProblemReportPath,
  getProblemRoot,
  getProblemSourcePath,
  isProblemAutoGenerateOutputFromStdEnabled,
  importLegacyProblem,
  moveProblemSampleToSubtask,
  moveProblemSamplesAfterExport,
  renameProblemSubtask,
  removeProblemGeneratorInput,
  removeProblemGenerator,
  resolveProblemReferencePath,
  renameProblemSample,
  saveProblemReport,
  clearProblemSampleScore,
  setProblemDefaultSource,
  setProblemSampleScore,
  setProblemSubtaskScoringMode,
  setProblemSubtaskGenerator,
  setProblemStdProgram,
  setProblemSubtaskGeneratorInput,
  setProblemSubtaskResult,
  setProblemTotalScore,
  toggleProblemAutoGenerateOutputFromStd,
  writeProblemGeneratedInputSample,
  writeGeneratedAnswerForSample,
  unbindProblemStatement,
  updateProblemChecker,
  updateProblemCompiler,
  updateProblemFileIo,
  updateProblemIoMode,
  updateProblemJudgeMode,
  updateProblemLimits,
  updateProblemStack,
  updateProblemStandard
} from './problems';
import {
  findExistingRunResult,
  findExistingStderrOutput,
  findExistingUserOutput,
  getProblemSampleOutputPaths,
  getSampleFileStatus,
  inferSampleSourceType,
  resolveSamplePath
} from './sampleFiles';
import { SampleTreeProvider, withSamplesRunning } from './sampleTreeProvider';
import { calculateEffectiveSampleScores, getProblemTotalScore } from './scoring';
import { isSetterModeEnabled, validateSetterSampleName } from './setterMode';
import { importTestlibToManaged, resolveTestlibForChecker } from './testlibResolver';
import {
  exportTestcases,
  shouldGenerateTestcaseConfig,
  targetContainsFiles,
  TestcaseExportFormat,
  TestcaseExportMode
} from './testcaseExport';
import { exportProblemPackage } from './problemPackageExport';
import {
  importProblemPackage,
  ProblemPackageVersionError
} from './problemPackageImport';
import {
  runGeneratorStdStressTest,
  runStandaloneStressTest,
  StressTestMode
} from './stressTest';
import { createStressRunController } from './stressRunController';
import { formatEnvironmentCheckReport, runEnvironmentCheck } from './environmentCheck';
import {
  StressTreeNode,
  StressRecordsTreeProvider
} from './stressRecordsTreeProvider';
import {
  rerunStressFailedCase,
  resolveStressFile,
  stressFileExists
} from './stressRecords';
import { runProcess } from './runner';
import { withCompilerPathEnv } from './compilerRuntime';
import { CompileResult, FileIoConfig, IoMode, JudgeMode, JudgeReport, PlainCheckerConfig, ProblemConfig, SampleConfig } from './types';

const output = vscode.window.createOutputChannel('OI Judge');
const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
const stressStopStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
const stressRunController = createStressRunController();
let activeProblemId: string | undefined;
let recentEditorFile: RecentEditorFile | undefined;
let problemSamplesRunInProgress = false;

type AddSampleMode = 'paste' | 'files';
type ProblemSampleAddMode = 'manual' | 'files' | 'batch';
type ProblemSampleAddModeItem = vscode.QuickPickItem & { mode: ProblemSampleAddMode };
export type JudgeModeItem = vscode.QuickPickItem & { mode: JudgeMode };
export type StressTestModeItem = vscode.QuickPickItem & { mode: StressTestMode };
type GeneratorInputBindMode = 'create' | 'files';
type GeneratorInputBindModeItem = vscode.QuickPickItem & { mode: GeneratorInputBindMode };
type EmptyGeneratorOutputAction = 'saveAll' | 'skip' | 'cancel';
type GeneratorInputChoice = {
  label: string;
  sourceLabel: string;
  path: string;
  source: 'global' | 'subtask';
};
export type WorkspaceManagementCommand =
  | 'oijudger.createProblem'
  | 'oijudger.addProblemFromCurrentFile'
  | 'oijudger.addProblemFromFile'
  | 'oijudger.refreshView'
  | 'oijudger.importLegacyProblem'
  | 'oijudger.checkEnvironment';
export type WorkspaceManagementItem = vscode.QuickPickItem & { command: WorkspaceManagementCommand };
const MAX_GENERATED_SAMPLE_INPUT_COUNT = 100;
type AutoStdOutputContext =
  | { enabled: false; reason?: string }
  | { enabled: true; std: StdAnswerGenerationContext };
export type RecentEditorFile = {
  uri: vscode.Uri;
  fsPath: string;
  timestamp: number;
};
export type CurrentCodeDocumentResolution =
  | { ok: true; document: vscode.TextDocument }
  | { ok: false; reason: 'noEditor' | 'notLocal' | 'notOpen' | 'notCpp' };
type RunProblemSamplesCommandOptions = {
  sourcePathOverride?: string;
  skipOpenDocumentSave?: boolean;
};

export function isStrictCppFilePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.cpp';
}

export function createRecentEditorFileFromDocument(
  document: Pick<vscode.TextDocument, 'uri'> | undefined,
  timestamp = Date.now()
): RecentEditorFile | undefined {
  if (!document || document.uri.scheme !== 'file') {
    return undefined;
  }
  return {
    uri: document.uri,
    fsPath: document.uri.fsPath,
    timestamp
  };
}

export function resolveCurrentCodeDocument(
  activeEditor: Pick<vscode.TextEditor, 'document'> | undefined,
  recentFile: RecentEditorFile | undefined,
  openDocuments: readonly vscode.TextDocument[]
): CurrentCodeDocumentResolution {
  const activeDocument = activeEditor?.document;
  const candidate = activeDocument
    ? { uri: activeDocument.uri, fsPath: activeDocument.uri.fsPath }
    : recentFile;
  if (!candidate) {
    return { ok: false, reason: 'noEditor' };
  }
  if (candidate.uri.scheme !== 'file') {
    return { ok: false, reason: 'notLocal' };
  }

  const document = openDocuments.find((entry) =>
    entry.uri.scheme === 'file' && isSameFsPath(entry.uri.fsPath, candidate.fsPath)
  );
  if (!document) {
    return { ok: false, reason: 'notOpen' };
  }
  if (!isStrictCppFilePath(document.uri.fsPath)) {
    return { ok: false, reason: 'notCpp' };
  }
  return { ok: true, document };
}

function isSameFsPath(left: string, right: string): boolean {
  const leftPath = path.normalize(left);
  const rightPath = path.normalize(right);
  return process.platform === 'win32'
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function rememberEditorFile(editor: vscode.TextEditor | undefined): void {
  const file = createRecentEditorFileFromDocument(editor?.document);
  if (file) {
    recentEditorFile = file;
  }
}

function getCurrentCodeResolutionMessageKey(
  reason: Exclude<CurrentCodeDocumentResolution, { ok: true }>['reason']
): Parameters<typeof t>[0] {
  switch (reason) {
    case 'notLocal':
      return 'testCurrentCode.notLocal';
    case 'notOpen':
      return 'testCurrentCode.notOpen';
    case 'notCpp':
      return 'testCurrentCode.notCpp';
    case 'noEditor':
    default:
      return 'testCurrentCode.noEditor';
  }
}

export function createWorkspaceManagementItems(): WorkspaceManagementItem[] {
  return [
    { label: t('createProblem'), command: 'oijudger.createProblem' },
    { label: t('addProblemFromCurrentFile'), command: 'oijudger.addProblemFromCurrentFile' },
    { label: t('addProblemFromFile'), command: 'oijudger.addProblemFromFile' },
    { label: t('refreshView'), command: 'oijudger.refreshView' },
    { label: t('importLegacyProblem'), command: 'oijudger.importLegacyProblem' },
    { label: t('environmentCheck'), command: 'oijudger.checkEnvironment' }
  ];
}

export function createJudgeModeItems(): JudgeModeItem[] {
  return [
    {
      label: t('strictTextCompare'),
      description: t('strictTextCompareDescription'),
      mode: 'strictText'
    },
    {
      label: t('normalTextCompare'),
      description: t('normalCompareDescription'),
      mode: 'trimTrailingWhitespace'
    },
    {
      label: t('customChecker'),
      description: t('customCheckerDescription'),
      mode: 'checker'
    }
  ];
}

export function createStressTestModeItems(): StressTestModeItem[] {
  return [
    {
      label: t('stress.mode.generatorStd'),
      description: t('stress.mode.generatorStd.description'),
      detail: t('stress.mode.generatorStd.detail'),
      mode: 'generator-std'
    },
    {
      label: t('stress.mode.standalone'),
      description: t('stress.mode.standalone.description'),
      detail: t('stress.mode.standalone.detail'),
      mode: 'standalone'
    }
  ];
}

export function getStressStandalonePickerTitle(): string {
  return t('stress.selectStandalone');
}

export function resolveProblemGeneratorPathForStress(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): { ok: true; path: string } | { ok: false; reason: 'missing' | 'notFound' } {
  const generatorRef = getProblemGeneratorProgram(problem);
  if (!generatorRef) {
    return { ok: false, reason: 'missing' };
  }
  const generatorPath = resolveProblemReferencePath(workspaceFolder, generatorRef);
  return existsSync(generatorPath) ? { ok: true, path: generatorPath } : { ok: false, reason: 'notFound' };
}

export function resolveProblemStdPathForStress(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): { ok: true; path: string } | { ok: false; reason: 'missing' | 'notFound' } {
  const stdRef = problem.setter?.stdProgram;
  if (!stdRef) {
    return { ok: false, reason: 'missing' };
  }
  const stdPath = resolveProblemReferencePath(workspaceFolder, stdRef);
  return existsSync(stdPath) ? { ok: true, path: stdPath } : { ok: false, reason: 'notFound' };
}

export function activate(context: vscode.ExtensionContext): void {
  const sampleTreeProvider = new SampleTreeProvider();
  const stressRecordsTreeProvider = new StressRecordsTreeProvider();
  statusBar.command = 'oijudger.refreshView';
  statusBar.show();
  stressStopStatusBar.command = 'oijudger.stopStressTest';
  stressStopStatusBar.text = t('stress.stopStatusBar');
  stressStopStatusBar.tooltip = t('stress.stopTooltip');
  void updateStatusBar();
  void updateSetterModeContext();
  void setStressRunningContext(false);
  context.subscriptions.push(
    vscode.window.createTreeView('oijudger.samplesView', {
      treeDataProvider: sampleTreeProvider,
      dragAndDropController: sampleTreeProvider
    }),
    vscode.window.createTreeView('oijudger.stressRecordsView', {
      treeDataProvider: stressRecordsTreeProvider
    }),
    statusBar,
    vscode.commands.registerCommand('oijudger.initProblem', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await initProblem(workspaceFolder);
      await ensureCompilerConfigured(workspaceFolder, config);
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(t('problemInitialized'));
    }),
    vscode.commands.registerCommand('oijudger.addSample', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      const mode = await pickAddSampleMode();
      if (!mode) {
        return;
      }

      const sample =
        mode === 'paste'
          ? await addManagedSingleSample(workspaceFolder, config)
          : await addExternalSingleSample(workspaceFolder, config);
      if (!sample) {
        return;
      }

      sampleTreeProvider.refresh();
      if (mode === 'files') {
        vscode.window.showInformationMessage(t('externalSampleFilesAdded'));
        return;
      }

      await openManualSampleFiles(workspaceFolder, sample);
      await showManualSampleCreatedMessage(sample);
    }),
    vscode.commands.registerCommand('oijudger.runAllSamples', async () => {
      const firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (firstWorkspaceFolder) {
        const problems = await ensureProblemsConfig(firstWorkspaceFolder);
        if (problems.problems.length > 0) {
          await runProblemSamplesCommand(activeProblemId, sampleTreeProvider, false, context);
          return;
        }
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(t('openCppFile'));
        return;
      }

      const sourceUri = editor.document.uri;
      if (sourceUri.scheme !== 'file' || !isCppFile(sourceUri.fsPath)) {
        vscode.window.showErrorMessage(t('onlyCppFile'));
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(t('cppFileInWorkspace'));
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      const configured = await ensureCompilerConfigured(workspaceFolder, config);
      if (!configured) {
        return;
      }
      if (configured.samples.length === 0) {
        vscode.window.showWarningMessage(t('noSamples'));
        return;
      }

      await editor.document.save();
      const report = await runAllSamples(workspaceFolder, sourceUri.fsPath, configured, output);
      sampleTreeProvider.refresh();
      if (!report) {
        return;
      }

      if (report.summary.accepted === report.summary.total) {
        vscode.window.showInformationMessage(t('allAccepted', { total: report.summary.total }));
      } else {
        vscode.window.showWarningMessage(
          t('acceptedSummary', { accepted: report.summary.accepted, total: report.summary.total })
        );
      }
    }),
    vscode.commands.registerCommand('oijudger.setTimeLimit', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      const timeMsText = await vscode.window.showInputBox({
        title: t('setTimeLimitTitle'),
        prompt: t('setTimeLimitPrompt'),
        value: String(config.limits.timeMs),
        validateInput: validatePositiveInteger
      });
      if (timeMsText === undefined) {
        return;
      }

      await setTimeLimit(workspaceFolder, Number(timeMsText));
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(t('timeLimitUpdated'));
    }),
    vscode.commands.registerCommand('oijudger.setMemoryLimit', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      const memoryMbText = await vscode.window.showInputBox({
        title: t('setMemoryLimitTitle'),
        prompt: t('setMemoryLimitPrompt'),
        value: String(config.limits.memoryMb),
        validateInput: validatePositiveInteger
      });
      if (memoryMbText === undefined) {
        return;
      }

      await setMemoryLimit(workspaceFolder, Number(memoryMbText));
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(t('memoryLimitUpdated'));
    }),
    vscode.commands.registerCommand('oijudger.setStackSize', async (problemArg?: unknown) => {
      await setStackSizeCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.selectCompiler', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      await selectCompiler(workspaceFolder, config);
      sampleTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('oijudger.openLastReport', async () => {
      await openLastReport(context);
    }),
    vscode.commands.registerCommand('oijudger.openResultPanel', async () => {
      await openLastReport(context);
    }),
    vscode.commands.registerCommand('oijudger.openSampleDetail', async (sampleId?: number) => {
      await openSampleDetail(context, sampleId);
    }),
    vscode.commands.registerCommand('oijudger.clearOutputs', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      await clearOutputs(workspaceFolder);
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(t('outputsCleared'));
    }),
    vscode.commands.registerCommand('oijudger.refreshView', () => {
      sampleTreeProvider.refresh();
      void updateStatusBar();
    }),
    vscode.commands.registerCommand('oijudger.checkEnvironment', async () => {
      await checkEnvironmentCommand(context);
    }),
    vscode.commands.registerCommand('oijudger.manageWorkspace', async () => {
      await manageWorkspaceCommand();
    }),
    vscode.commands.registerCommand('oijudger.createProblem', async () => {
      await createProblemCommand(sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemFromCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file' || !isCppFile(editor.document.uri.fsPath)) {
        vscode.window.showErrorMessage(t('openCppFile'));
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(t('cppFileInWorkspace'));
        return;
      }

      const problem = await addProblemFromSource(workspaceFolder, editor.document.uri.fsPath);
      const candidate = await findCompiler(workspaceFolder, problem);
      if (candidate) {
        await updateProblemCompiler(workspaceFolder, problem.id, candidate.command);
      }
      activeProblemId = problem.id;
      sampleTreeProvider.refresh();
      await updateStatusBar(problem.id);
      vscode.window.showInformationMessage(t('problemAdded', { problem: problem.name }));
    }),
    vscode.commands.registerCommand('oijudger.addProblemFromFile', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const sourceUri = await pickSourceFile();
      if (!sourceUri) {
        return;
      }

      const problem = await addProblemFromSource(workspaceFolder, sourceUri.fsPath);
      const candidate = await findCompiler(workspaceFolder, problem);
      if (candidate) {
        await updateProblemCompiler(workspaceFolder, problem.id, candidate.command);
      }
      activeProblemId = problem.id;
      sampleTreeProvider.refresh();
      await updateStatusBar(problem.id);
      vscode.window.showInformationMessage(t('problemAdded', { problem: problem.name }));
    }),
    vscode.commands.registerCommand('oijudger.importLegacyProblem', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const problem = await importLegacyProblem(workspaceFolder);
      if (!problem) {
        vscode.window.showWarningMessage(t('noLegacyProblem'));
        return;
      }
      activeProblemId = problem.id;
      sampleTreeProvider.refresh();
      await updateStatusBar(problem.id);
      vscode.window.showInformationMessage(t('legacyProblemImported', { problem: problem.name }));
    }),
    vscode.commands.registerCommand('oijudger.addSampleFromSamplesGroup', async (problemArg?: unknown) => {
      await addSampleFromSamplesGroupCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.generateSampleInput', async (problemArg?: unknown) => {
      await generateSampleInputCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setProblemTotalScore', async (problemArg?: unknown) => {
      await setProblemTotalScoreCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.exportTestcases', async (problemArg?: unknown) => {
      await exportTestcasesCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.exportProblemPackage', async (problemArg?: unknown) => {
      await exportProblemPackageCommand(readProblemId(problemArg));
    }),
    vscode.commands.registerCommand('oijudger.importProblemPackage', async () => {
      await importProblemPackageCommand(sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.runStressTest', async (problemArg?: unknown) => {
      await runStressTestCommand(readProblemId(problemArg), stressRecordsTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.stressTestCurrentCode', async (problemArg?: unknown) => {
      await stressTestCurrentCodeCommand(readProblemId(problemArg), stressRecordsTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.stopStressTest', async () => {
      await stopStressTestCommand();
    }),
    vscode.commands.registerCommand('oijudger.refreshStressRecords', () => {
      stressRecordsTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('oijudger.openStressFile', async (node?: StressTreeNode) => {
      await openStressFileCommand(node);
    }),
    vscode.commands.registerCommand('oijudger.addStressCaseToSamples', async (node?: StressTreeNode) => {
      await addStressCaseToSamplesCommand(node, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.rerunStressCase', async (node?: StressTreeNode) => {
      await rerunStressCaseCommand(node);
    }),
    vscode.commands.registerCommand('oijudger.revealStressSessionFolder', async (node?: StressTreeNode) => {
      await revealStressSessionFolderCommand(node);
    }),
    vscode.commands.registerCommand('oijudger.createSubtask', async (problemArg?: unknown) => {
      await createSubtaskCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.renameSubtask', async (problemArg?: unknown) => {
      await renameSubtaskCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.deleteSubtask', async (problemArg?: unknown) => {
      await deleteSubtaskCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.bindSubtaskGeneratorInput', async (problemArg?: unknown) => {
      await bindSubtaskGeneratorInputCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openSubtaskGeneratorInput', async (problemArg?: unknown) => {
      await openSubtaskGeneratorInputCommand(readProblemId(problemArg), readSubtaskId(problemArg));
    }),
    vscode.commands.registerCommand('oijudger.clearSubtaskGeneratorInput', async (problemArg?: unknown) => {
      await clearSubtaskGeneratorInputCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.moveSampleToSubtask', async (problemArg?: unknown, sampleArg?: unknown) => {
      await moveSampleToSubtaskCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.runSubtask', async (problemArg?: unknown) => {
      await runSubtaskCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.generateSubtaskSampleInput', async (problemArg?: unknown) => {
      await generateSubtaskSampleInputCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setSubtaskScoringMode', async (problemArg?: unknown) => {
      await setSubtaskScoringModeCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemSample', async (problemArg?: unknown) => {
      await addProblemSampleCommand(readProblemId(problemArg), false, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemSampleFromFiles', async (problemArg?: unknown) => {
      await addProblemSampleCommand(readProblemId(problemArg), true, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.batchAddSamples', async (problemArg?: unknown) => {
      await batchAddSamplesCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.runProblemSamples', async (problemArg?: unknown) => {
      await runProblemSamplesCommand(readProblemId(problemArg), sampleTreeProvider, false, context);
    }),
    vscode.commands.registerCommand('oijudger.runSamplesWithProgram', async (problemArg?: unknown) => {
      await runProblemSamplesCommand(readProblemId(problemArg), sampleTreeProvider, true, context);
    }),
    vscode.commands.registerCommand('oijudger.testCurrentCode', async () => {
      await testCurrentCodeCommand(sampleTreeProvider, context);
    }),
    vscode.commands.registerCommand('oijudger.runProblemSample', async (problemArg?: unknown, sampleArg?: unknown) => {
      await runProblemSampleCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setProblemTimeLimit', async (problemArg?: unknown) => {
      await setProblemLimitCommand(readProblemId(problemArg), 'timeMs', sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setProblemMemoryLimit', async (problemArg?: unknown) => {
      await setProblemLimitCommand(readProblemId(problemArg), 'memoryMb', sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setProblemStackSize', async (problemArg?: unknown) => {
      await setStackSizeCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setJudgeMode', async (problemArg?: unknown) => {
      await setJudgeModeCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setIoMode', async (problemArg?: unknown) => {
      await setIoModeCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setFileIoNames', async (problemArg?: unknown) => {
      await setFileIoNamesCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setChecker', async (problemArg?: unknown) => {
      await setCheckerCommand(context, readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setPlainCheckerProtocol', async (problemArg?: unknown) => {
      await setPlainCheckerProtocolCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.clearChecker', async (problemArg?: unknown) => {
      await clearCheckerCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openChecker', async (problemArg?: unknown) => {
      await openCheckerCommand(readProblemId(problemArg));
    }),
    vscode.commands.registerCommand('oijudger.importTestlib', async () => {
      await importTestlibCommand(context);
      sampleTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('oijudger.openTestlib', async (problemArg?: unknown) => {
      await openTestlibCommand(readProblemId(problemArg));
    }),
    vscode.commands.registerCommand('oijudger.setProblemStandard', async (problemArg?: unknown) => {
      await setProblemStandardCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.selectProblemCompiler', async (problemArg?: unknown) => {
      await selectProblemCompilerCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.bindStatement', async (problemArg?: unknown) => {
      await bindStatementCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openStatement', async (problemArg?: unknown) => {
      await openStatementCommand(readProblemId(problemArg));
    }),
    vscode.commands.registerCommand('oijudger.unbindStatement', async (problemArg?: unknown) => {
      await unbindStatementCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProgramToProblem', async (problemArg?: unknown) => {
      await addProgramToProblemCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setDefaultProgram', async (problemArg?: unknown) => {
      await setDefaultProgramCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openProblemResultPanel', async (problemArg?: unknown) => {
      const problemId = readProblemId(problemArg);
      if (!problemId) {
        vscode.window.showWarningMessage(t('problemNotFound'));
        return;
      }
      await openProblemReport(context, problemId);
    }),
    vscode.commands.registerCommand('oijudger.openProblemSampleDetail', async (problemArg?: unknown, sampleArg?: unknown) => {
      const problemId = readProblemId(problemArg);
      const sampleId = readSampleId(problemArg, sampleArg);
      if (!problemId || sampleId === undefined) {
        vscode.window.showWarningMessage(t('sampleNotFound'));
        return;
      }
      await openProblemSampleDetail(context, problemId, sampleId);
    }),
    vscode.commands.registerCommand('oijudger.openSampleInput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'input');
    }),
    vscode.commands.registerCommand('oijudger.openSampleAnswer', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'answer');
    }),
    vscode.commands.registerCommand('oijudger.copyTestcaseFreopenInput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await copyTestcaseFreopenInputCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    vscode.commands.registerCommand('oijudger.openSampleOutput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'output');
    }),
    vscode.commands.registerCommand('oijudger.openSampleUserOutput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'output');
    }),
    // Legacy compatibility command for old reports or external links. The current UI uses Run Result.
    vscode.commands.registerCommand('oijudger.openSampleStderr', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'stderr');
    }),
    vscode.commands.registerCommand('oijudger.openSampleDiff', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleDiffCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), readSourceViewColumn(problemArg));
    }),
    vscode.commands.registerCommand('oijudger.openCheckerOutput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openCheckerArtifactCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    // Legacy compatibility command for old reports or external links. The current UI uses Checker Output.
    vscode.commands.registerCommand('oijudger.openCheckerStderr', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openCheckerArtifactCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    vscode.commands.registerCommand('oijudger.selectStdProgram', async (problemArg?: unknown) => {
      await selectStdProgramCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openStdProgram', async (problemArg?: unknown) => {
      await openStdProgramCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.clearStdProgram', async (problemArg?: unknown) => {
      await clearStdProgramCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.toggleAutoGenerateOutputFromStd', async (problemArg?: unknown) => {
      await toggleAutoGenerateOutputFromStdCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.generateSampleAnswerWithStd', async (problemArg?: unknown, sampleArg?: unknown) => {
      await generateSampleAnswerWithStdCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.generateAllSampleAnswersWithStd', async (problemArg?: unknown) => {
      await generateAllSampleAnswersWithStdCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.viewCurrentSampleAnswer', async (problemArg?: unknown, sampleArg?: unknown) => {
      await viewCurrentSampleAnswerCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    vscode.commands.registerCommand('oijudger.viewGeneratedSampleAnswer', async (problemArg?: unknown, sampleArg?: unknown) => {
      await viewGeneratedSampleAnswerCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    vscode.commands.registerCommand('oijudger.diffGeneratedSampleAnswer', async (problemArg?: unknown, sampleArg?: unknown) => {
      await diffGeneratedSampleAnswerCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    vscode.commands.registerCommand('oijudger.applyGeneratedSampleAnswer', async (problemArg?: unknown, sampleArg?: unknown) => {
      await applyGeneratedSampleAnswerCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.deleteGeneratedSampleAnswer', async (problemArg?: unknown, sampleArg?: unknown) => {
      await deleteGeneratedSampleAnswerCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.applyAllGeneratedSampleAnswers', async (problemArg?: unknown) => {
      await applyAllGeneratedSampleAnswersCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemGenerator', async (problemArg?: unknown) => {
      await addProblemGeneratorCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openProblemGenerator', async (problemArg?: unknown) => {
      await openProblemGeneratorCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.removeProblemGenerator', async (problemArg?: unknown) => {
      await removeProblemGeneratorCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemGeneratorInput', async (problemArg?: unknown) => {
      await addProblemGeneratorInputCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openProblemGeneratorInput', async (problemArg?: unknown, inputArg?: unknown) => {
      await openProblemGeneratorInputCommand(readProblemId(problemArg), readGeneratorInputId(problemArg, inputArg));
    }),
    vscode.commands.registerCommand('oijudger.removeProblemGeneratorInput', async (problemArg?: unknown, inputArg?: unknown) => {
      await removeProblemGeneratorInputCommand(readProblemId(problemArg), readGeneratorInputId(problemArg, inputArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.selectGeneratorProgram', async (problemArg?: unknown) => {
      await addProblemGeneratorCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openGeneratorProgram', async (problemArg?: unknown) => {
      await openProblemGeneratorCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.clearGeneratorProgram', async (problemArg?: unknown) => {
      await removeProblemGeneratorCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.bindSubtaskGenerator', async (problemArg?: unknown) => {
      await bindSubtaskGeneratorCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.openSubtaskGenerator', async (problemArg?: unknown) => {
      await openSubtaskGeneratorCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.clearSubtaskGenerator', async (problemArg?: unknown) => {
      await clearSubtaskGeneratorCommand(readProblemId(problemArg), readSubtaskId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addSetterInputSample', async (problemArg?: unknown) => {
      await addSetterInputSampleCommand(readProblemId(problemArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setSampleName', async (problemArg?: unknown, sampleArg?: unknown) => {
      await setSampleNameCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setSampleScore', async (problemArg?: unknown, sampleArg?: unknown) => {
      await setSampleScoreCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.clearSampleScore', async (problemArg?: unknown, sampleArg?: unknown) => {
      await clearSampleScoreCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.deleteSample', async (problemArg?: unknown, sampleArg?: unknown) => {
      await deleteSampleCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    output
  );

  rememberEditorFile(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      rememberEditorFile(editor);
      sampleTreeProvider.refresh();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => rememberEditorFile(event.textEditor)),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (
        document.uri.fsPath.endsWith('config.json') ||
        document.uri.fsPath.endsWith('problems.json') ||
        path.basename(document.uri.fsPath) === '.OIJudge' ||
        document.uri.fsPath.endsWith('report.json')
      ) {
        sampleTreeProvider.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('oijudger.language') || event.affectsConfiguration('oijudger.setterMode.enabled')) {
        void updateSetterModeContext();
        sampleTreeProvider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up.
}

async function checkEnvironmentCommand(context: vscode.ExtensionContext): Promise<void> {
  output.appendLine('');
  output.appendLine('=== OI Judge Environment Check ===');
  const workspaceFolder = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : vscode.workspace.workspaceFolders?.[0];
  const configuredCompiler = workspaceFolder ? await resolveEnvironmentCheckCompiler(workspaceFolder) : undefined;
  const report = await runEnvironmentCheck({
    workspaceFolder,
    configuredCompiler,
    vscodeVersion: vscode.version,
    extensionVersion: context.extension?.packageJSON?.version,
    output
  });
  const reportText = formatEnvironmentCheckReport(report);
  const openReport = t('environmentCheck.openReport');
  const copyReport = t('environmentCheck.copyReport');
  const openOutput = t('environmentCheck.openOutput');
  const message = report.overallStatus === 'pass'
    ? t('environmentCheck.passed')
    : report.overallStatus === 'warn'
      ? t('environmentCheck.warning')
      : t('environmentCheck.failed');
  const showMessage = report.overallStatus === 'fail'
    ? vscode.window.showErrorMessage
    : report.overallStatus === 'warn'
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;
  const picked = await showMessage(message, openReport, copyReport, openOutput);
  if (picked === openReport) {
    const document = await vscode.workspace.openTextDocument({
      content: reportText,
      language: 'plaintext'
    });
    await vscode.window.showTextDocument(document, { preview: true });
  } else if (picked === copyReport) {
    await vscode.env.clipboard.writeText(reportText);
    vscode.window.showInformationMessage(t('environmentCheck.copied'));
  } else if (picked === openOutput) {
    output.show(true);
  }
}

async function resolveEnvironmentCheckCompiler(workspaceFolder: vscode.WorkspaceFolder): Promise<string | undefined> {
  try {
    const problems = await ensureProblemsConfig(workspaceFolder);
    const activeProblem = activeProblemId
      ? problems.problems.find((problem) => problem.id === activeProblemId)
      : undefined;
    const problem = activeProblem ?? problems.problems[0];
    return problem?.compiler?.command;
  } catch {
    return undefined;
  }
}

async function manageWorkspaceCommand(): Promise<void> {
  if (!getWorkspaceFolder()) {
    vscode.window.showWarningMessage(t('openWorkspaceFolder'));
    return;
  }

  const picked = await vscode.window.showQuickPick(createWorkspaceManagementItems(), {
    title: t('manageWorkspace'),
    placeHolder: t('manageWorkspace')
  });
  if (!picked) {
    return;
  }

  await vscode.commands.executeCommand(picked.command);
}

async function pickAddSampleMode(): Promise<AddSampleMode | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: t('pasteManually'),
        description: t('pasteManuallyDescription'),
        mode: 'paste' as const
      },
      {
        label: t('selectInputOutputFiles'),
        description: t('selectInputOutputFilesDescription'),
        mode: 'files' as const
      }
    ],
    {
      title: t('addSampleTitle'),
      placeHolder: t('addSamplePlaceHolder')
    }
  );

  return picked?.mode;
}

export function createProblemSampleAddModeItems(): ProblemSampleAddModeItem[] {
  return [
    {
      label: t('sampleAddManual'),
      description: t('sampleAddManualDescription'),
      mode: 'manual'
    },
    {
      label: t('sampleAddImportFiles'),
      description: t('sampleAddImportFilesDescription'),
      mode: 'files'
    },
    {
      label: t('sampleAddBatchImport'),
      description: t('sampleAddBatchImportDescription'),
      mode: 'batch'
    }
  ];
}

export function createGeneratorInputBindModeItems(): GeneratorInputBindModeItem[] {
  return [
    {
      label: t('subtask.generatorInputCreate'),
      description: t('subtask.generatorInputCreateDescription'),
      mode: 'create'
    },
    {
      label: t('subtask.generatorInputSelect'),
      description: t('subtask.generatorInputSelectDescription'),
      mode: 'files'
    }
  ];
}

async function pickProblemSampleAddMode(): Promise<ProblemSampleAddMode | undefined> {
  const picked = await vscode.window.showQuickPick(createProblemSampleAddModeItems(), {
    title: t('sampleAddTitle'),
    placeHolder: t('addSamplePlaceHolder')
  });
  return picked?.mode;
}

async function pickGeneratorInputBindMode(): Promise<GeneratorInputBindMode | undefined> {
  const picked = await vscode.window.showQuickPick(createGeneratorInputBindModeItems(), {
    title: t('subtask.bindGeneratorInput'),
    placeHolder: t('subtask.generatorInputBindPlaceHolder')
  });
  return picked?.mode;
}

async function readSampleFilePaths(): Promise<{ inputPath: string; answerPath: string } | undefined> {
  const inputUri = await pickSingleFile(t('selectInputFile'));
  if (!inputUri) {
    return undefined;
  }

  const answerUri = await pickSingleFile(t('selectAnswerFile'));
  if (!answerUri) {
    return undefined;
  }

  return {
    inputPath: inputUri.fsPath,
    answerPath: answerUri.fsPath
  };
}

async function addManagedSingleSample(
  workspaceFolder: vscode.WorkspaceFolder,
  config: Awaited<ReturnType<typeof ensureConfig>>
): Promise<Awaited<ReturnType<typeof addSample>> | undefined> {
  return addSample(workspaceFolder, config, '', '', {
    decodeEscapes: false
  });
}

async function openManualSampleFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: Pick<SampleConfig, 'input' | 'answer'>
): Promise<void> {
  const inputPath = resolveWorkspacePath(workspaceFolder, sample.input);
  const answerPath = resolveWorkspacePath(workspaceFolder, sample.answer);
  const inputDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(inputPath));
  await vscode.window.showTextDocument(inputDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false
  });

  const answerDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(answerPath));
  await vscode.window.showTextDocument(answerDocument, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false
  });
}

async function openInputSampleFile(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: Pick<SampleConfig, 'input'>
): Promise<void> {
  const inputPath = resolveWorkspacePath(workspaceFolder, sample.input);
  const inputDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(inputPath));
  await vscode.window.showTextDocument(inputDocument, {
    preview: false
  });
}

async function showManualSampleCreatedMessage(sample: Pick<SampleConfig, 'input' | 'answer'>): Promise<void> {
  await vscode.window.showInformationMessage(
    t('manualSampleFilesCreatedMessage', {
      inputFile: path.basename(sample.input),
      answerFile: path.basename(sample.answer)
    })
  );
}

async function showSetterInputSampleCreatedMessage(sample: Pick<SampleConfig, 'input'>): Promise<void> {
  await vscode.window.showInformationMessage(t('setter.sample.inputCreated', {
    inputFile: path.basename(sample.input)
  }));
}

async function addExternalSingleSample(
  workspaceFolder: vscode.WorkspaceFolder,
  config: Awaited<ReturnType<typeof ensureConfig>>
): Promise<Awaited<ReturnType<typeof addExternalSample>> | undefined> {
  const files = await readSampleFilePaths();
  if (!files) {
    return undefined;
  }

  return addExternalSample(workspaceFolder, config, files.inputPath, files.answerPath);
}

async function pickSingleFile(title: string): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select')
  });

  return uris?.[0];
}

async function pickSourceFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('selectSourceFile'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      'C++ Source': ['cpp', 'cc', 'cxx', 'c++']
    }
  });

  return uris?.[0];
}

async function pickGeneratorFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('selectGenerator'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      'C/C++ Source': ['cpp', 'cc', 'cxx', 'c', 'c++']
    }
  });

  return uris?.[0];
}

async function pickGlobalGeneratorInputFiles(): Promise<vscode.Uri[] | undefined> {
  return vscode.window.showOpenDialog({
    title: t('generatorInput.global.select'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    openLabel: t('select'),
    filters: {
      [t('generatorInput.global.root')]: ['txt', 'in', 'json', 'yaml', 'yml'],
      'All Files': ['*']
    }
  });
}

async function pickSamplesFolder(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('batchAddSamples'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t('selectSamplesFolder')
  });

  return uris?.[0];
}

function normalizeSuffix(value: string): string {
  const suffix = value.trim();
  return suffix.startsWith('.') ? suffix : `.${suffix}`;
}

export async function scanSamplePairs(
  folder: string,
  inputSuffix: string,
  answerSuffix: string
): Promise<{
  matched: Array<{ inputPath: string; answerPath: string; baseName: string }>;
  missingAnswers: Array<{ inputPath: string; expectedAnswerPath: string }>;
}> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const fileSet = new Set(fileNames);
  const matched: Array<{ inputPath: string; answerPath: string; baseName: string }> = [];
  const missingAnswers: Array<{ inputPath: string; expectedAnswerPath: string }> = [];

  for (const fileName of fileNames) {
    if (!fileName.endsWith(inputSuffix)) {
      continue;
    }
    const baseName = fileName.slice(0, -inputSuffix.length);
    const answerFileName = resolveAnswerFileName(fileSet, baseName, answerSuffix);
    const inputPath = path.resolve(folder, fileName);
    const answerPath = path.resolve(folder, answerFileName);
    if (fileSet.has(answerFileName)) {
      matched.push({ inputPath, answerPath, baseName });
    } else {
      missingAnswers.push({ inputPath, expectedAnswerPath: answerPath });
    }
  }

  matched.sort((a, b) => a.baseName.localeCompare(b.baseName, undefined, { numeric: true, sensitivity: 'base' }));
  missingAnswers.sort((a, b) =>
    path.basename(a.inputPath).localeCompare(path.basename(b.inputPath), undefined, { numeric: true, sensitivity: 'base' })
  );
  return { matched, missingAnswers };
}

function resolveAnswerFileName(fileSet: Set<string>, baseName: string, answerSuffix: string): string {
  const preferred = `${baseName}${answerSuffix}`;
  if (fileSet.has(preferred) || answerSuffix.toLowerCase() !== '.out') {
    return preferred;
  }

  const compatibleAns = `${baseName}.ans`;
  return fileSet.has(compatibleAns) ? compatibleAns : preferred;
}

function writeBatchAddDiagnostics(
  problemName: string,
  folder: string,
  inputSuffix: string,
  answerSuffix: string,
  scan: {
    matched: Array<{ inputPath: string; answerPath: string }>;
    missingAnswers: Array<{ inputPath: string; expectedAnswerPath: string }>;
  }
): void {
  output.appendLine('');
  output.appendLine('Batch Add Samples');
  output.appendLine(`Problem: ${problemName}`);
  output.appendLine(`Folder: ${folder}`);
  output.appendLine(`Input suffix: ${inputSuffix}`);
  output.appendLine(`Answer suffix: ${answerSuffix}`);
  output.appendLine('Matched:');
  for (const pair of scan.matched) {
    output.appendLine(`  ${path.basename(pair.inputPath)} -> ${path.basename(pair.answerPath)}`);
  }
  output.appendLine('Skipped missing answer:');
  for (const skipped of scan.missingAnswers) {
    output.appendLine(`  ${path.basename(skipped.inputPath)} expected ${path.basename(skipped.expectedAnswerPath)}`);
  }
}

async function createProblemCommand(sampleTreeProvider: SampleTreeProvider): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const name = await vscode.window.showInputBox({
    title: t('createProblem'),
    prompt: t('problemName'),
    value: ''
  });
  if (!name?.trim()) {
    return;
  }

  const problem = await createProblem(workspaceFolder, name.trim());
  activeProblemId = problem.id;
  sampleTreeProvider.refresh();
  await updateStatusBar(problem.id);
  vscode.window.showInformationMessage(t('problemCreated'));
}

async function addProblemSampleCommand(
  problemId: string | undefined,
  fromFiles: boolean,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const sample = fromFiles
    ? await addExternalProblemSampleFromPicker(context.workspaceFolder, context.problem.id)
    : await addEmptyProblemSample(context.workspaceFolder, context.problem.id);
  if (!sample) {
    return;
  }

  sampleTreeProvider.refresh();
  if (fromFiles) {
    vscode.window.showInformationMessage(t('externalSampleFilesAdded'));
    return;
  }

  await openManualSampleFiles(context.workspaceFolder, sample);
  await showManualSampleCreatedMessage(sample);
}

async function addSampleFromSamplesGroupCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  if (!problemId) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  const mode = await pickProblemSampleAddMode();
  if (!mode) {
    return;
  }

  if (mode === 'batch') {
    await batchAddSamplesCommand(problemId, sampleTreeProvider);
    return;
  }

  await addProblemSampleCommand(problemId, mode === 'files', sampleTreeProvider);
}

async function addExternalProblemSampleFromPicker(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<Awaited<ReturnType<typeof addExternalProblemSample>> | undefined> {
  const files = await readSampleFilePaths();
  if (!files) {
    return undefined;
  }

  return addExternalProblemSample(workspaceFolder, problemId, files.inputPath, files.answerPath);
}

async function batchAddSamplesCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const inputSuffixText = await vscode.window.showInputBox({
    title: t('batchAddSamples'),
    prompt: t('enterInputSuffix'),
    value: '.in',
    validateInput: (value) => value.trim() ? undefined : t('inputSuffixEmpty')
  });
  if (inputSuffixText === undefined) {
    vscode.window.showInformationMessage(t('batchAddCanceled'));
    return;
  }

  const answerSuffixText = await vscode.window.showInputBox({
    title: t('batchAddSamples'),
    prompt: t('enterAnswerSuffix'),
    value: '.out',
    validateInput: (value) => value.trim() ? undefined : t('answerSuffixEmpty')
  });
  if (answerSuffixText === undefined) {
    vscode.window.showInformationMessage(t('batchAddCanceled'));
    return;
  }

  const folderUri = await pickSamplesFolder();
  if (!folderUri) {
    vscode.window.showInformationMessage(t('batchAddCanceled'));
    return;
  }

  const inputSuffix = normalizeSuffix(inputSuffixText);
  const answerSuffix = normalizeSuffix(answerSuffixText);
  const scan = await scanSamplePairs(folderUri.fsPath, inputSuffix, answerSuffix);
  writeBatchAddDiagnostics(context.problem.name, folderUri.fsPath, inputSuffix, answerSuffix, scan);

  if (scan.matched.length === 0) {
    vscode.window.showWarningMessage(t('noMatchedSamples'));
    return;
  }

  const result = await batchAddExternalProblemSamples(context.workspaceFolder, context.problem.id, scan.matched);
  if (!result) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  output.appendLine('Skipped duplicates:');
  for (const duplicate of result.duplicates) {
    output.appendLine(`  ${path.basename(duplicate.inputPath)} -> ${path.basename(duplicate.answerPath)}`);
  }

  const missing = scan.missingAnswers.length;
  const duplicates = result.duplicates.length;
  sampleTreeProvider.refresh();
  if (missing > 0 || duplicates > 0) {
    vscode.window.showInformationMessage(t('batchAddSamplesSummary', {
      count: result.added.length,
      missing,
      duplicates
    }));
  } else {
    vscode.window.showInformationMessage(t('batchAddSamplesAdded', { count: result.added.length }));
  }
}

async function runProblemSamplesCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider,
  forceProgramPicker: boolean,
  extensionContext: vscode.ExtensionContext,
  options: RunProblemSamplesCommandOptions = {}
): Promise<void> {
  if (problemSamplesRunInProgress) {
    vscode.window.showErrorMessage(t('judgeAlreadyRunning'));
    return;
  }

  problemSamplesRunInProgress = true;
  try {
    const context = await getProblemContext(problemId, true);
    if (!context) {
      return;
    }

    let problem = await ensureProblemCompiler(context.workspaceFolder, context.problem);
    if (!problem) {
      return;
    }

    if (problem.samples.length === 0) {
      vscode.window.showWarningMessage(t('noSamples'));
      return;
    }

    const sourcePath = options.sourcePathOverride
      ?? (forceProgramPicker
        ? await pickProgramForRun(context.workspaceFolder, problem, true)
        : await resolveSourceForRun(context.workspaceFolder, problem));
    if (!sourcePath) {
      return;
    }

    if (!(await exists(sourcePath))) {
      vscode.window.showErrorMessage(t('programMissing'));
      return;
    }

    if (!options.skipOpenDocumentSave) {
      const document = vscode.workspace.textDocuments.find((entry) => isSameFsPath(entry.uri.fsPath, sourcePath));
      const saved = await document?.save();
      if (saved === false) {
        vscode.window.showErrorMessage(t('testCurrentCode.saveFailed'));
        return;
      }
    }

    const runningSampleIds = problem.samples.map((sample) => sample.id);
    await withSamplesRunning(sampleTreeProvider, problem.id, runningSampleIds, async () => {
      const report = await runAllSamples(context.workspaceFolder, sourcePath, problem, output, {
        onSampleComplete: async (partialReport, sampleReport) => {
          await saveProblemReport(context.workspaceFolder, problem.id, partialReport);
          sampleTreeProvider.clearSamplesRunning(problem.id, [sampleReport.id]);
          sampleTreeProvider.refresh();
        }
      });
      if (report) {
        await saveProblemReport(context.workspaceFolder, problem.id, report);
        await openProblemReport(extensionContext, problem.id);
      }
      activeProblemId = problem.id;
      sampleTreeProvider.refresh();
      await updateStatusBar(problem.id);
    });
  } finally {
    problemSamplesRunInProgress = false;
  }
}

async function testCurrentCodeCommand(
  sampleTreeProvider: SampleTreeProvider,
  extensionContext: vscode.ExtensionContext
): Promise<void> {
  if (problemSamplesRunInProgress) {
    vscode.window.showErrorMessage(t('judgeAlreadyRunning'));
    return;
  }

  const resolution = resolveCurrentCodeDocument(
    vscode.window.activeTextEditor,
    recentEditorFile,
    vscode.workspace.textDocuments
  );
  if (!resolution.ok) {
    vscode.window.showErrorMessage(t(getCurrentCodeResolutionMessageKey(resolution.reason)));
    return;
  }

  const sourcePath = resolution.document.uri.fsPath;
  if (!(await exists(sourcePath))) {
    vscode.window.showErrorMessage(t('testCurrentCode.missing'));
    return;
  }

  if (resolution.document.isDirty) {
    const saved = await resolution.document.save();
    if (!saved) {
      vscode.window.showErrorMessage(t('testCurrentCode.saveFailed'));
      return;
    }
  }

  await runProblemSamplesCommand(activeProblemId, sampleTreeProvider, false, extensionContext, {
    sourcePathOverride: sourcePath,
    skipOpenDocumentSave: true
  });
}

async function runProblemSampleCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  let problem = await ensureProblemCompiler(context.workspaceFolder, context.problem);
  if (!problem) {
    return;
  }

  const sourcePath = await resolveSourceForRun(context.workspaceFolder, problem);
  if (!sourcePath) {
    return;
  }

  if (!(await exists(sourcePath))) {
    vscode.window.showErrorMessage(t('programMissing'));
    return;
  }

  const sample = problem.samples.find((entry) => entry.id === context.sample.id);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  const document = vscode.workspace.textDocuments.find((entry) => entry.uri.fsPath === sourcePath);
  await document?.save();

  await withSamplesRunning(sampleTreeProvider, problem.id, [sample.id], async () => {
    const report = await runAllSamples(context.workspaceFolder, sourcePath, { ...problem, samples: [sample] }, output, {
      onSampleComplete: async (partialReport, sampleReport) => {
        await saveMergedProblemSampleReport(context.workspaceFolder, problem.id, partialReport);
        sampleTreeProvider.clearSamplesRunning(problem.id, [sampleReport.id]);
        sampleTreeProvider.refresh();
      }
    });
    if (report) {
      await saveMergedProblemSampleReport(context.workspaceFolder, problem.id, report);
    }
    activeProblemId = problem.id;
    sampleTreeProvider.refresh();
    await updateStatusBar(problem.id);
  });
}

async function saveMergedProblemSampleReport(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  report: JudgeReport
): Promise<void> {
  const previous = await readProblemReport(workspaceFolder, problemId);
  if (!previous) {
    await saveProblemReport(workspaceFolder, problemId, report);
    return;
  }

  const samples = mergeReportEntries(previous.samples ?? [], report.samples ?? []);
  const results = mergeReportEntries(previous.results ?? previous.samples ?? [], report.results ?? report.samples ?? []);
  await saveProblemReport(workspaceFolder, problemId, {
    ...previous,
    ...report,
    samples,
    results,
    summary: {
      accepted: samples.filter((sample) => sample.status === 'AC').length,
      total: samples.length
    }
  });
}

async function readProblemReport(
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

function mergeReportEntries<T extends { id?: string; index?: number; name?: string }>(previous: T[], next: T[]): T[] {
  const byKey = new Map(previous.map((entry) => [getReportEntryKey(entry), entry]));
  for (const entry of next) {
    byKey.set(getReportEntryKey(entry), entry);
  }
  return [...byKey.values()].sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER));
}

function getReportEntryKey(entry: { id?: string; index?: number; name?: string }): string {
  return entry.id ?? (entry.index !== undefined ? `index:${entry.index}` : `name:${entry.name ?? ''}`);
}

async function createSubtaskCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const defaultName = t('subtask.defaultName', { index: (context.problem.subtasks?.length ?? 0) + 1 });
  const name = await vscode.window.showInputBox({
    title: t('subtask.create'),
    prompt: t('subtask.namePrompt'),
    value: defaultName
  });
  if (name === undefined || !name.trim()) {
    return;
  }

  const subtask = await createProblemSubtask(context.workspaceFolder, context.problem.id, name);
  if (!subtask) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.created', { name: subtask.name }));
}

async function setProblemTotalScoreCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const value = await vscode.window.showInputBox({
    title: t('score.setTotal'),
    prompt: t('score.setTotal.prompt'),
    value: String(getProblemTotalScore(context.problem)),
    validateInput: validatePositiveScoreInput
  });
  if (value === undefined) {
    return;
  }

  await setProblemTotalScore(context.workspaceFolder, context.problem.id, Number(value.trim()));
  sampleTreeProvider.refresh();
}

async function exportTestcasesCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const mode = await pickTestcaseExportMode();
  if (!mode) {
    return;
  }

  const target = await vscode.window.showOpenDialog({
    title: t('export.testcases.target.select'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t('select')
  });
  const targetDir = target?.[0]?.fsPath;
  if (!targetDir) {
    return;
  }

  if (await targetContainsFiles(targetDir)) {
    const overwrite = await vscode.window.showWarningMessage(
      t('export.testcases.overwriteConfirm'),
      { modal: true },
      t('continueAction'),
      t('cancel')
    );
    if (overwrite !== t('continueAction')) {
      return;
    }
  }

  let format: TestcaseExportFormat | undefined;
  const needConfig = shouldGenerateTestcaseConfig(context.problem);
  if (needConfig) {
    format = await pickTestcaseExportFormat();
    if (!format) {
      return;
    }
  }

  if (mode === 'move') {
    const confirm = await vscode.window.showWarningMessage(
      t('export.testcases.mode.moveConfirm'),
      { modal: true },
      t('export.testcases.mode.move'),
      t('cancel')
    );
    if (confirm !== t('export.testcases.mode.move')) {
      return;
    }
  }

  output.clear();
  output.show(true);
  output.appendLine('Export Testcases');
  output.appendLine(`Mode: ${mode === 'move' ? 'Move' : 'Copy'}`);
  output.appendLine(`Format: ${getTestcaseExportFormatLabel(format)}`);
  output.appendLine(`Target: ${targetDir}`);
  output.appendLine(`Generate platform config: ${format ? 'yes' : 'no'}`);

  try {
    const result = await exportTestcases(context.workspaceFolder, context.problem, targetDir, format);
    let moveCleanupWarnings: string[] = [];
    let movedCount = 0;
    if (mode === 'move') {
      const moved = await moveProblemSamplesAfterExport(
        context.workspaceFolder,
        context.problem.id,
        context.problem.samples.map((sample) => sample.id)
      );
      movedCount = moved.samples.length;
      moveCleanupWarnings = [
        ...moved.cleanupErrors.map((warning) => `move.cleanup:${warning}`),
        ...moved.missingSampleIds.map((sampleId) => `move.missingSample:${sampleId}`)
      ];
      result.warnings.push(...moveCleanupWarnings);
      sampleTreeProvider.refresh();
      await updateStatusBar(context.problem.id);
    }

    output.appendLine('Generated:');
    for (const file of result.generatedFiles) {
      output.appendLine(`  ${file}`);
    }
    output.appendLine('Copied:');
    for (const file of result.copiedFiles) {
      output.appendLine(`  ${file}`);
    }
    if (result.warnings.length > 0) {
      output.appendLine('Warnings:');
      for (const warning of result.warnings) {
        output.appendLine(`  ${formatExportWarning(warning)}`);
      }
    }
    vscode.window.showInformationMessage(
      mode === 'move'
        ? t('export.testcases.moved', { count: movedCount, path: targetDir })
        : t('export.testcases.done', { path: targetDir })
    );
    vscode.window.showInformationMessage(
      result.configGenerated
        ? getTestcaseExportGeneratedMessage(result.format)
        : t('export.testcases.configSkipped')
    );
    if (mode === 'move' && result.warnings.length > 0) {
      vscode.window.showWarningMessage(t('export.testcases.movedWithWarnings', { count: result.warnings.length }));
    } else if (result.warnings.length > 0) {
      vscode.window.showWarningMessage(t('export.testcases.doneWithWarnings', { count: result.warnings.length }));
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'score.invalid') {
      vscode.window.showWarningMessage(t('export.testcases.scoreInvalid'));
      return;
    }
    throw error;
  }
}

async function exportProblemPackageCommand(problemId: string | undefined): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const target = await vscode.window.showOpenDialog({
    title: t('export.problemPackage.target.select'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t('select')
  });
  const targetDir = target?.[0]?.fsPath;
  if (!targetDir) {
    return;
  }

  if (await targetContainsFiles(targetDir)) {
    const overwrite = await vscode.window.showWarningMessage(
      t('export.problemPackage.overwriteConfirm'),
      { modal: true },
      t('continueAction'),
      t('cancel')
    );
    if (overwrite !== t('continueAction')) {
      return;
    }
  }

  output.clear();
  output.show(true);
  output.appendLine('Export Problem Package');
  output.appendLine(`Problem: ${context.problem.name}`);
  output.appendLine(`Target: ${targetDir}`);

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('export.problemPackage.progress'),
      cancellable: false
    },
    async () => exportProblemPackage(context.workspaceFolder, context.problem, targetDir)
  );

  output.appendLine('');
  output.appendLine('Generated:');
  for (const file of result.generatedFiles) {
    output.appendLine(`  ${file}`);
  }
  output.appendLine('Copied:');
  for (const file of result.copiedFiles) {
    output.appendLine(`  ${file}`);
  }
  if (result.warnings.length > 0) {
    output.appendLine('Warnings:');
    for (const warning of result.warnings) {
      output.appendLine(`  ${warning}`);
    }
  }

  const open = await vscode.window.showInformationMessage(
    t('export.problemPackage.done', {
      copied: result.copiedFiles.length,
      generated: result.generatedFiles.length,
      warnings: result.warnings.length
    }),
    t('openFolder')
  );
  if (open === t('openFolder')) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.targetDir));
  }
}

async function importProblemPackageCommand(sampleTreeProvider: SampleTreeProvider): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    title: t('import.problemPackage.target.select'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t('select')
  });
  const packageDir = picked?.[0]?.fsPath;
  if (!packageDir) {
    return;
  }

  output.clear();
  output.show(true);
  output.appendLine('Import Problem Package');
  output.appendLine(`Source: ${packageDir}`);

  let allowNewerVersion = false;
  let result: Awaited<ReturnType<typeof importProblemPackage>>;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t('import.problemPackage.progress'),
        cancellable: false
      },
      async () => importProblemPackage(workspaceFolder, packageDir)
    );
  } catch (error) {
    if (error instanceof ProblemPackageVersionError) {
      const action = await vscode.window.showWarningMessage(
        t('import.problemPackage.newerVersion', { version: error.version }),
        { modal: true },
        t('continueAction'),
        t('cancel')
      );
      if (action !== t('continueAction')) {
        return;
      }
      allowNewerVersion = true;
    } else {
      vscode.window.showErrorMessage(formatProblemPackageImportError(error));
      return;
    }
    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t('import.problemPackage.progress'),
          cancellable: false
        },
        async () => importProblemPackage(workspaceFolder, packageDir, { allowNewerVersion })
      );
    } catch (retryError) {
      vscode.window.showErrorMessage(formatProblemPackageImportError(retryError));
      return;
    }
  }

  activeProblemId = result.problem.id;
  sampleTreeProvider.refresh();
  await updateStatusBar(result.problem.id);

  output.appendLine(`Problem: ${result.problem.name}`);
  output.appendLine('Copied:');
  for (const file of result.copiedFiles) {
    output.appendLine(`  ${file}`);
  }
  if (result.warnings.length > 0) {
    output.appendLine('Warnings:');
    for (const warning of result.warnings) {
      output.appendLine(`  ${warning}`);
    }
  }

  const message = result.warnings.length > 0
    ? t('import.problemPackage.doneWithWarnings', {
      problem: result.problem.name,
      copied: result.copiedFiles.length,
      warnings: result.warnings.length
    })
    : t('import.problemPackage.done', {
      problem: result.problem.name,
      copied: result.copiedFiles.length
    });
  const action = await vscode.window.showInformationMessage(
    message,
    t('openProblem'),
    t('openFolder')
  );
  if (action === t('openProblem')) {
    activeProblemId = result.problem.id;
    sampleTreeProvider.refresh();
    await updateStatusBar(result.problem.id);
  }
  if (action === t('openFolder')) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(getProblemRoot(workspaceFolder, result.problem.id)));
  }
}

function formatProblemPackageImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'import.problemPackage.manifestMissing') {
    return t('import.problemPackage.manifestMissing');
  }
  if (message === 'import.problemPackage.invalidFormat') {
    return t('import.problemPackage.invalidFormat');
  }
  if (message === 'import.problemPackage.invalidVersion') {
    return t('import.problemPackage.invalidVersion');
  }
  if (message === 'import.problemPackage.unsafePath') {
    return t('import.problemPackage.unsafePath');
  }
  return t('import.problemPackage.failed', { error: message });
}

export function createTestcaseExportModeItems(): Array<vscode.QuickPickItem & { mode: TestcaseExportMode }> {
  return [
    { label: t('export.testcases.mode.copy'), mode: 'copy' as const },
    { label: t('export.testcases.mode.move'), mode: 'move' as const }
  ];
}

async function pickTestcaseExportMode(): Promise<TestcaseExportMode | undefined> {
  const picked = await vscode.window.showQuickPick(
    createTestcaseExportModeItems(),
    {
      title: t('export.testcases.mode.select'),
      placeHolder: t('export.testcases.mode.select')
    }
  );
  return picked?.mode;
}

async function pickTestcaseExportFormat(): Promise<TestcaseExportFormat | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: t('export.testcases.format.luogu'), format: 'luogu' as const },
      { label: t('export.testcases.format.polygon'), format: 'polygon' as const },
      { label: t('export.testcases.format.lemonlime'), format: 'lemonlime' as const }
    ],
    {
      title: t('export.testcases.format.select'),
      placeHolder: t('export.testcases.format.select')
    }
  );
  return picked?.format;
}

function getTestcaseExportFormatLabel(format: TestcaseExportFormat | undefined): string {
  if (format === 'luogu') {
    return 'Luogu';
  }
  if (format === 'polygon') {
    return 'Codeforces / Polygon';
  }
  if (format === 'lemonlime') {
    return 'LemonLime';
  }
  return 'None';
}

function getTestcaseExportGeneratedMessage(format: TestcaseExportFormat | undefined): string {
  if (format === 'polygon') {
    return t('export.testcases.polygonGenerated');
  }
  if (format === 'lemonlime') {
    return t('export.testcases.lemonlimeGenerated');
  }
  return t('export.testcases.luoguGenerated');
}

async function beginStressRun(): Promise<boolean> {
  if (!stressRunController.start()) {
    vscode.window.showWarningMessage(t('stress.alreadyRunning'));
    return false;
  }
  await setStressRunningContext(true);
  stressStopStatusBar.text = t('stress.stopStatusBar');
  stressStopStatusBar.tooltip = t('stress.stopTooltip');
  stressStopStatusBar.show();
  return true;
}

async function endStressRun(): Promise<void> {
  stressRunController.finish();
  stressStopStatusBar.hide();
  await setStressRunningContext(false);
}

async function setStressRunningContext(value: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'oijudger.stressRunning', value);
}

async function stopStressTestCommand(): Promise<void> {
  if (!stressRunController.isRunning) {
    vscode.window.showInformationMessage(t('stress.notRunning'));
    return;
  }
  await stressRunController.cancel();
  vscode.window.showInformationMessage(t('stress.stopped'));
}

async function runStressTestCommand(
  problemId: string | undefined,
  stressRecordsTreeProvider?: StressRecordsTreeProvider
): Promise<void> {
  if (!(await beginStressRun())) {
    return;
  }
  try {
    const context = await getProblemContext(problemId, true);
    if (!context) {
      return;
    }
    const mode = await pickStressTestMode();
    if (!mode) {
      return;
    }

    if (mode === 'standalone') {
      const program = await pickCppFile(getStressStandalonePickerTitle());
      if (!program) {
        return;
      }
      const result = await runStandaloneStressTest({
        workspaceFolder: context.workspaceFolder,
        config: context.problem,
        programPath: program.fsPath,
        output,
        controller: stressRunController
      });
      stressRecordsTreeProvider?.refresh();
      if (!result) {
        vscode.window.showWarningMessage(t('stress.compileFailed'));
        return;
      }
      if (result.cancelled) {
        return;
      }
      vscode.window.showInformationMessage(t('stress.standaloneFinished'));
      return;
    }

    const generator = await pickCppFile(t('stress.selectGenerator'));
    if (!generator) {
      return;
    }
    const std = await pickCppFile(t('stress.selectStd'));
    if (!std) {
      return;
    }
    const solution = await pickStressSolutionFile();
    if (!solution) {
      return;
    }
    const rounds = await pickStressRounds();
    if (!rounds) {
      return;
    }

    const result = await runGeneratorStdStressTest({
      workspaceFolder: context.workspaceFolder,
      config: context.problem,
      generatorPath: generator.fsPath,
      stdPath: std.fsPath,
      solutionPath: solution.fsPath,
      rounds,
      output,
      controller: stressRunController,
      source: 'manual'
    });
    stressRecordsTreeProvider?.refresh();
    if (!result) {
      vscode.window.showWarningMessage(t('stress.compileFailed'));
      return;
    }
    if (result.cancelled) {
      return;
    }
    if (result.failedAt !== undefined) {
      vscode.window.showWarningMessage(t('stress.failed', { round: result.failedAt }));
      return;
    }
    vscode.window.showInformationMessage(t('stress.finished', { count: result.passed }));
  } finally {
    await endStressRun();
  }
}

async function stressTestCurrentCodeCommand(
  problemId: string | undefined,
  stressRecordsTreeProvider?: StressRecordsTreeProvider
): Promise<void> {
  if (!(await beginStressRun())) {
    return;
  }
  try {
    const resolution = resolveCurrentCodeDocument(
      vscode.window.activeTextEditor,
      recentEditorFile,
      vscode.workspace.textDocuments
    );
    if (!resolution.ok) {
      vscode.window.showErrorMessage(t(getStressCurrentCodeResolutionMessageKey(resolution.reason)));
      return;
    }

    const solutionPath = resolution.document.uri.fsPath;
    if (!(await exists(solutionPath))) {
      vscode.window.showErrorMessage(t('stress.currentCode.missing'));
      return;
    }
    if (resolution.document.isDirty) {
      const saved = await resolution.document.save();
      if (!saved) {
        vscode.window.showErrorMessage(t('stress.currentCode.saveFailed'));
        return;
      }
    }

    const context = await getProblemContext(problemId, true);
    if (!context) {
      vscode.window.showErrorMessage(t('stress.currentCode.noProblem'));
      return;
    }
    const generator = resolveProblemGeneratorPathForStress(context.workspaceFolder, context.problem);
    if (!generator.ok) {
      vscode.window.showErrorMessage(t(generator.reason === 'missing'
        ? 'stress.currentCode.noGenerator'
        : 'stress.currentCode.generatorMissing'));
      return;
    }
    const std = resolveProblemStdPathForStress(context.workspaceFolder, context.problem);
    if (!std.ok) {
      vscode.window.showErrorMessage(t(std.reason === 'missing'
        ? 'stress.currentCode.noStd'
        : 'stress.currentCode.stdMissing'));
      return;
    }
    const rounds = await pickStressRounds();
    if (!rounds) {
      return;
    }

    const result = await runGeneratorStdStressTest({
      workspaceFolder: context.workspaceFolder,
      config: context.problem,
      generatorPath: generator.path,
      stdPath: std.path,
      solutionPath,
      rounds,
      output,
      controller: stressRunController,
      source: 'currentCode'
    });
    stressRecordsTreeProvider?.refresh();
    if (!result) {
      vscode.window.showWarningMessage(t('stress.compileFailed'));
      return;
    }
    if (result.cancelled) {
      return;
    }
    if (result.failedAt !== undefined) {
      vscode.window.showWarningMessage(t('stress.failed', { round: result.failedAt }));
      return;
    }
    vscode.window.showInformationMessage(t('stress.finished', { count: result.passed }));
  } finally {
    await endStressRun();
  }
}

function getStressCurrentCodeResolutionMessageKey(
  reason: Exclude<CurrentCodeDocumentResolution, { ok: true }>['reason']
): Parameters<typeof t>[0] {
  switch (reason) {
    case 'notLocal':
    case 'noEditor':
      return 'stress.currentCode.noEditor';
    case 'notOpen':
      return 'stress.currentCode.notOpen';
    case 'notCpp':
    default:
      return 'stress.currentCode.notCpp';
  }
}

async function pickStressTestMode(): Promise<StressTestMode | undefined> {
  const picked = await vscode.window.showQuickPick(
    createStressTestModeItems(),
    {
      title: t('stress.mode.select'),
      placeHolder: t('stress.mode.select')
    }
  );
  return picked?.mode;
}

async function pickStressRounds(): Promise<number | undefined> {
  const value = await vscode.window.showInputBox({
    title: t('stress.rounds.prompt'),
    prompt: t('stress.rounds.prompt'),
    value: '100',
    validateInput: (text) => validateStressRounds(text) ? undefined : t('stress.rounds.invalid')
  });
  return value === undefined ? undefined : Number(value.trim());
}

function validateStressRounds(value: string): boolean {
  if (!/^[1-9]\d*$/u.test(value.trim())) {
    return false;
  }
  return Number(value.trim()) <= 100000;
}

async function pickStressSolutionFile(): Promise<vscode.Uri | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'file' && isCppFile(editor.document.uri.fsPath)) {
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: path.basename(editor.document.uri.fsPath),
          description: t('currentFile'),
          uri: editor.document.uri
        },
        {
          label: t('selectSourceFile'),
          description: t('stress.selectSolution')
        }
      ],
      {
        title: t('stress.selectSolution'),
        placeHolder: t('stress.selectSolution')
      }
    );
    if (!picked) {
      return undefined;
    }
    if ('uri' in picked) {
      return picked.uri;
    }
  }
  return pickCppFile(t('stress.selectSolution'));
}

async function pickCppFile(title: string): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      'C++ Source': ['cpp', 'cc', 'cxx', 'c++']
    }
  });
  return uris?.[0];
}

async function openStressFileCommand(node: StressTreeNode | undefined): Promise<void> {
  if (!node?.filePath || !(await stressFileExists(node.filePath))) {
    vscode.window.showWarningMessage(t('stress.fileMissing', { path: node?.filePath ?? '-' }));
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function revealStressSessionFolderCommand(node: StressTreeNode | undefined): Promise<void> {
  const dir = node?.session?.dir;
  if (!dir || !(await exists(dir))) {
    vscode.window.showWarningMessage(t('stress.fileMissing', { path: dir ?? '-' }));
    return;
  }
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
}

async function addStressCaseToSamplesCommand(
  node: StressTreeNode | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  if (!node?.session?.failedCase) {
    return;
  }
  const context = await getProblemContext(undefined, true);
  if (!context) {
    return;
  }
  const inputPath = resolveStressFile(node.session, node.session.failedCase.input);
  const stdOutputPath = resolveStressFile(node.session, node.session.failedCase.stdOutput);
  if (!inputPath || !(await stressFileExists(inputPath))) {
    vscode.window.showWarningMessage(t('stress.fileMissing', { path: inputPath ?? '-' }));
    return;
  }
  if (!stdOutputPath || !(await stressFileExists(stdOutputPath))) {
    vscode.window.showWarningMessage(t('stress.addCase.missingStdOutput'));
    return;
  }

  const target = await pickStressAddTarget(context.problem);
  if (!target) {
    return;
  }
  const sample = await addProblemSample(
    context.workspaceFolder,
    context.problem.id,
    await fs.readFile(inputPath, 'utf8'),
    await fs.readFile(stdOutputPath, 'utf8'),
    { decodeEscapes: false }
  );
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }
  if (target.subtaskId) {
    await moveProblemSampleToSubtask(context.workspaceFolder, context.problem.id, sample.id, target.subtaskId);
  }
  sampleTreeProvider.refresh();
  const subtaskName = target.subtaskName;
  vscode.window.showInformationMessage(
    subtaskName
      ? t('stress.addCase.doneSubtask', { subtask: subtaskName })
      : t('stress.addCase.done')
  );
}

async function rerunStressCaseCommand(node: StressTreeNode | undefined): Promise<void> {
  if (!node?.session?.failedCase) {
    return;
  }
  const context = await getProblemContext(undefined, true);
  if (!context) {
    return;
  }
  const inputPath = resolveStressFile(node.session, node.session.failedCase.input);
  const stdOutputPath = resolveStressFile(node.session, node.session.failedCase.stdOutput);
  if (!inputPath || !(await stressFileExists(inputPath))) {
    vscode.window.showWarningMessage(t('stress.fileMissing', { path: inputPath ?? '-' }));
    return;
  }
  if (!stdOutputPath || !(await stressFileExists(stdOutputPath))) {
    vscode.window.showWarningMessage(t('stress.addCase.missingStdOutput'));
    return;
  }
  const solution = await pickStressSolutionFile();
  if (!solution) {
    return;
  }
  const result = await rerunStressFailedCase({
    workspaceFolder: context.workspaceFolder,
    config: context.problem,
    session: node.session,
    failedCase: node.session.failedCase,
    solutionPath: solution.fsPath,
    output
  });
  if (!result) {
    vscode.window.showWarningMessage(t('stress.compileFailed'));
    return;
  }
  vscode.window.showInformationMessage(
    result.status === 'Accepted'
      ? t('stress.rerun.doneAccepted')
      : t('stress.rerun.doneFailed', { status: result.status })
  );
}

async function pickStressAddTarget(problem: ProblemConfig): Promise<{
  subtaskId?: string;
  subtaskName?: string;
} | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: t('stress.addCase.target.root')
      },
      ...(problem.subtasks ?? []).map((subtask) => ({
        label: subtask.name,
        description: subtask.id,
        subtaskId: subtask.id,
        subtaskName: subtask.name
      }))
    ],
    {
      title: t('stress.addCase.target.select'),
      placeHolder: t('stress.addCase.target.select')
    }
  );
  return picked
    ? { subtaskId: 'subtaskId' in picked ? picked.subtaskId : undefined, subtaskName: 'subtaskName' in picked ? picked.subtaskName : undefined }
    : undefined;
}

function formatExportWarning(warning: string): string {
  const [key, ...rest] = warning.split(':');
  return key === 'export.testcases.outputMissing'
    ? t(key, { path: rest.join(':') })
    : warning;
}

async function renameSubtaskCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }

  const name = await vscode.window.showInputBox({
    title: t('subtask.rename'),
    prompt: t('subtask.namePrompt'),
    value: context.subtask.name
  });
  if (name === undefined || !name.trim()) {
    return;
  }

  const subtask = await renameProblemSubtask(context.workspaceFolder, context.problem.id, context.subtask.id, name);
  if (!subtask) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.renamed', { name: subtask.name }));
}

async function deleteSubtaskCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    t('subtask.deleteConfirm'),
    { modal: true },
    t('delete'),
    t('cancel')
  );
  if (confirmed !== t('delete')) {
    return;
  }

  const deleted = await deleteProblemSubtask(context.workspaceFolder, context.problem.id, context.subtask.id);
  if (!deleted) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.deleted'));
}

async function setSubtaskScoringModeCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      {
        label: t('score.scoringMode.sum'),
        description: t('score.scoringMode.sumDescription'),
        scoringMode: 'sum' as const
      },
      {
        label: t('score.scoringMode.bundle'),
        description: t('score.scoringMode.bundleDescription'),
        scoringMode: 'bundle' as const
      }
    ],
    {
      title: t('score.subtask.setScoringMode'),
      placeHolder: t('score.scoringMode')
    }
  );
  if (!picked) {
    return;
  }

  await setProblemSubtaskScoringMode(context.workspaceFolder, context.problem.id, context.subtask.id, picked.scoringMode);
  sampleTreeProvider.refresh();
}

async function bindSubtaskGeneratorInputCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const mode = await pickGeneratorInputBindMode();
  if (!mode) {
    return;
  }

  if (mode === 'create') {
    const result = await createProblemSubtaskGeneratorInputFile(
      context.workspaceFolder,
      context.problem.id,
      context.subtask.id
    );
    if (!result) {
      vscode.window.showWarningMessage(t('subtask.notFound'));
      return;
    }

    sampleTreeProvider.refresh();
    await openFileInEditor(result.inputPath, t('subtask.generatorInputMissing'));
    vscode.window.showInformationMessage(t(
      result.created ? 'subtask.generatorInputCreated' : 'subtask.generatorInputOpened',
      { name: path.basename(result.inputPath) }
    ));
    return;
  }

  const uri = await pickGeneratorInputFile();
  if (!uri) {
    return;
  }

  const subtask = await setProblemSubtaskGeneratorInput(
    context.workspaceFolder,
    context.problem.id,
    context.subtask.id,
    uri.fsPath
  );
  if (!subtask) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.generatorInputBound', { name: path.basename(uri.fsPath) }));
}

async function openSubtaskGeneratorInputCommand(
  problemId: string | undefined,
  subtaskId: string | undefined
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const generatorInput = context.subtask.generatorInput;
  if (!generatorInput) {
    vscode.window.showWarningMessage(t('subtask.noGeneratorInputBound'));
    return;
  }

  const inputPath = resolveProblemReferencePath(context.workspaceFolder, generatorInput);
  if (!(await exists(inputPath))) {
    vscode.window.showWarningMessage(t('subtask.generatorInputMissing'));
    return;
  }

  await openFileInEditor(inputPath, t('subtask.generatorInputMissing'));
}

async function clearSubtaskGeneratorInputCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const subtask = await clearProblemSubtaskGeneratorInput(
    context.workspaceFolder,
    context.problem.id,
    context.subtask.id
  );
  if (!subtask) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.generatorInputCleared'));
}

async function moveSampleToSubtaskCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const choices = [
    {
      label: t('subtask.moveToUnassigned'),
      description: t('subtask.unassigned'),
      subtaskId: undefined as string | undefined
    },
    ...(context.problem.subtasks ?? []).map((subtask) => ({
      label: subtask.name,
      description: subtask.id,
      subtaskId: subtask.id
    }))
  ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: t('subtask.moveSample'),
    placeHolder: t('subtask.moveTo')
  });
  if (!picked) {
    return;
  }

  const moved = await moveProblemSampleToSubtask(
    context.workspaceFolder,
    context.problem.id,
    context.sample.id,
    picked.subtaskId
  );
  if (!moved) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(
    picked.subtaskId
      ? t('subtask.sampleMoved', { sample: context.sample.name, subtask: picked.label })
      : t('subtask.sampleMovedToUnassigned', { sample: context.sample.name })
  );
}

async function runSubtaskCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }

  let problem = await ensureProblemCompiler(context.workspaceFolder, context.problem);
  if (!problem) {
    await setProblemSubtaskResult(context.workspaceFolder, context.problem.id, context.subtask.id, {
      status: 'failed',
      passed: 0,
      total: context.subtask.sampleIds.length
    });
    sampleTreeProvider.refresh();
    return;
  }

  const samples = getSubtaskSamples(problem, context.subtask.id);
  if (samples.length === 0) {
    vscode.window.showWarningMessage(t('subtask.noSamples'));
    return;
  }

  const sourcePath = await resolveSourceForRun(context.workspaceFolder, problem);
  if (!sourcePath) {
    return;
  }

  if (!(await exists(sourcePath))) {
    vscode.window.showErrorMessage(t('programMissing'));
    return;
  }

  const document = vscode.workspace.textDocuments.find((entry) => entry.uri.fsPath === sourcePath);
  await document?.save();

  output.appendLine('');
  output.appendLine(`Subtask: ${context.subtask.name}`);
  const runningSampleIds = samples.map((sample) => sample.id);
  await withSamplesRunning(sampleTreeProvider, problem.id, runningSampleIds, async () => {
    const report = await runAllSamples(context.workspaceFolder, sourcePath, { ...problem, samples }, output, {
      onSampleComplete: async (partialReport, sampleReport) => {
        await saveProblemReport(context.workspaceFolder, problem.id, partialReport);
        sampleTreeProvider.clearSamplesRunning(problem.id, [sampleReport.id]);
        sampleTreeProvider.refresh();
      }
    });
    const passed = report?.summary.accepted ?? 0;
    const total = report?.summary.total ?? samples.length;
    await setProblemSubtaskResult(context.workspaceFolder, problem.id, context.subtask.id, {
      status: total > 0 && passed === total ? 'passed' : 'failed',
      passed,
      total
    });
    if (report) {
      await saveProblemReport(context.workspaceFolder, problem.id, report);
    }

    activeProblemId = problem.id;
    sampleTreeProvider.refresh();
    await updateStatusBar(problem.id);
    vscode.window.showInformationMessage(
      passed === total
        ? t('subtask.resultSummary', { passed, total })
        : t('subtask.resultFailedSummary', { passed, total })
    );
  });
}

async function generateSampleInputCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  await generateInputFromGenerator(context.workspaceFolder, context.problem, undefined, sampleTreeProvider);
}

async function generateSubtaskSampleInputCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  await generateInputFromGenerator(context.workspaceFolder, context.problem, context.subtask, sampleTreeProvider);
}

async function generateInputFromGenerator(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  subtask: NonNullable<ProblemConfig['subtasks']>[number] | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const generator = subtask
    ? await resolveGeneratorForSubtask(problem, subtask)
    : await pickProblemGenerator(problem, t('generator.selectGenerator'));
  if (!generator) {
    const choice = await vscode.window.showWarningMessage(
      t('generator.noGenerator'),
      t('generator.add'),
      t('cancel')
    );
    if (choice === t('generator.add')) {
      await addProblemGeneratorCommand(problem.id, sampleTreeProvider);
    }
    return;
  }
  if (!generator.source) {
    vscode.window.showWarningMessage(t('generator.sourceMissing'));
    return;
  }

  const generatorPath = resolveProblemReferencePath(workspaceFolder, generator.source.path);
  if (!(await exists(generatorPath))) {
    vscode.window.showWarningMessage(`${t('generator.sourceMissing')}: ${generatorPath}`);
    return;
  }

  const inputChoice = subtask?.generatorInput
    ? createSubtaskGeneratorInputChoice(workspaceFolder, subtask)
    : await pickGeneratorInputForRun(workspaceFolder, problem);
  if (!inputChoice) {
    return;
  }
  const inputPath = resolveProblemReferencePath(workspaceFolder, inputChoice.path);
  if (!(await exists(inputPath))) {
    vscode.window.showWarningMessage(`${t('generator.input.missing')}: ${inputPath}`);
    return;
  }

  const count = await askSampleInputGenerateCount();
  if (count === undefined) {
    return;
  }

  const compile = await compileGenerator(workspaceFolder, problem, generatorPath, inputPath, inputChoice, count, subtask);
  if (!compile) {
    return;
  }

  const autoStd = await prepareAutoStdOutputGeneration(workspaceFolder, problem);
  if (!autoStd) {
    return;
  }

  let generatedCount = 0;
  let outputCount = 0;
  let emptyOutputAction: EmptyGeneratorOutputAction | undefined;
  for (let current = 1; current <= count; current += 1) {
    output.appendLine(t('generator.input.generatingProgress', { current, total: count }));
    const generated = await runCompiledGenerator(workspaceFolder, problem, compile, generatorPath, inputPath);
    if (generated === undefined) {
      output.appendLine(`Generator execution failed at ${current}/${count}.`);
      output.appendLine(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
      sampleTreeProvider.refresh();
      vscode.window.showWarningMessage(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
      return;
    }
    if (!generated) {
      if (emptyOutputAction !== 'saveAll') {
        emptyOutputAction = await confirmEmptyGeneratorOutputForBatch();
      }
      if (emptyOutputAction === 'cancel' || !emptyOutputAction) {
        output.appendLine(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
        sampleTreeProvider.refresh();
        vscode.window.showWarningMessage(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
        return;
      }
      if (emptyOutputAction === 'skip') {
        output.appendLine(`[${current}/${count}] ${t('generator.input.skippedEmpty')}`);
        continue;
      }
    }

    const sample = await writeProblemGeneratedInputSample(workspaceFolder, problem.id, generated, subtask?.id);
    if (!sample) {
      output.appendLine(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
      sampleTreeProvider.refresh();
      vscode.window.showWarningMessage(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
      return;
    }

    generatedCount += 1;
    const inputFilePath = resolveWorkspacePath(workspaceFolder, sample.input);
    output.appendLine(`[${current}/${count}] Generated input: ${path.basename(sample.input)}`);
    output.appendLine(`Generated sample input path: ${inputFilePath}`);
    if (autoStd.enabled) {
      const generatedOutput = await generateOutputForGeneratedSample(workspaceFolder, problem, sample, autoStd.std);
      if (!generatedOutput.ok) {
        output.appendLine(`STD execution failed at ${current}/${count}.`);
        output.appendLine(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
        sampleTreeProvider.refresh();
        vscode.window.showWarningMessage(t('generator.autoOutput.runFailed', { current, total: count }));
        vscode.window.showWarningMessage(createGeneratedInputPartialMessage(autoStd, generatedCount, outputCount));
        return;
      }
      outputCount += 1;
      output.appendLine(`[${current}/${count}] Generated output: ${path.basename(generatedOutput.answerPath)}`);
    }
  }

  sampleTreeProvider.refresh();
  output.appendLine('');
  vscode.window.showInformationMessage(createGeneratedInputSuccessMessage(autoStd, generatedCount));
}

async function resolveGeneratorForSubtask(
  problem: ProblemConfig,
  subtask: NonNullable<ProblemConfig['subtasks']>[number]
): Promise<ReturnType<typeof getProblemGenerators>[number] | undefined> {
  const bound = getProblemGenerator(problem, subtask.generatorId);
  if (bound) {
    return bound;
  }
  if (subtask.generatorId) {
    vscode.window.showWarningMessage(t('generator.missingReference'));
  }
  return pickProblemGenerator(problem, t('generator.selectGenerator'));
}

function createSubtaskGeneratorInputChoice(
  workspaceFolder: vscode.WorkspaceFolder,
  subtask: NonNullable<ProblemConfig['subtasks']>[number]
): GeneratorInputChoice | undefined {
  if (!subtask.generatorInput) {
    return undefined;
  }
  const inputPath = resolveProblemReferencePath(workspaceFolder, subtask.generatorInput);
  return {
    label: path.basename(inputPath),
    sourceLabel: t('generator.input.subtaskSource', { subtask: subtask.name }),
    path: subtask.generatorInput,
    source: 'subtask'
  };
}

async function pickGeneratorInputForRun(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<GeneratorInputChoice | undefined> {
  const choices = createGeneratorInputChoices(workspaceFolder, problem);
  const createChoice = {
    label: t('generator.input.create'),
    description: '',
    detail: t('subtask.generatorInputCreateDescription'),
    create: true as const
  };
  const picked = await vscode.window.showQuickPick(
    [
      ...choices.map((choice) => ({
        label: choice.label,
        description: choice.sourceLabel,
        detail: choice.path,
        choice
      })),
      createChoice
    ],
    {
      title: t('generator.input.select'),
      placeHolder: t('generator.input.select')
    }
  );
  if (!picked) {
    return undefined;
  }
  if ('create' in picked) {
    await createGlobalGeneratorInputForRun(workspaceFolder, problem);
    return undefined;
  }
  return picked.choice;
}

function createGeneratorInputChoices(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): GeneratorInputChoice[] {
  const choices: GeneratorInputChoice[] = getProblemGeneratorInputs(problem)
    .filter((input) => input.source?.path)
    .map((input) => ({
      label: input.name,
      sourceLabel: t('generator.input.globalSource'),
      path: input.source?.path ?? '',
      source: 'global'
    }));
  for (const subtask of problem.subtasks ?? []) {
    const choice = createSubtaskGeneratorInputChoice(workspaceFolder, subtask);
    if (choice) {
      choices.push(choice);
    }
  }
  return choices;
}

async function createGlobalGeneratorInputForRun(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<void> {
  const fileName = await vscode.window.showInputBox({
    title: t('generator.input.createName'),
    prompt: t('generator.input.createName'),
    value: 'generator-input.txt',
    validateInput: validateGeneratorInputFileName
  });
  if (!fileName) {
    return;
  }

  const inputPath = path.join(workspaceFolder.uri.fsPath, '.vscode', '.OIJudge', 'generator-inputs', fileName);
  await fs.mkdir(path.dirname(inputPath), { recursive: true });
  if (!(await exists(inputPath))) {
    await fs.writeFile(inputPath, '', 'utf8');
  }
  await addProblemGeneratorInputs(workspaceFolder, problem.id, [inputPath]);
  await openFileInEditor(inputPath, t('generator.input.missing'));
  vscode.window.showInformationMessage(t('generator.input.created'));
}

function validateGeneratorInputFileName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return t('invalidSampleName');
  }
  if (path.isAbsolute(trimmed) || trimmed.includes('..') || /[\\/]/u.test(trimmed)) {
    return t('invalidSampleName');
  }
  return undefined;
}

async function askSampleInputGenerateCount(): Promise<number | undefined> {
  const value = await vscode.window.showInputBox({
    title: t('generator.input.count.prompt'),
    prompt: t('generator.input.count.prompt'),
    placeHolder: t('generator.input.count.placeholder'),
    value: '1',
    validateInput: validateSampleInputGenerateCount
  });
  if (value === undefined) {
    return undefined;
  }
  return Number(value.trim());
}

function validateSampleInputGenerateCount(value: string): string | undefined {
  const count = Number(value.trim());
  if (!Number.isInteger(count) || count <= 0) {
    return t('generator.input.count.invalid');
  }
  if (count > MAX_GENERATED_SAMPLE_INPUT_COUNT) {
    return t('generator.input.count.tooLarge', { max: MAX_GENERATED_SAMPLE_INPUT_COUNT });
  }
  return undefined;
}

async function compileGenerator(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  generatorPath: string,
  inputPath: string,
  inputChoice: GeneratorInputChoice,
  count: number,
  subtask: NonNullable<ProblemConfig['subtasks']>[number] | undefined
): Promise<CompileResult | undefined> {
  output.clear();
  output.show(true);
  output.appendLine('Generate sample inputs');
  output.appendLine(`Count: ${count}`);
  output.appendLine(`Generator: ${path.basename(generatorPath)}`);
  output.appendLine(`Generator source: ${generatorPath}`);
  output.appendLine(`Generator input: ${inputChoice.label}`);
  output.appendLine(`Generator input source: ${inputPath}`);
  output.appendLine(`Generator input origin: ${inputChoice.sourceLabel}`);
  output.appendLine(`Target: ${subtask ? 'subtask' : 'samples'}`);
  if (subtask) {
    output.appendLine(`Subtask: ${subtask.name}`);
  }

  const compile = await compileSource(workspaceFolder, generatorPath, problem, output);
  if (!compile || compile.status !== 'OK' || !compile.executablePath) {
    vscode.window.showErrorMessage(t('generator.compileFailed'));
    return undefined;
  }
  return compile;
}

async function runCompiledGenerator(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  compile: CompileResult,
  generatorPath: string,
  inputPath: string
): Promise<string | undefined> {
  const input = await fs.readFile(inputPath, 'utf8');
  output.appendLine(`Run command: ${compile.executablePath}`);
  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    if (compile.status !== 'OK' || !compile.executablePath) {
      vscode.window.showErrorMessage(t('generator.compileFailed'));
      return undefined;
    }
    result = await runProcess(
      compile.executablePath,
      [],
      input,
      path.dirname(generatorPath),
      Math.max(problem.limits.timeMs, 1_000),
      withCompilerPathEnv(compile.compilerCommand)
    );
  } catch (error) {
    output.appendLine(`Generator failed to start: ${String(error)}`);
    vscode.window.showErrorMessage(t('generator.runFailed'));
    return undefined;
  }

  output.appendLine(`Exit code: ${result.code ?? 'null'}`);
  output.appendLine(`Timed out: ${result.timedOut ? 'yes' : 'no'}`);
  output.appendLine(`Run time: ${Math.round(result.timeMs)} ms`);
  if (result.stderr.trim()) {
    output.appendLine('stderr:');
    output.appendLine(result.stderr.trimEnd());
  }
  if (result.timedOut || result.code !== 0) {
    vscode.window.showErrorMessage(t(result.timedOut ? 'generator.runTimedOut' : 'generator.runFailed'));
    return undefined;
  }
  return result.stdout;
}

async function prepareAutoStdOutputGeneration(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<AutoStdOutputContext | undefined> {
  const enabled = isProblemAutoGenerateOutputFromStdEnabled(problem);
  output.appendLine(`Auto generate output with STD: ${enabled ? 'On' : 'Off'}`);
  if (!enabled) {
    return { enabled: false };
  }
  if (!problem.setter?.stdProgram) {
    output.appendLine('STD: Not bound');
    output.appendLine('Skip output generation.');
    vscode.window.showWarningMessage(t('generator.autoOutput.noStd'));
    return { enabled: false, reason: 'noStd' };
  }

  const stdPath = resolveProblemReferencePath(workspaceFolder, problem.setter.stdProgram);
  if (!(await exists(stdPath))) {
    output.appendLine(`STD: Missing (${stdPath})`);
    output.appendLine('Skip output generation.');
    vscode.window.showWarningMessage(t('generator.autoOutput.stdMissing'));
    return { enabled: false, reason: 'stdMissing' };
  }

  const saved = await vscode.workspace.saveAll(false);
  if (!saved) {
    output.appendLine('[ERR] Failed to save files before auto-generating outputs with STD.');
    vscode.window.showWarningMessage(t('seeOutputAndStderr'));
    return undefined;
  }

  output.appendLine(`STD: ${path.basename(stdPath)}`);
  output.appendLine(`STD source: ${stdPath}`);
  output.appendLine('STD compile:');
  const compile = await compileSource(workspaceFolder, stdPath, problem, output);
  if (!compile || compile.status !== 'OK' || !compile.executablePath) {
    vscode.window.showErrorMessage(t('generator.autoOutput.compileFailed'));
    return undefined;
  }

  return {
    enabled: true,
    std: { stdPath, compile }
  };
}

async function generateOutputForGeneratedSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  sample: SampleConfig,
  std: StdAnswerGenerationContext
): Promise<{ ok: true; answerPath: string } | { ok: false; reason: string }> {
  const inputPath = resolveSamplePath(workspaceFolder, sample.input);
  if (!(await exists(inputPath))) {
    const reason = `Sample input missing: ${inputPath}`;
    output.appendLine(`[ERR] ${sample.name}: ${reason}`);
    return { ok: false, reason };
  }

  const input = await fs.readFile(inputPath, 'utf8');
  const execution = await prepareStdSampleExecution(workspaceFolder, problem, sample, input);
  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    if (std.compile.status !== 'OK' || !std.compile.executablePath) {
      return { ok: false, reason: t('stdCompileFailed') };
    }
    result = await runProcess(
      std.compile.executablePath,
      [],
      execution.stdin,
      execution.cwd,
      problem.limits.timeMs,
      createStdExecutionEnv(std.compile.executablePath, std.compile.compilerCommand)
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    output.appendLine(`[ERR] ${sample.name}: STD failed to start: ${reason}`);
    return { ok: false, reason };
  }

  if (result.timedOut || result.code !== 0 || result.signal) {
    const reason = result.timedOut
      ? `STD timed out after ${Math.round(result.timeMs)} ms.`
      : `STD exited abnormally: code=${result.code ?? 'null'}, signal=${result.signal ?? 'null'}.`;
    output.appendLine(`[ERR] ${sample.name}: ${reason}`);
    if (result.stderr.trim()) {
      output.appendLine(result.stderr.trimEnd());
    }
    return { ok: false, reason };
  }

  if (result.stderr.trim()) {
    output.appendLine(`[STD stderr] ${sample.name}:`);
    output.appendLine(result.stderr.trimEnd());
  }

  let answer = result.stdout;
  if (execution.outputPath) {
    if (!(await exists(execution.outputPath))) {
      const fileIo = getProblemFileIoForRun(problem);
      const reason = `STD did not create File IO output file: ${fileIo.outputFileName}`;
      output.appendLine(`[ERR] ${sample.name}: ${reason}`);
      return { ok: false, reason };
    }
    answer = await fs.readFile(execution.outputPath, 'utf8');
  }

  const answerPath = resolveSamplePath(workspaceFolder, sample.answer);
  await fs.mkdir(path.dirname(answerPath), { recursive: true });
  await fs.writeFile(answerPath, answer, 'utf8');
  output.appendLine(`[OK] ${sample.name}: wrote STD output directly to ${answerPath}`);
  return { ok: true, answerPath };
}

function createGeneratedInputSuccessMessage(autoStd: AutoStdOutputContext, count: number): string {
  return autoStd.enabled
    ? t('generator.input.generatedWithOutput', { count })
    : t('generator.input.generatedMany', { count });
}

function createGeneratedInputPartialMessage(
  autoStd: AutoStdOutputContext,
  inputCount: number,
  outputCount: number
): string {
  return autoStd.enabled
    ? t('generator.input.generatedPartialWithOutput', { inputCount, outputCount })
    : t('generator.input.generatedPartial', { count: inputCount });
}

async function confirmEmptyGeneratorOutputForBatch(): Promise<EmptyGeneratorOutputAction | undefined> {
  const saveEmpty = t('generator.input.emptySaveAndContinue');
  const skip = t('generator.input.emptySkip');
  const cancel = t('generator.input.emptyCancel');
  const choice = await vscode.window.showWarningMessage(
    t('generator.input.emptyConfirm'),
    { modal: true },
    saveEmpty,
    skip,
    cancel
  );
  if (choice === saveEmpty) {
    return 'saveAll';
  }
  if (choice === skip) {
    return 'skip';
  }
  if (choice === cancel) {
    return 'cancel';
  }
  return undefined;
}

async function resolveSourceForRun(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<string | undefined> {
  const defaultSource = getProblemSourcePath(workspaceFolder, problem);
  if (defaultSource && await exists(defaultSource)) {
    return defaultSource;
  }
  if (defaultSource) {
    vscode.window.showWarningMessage(t('programMissing'));
  }
  return pickProgramForRun(workspaceFolder, problem, false);
}

async function pickProgramForRun(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  alwaysPick: boolean
): Promise<string | undefined> {
  const pickedPath = await pickProgramPath(workspaceFolder, problem, alwaysPick);
  if (!pickedPath) {
    return undefined;
  }

  const setDefault = await vscode.window.showQuickPick(
    [
      { label: t('setAsDefault'), value: true },
      { label: t('doNotSetDefault'), value: false }
    ],
    {
      title: t('setProgramAsDefault')
    }
  );
  await addProgramToProblem(workspaceFolder, problem.id, pickedPath, { setDefault: setDefault?.value === true });
  return pickedPath;
}

async function pickProgramPath(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  alwaysPick: boolean
): Promise<string | undefined> {
  const sources = problem.sources ?? [];
  if (sources.length > 0 || alwaysPick) {
    const picked = await vscode.window.showQuickPick(
      [
        ...sources.map((source) => ({
          label: source.name ?? path.basename(source.path),
          description: source.path === getDefaultProblemSource(problem) ? t('defaultProgram') : undefined,
          detail: resolveProblemReferencePath(workspaceFolder, source.path),
          path: resolveProblemReferencePath(workspaceFolder, source.path)
        })),
        {
          label: t('selectAnotherProgram'),
          description: t('selectSourceFile'),
          path: undefined
        }
      ],
      {
        title: t('runWithProgram'),
        placeHolder: t('program')
      }
    );
    if (!picked) {
      return undefined;
    }
    if (picked.path) {
      return picked.path;
    }
  }

  const uri = await pickSourceFile();
  return uri?.fsPath;
}

async function setProblemLimitCommand(
  problemId: string | undefined,
  field: 'timeMs' | 'memoryMb',
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const valueText = await vscode.window.showInputBox({
    title: field === 'timeMs' ? t('setTimeLimitTitle') : t('setMemoryLimitTitle'),
    prompt: field === 'timeMs' ? t('setTimeLimitPrompt') : t('setMemoryLimitPrompt'),
    value: String(context.problem.limits[field]),
    validateInput: validatePositiveInteger
  });
  if (valueText === undefined) {
    return;
  }

  await updateProblemLimits(context.workspaceFolder, context.problem.id, {
    [field]: Number(valueText)
  });
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(field === 'timeMs' ? t('timeLimitUpdated') : t('memoryLimitUpdated'));
}

async function setStackSizeCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }
  const problems = await ensureProblemsConfig(workspaceFolder);
  const context = problemId || activeProblemId || problems.problems.length > 0
    ? await getProblemContext(problemId, true)
    : undefined;
  if (!context && problems.problems.length > 0) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: t('stackFollowMemory'), mode: 'follow' as const },
      { label: t('stackCustom'), mode: 'custom' as const },
      { label: t('stackDisable'), mode: 'disable' as const }
    ],
    {
      title: t('setStackSize'),
      placeHolder: t('stack')
    }
  );
  if (!picked) {
    return;
  }

  let stack = { auto: true, sizeMb: null as number | null };
  if (picked.mode === 'custom') {
    const sizeText = await vscode.window.showInputBox({
      title: t('setStackSize'),
      prompt: t('enterStackSizeMb'),
      value: String(context?.problem.stack?.sizeMb ?? context?.problem.limits.memoryMb ?? 256),
      validateInput: validatePositiveInteger
    });
    if (sizeText === undefined) {
      return;
    }
    stack = { auto: true, sizeMb: Number(sizeText) };
  } else if (picked.mode === 'disable') {
    stack = { auto: false, sizeMb: null };
  }

  if (context) {
    await updateProblemStack(context.workspaceFolder, context.problem.id, stack);
  } else {
    await setStackConfig(workspaceFolder, stack);
  }

  sampleTreeProvider.refresh();
  if (!stack.auto) {
    vscode.window.showInformationMessage(t('autoStackDisabled'));
  } else if (stack.sizeMb) {
    vscode.window.showInformationMessage(t('stackSizeSet', { size: stack.sizeMb }));
  } else {
    vscode.window.showInformationMessage(t('autoStackEnabled'));
  }
}

async function setJudgeModeCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    createJudgeModeItems(),
    {
      title: t('setJudgeMode'),
      placeHolder: t('judgeMode')
    }
  );
  if (!picked) {
    return;
  }

  await updateProblemJudgeMode(context.workspaceFolder, context.problem.id, picked.mode);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(
    picked.mode === 'checker'
      ? t('switchedToCustomChecker')
      : picked.mode === 'strictText'
        ? t('switchedToStrictCompare')
        : t('switchedToNormalCompare')
  );
}

async function setIoModeCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: t('standardIo'), mode: 'stdio' as const },
      { label: t('fileIo'), mode: 'fileio' as const }
    ],
    {
      title: t('setIoMode'),
      placeHolder: t('ioMode')
    }
  );
  if (!picked) {
    return;
  }

  if (picked.mode === 'stdio') {
    await updateProblemIoMode(context.workspaceFolder, context.problem.id, 'stdio', context.problem.fileIo);
    sampleTreeProvider.refresh();
    vscode.window.showInformationMessage(t('switchedToStandardIo'));
    return;
  }

  const fileIo = await readFileIoNames(context.problem.fileIo);
  if (!fileIo) {
    return;
  }

  await updateProblemIoMode(context.workspaceFolder, context.problem.id, 'fileio', fileIo);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('switchedToFileIo'));
}

async function setFileIoNamesCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const fileIo = await readFileIoNames(context.problem.fileIo);
  if (!fileIo) {
    return;
  }

  await updateProblemFileIo(context.workspaceFolder, context.problem.id, fileIo);
  sampleTreeProvider.refresh();
}

async function readFileIoNames(
  current: ProblemConfig['fileIo'] | undefined
): Promise<{ inputFileName: string; outputFileName: string } | undefined> {
  const inputFileName = await vscode.window.showInputBox({
    title: t('setFileIoNames'),
    prompt: t('inputFileName'),
    value: current?.inputFileName || 'input.txt',
    validateInput: validateFileIoName
  });
  if (inputFileName === undefined) {
    return undefined;
  }

  const outputFileName = await vscode.window.showInputBox({
    title: t('setFileIoNames'),
    prompt: t('outputFileName'),
    value: current?.outputFileName || 'output.txt',
    validateInput: validateFileIoName
  });
  if (outputFileName === undefined) {
    return undefined;
  }

  return { inputFileName, outputFileName };
}

function validateFileIoName(value: string): string | undefined {
  return validateFileIoNameValue(value).ok ? undefined : t('invalidFileIoName');
}

async function setCheckerCommand(
  extensionContext: vscode.ExtensionContext,
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  if (getEffectiveJudgeMode(context.problem) !== 'checker') {
    const confirmed = await vscode.window.showWarningMessage(
      t('switchToCheckerPrompt'),
      { modal: true },
      t('switchAndSet'),
      t('cancel')
    );
    if (confirmed !== t('switchAndSet')) {
      return;
    }
    await updateProblemJudgeMode(context.workspaceFolder, context.problem.id, 'checker');
    context.problem.judgeMode = 'checker';
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: t('checkerNone'), type: 'none' as const },
      { label: t('checkerTestlib'), type: 'testlib' as const },
      { label: t('checkerPlain'), type: 'plain' as const }
    ],
    {
      title: t('setChecker'),
      placeHolder: t('judgeMode')
    }
  );
  if (!picked) {
    return;
  }

  if (picked.type === 'none') {
    await updateProblemChecker(context.workspaceFolder, context.problem.id, { enabled: false, type: 'none' });
    sampleTreeProvider.refresh();
    vscode.window.showInformationMessage(t('checkerCleared'));
    return;
  }

  const checkerUri = await pickCheckerFile();
  if (!checkerUri) {
    return;
  }

  const plain = picked.type === 'plain'
    ? await readPlainCheckerProtocol(context.problem.checker?.plain)
    : {
      protocolVersion: 1 as const
    };
  if (!plain) {
    return;
  }

  const checker = {
    enabled: true,
    type: picked.type,
    source: checkerUri.fsPath,
    exe: getOiJudgeDataRelPath('problems', context.problem.id, 'checker', process.platform === 'win32' ? 'checker.exe' : 'checker'),
    timeLimitMs: 5000,
    testlib: {
      mode: 'auto' as const,
      path: null
    },
    plain: {
      ...plain
    }
  };
  await updateProblemChecker(context.workspaceFolder, context.problem.id, checker);
  if (picked.type === 'plain') {
    sampleTreeProvider.refresh();
    vscode.window.showInformationMessage(`${t('plainCheckerSet')} ${t('plainCheckerLastLineHint')}`);
    return;
  }

  const testlib = await resolveTestlibForChecker(context.workspaceFolder, checkerUri.fsPath, checker);
  let testlibFound = testlib.found;
  if (!testlib.found && await bundledTestlibExists(extensionContext)) {
    const action = await vscode.window.showWarningMessage(
      t('installBundledTestlibPrompt'),
      t('install'),
      t('importFromLocalFile'),
      t('cancel')
    );
    if (action === t('install')) {
      const installed = await installBundledTestlib(extensionContext, context.workspaceFolder);
      if (!installed) {
        return;
      }
      testlibFound = true;
    } else if (action === t('importFromLocalFile')) {
      await importLocalTestlib(context.workspaceFolder);
      testlibFound = true;
    }
  }
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(testlibFound ? t('checkerSet') : `${t('checkerSet')} ${t('testlibNotFound')} ${t('importTestlibHint')}`);
}

async function clearCheckerCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  await updateProblemChecker(context.workspaceFolder, context.problem.id, { enabled: false, type: 'none' });
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('checkerCleared'));
}

async function setPlainCheckerProtocolCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (getEffectiveJudgeMode(context.problem) !== 'checker' || context.problem.checker?.type !== 'plain') {
    vscode.window.showWarningMessage(t('notPlainChecker'));
    return;
  }

  const plain = await readPlainCheckerProtocol(context.problem.checker.plain);
  if (!plain) {
    return;
  }

  await updateProblemChecker(context.workspaceFolder, context.problem.id, {
    ...context.problem.checker,
    enabled: true,
    type: 'plain',
    plain
  });
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('plainCheckerProtocolUpdated'));
}

async function readPlainCheckerProtocol(
  current: PlainCheckerConfig | undefined
): Promise<{
  protocolVersion: 1;
  verdictPosition: 'firstLine' | 'lastLine';
  acceptedToken: string;
  wrongAnswerToken: string;
} | undefined> {
  const options = resolvePlainCheckerOptions(current);
  const positionItems = [
    { label: t('plainVerdictLastLine'), value: 'lastLine' as const },
    { label: t('plainVerdictFirstLine'), value: 'firstLine' as const }
  ].sort((left) => left.value === options.verdictPosition ? -1 : 1);
  const picked = await vscode.window.showQuickPick(
    positionItems,
    {
      title: t('setPlainCheckerProtocol'),
      placeHolder: t('verdictLine')
    }
  );
  if (!picked) {
    return undefined;
  }

  const acceptedToken = await vscode.window.showInputBox({
    title: t('setPlainCheckerProtocol'),
    prompt: t('acceptedToken'),
    value: options.acceptedToken,
    validateInput: validatePlainAcceptedToken
  });
  if (acceptedToken === undefined) {
    return undefined;
  }

  const wrongAnswerToken = await vscode.window.showInputBox({
    title: t('setPlainCheckerProtocol'),
    prompt: t('wrongAnswerToken'),
    value: options.wrongAnswerToken,
    validateInput: (value) => validatePlainWrongAnswerToken(value, acceptedToken)
  });
  if (wrongAnswerToken === undefined) {
    return undefined;
  }

  return {
    protocolVersion: 1,
    verdictPosition: picked.value,
    acceptedToken: acceptedToken.trim(),
    wrongAnswerToken: wrongAnswerToken.trim()
  };
}

function validatePlainAcceptedToken(value: string): string | undefined {
  const issue = validatePlainCheckerToken(value, 'accepted');
  return issue ? plainProtocolValidationMessage(issue) : undefined;
}

function validatePlainWrongAnswerToken(value: string, acceptedToken: string): string | undefined {
  const result = validatePlainCheckerProtocol({ acceptedToken, wrongAnswerToken: value });
  return result.ok ? undefined : plainProtocolValidationMessage(result.issue);
}

function plainProtocolValidationMessage(issue: PlainCheckerProtocolValidationIssue): string {
  switch (issue) {
    case 'acceptedTokenEmpty':
      return t('acceptedTokenEmpty');
    case 'wrongAnswerTokenEmpty':
      return t('wrongAnswerTokenEmpty');
    case 'tokensSame':
      return t('plainTokensCannotBeSame');
    case 'acceptedTokenNumeric':
    case 'wrongAnswerTokenNumeric':
      return t('plainTokensCannotBeNumeric');
  }
}

async function openCheckerCommand(problemId: string | undefined): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const checkerSource = context.problem.checker?.source;
  if (!checkerSource) {
    vscode.window.showWarningMessage(t('noCheckerSet'));
    return;
  }

  const checkerPath = path.isAbsolute(checkerSource)
    ? checkerSource
    : resolveProblemReferencePath(context.workspaceFolder, checkerSource);
  if (!(await exists(checkerPath))) {
    vscode.window.showWarningMessage(t('checkerMissing'));
    return;
  }

  await openFileInEditor(checkerPath, t('checkerMissing'));
}

async function importTestlibCommand(extensionContext: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  if (await bundledTestlibExists(extensionContext)) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: t('installBundledTestlib'), value: 'bundled' as const },
        { label: t('importFromLocalFile'), value: 'local' as const }
      ],
      {
        title: t('importTestlib')
      }
    );
    if (!picked) {
      return;
    }
    if (picked.value === 'bundled') {
      await installBundledTestlib(extensionContext, workspaceFolder);
      return;
    }
  }

  await importLocalTestlib(workspaceFolder);
}

async function importLocalTestlib(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const uri = await pickTestlibFile();
  if (!uri) {
    return;
  }

  if (path.basename(uri.fsPath).toLowerCase() !== 'testlib.h') {
    const confirmed = await vscode.window.showWarningMessage(
      t('testlibNameWarning'),
      { modal: true },
      t('select'),
      t('cancel')
    );
    if (confirmed !== t('select')) {
      return;
    }
  }

  await importTestlibToManaged(workspaceFolder, uri.fsPath);
  vscode.window.showInformationMessage(t('testlibImported'));
}

async function openTestlibCommand(problemId: string | undefined): Promise<void> {
  const context = await getProblemContext(problemId, true);
  const workspaceFolder = context?.workspaceFolder ?? getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const checkerSource = context?.problem.checker?.source
    ? path.isAbsolute(context.problem.checker.source)
      ? context.problem.checker.source
      : resolveProblemReferencePath(workspaceFolder, context.problem.checker.source)
    : workspaceFolder.uri.fsPath;
  const resolved = await resolveTestlibForChecker(workspaceFolder, checkerSource, context?.problem.checker);
  if (!resolved.found || !resolved.testlibPath) {
    vscode.window.showWarningMessage(`${t('testlibNotFound')} ${t('bundledAvailableHint')}`);
    return;
  }

  await openFileInEditor(resolved.testlibPath, t('testlibMissing'));
}

async function installBundledTestlib(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<boolean> {
  const bundledPath = getBundledTestlibPath(context);
  if (!(await exists(bundledPath))) {
    vscode.window.showWarningMessage(t('bundledTestlibMissing'));
    return false;
  }

  const targetPath = path.join(getOITestDir(workspaceFolder), 'tools', 'testlib', 'testlib.h');
  if (await exists(targetPath)) {
    const confirmed = await vscode.window.showWarningMessage(
      t('overwriteTestlibPrompt'),
      { modal: true },
      t('install'),
      t('cancel')
    );
    if (confirmed !== t('install')) {
      return false;
    }
  }

  await importTestlibToManaged(workspaceFolder, bundledPath);
  vscode.window.showInformationMessage(t('bundledTestlibInstalled'));
  return true;
}

async function bundledTestlibExists(context: vscode.ExtensionContext): Promise<boolean> {
  return exists(getBundledTestlibPath(context));
}

function getBundledTestlibPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, 'resources', 'testlib', 'testlib.h');
}

async function pickCheckerFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('selectCheckerCpp'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      'C++ Source': ['cpp', 'cc', 'cxx', 'c++']
    }
  });
  return uris?.[0];
}

async function pickTestlibFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('importTestlib'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      'testlib.h': ['h', 'hpp'],
      [t('statementFile')]: ['*']
    }
  });
  return uris?.[0];
}

async function setProblemStandardCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId);
  if (!context) {
    return;
  }

  const standard = await vscode.window.showQuickPick(['c++11', 'c++14', 'c++17', 'c++20', 'c++23'], {
    title: t('selectCppStandard'),
    placeHolder: t('chooseCppStandard')
  });
  if (!standard) {
    return;
  }

  await updateProblemStandard(context.workspaceFolder, context.problem.id, standard);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('standardUpdated'));
}

async function selectProblemCompilerCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId);
  if (!context) {
    return;
  }

  const compilerPath = await pickCompilerPath();
  if (!compilerPath) {
    return;
  }

  await updateProblemCompiler(context.workspaceFolder, context.problem.id, compilerPath);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('compilerSaved'));
}

async function bindStatementCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const uri = await pickStatementFile();
  if (!uri) {
    return;
  }

  await bindProblemStatement(context.workspaceFolder, context.problem.id, uri.fsPath);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('statementBound'));
}

async function openStatementCommand(problemId: string | undefined): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const statement = context.problem.statement;
  if (!statement) {
    vscode.window.showWarningMessage(t('noStatementBound'));
    return;
  }

  const statementPath = resolveProblemReferencePath(context.workspaceFolder, statement.path);
  if (!(await exists(statementPath))) {
    vscode.window.showWarningMessage(t('statementMissing'));
    return;
  }

  const uri = vscode.Uri.file(statementPath);
  if (statement.type === 'pdf') {
    await vscode.commands.executeCommand('vscode.open', uri);
    return;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function unbindStatementCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!context.problem.statement) {
    vscode.window.showInformationMessage(t('noStatementBound'));
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    t('unbindStatementConfirm'),
    { modal: true },
    t('unbindStatement'),
    t('cancel')
  );
  if (confirmed !== t('unbindStatement')) {
    return;
  }

  await unbindProblemStatement(context.workspaceFolder, context.problem.id);
  sampleTreeProvider.refresh();
}

async function addProgramToProblemCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const uri = await pickSourceFile();
  if (!uri) {
    return;
  }

  const setDefault = !getDefaultProblemSource(context.problem);
  await addProgramToProblem(context.workspaceFolder, context.problem.id, uri.fsPath, { setDefault });
  sampleTreeProvider.refresh();
  await updateStatusBar(context.problem.id);
}

async function setDefaultProgramCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const programPath = await pickProgramPath(context.workspaceFolder, context.problem, true);
  if (!programPath) {
    return;
  }

  await setProblemDefaultSource(context.workspaceFolder, context.problem.id, programPath);
  sampleTreeProvider.refresh();
  await updateStatusBar(context.problem.id);
}

async function selectStdProgramCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const sources = context.problem.sources ?? [];
  const picked = await vscode.window.showQuickPick(
    [
      ...sources.map((source) => {
        const resolvedPath = resolveProblemReferencePath(context.workspaceFolder, source.path);
        return {
          label: source.name ?? path.basename(resolvedPath),
          detail: resolvedPath,
          path: resolvedPath
        };
      }),
      {
        label: t('selectStdFromFile'),
        description: t('selectSourceFile'),
        path: undefined
      }
    ],
    {
      title: t('selectStdPrompt'),
      placeHolder: t('standardSolution')
    }
  );
  if (!picked) {
    return;
  }

  let stdPath = picked.path;
  if (!stdPath) {
    const uri = await pickSourceFile();
    stdPath = uri?.fsPath;
  }
  if (!stdPath) {
    return;
  }

  await setProblemStdProgram(context.workspaceFolder, context.problem.id, stdPath);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('stdSet', { name: path.basename(stdPath) }));
}

async function openStdProgramCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const stdProgram = context.problem.setter?.stdProgram;
  if (!stdProgram) {
    vscode.window.showWarningMessage(t('stdMissingSelectFirst'));
    return;
  }

  const stdPath = resolveProblemReferencePath(context.workspaceFolder, stdProgram);
  if (!(await exists(stdPath))) {
    const choice = await vscode.window.showWarningMessage(
      t('stdFileMissing'),
      t('selectStd'),
      t('cancel')
    );
    if (choice === t('selectStd')) {
      await selectStdProgramCommand(context.problem.id, sampleTreeProvider);
    }
    return;
  }

  await openFileInEditor(stdPath, t('stdFileMissing'));
}

async function clearStdProgramCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  await clearProblemStdProgram(context.workspaceFolder, context.problem.id);
  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('stdCleared'));
}

async function toggleAutoGenerateOutputFromStdCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const result = await toggleProblemAutoGenerateOutputFromStd(context.workspaceFolder, context.problem.id);
  if (!result) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(
    result.enabled ? t('generator.autoOutput.enabled') : t('generator.autoOutput.disabled')
  );
}

async function generateSampleAnswerWithStdCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const std = await prepareStdAnswerGeneration(context.workspaceFolder, context.problem);
  if (!std) {
    return;
  }

  const result = await generateAnswerForSample(context.workspaceFolder, context.problem, context.sample, std);
  if (!result.ok) {
    vscode.window.showErrorMessage(t('stdRunFailed'));
    return;
  }

  sampleTreeProvider.refresh();
  if (result.mode === 'direct') {
    vscode.window.showInformationMessage(
      result.answerCreated
        ? t('setter.generatedOutput.createdAndWritten', { answerFile: path.basename(result.answerPath) })
        : t('setter.generatedOutput.writtenDirectly', { sampleName: context.sample.name })
    );
    return;
  }
  vscode.window.showInformationMessage(t('setter.generatedOutput.generatedPendingBecauseCurrentNotEmpty', {
    sampleName: context.sample.name
  }));
}

async function generateAllSampleAnswersWithStdCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context || context.problem.samples.length === 0) {
    return;
  }

  const std = await prepareStdAnswerGeneration(context.workspaceFolder, context.problem);
  if (!std) {
    return;
  }

  let direct = 0;
  let pending = 0;
  let failed = 0;
  for (const sample of context.problem.samples) {
    const result = await generateAnswerForSample(context.workspaceFolder, context.problem, sample, std);
    if (!result.ok) {
      failed += 1;
    } else if (result.mode === 'direct') {
      direct += 1;
    } else {
      pending += 1;
    }
  }

  sampleTreeProvider.refresh();
  if (failed > 0) {
    output.show();
    vscode.window.showWarningMessage(t('setter.generatedOutput.processedSummaryWithFailures', {
      total: direct + pending,
      failed,
      direct,
      pending
    }));
    return;
  }
  vscode.window.showInformationMessage(t('setter.generatedOutput.processedSummary', {
    total: direct + pending,
    direct,
    pending
  }));
}

async function viewCurrentSampleAnswerCommand(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const fileStatus = await getSampleFileStatus(context.workspaceFolder, context.sample);
  if (fileStatus.answerMissing) {
    vscode.window.showWarningMessage(t('setter.generatedOutput.currentMissing'));
    return;
  }

  await openFileInEditor(fileStatus.answerPath, t('expectedOutputMissing'));
}

async function viewGeneratedSampleAnswerCommand(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const generated = await getSampleGeneratedAnswerStatus(context.workspaceFolder, context.problem, context.sample);
  if (!generated.exists || !generated.path) {
    vscode.window.showWarningMessage(t('setter.generatedOutput.noGenerated'));
    return;
  }

  await openFileInEditor(generated.path, t('setter.generatedOutput.noGenerated'));
}

async function diffGeneratedSampleAnswerCommand(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const fileStatus = await getSampleFileStatus(context.workspaceFolder, context.sample);
  const generated = await getSampleGeneratedAnswerStatus(context.workspaceFolder, context.problem, context.sample);
  if (!generated.exists || !generated.path) {
    vscode.window.showWarningMessage(t('setter.generatedOutput.noGenerated'));
    return;
  }
  if (fileStatus.answerMissing) {
    vscode.window.showWarningMessage(t('setter.generatedOutput.currentMissing'));
    await openFileInEditor(generated.path, t('setter.generatedOutput.noGenerated'));
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(fileStatus.answerPath),
    vscode.Uri.file(generated.path),
    t('setter.generatedOutput.compareTitle', { sample: context.sample.name })
  );
}

async function applyGeneratedSampleAnswerCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const result = await applyGeneratedAnswerForSample(context.workspaceFolder, context.problem.id, context.sample.index);
  sampleTreeProvider.refresh();
  if (!result.ok) {
    output.appendLine(`[ERR] Failed to apply generated output for ${context.sample.name}: ${result.error ?? 'Unknown error'}`);
    vscode.window.showWarningMessage(t('setter.generatedOutput.applyFailed'));
    return;
  }

  vscode.window.showInformationMessage(t('setter.generatedOutput.applied', {
    sample: result.sample?.name ?? context.sample.name,
    file: result.answerPath ? path.basename(result.answerPath) : ''
  }));
}

async function applyAllGeneratedSampleAnswersCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const result = await applyAllGeneratedAnswersForProblem(context.workspaceFolder, context.problem.id);
  sampleTreeProvider.refresh();
  if (result.applied.length === 0 && result.failed.length === 0) {
    vscode.window.showInformationMessage(t('setter.generatedOutput.noGenerated'));
    return;
  }
  if (result.failed.length > 0) {
    output.show();
    for (const failed of result.failed) {
      output.appendLine(`[ERR] Failed to apply generated output: ${failed.error ?? 'Unknown error'}`);
    }
    vscode.window.showWarningMessage(t('setter.generatedOutput.applyAllFailed', {
      count: result.applied.length,
      failed: result.failed.length
    }));
    return;
  }

  vscode.window.showInformationMessage(t('setter.generatedOutput.appliedAll', { count: result.applied.length }));
}

async function deleteGeneratedSampleAnswerCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const result = await deleteGeneratedAnswerForSample(context.workspaceFolder, context.problem.id, context.sample.index);
  sampleTreeProvider.refresh();
  if (!result.ok) {
    output.appendLine(`[ERR] Failed to delete generated output for ${context.sample.name}: ${result.error ?? 'Unknown error'}`);
    vscode.window.showWarningMessage(t('setter.generatedOutput.deleteFailed'));
    return;
  }

  vscode.window.showInformationMessage(t('setter.generatedOutput.deleted', {
    sample: result.sample?.name ?? context.sample.name
  }));
}

async function addProblemGeneratorCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const uri = await pickGeneratorFile();
  if (!uri) {
    return;
  }

  const result = await addProblemGenerator(context.workspaceFolder, context.problem.id, uri.fsPath);
  if (!result) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('generator.added', { name: result.generator.name }));
}

async function openProblemGeneratorCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const generator = await pickProblemGenerator(context.problem, t('generator.open'));
  if (!generator) {
    const choice = await vscode.window.showWarningMessage(
      t('generator.noneAddFirst'),
      t('generator.add'),
      t('cancel')
    );
    if (choice === t('generator.add')) {
      await addProblemGeneratorCommand(context.problem.id, sampleTreeProvider);
    }
    return;
  }

  if (!generator.source) {
    vscode.window.showWarningMessage(t('generator.missing'));
    return;
  }

  const generatorPath = resolveProblemReferencePath(context.workspaceFolder, generator.source.path);
  if (!(await exists(generatorPath))) {
    const choice = await vscode.window.showWarningMessage(
      t('generator.missing'),
      t('generator.add'),
      t('cancel')
    );
    if (choice === t('generator.add')) {
      await addProblemGeneratorCommand(context.problem.id, sampleTreeProvider);
    }
    return;
  }

  await openFileInEditor(generatorPath, t('generator.missing'));
}

async function removeProblemGeneratorCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }

  const generator = await pickProblemGenerator(context.problem, t('generator.remove'));
  if (!generator) {
    vscode.window.showWarningMessage(t('generator.none'));
    return;
  }

  const usedCount = (context.problem.subtasks ?? []).filter((subtask) => subtask.generatorId === generator.id).length;
  if (usedCount > 0) {
    const confirmed = await vscode.window.showWarningMessage(
      t('generator.remove.confirm', { count: usedCount }),
      { modal: true },
      t('delete'),
      t('cancel')
    );
    if (confirmed !== t('delete')) {
      return;
    }
  }

  const result = await removeProblemGenerator(context.workspaceFolder, context.problem.id, generator.id);
  if (!result) {
    vscode.window.showWarningMessage(t('generator.missing'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('generator.removed', { name: generator.name }));
}

async function addProblemGeneratorInputCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const uris = await pickGlobalGeneratorInputFiles();
  if (!uris || uris.length === 0) {
    return;
  }

  const result = await addProblemGeneratorInputs(
    context.workspaceFolder,
    context.problem.id,
    uris.map((uri) => uri.fsPath)
  );
  if (!result) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('generatorInput.global.added', { count: result.added.length }));
}

async function openProblemGeneratorInputCommand(
  problemId: string | undefined,
  inputId: string | undefined
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const input = await pickProblemGeneratorInput(context.problem, inputId, t('generatorInput.global.open'));
  if (!input?.source) {
    vscode.window.showWarningMessage(t('generatorInput.global.missing'));
    return;
  }

  const inputPath = resolveProblemReferencePath(context.workspaceFolder, input.source.path);
  await openFileInEditor(inputPath, t('generatorInput.global.missing'));
}

async function removeProblemGeneratorInputCommand(
  problemId: string | undefined,
  inputId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const input = await pickProblemGeneratorInput(context.problem, inputId, t('generatorInput.global.remove'));
  if (!input) {
    vscode.window.showWarningMessage(t('generatorInput.global.none'));
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    t('generatorInput.global.remove.confirm', { name: input.name }),
    { modal: true },
    t('delete'),
    t('cancel')
  );
  if (confirmed !== t('delete')) {
    return;
  }

  const result = await removeProblemGeneratorInput(context.workspaceFolder, context.problem.id, input.id);
  if (!result) {
    vscode.window.showWarningMessage(t('generatorInput.global.missing'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('generatorInput.global.removed', { name: input.name }));
}

async function bindSubtaskGeneratorCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const generator = await pickProblemGenerator(context.problem, t('subtask.generator.bind'));
  if (!generator) {
    const choice = await vscode.window.showWarningMessage(
      t('generator.noneAddFirst'),
      t('generator.add'),
      t('cancel')
    );
    if (choice === t('generator.add')) {
      await addProblemGeneratorCommand(context.problem.id, sampleTreeProvider);
    }
    return;
  }

  const subtask = await setProblemSubtaskGenerator(
    context.workspaceFolder,
    context.problem.id,
    context.subtask.id,
    generator.id
  );
  if (!subtask) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.generator.bound', { name: generator.name }));
}

async function openSubtaskGeneratorCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const generator = getProblemGenerator(context.problem, context.subtask.generatorId);
  if (!generator) {
    vscode.window.showWarningMessage(t(context.subtask.generatorId ? 'generator.missing' : 'subtask.generator.notBound'));
    return;
  }
  if (!generator.source) {
    vscode.window.showWarningMessage(t('generator.missing'));
    return;
  }

  const generatorPath = resolveProblemReferencePath(context.workspaceFolder, generator.source.path);
  if (!(await exists(generatorPath))) {
    vscode.window.showWarningMessage(t('generator.missing'));
    return;
  }

  await openFileInEditor(generatorPath, t('generator.missing'));
}

async function clearSubtaskGeneratorCommand(
  problemId: string | undefined,
  subtaskId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSubtaskContext(problemId, subtaskId);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const subtask = await clearProblemSubtaskGenerator(context.workspaceFolder, context.problem.id, context.subtask.id);
  if (!subtask) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(t('subtask.generator.cleared'));
}

async function pickProblemGenerator(
  problem: ProblemConfig,
  title: string
): Promise<ReturnType<typeof getProblemGenerators>[number] | undefined> {
  const generators = getProblemGenerators(problem);
  if (generators.length === 0) {
    return undefined;
  }
  if (generators.length === 1) {
    return generators[0];
  }
  const picked = await vscode.window.showQuickPick(
    generators.map((generator) => ({
      label: generator.name,
      description: generator.id,
      detail: generator.source?.path,
      generator
    })),
    {
      title,
      placeHolder: t('generator.select')
    }
  );
  return picked?.generator;
}

async function pickProblemGeneratorInput(
  problem: ProblemConfig,
  inputId: string | undefined,
  title: string
): Promise<ReturnType<typeof getProblemGeneratorInputs>[number] | undefined> {
  const input = getProblemGeneratorInput(problem, inputId);
  if (input) {
    return input;
  }

  const inputs = getProblemGeneratorInputs(problem);
  if (inputs.length === 0) {
    return undefined;
  }
  if (inputs.length === 1) {
    return inputs[0];
  }

  const picked = await vscode.window.showQuickPick(
    inputs.map((entry) => ({
      label: entry.name,
      description: entry.id,
      detail: entry.source?.path,
      input: entry
    })),
    {
      title,
      placeHolder: t('generatorInput.global.selectOne')
    }
  );
  return picked?.input;
}

async function addSetterInputSampleCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return;
  }
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return;
  }

  const sample = await addProblemInputSample(context.workspaceFolder, context.problem.id);
  if (!sample) {
    return;
  }

  sampleTreeProvider.refresh();
  await openInputSampleFile(context.workspaceFolder, sample);
  await showSetterInputSampleCreatedMessage(sample);
}

type StdAnswerGenerationContext = {
  stdPath: string;
  compile: CompileResult;
};

type StdSampleExecution = {
  stdin: string;
  cwd: string;
  outputPath?: string;
};

async function prepareStdAnswerGeneration(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<StdAnswerGenerationContext | undefined> {
  if (!isSetterModeEnabled()) {
    vscode.window.showWarningMessage(t('setterOnlyFeature'));
    return undefined;
  }
  if (!problem.setter?.stdProgram) {
    vscode.window.showWarningMessage(t('stdMissingSelectFirst'));
    return undefined;
  }

  const stdPath = resolveProblemReferencePath(workspaceFolder, problem.setter.stdProgram);
  if (!(await exists(stdPath))) {
    vscode.window.showWarningMessage(t('stdFileMissing'));
    return undefined;
  }

  const saved = await vscode.workspace.saveAll(false);
  if (!saved) {
    output.appendLine('[ERR] Failed to save files before generating answers with STD.');
    vscode.window.showWarningMessage(t('seeOutputAndStderr'));
    return undefined;
  }

  output.appendLine('');
  output.appendLine(`Generate sample answers with STD: ${stdPath}`);
  output.appendLine('STD compile:');
  output.appendLine(`STD source: ${stdPath}`);
  const compile = await compileSource(workspaceFolder, stdPath, problem, output);
  if (!compile || compile.status !== 'OK' || !compile.executablePath) {
    vscode.window.showErrorMessage(t('stdCompileFailed'));
    return undefined;
  }

  return { stdPath, compile };
}

async function generateAnswerForSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  sample: SampleConfig,
  std: StdAnswerGenerationContext
): Promise<
  | { ok: true; mode: 'direct'; answerPath: string; answerCreated: boolean }
  | { ok: true; mode: 'pending'; generatedPath: string }
  | { ok: false; reason: string }
> {
  const inputPath = resolveSamplePath(workspaceFolder, sample.input);
  if (!(await exists(inputPath))) {
    const reason = `Sample input missing: ${inputPath}`;
    output.appendLine(`[ERR] ${sample.name}: ${reason}`);
    return { ok: false, reason };
  }

  const input = await fs.readFile(inputPath, 'utf8');
  const execution = await prepareStdSampleExecution(workspaceFolder, problem, sample, input);
  let result;
  try {
    if (std.compile.status !== 'OK' || !std.compile.executablePath) {
      return { ok: false, reason: t('stdCompileFailed') };
    }
    result = await runProcess(
      std.compile.executablePath,
      [],
      execution.stdin,
      execution.cwd,
      problem.limits.timeMs,
      createStdExecutionEnv(std.compile.executablePath, std.compile.compilerCommand)
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    output.appendLine(`[ERR] ${sample.name}: STD failed to start: ${reason}`);
    return { ok: false, reason };
  }

  if (result.timedOut || result.code !== 0 || result.signal) {
    const reason = result.timedOut
      ? `STD timed out after ${Math.round(result.timeMs)} ms.`
      : `STD exited abnormally: code=${result.code ?? 'null'}, signal=${result.signal ?? 'null'}.`;
    output.appendLine(`[ERR] ${sample.name}: ${reason}`);
    if (result.stderr.trim()) {
      output.appendLine(result.stderr.trimEnd());
    }
    if (result.stdinError || result.stdoutError || result.stderrError) {
      output.appendLine(`stdio errors: ${[result.stdinError, result.stdoutError, result.stderrError].filter(Boolean).join('; ')}`);
    }
    return { ok: false, reason };
  }

  if (result.stderr.trim()) {
    output.appendLine(`[STD stderr] ${sample.name}:`);
    output.appendLine(result.stderr.trimEnd());
  }

  let answer = result.stdout;
  if (execution.outputPath) {
    if (!(await exists(execution.outputPath))) {
      const fileIo = getProblemFileIoForRun(problem);
      const reason = `STD did not create File IO output file: ${fileIo.outputFileName}`;
      output.appendLine(`[ERR] ${sample.name}: ${reason}`);
      return { ok: false, reason };
    }
    answer = await fs.readFile(execution.outputPath, 'utf8');
  }

  const written = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample.index, answer);
  if (!written.ok) {
    const reason = written.error;
    output.appendLine(`[ERR] ${sample.name}: ${reason}`);
    return { ok: false, reason };
  }
  if (written.mode === 'direct') {
    output.appendLine(`[OK] ${sample.name}: wrote STD output directly to ${written.answerPath}`);
    return {
      ok: true,
      mode: 'direct',
      answerPath: written.answerPath,
      answerCreated: written.answerCreated
    };
  }
  output.appendLine(`[OK] ${sample.name}: wrote generated output ${written.generatedPath}`);
  return { ok: true, mode: 'pending', generatedPath: written.generatedPath };
}

async function prepareStdSampleExecution(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  sample: SampleConfig,
  input: string
): Promise<StdSampleExecution> {
  if (getProblemIoModeForRun(problem) !== 'fileio') {
    return {
      stdin: input,
      cwd: workspaceFolder.uri.fsPath
    };
  }

  const fileIo = getProblemFileIoForRun(problem);
  const outputPaths = getProblemSampleOutputPaths(workspaceFolder, problem.id, sample.index);
  await fs.rm(outputPaths.runDirPath, { recursive: true, force: true });
  await fs.mkdir(outputPaths.runDirPath, { recursive: true });
  await fs.writeFile(path.join(outputPaths.runDirPath, fileIo.inputFileName), input, 'utf8');

  return {
    stdin: '',
    cwd: outputPaths.runDirPath,
    outputPath: path.join(outputPaths.runDirPath, fileIo.outputFileName)
  };
}

function getProblemIoModeForRun(problem: ProblemConfig): IoMode {
  return problem.ioMode === 'fileio' ? 'fileio' : 'stdio';
}

function getProblemFileIoForRun(problem: ProblemConfig): FileIoConfig {
  return {
    inputFileName: problem.fileIo?.inputFileName || 'input.txt',
    outputFileName: problem.fileIo?.outputFileName || 'output.txt'
  };
}

function createStdExecutionEnv(executablePath: string, compilerCommand: string | undefined): NodeJS.ProcessEnv {
  const executableDir = path.dirname(executablePath);
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const env = withCompilerPathEnv(compilerCommand);
  return {
    ...env,
    [pathKey]: [executableDir, env[pathKey], env.PATH]
      .filter(Boolean)
      .join(path.delimiter)
  };
}

async function setSampleNameCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = sampleId === undefined
    ? await getProblemContext(problemId, true)
    : await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  let targetSample: SampleConfig | undefined = (context as { sample?: SampleConfig }).sample;
  if (!targetSample) {
    const picked = await vscode.window.showQuickPick(
      context.problem.samples.map((sample) => ({
        label: sample.name,
        description: sample.id,
        sample
      })),
      {
        title: t('setSampleName'),
        placeHolder: t('sampleName')
      }
    );
    targetSample = picked?.sample;
  }
  if (!targetSample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  const name = await vscode.window.showInputBox({
    title: t('setSampleName'),
    prompt: t('sampleNameSetterNote'),
    value: targetSample.name,
    validateInput: (value) => {
      if (!value.trim()) {
        return t('sampleNameCannotBeEmpty');
      }
      return validateSetterSampleName(value) ? undefined : t('invalidSampleName');
    }
  });
  if (name === undefined) {
    return;
  }

  const result = await renameProblemSample(context.workspaceFolder, context.problem.id, targetSample.index, name);
  if (!result?.sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  await refreshProblemReportPanel(context.problem.id);
  vscode.window.showInformationMessage(
    result.renamed
      ? t('sampleRenamed', { name: result.sample.name })
      : t('sampleNameUpdated', { name: result.sample.name })
  );
}

async function setSampleScoreCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const effective = calculateEffectiveSampleScores(context.problem);
  const current = context.sample.score ?? effective.sampleScores.get(context.sample.id)?.score ?? 0;
  const value = await vscode.window.showInputBox({
    title: t('score.setSample'),
    prompt: t('score.sample.prompt'),
    value: String(current),
    validateInput: validateNonNegativeScoreInput
  });
  if (value === undefined) {
    return;
  }

  await setProblemSampleScore(context.workspaceFolder, context.problem.id, context.sample.id, Number(value.trim()));
  const updated = await getProblem(context.workspaceFolder, context.problem.id);
  const errors = updated ? calculateEffectiveSampleScores(updated).errors : [];
  sampleTreeProvider.refresh();
  if (errors.includes('score.manualTotalExceeded')) {
    vscode.window.showWarningMessage(t('score.manualTotalExceeded'));
  }
}

async function clearSampleScoreCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  await clearProblemSampleScore(context.workspaceFolder, context.problem.id, context.sample.id);
  sampleTreeProvider.refresh();
}

function validatePositiveScoreInput(value: string): string | undefined {
  const score = Number(value.trim());
  return Number.isInteger(score) && score > 0
    ? undefined
    : t('score.invalidPositiveInteger');
}

function validateNonNegativeScoreInput(value: string): string | undefined {
  const score = Number(value.trim());
  return Number.isInteger(score) && score >= 0
    ? undefined
    : t('score.invalidNonNegativeInteger');
}

async function pickStatementFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('statementFile'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      [t('markdownStatement')]: ['md', 'markdown'],
      [t('pdfStatement')]: ['pdf'],
      [t('textStatement')]: ['txt'],
      [t('statementFile')]: ['*']
    }
  });

  return uris?.[0];
}

async function pickGeneratorInputFile(): Promise<vscode.Uri | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('subtask.generatorInputFile'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('select'),
    filters: {
      [t('subtask.generatorInputFile')]: ['*']
    }
  });

  return uris?.[0];
}

async function ensureProblemCompiler(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<ProblemConfig | undefined> {
  const candidate = await findCompiler(workspaceFolder, problem);
  if (candidate) {
    return updateProblemCompiler(workspaceFolder, problem.id, candidate.command);
  }

  vscode.window.showWarningMessage(t('compilerMissing'));
  const selected = await pickCompilerPath();
  if (!selected) {
    vscode.window.showWarningMessage(t('compilerNeeded'));
    return undefined;
  }

  return updateProblemCompiler(workspaceFolder, problem.id, selected);
}

async function getProblemContext(problemId: string | undefined, allowActive = false): Promise<{
  workspaceFolder: vscode.WorkspaceFolder;
  problem: ProblemConfig;
} | undefined> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return undefined;
  }

  let resolvedProblemId = problemId ?? (allowActive ? activeProblemId : undefined);
  if (!resolvedProblemId && allowActive) {
    const config = await ensureProblemsConfig(workspaceFolder);
    if (config.problems.length === 1) {
      resolvedProblemId = config.problems[0].id;
    } else if (config.problems.length > 1) {
      const picked = await vscode.window.showQuickPick(
        config.problems.map((problem) => ({ label: problem.name, description: problem.id, problem })),
        { title: t('problems') }
      );
      resolvedProblemId = picked?.problem.id;
    }
  }

  if (!resolvedProblemId) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return undefined;
  }

  const problem = await getProblem(workspaceFolder, resolvedProblemId);
  if (!problem) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return undefined;
  }

  activeProblemId = problem.id;
  return { workspaceFolder, problem };
}

async function openSampleFileCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  kind: 'input' | 'answer' | 'output' | 'stderr'
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const fileStatus = await getSampleFileStatus(context.workspaceFolder, context.sample);
  const filePath =
    kind === 'input'
      ? fileStatus.inputPath
      : kind === 'answer'
        ? fileStatus.answerPath
        : kind === 'stderr'
          ? await findExistingStderrOutput(context.workspaceFolder, context.sample, context.problem.id)
          : await findExistingRunResult(context.workspaceFolder, context.sample, context.problem.id)
            ?? await createRunResultFallback(context)
            ?? await findExistingUserOutput(context.workspaceFolder, context.sample, context.problem.id);

  if (!filePath) {
    vscode.window.showWarningMessage(kind === 'stderr' ? t('stderrMissing') : t('runResultMissing'));
    return;
  }

  if (kind === 'input' && fileStatus.inputMissing) {
    vscode.window.showWarningMessage(t('sampleInputMissing'));
    return;
  }
  if (kind === 'answer' && fileStatus.answerMissing) {
    vscode.window.showWarningMessage(t('expectedOutputMissing'));
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch {
    vscode.window.showErrorMessage(t('failedOpenSampleFile'));
  }
}

async function copyTestcaseFreopenInputCommand(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    vscode.window.showWarningMessage(t('debug.copyFreopenInput.noSample'));
    return;
  }

  const fileStatus = await getSampleFileStatus(context.workspaceFolder, context.sample);
  if (fileStatus.inputMissing) {
    vscode.window.showWarningMessage(t('debug.copyFreopenInput.inputMissing'));
    return;
  }

  try {
    const snippet = `freopen("${toCppStringLiteralPath(fileStatus.inputPath)}", "r", stdin);`;
    await vscode.env.clipboard.writeText(snippet);
    vscode.window.showInformationMessage(t('debug.copyFreopenInput.done'));
  } catch {
    vscode.window.showWarningMessage(t('debug.copyFreopenInput.failed'));
  }
}

function toCppStringLiteralPath(filePath: string): string {
  return filePath
    .replace(/\\/gu, '/')
    .replace(/"/gu, '\\"');
}

async function openSampleDiffCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sourceViewColumn?: vscode.ViewColumn
): Promise<void> {
  const files = await resolveSampleDiffFiles(problemId, sampleId);
  if (!files) {
    return;
  }

  await ensureDiffEditorSideBySide();

  const targetViewColumn = getDiffTargetViewColumn(sourceViewColumn);
  const options: vscode.TextDocumentShowOptions = {
    preview: false,
    preserveFocus: false
  };
  if (targetViewColumn !== undefined) {
    options.viewColumn = targetViewColumn;
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(files.expectedPath),
    vscode.Uri.file(files.actualPath),
    t('diffTitle', { sample: files.sampleName }),
    options
  );
}

async function ensureDiffEditorSideBySide(): Promise<void> {
  const config = vscode.workspace.getConfiguration('diffEditor');
  const update = typeof config.update === 'function' ? config.update.bind(config) : undefined;
  if (!update) {
    return;
  }

  const updates: Thenable<void>[] = [];
  if (config.get<boolean>('renderSideBySide') !== true) {
    updates.push(update('renderSideBySide', true, vscode.ConfigurationTarget.Workspace));
  }
  if (config.get<boolean>('useInlineViewWhenSpaceIsLimited') !== false) {
    updates.push(update('useInlineViewWhenSpaceIsLimited', false, vscode.ConfigurationTarget.Workspace));
  }

  if (updates.length === 0) {
    return;
  }

  try {
    await Promise.all(updates);
  } catch (error) {
    output.appendLine(`[WARN] Failed to update diff editor layout settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveSampleDiffFiles(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<{ expectedPath: string; actualPath: string; sampleName: string } | undefined> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return undefined;
  }

  const fileStatus = await getSampleFileStatus(context.workspaceFolder, context.sample);
  if (fileStatus.answerMissing) {
    vscode.window.showWarningMessage(t('diffFilesMissing'));
    return undefined;
  }

  const outputPath = await findExistingUserOutput(context.workspaceFolder, context.sample, context.problem.id);
  if (!outputPath) {
    vscode.window.showWarningMessage(t('diffFilesMissing'));
    return undefined;
  }

  return {
    expectedPath: fileStatus.answerPath,
    actualPath: outputPath,
    sampleName: context.sample.name
  };
}

function getDiffTargetViewColumn(sourceViewColumn?: vscode.ViewColumn): vscode.ViewColumn | undefined {
  if (sourceViewColumn === undefined) {
    return undefined;
  }

  const columns = [...(vscode.window.tabGroups?.all ?? [])]
    .map((group) => group.viewColumn)
    .filter((viewColumn): viewColumn is vscode.ViewColumn => typeof viewColumn === 'number' && viewColumn > 0)
    .sort((left, right) => left - right);

  const candidates = [...new Set(columns)].filter((viewColumn) => viewColumn !== sourceViewColumn);
  if (candidates.length > 0) {
    return candidates[candidates.length - 1];
  }

  return sourceViewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
}

function readSourceViewColumn(value: unknown): vscode.ViewColumn | undefined {
  if (typeof value === 'object' && value !== null && 'sourceViewColumn' in value) {
    const viewColumn = (value as { sourceViewColumn?: unknown }).sourceViewColumn;
    return typeof viewColumn === 'number' ? viewColumn as vscode.ViewColumn : undefined;
  }
  return undefined;
}

async function createRunResultFallback(context: {
  workspaceFolder: vscode.WorkspaceFolder;
  problem: ProblemConfig;
  sample: ProblemConfig['samples'][number];
}): Promise<string | undefined> {
  const paths = getProblemSampleOutputPaths(context.workspaceFolder, context.problem.id, context.sample.index);
  const stdoutPath = await findExistingUserOutput(context.workspaceFolder, context.sample, context.problem.id);
  const stderrPath = await findExistingStderrOutput(context.workspaceFolder, context.sample, context.problem.id);
  if (!stdoutPath && !stderrPath) {
    return undefined;
  }

  let sampleReport: {
    status?: string;
    message?: string;
    exitCode?: number | null;
    signal?: string | null;
    killedByTimeout?: boolean;
    stdinError?: string;
    stdoutError?: string;
    stderrError?: string;
    timeMs?: number;
    runtimeError?: {
      rawExitCode?: number;
      rawSignal?: string | null;
    };
  } | undefined;
  try {
    const report = JSON.parse(await fs.readFile(getProblemReportPath(context.workspaceFolder, context.problem.id), 'utf8')) as {
      samples?: Array<{
        id?: string;
        index?: number;
        status?: string;
        message?: string;
        exitCode?: number | null;
        signal?: string | null;
        killedByTimeout?: boolean;
        stdinError?: string;
        stdoutError?: string;
        stderrError?: string;
        timeMs?: number;
        runtimeError?: {
          rawExitCode?: number;
          rawSignal?: string | null;
        };
      }>;
    };
    sampleReport = report.samples?.find((entry) =>
      entry.index === context.sample.index || entry.id === context.sample.id
    );
  } catch {
    // A missing or older report should not block opening the best available run result.
  }

  const stdout = stdoutPath && await exists(stdoutPath) ? await fs.readFile(stdoutPath, 'utf8') : '';
  const stderr = stderrPath && await exists(stderrPath) ? await fs.readFile(stderrPath, 'utf8') : '';
  const lines = [
    '[stdout]',
    stdout.trimEnd() || '<empty>',
    '',
    '[stderr]',
    stderr.trimEnd() || '<empty>',
    '',
    '[runtime]',
    `Status: ${sampleReport?.status ?? 'Unknown'}`,
    `Exit code: ${sampleReport?.exitCode ?? 'unknown'}`,
    `Signal: ${sampleReport?.signal ?? 'null'}`,
    `Killed by timeout: ${sampleReport?.killedByTimeout ?? false}`
  ];
  if (sampleReport?.timeMs !== undefined) {
    lines.push(`Time: ${Math.round(sampleReport.timeMs)} ms`);
  }
  if (sampleReport?.stdinError) {
    lines.push(`stdinError: ${sampleReport.stdinError}`);
  }
  if (sampleReport?.stdoutError) {
    lines.push(`stdoutError: ${sampleReport.stdoutError}`);
  }
  if (sampleReport?.stderrError) {
    lines.push(`stderrError: ${sampleReport.stderrError}`);
  }
  if (sampleReport?.message) {
    lines.push(`Message: ${sampleReport.message}`);
  }
  if (sampleReport?.status === 'RE') {
    const explanation = explainRuntimeError({
      exitCode: sampleReport.runtimeError?.rawExitCode ?? sampleReport.exitCode,
      signal: sampleReport.runtimeError?.rawSignal ?? sampleReport.signal,
      platform: process.platform
    });
    if (explanation) {
      lines.push('', renderRuntimeErrorExplanation(explanation, { stderrEmpty: !stderr.trim() }));
    }
  }

  await fs.mkdir(path.dirname(paths.runResultPath), { recursive: true });
  await fs.writeFile(paths.runResultPath, `${lines.join('\n')}\n`, 'utf8');
  return paths.runResultPath;
}

async function openCheckerArtifactCommand(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const reportPath = getProblemReportPath(context.workspaceFolder, context.problem.id);
  if (!(await exists(reportPath))) {
    vscode.window.showWarningMessage(t('noReport'));
    return;
  }

  try {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as { samples?: Array<{ index?: number; id?: string; checker?: { output?: string; stdout?: string; stderr?: string } }> };
    const sampleReport = report.samples?.find((entry) =>
      entry.index === context.sample.index || entry.id === context.sample.id
    );
    const artifact = sampleReport?.checker?.output ?? sampleReport?.checker?.stdout ?? sampleReport?.checker?.stderr;
    if (!artifact) {
      vscode.window.showWarningMessage(t('checkerOutputMissing'));
      return;
    }

    const artifactPath = path.isAbsolute(artifact)
      ? artifact
      : resolveProblemReferencePath(context.workspaceFolder, artifact);
    await openFileInEditor(artifactPath, t('checkerOutputMissing'));
  } catch {
    vscode.window.showWarningMessage(t('checkerOutputMissing'));
  }
}

async function openFileInEditor(filePath: string, missingMessage: string): Promise<void> {
  if (!(await exists(filePath))) {
    vscode.window.showWarningMessage(missingMessage);
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function deleteSampleCommand(
  problemId: string | undefined,
  sampleId: number | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const target = await getDeleteSampleTarget(problemId, sampleId);
  if (!target) {
    return;
  }

  const sourceType = inferSampleSourceType(target.workspaceFolder, target.sample);
  const detail =
    sourceType === 'external'
      ? t('deleteExternalSampleDetail')
      : t('deleteManagedSampleDetail');
  const confirmed = await vscode.window.showWarningMessage(
    `${t('deleteSampleConfirm', { name: target.sample.name })} ${detail}`,
    { modal: true },
    t('delete'),
    t('cancel')
  );
  if (confirmed !== t('delete')) {
    return;
  }

  try {
    const result = await deleteProblemSample(target.workspaceFolder, target.problem.id, target.sample.index);
    if (!result.sample) {
      vscode.window.showWarningMessage(t('sampleNotFound'));
      return;
    }

    for (const error of result.cleanupErrors) {
      output.appendLine(`[WARN] Failed to clean sample file: ${error}`);
    }
    if (result.reportCleared) {
      output.appendLine('[WARN] Invalid report.json was removed after deleting a sample.');
    }

    sampleTreeProvider.refresh();
    await refreshProblemReportPanel(target.problem.id);
    vscode.window.showInformationMessage(
      result.cleanupErrors.length > 0 ? t('sampleDeletedWithCleanupWarning') : t('sampleDeleted')
    );
  } catch (error) {
    output.appendLine(`[ERR] Failed to delete sample: ${String(error)}`);
    vscode.window.showErrorMessage(t('deleteSampleFailed'));
  }
}

async function getDeleteSampleTarget(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<{
  workspaceFolder: vscode.WorkspaceFolder;
  problem: ProblemConfig;
  sample: ProblemConfig['samples'][number];
} | undefined> {
  if (problemId && sampleId !== undefined) {
    return getSampleContext(problemId, sampleId);
  }

  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return undefined;
  }

  const problems = await ensureProblemsConfig(workspaceFolder);
  const choices = problems.problems.flatMap((problem) =>
    problem.samples.map((sample) => ({
      label: sample.name,
      description: problem.name,
      detail: sample.input,
      problem,
      sample
    }))
  );

  if (choices.length === 0) {
    vscode.window.showWarningMessage(t('noSamplesToDelete'));
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(choices, {
    title: t('deleteSample'),
    placeHolder: t('selectSampleToDelete')
  });
  if (!picked) {
    return undefined;
  }

  return {
    workspaceFolder,
    problem: picked.problem,
    sample: picked.sample
  };
}

async function getSampleContext(
  problemId: string | undefined,
  sampleId: number | undefined
): Promise<{
  workspaceFolder: vscode.WorkspaceFolder;
  problem: ProblemConfig;
  sample: ProblemConfig['samples'][number];
} | undefined> {
  const context = await getProblemContext(problemId);
  if (!context || sampleId === undefined) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return undefined;
  }

  const sample = context.problem.samples.find((entry) => entry.index === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return undefined;
  }

  return { ...context, sample };
}

async function getSubtaskContext(
  problemId: string | undefined,
  subtaskId: string | undefined
): Promise<{
  workspaceFolder: vscode.WorkspaceFolder;
  problem: ProblemConfig;
  subtask: NonNullable<ProblemConfig['subtasks']>[number];
} | undefined> {
  const context = await getProblemContext(problemId, true);
  if (!context) {
    return undefined;
  }

  let resolvedSubtaskId = subtaskId;
  if (!resolvedSubtaskId) {
    const picked = await vscode.window.showQuickPick(
      (context.problem.subtasks ?? []).map((subtask) => ({
        label: subtask.name,
        description: subtask.id,
        subtask
      })),
      {
        title: t('subtask.run'),
        placeHolder: t('subtask.moveTo')
      }
    );
    resolvedSubtaskId = picked?.subtask.id;
  }

  const subtask = context.problem.subtasks?.find((entry) => entry.id === resolvedSubtaskId);
  if (!subtask) {
    vscode.window.showWarningMessage(t('subtask.notFound'));
    return undefined;
  }

  return { ...context, subtask };
}

function readProblemId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'problemId' in value) {
    const problemId = (value as { problemId?: unknown }).problemId;
    return typeof problemId === 'string' ? problemId : undefined;
  }
  return undefined;
}

function readSubtaskId(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'subtaskId' in value) {
    const subtaskId = (value as { subtaskId?: unknown }).subtaskId;
    return typeof subtaskId === 'string' ? subtaskId : undefined;
  }
  return undefined;
}

function readGeneratorInputId(value: unknown, fallback: unknown): string | undefined {
  if (typeof fallback === 'string') {
    return fallback;
  }
  if (typeof value === 'object' && value !== null && 'generatorInputId' in value) {
    const inputId = (value as { generatorInputId?: unknown }).generatorInputId;
    return typeof inputId === 'string' ? inputId : undefined;
  }
  return undefined;
}

function readSampleId(problemArg: unknown, sampleArg: unknown): number | undefined {
  if (typeof sampleArg === 'number') {
    return sampleArg;
  }
  if (typeof problemArg === 'object' && problemArg !== null && 'sampleId' in problemArg) {
    const sampleId = (problemArg as { sampleId?: unknown }).sampleId;
    return typeof sampleId === 'number' ? sampleId : undefined;
  }
  return undefined;
}

function getEffectiveJudgeMode(problem: ProblemConfig): JudgeMode {
  if (problem.judgeMode === 'strictText' || problem.judgeMode === 'trimTrailingWhitespace' || problem.judgeMode === 'checker') {
    return problem.judgeMode;
  }
  if ((problem as { judgeMode?: string }).judgeMode === 'normal') {
    return 'trimTrailingWhitespace';
  }
  return problem.checker?.enabled && problem.checker.type !== 'none' ? 'checker' : 'trimTrailingWhitespace';
}

async function updateSetterModeContext(): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'oijudger.setterModeEnabled', isSetterModeEnabled());
}

async function updateStatusBar(problemId: string | undefined = activeProblemId): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    statusBar.text = 'OI Judge';
    return;
  }

  const config = await ensureProblemsConfig(workspaceFolder);
  const problem = problemId
    ? config.problems.find((entry) => entry.id === problemId)
    : config.problems[0];
  if (!problem) {
    statusBar.text = 'OI Judge';
    return;
  }

  activeProblemId = problem.id;
  if (!getDefaultProblemSource(problem)) {
    statusBar.text = `OI Judge: ${problem.name}  ${t('noProgramSet')}`;
    return;
  }

  try {
    const report = JSON.parse(await vscode.workspace.fs.readFile(vscode.Uri.file(getProblemReportPath(workspaceFolder, problem.id))).then((bytes) => new TextDecoder().decode(bytes))) as {
      summary?: { accepted: number; total: number };
    };
    if (report.summary) {
      statusBar.text = `OI Judge: ${problem.name}  ${report.summary.accepted}/${report.summary.total} ${t('statusAC')}`;
      return;
    }
  } catch {
    // Ignore missing or invalid report for the compact status item.
  }

  statusBar.text = `OI Judge: ${problem.name}`;
}
