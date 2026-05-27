import * as path from 'path';
import * as vscode from 'vscode';
import {
  addExternalSample,
  addSample,
  clearOutputs,
  ensureConfig,
  exists,
  getWorkspaceFolder,
  initProblem,
  isCppFile,
  setMemoryLimit,
  setTimeLimit,
  validatePositiveInteger
} from './config';
import { ensureCompilerConfigured, findCompiler, pickCompilerPath, selectCompiler } from './compilerDetection';
import { t } from './i18n';
import { runAllSamples } from './judge';
import {
  openLastReport,
  openProblemReport,
  openProblemSampleDetail,
  openSampleDetail,
  refreshProblemReportPanel
} from './reportView';
import {
  addProgramToProblem,
  addExternalProblemSample,
  addProblemFromSource,
  addProblemSample,
  bindProblemStatement,
  createProblem,
  deleteProblemSample,
  ensureProblemsConfig,
  getDefaultProblemSource,
  getProblem,
  getProblemReportPath,
  getProblemSourcePath,
  importLegacyProblem,
  resolveProblemReferencePath,
  saveProblemReport,
  setProblemDefaultSource,
  unbindProblemStatement,
  updateProblemCompiler,
  updateProblemLimits,
  updateProblemStandard
} from './problems';
import { findExistingUserOutput, getSampleFileStatus, inferSampleSourceType } from './sampleFiles';
import { SampleTreeProvider } from './sampleTreeProvider';
import { ProblemConfig } from './types';

const output = vscode.window.createOutputChannel('OIjudger');
const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
let activeProblemId: string | undefined;

type AddSampleMode = 'paste' | 'files';

export function activate(context: vscode.ExtensionContext): void {
  const sampleTreeProvider = new SampleTreeProvider();
  statusBar.command = 'oijudger.refreshView';
  statusBar.show();
  void updateStatusBar();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('oijudger.samplesView', sampleTreeProvider),
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
      vscode.window.showInformationMessage(
        mode === 'files'
          ? t('externalSampleFilesAdded')
          : t('sampleAdded', { sample: sample.name })
      );
    }),
    vscode.commands.registerCommand('oijudger.runAllSamples', async () => {
      const firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (firstWorkspaceFolder) {
        const problems = await ensureProblemsConfig(firstWorkspaceFolder);
        if (problems.problems.length > 0) {
          await runProblemSamplesCommand(activeProblemId, sampleTreeProvider, false);
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
    vscode.commands.registerCommand('oijudger.addProblemSample', async (problemArg?: unknown) => {
      await addProblemSampleCommand(readProblemId(problemArg), false, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemSampleFromFiles', async (problemArg?: unknown) => {
      await addProblemSampleCommand(readProblemId(problemArg), true, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.runProblemSamples', async (problemArg?: unknown) => {
      await runProblemSamplesCommand(readProblemId(problemArg), sampleTreeProvider, false);
    }),
    vscode.commands.registerCommand('oijudger.runSamplesWithProgram', async (problemArg?: unknown) => {
      await runProblemSamplesCommand(readProblemId(problemArg), sampleTreeProvider, true);
    }),
    vscode.commands.registerCommand('oijudger.setProblemTimeLimit', async (problemArg?: unknown) => {
      await setProblemLimitCommand(readProblemId(problemArg), 'timeMs', sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.setProblemMemoryLimit', async (problemArg?: unknown) => {
      await setProblemLimitCommand(readProblemId(problemArg), 'memoryMb', sampleTreeProvider);
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
    vscode.commands.registerCommand('oijudger.openSampleOutput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'output');
    }),
    vscode.commands.registerCommand('oijudger.openSampleUserOutput', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleFileCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), 'output');
    }),
    vscode.commands.registerCommand('oijudger.openSampleDiff', async (problemArg?: unknown, sampleArg?: unknown) => {
      await openSampleDiffCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg));
    }),
    vscode.commands.registerCommand('oijudger.deleteSample', async (problemArg?: unknown, sampleArg?: unknown) => {
      await deleteSampleCommand(readProblemId(problemArg), readSampleId(problemArg, sampleArg), sampleTreeProvider);
    }),
    output
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => sampleTreeProvider.refresh()),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (
        document.uri.fsPath.endsWith('config.json') ||
        document.uri.fsPath.endsWith('problems.json') ||
        document.uri.fsPath.endsWith('report.json')
      ) {
        sampleTreeProvider.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('oijudger.language')) {
        sampleTreeProvider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up.
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

async function readSampleFromInputBoxes(): Promise<{ input: string; answer: string } | undefined> {
  const input = await vscode.window.showInputBox({
    title: t('addSampleTitle'),
    prompt: t('sampleInputPrompt'),
    value: ''
  });
  if (input === undefined) {
    return undefined;
  }

  const answer = await vscode.window.showInputBox({
    title: t('addSampleTitle'),
    prompt: t('sampleAnswerPrompt'),
    value: ''
  });
  if (answer === undefined) {
    return undefined;
  }

  return { input, answer };
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
  const content = await readSampleFromInputBoxes();
  if (!content) {
    return undefined;
  }

  return addSample(workspaceFolder, config, content.input, content.answer, {
    decodeEscapes: true
  });
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
  const context = await getProblemContext(problemId);
  if (!context) {
    return;
  }

  const sample = fromFiles
    ? await addExternalProblemSampleFromPicker(context.workspaceFolder, context.problem.id)
    : await addManagedProblemSampleFromInput(context.workspaceFolder, context.problem.id);
  if (!sample) {
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(
    fromFiles
      ? t('externalSampleFilesAdded')
      : t('problemSamplesAdded', { sample: sample.name, problem: context.problem.name })
  );
}

async function addManagedProblemSampleFromInput(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<Awaited<ReturnType<typeof addProblemSample>> | undefined> {
  const content = await readSampleFromInputBoxes();
  if (!content) {
    return undefined;
  }

  return addProblemSample(workspaceFolder, problemId, content.input, content.answer, { decodeEscapes: true });
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

async function runProblemSamplesCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider,
  forceProgramPicker: boolean
): Promise<void> {
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

  const sourcePath = forceProgramPicker
    ? await pickProgramForRun(context.workspaceFolder, problem, true)
    : await resolveSourceForRun(context.workspaceFolder, problem);
  if (!sourcePath) {
    return;
  }

  if (!(await exists(sourcePath))) {
    vscode.window.showErrorMessage(t('programMissing'));
    return;
  }

  const document = vscode.workspace.textDocuments.find((entry) => entry.uri.fsPath === sourcePath);
  await document?.save();

  const report = await runAllSamples(context.workspaceFolder, sourcePath, problem, output);
  if (report) {
    await saveProblemReport(context.workspaceFolder, problem.id, report);
  }
  activeProblemId = problem.id;
  sampleTreeProvider.refresh();
  await updateStatusBar(problem.id);
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
  const context = await getProblemContext(problemId);
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
  kind: 'input' | 'answer' | 'output'
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
        : await findExistingUserOutput(context.workspaceFolder, context.sample, context.problem.id);

  if (!filePath) {
    vscode.window.showWarningMessage(t('userOutputMissing'));
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

async function openSampleDiffCommand(problemId: string | undefined, sampleId: number | undefined): Promise<void> {
  const context = await getSampleContext(problemId, sampleId);
  if (!context) {
    return;
  }

  const fileStatus = await getSampleFileStatus(context.workspaceFolder, context.sample);
  if (fileStatus.answerMissing) {
    vscode.window.showWarningMessage(t('expectedOutputMissing'));
    return;
  }

  const outputPath = await findExistingUserOutput(context.workspaceFolder, context.sample, context.problem.id);
  if (!outputPath) {
    vscode.window.showWarningMessage(t('diffUnavailable'));
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.file(fileStatus.answerPath),
    vscode.Uri.file(outputPath),
    t('diffTitle', { sample: context.sample.name })
  );
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
    const result = await deleteProblemSample(target.workspaceFolder, target.problem.id, target.sample.id);
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

  const sample = context.problem.samples.find((entry) => entry.id === sampleId);
  if (!sample) {
    vscode.window.showWarningMessage(t('sampleNotFound'));
    return undefined;
  }

  return { ...context, sample };
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

async function updateStatusBar(problemId: string | undefined = activeProblemId): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    statusBar.text = 'OIjudger';
    return;
  }

  const config = await ensureProblemsConfig(workspaceFolder);
  const problem = problemId
    ? config.problems.find((entry) => entry.id === problemId)
    : config.problems[0];
  if (!problem) {
    statusBar.text = 'OIjudger';
    return;
  }

  activeProblemId = problem.id;
  if (!getDefaultProblemSource(problem)) {
    statusBar.text = `OIjudger: ${problem.name}  ${t('noProgramSet')}`;
    return;
  }

  try {
    const report = JSON.parse(await vscode.workspace.fs.readFile(vscode.Uri.file(getProblemReportPath(workspaceFolder, problem.id))).then((bytes) => new TextDecoder().decode(bytes))) as {
      summary?: { accepted: number; total: number };
    };
    if (report.summary) {
      statusBar.text = `OIjudger: ${problem.name}  ${report.summary.accepted}/${report.summary.total} ${t('statusAC')}`;
      return;
    }
  } catch {
    // Ignore missing or invalid report for the compact status item.
  }

  statusBar.text = `OIjudger: ${problem.name}`;
}
