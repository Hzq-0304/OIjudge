import * as vscode from 'vscode';
import {
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
  openSampleDetail
} from './reportView';
import {
  addProblemFromSource,
  addProblemSample,
  getProblem,
  getProblemSourcePath,
  importLegacyProblem,
  saveProblemReport,
  updateProblemCompiler,
  updateProblemLimits,
  updateProblemStandard
} from './problems';
import { SampleTreeProvider } from './sampleTreeProvider';
import { ProblemConfig } from './types';

const output = vscode.window.createOutputChannel('OIjudger');

type AddSampleMode = 'paste' | 'files';

export function activate(context: vscode.ExtensionContext): void {
  const sampleTreeProvider = new SampleTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('oijudger.samplesView', sampleTreeProvider),
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

      const content = mode === 'paste' ? await readSampleFromInputBoxes() : await readSampleFromFiles();
      if (!content) {
        return;
      }

      const sample = await addSample(workspaceFolder, config, content.input, content.answer, {
        decodeEscapes: mode === 'paste'
      });
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(
        mode === 'files'
          ? t('sampleAddedFromFiles', { sample: sample.name })
          : t('sampleAdded', { sample: sample.name })
      );
    }),
    vscode.commands.registerCommand('oijudger.runAllSamples', async () => {
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
      sampleTreeProvider.refresh();
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
      sampleTreeProvider.refresh();
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
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(t('legacyProblemImported', { problem: problem.name }));
    }),
    vscode.commands.registerCommand('oijudger.addProblemSample', async (problemArg?: unknown) => {
      await addProblemSampleCommand(readProblemId(problemArg), false, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.addProblemSampleFromFiles', async (problemArg?: unknown) => {
      await addProblemSampleCommand(readProblemId(problemArg), true, sampleTreeProvider);
    }),
    vscode.commands.registerCommand('oijudger.runProblemSamples', async (problemArg?: unknown) => {
      await runProblemSamplesCommand(readProblemId(problemArg), sampleTreeProvider);
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

async function readSampleFromFiles(): Promise<{ input: string; answer: string } | undefined> {
  const inputUri = await pickSingleFile(t('selectInputFile'));
  if (!inputUri) {
    return undefined;
  }

  const answerUri = await pickSingleFile(t('selectAnswerFile'));
  if (!answerUri) {
    return undefined;
  }

  try {
    return {
      input: await readTextFile(inputUri),
      answer: await readTextFile(answerUri)
    };
  } catch (error) {
    vscode.window.showErrorMessage(t('failedReadSampleFiles', { error: String(error) }));
    return undefined;
  }
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

async function readTextFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder('utf-8').decode(bytes);
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

async function addProblemSampleCommand(
  problemId: string | undefined,
  fromFiles: boolean,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId);
  if (!context) {
    return;
  }

  const content = fromFiles ? await readSampleFromFiles() : await readSampleFromInputBoxes();
  if (!content) {
    return;
  }

  const sample = await addProblemSample(
    context.workspaceFolder,
    context.problem.id,
    content.input,
    content.answer,
    { decodeEscapes: !fromFiles }
  );
  if (!sample) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return;
  }

  sampleTreeProvider.refresh();
  vscode.window.showInformationMessage(
    fromFiles
      ? t('problemSamplesAddedFromFiles', { sample: sample.name, problem: context.problem.name })
      : t('problemSamplesAdded', { sample: sample.name, problem: context.problem.name })
  );
}

async function runProblemSamplesCommand(
  problemId: string | undefined,
  sampleTreeProvider: SampleTreeProvider
): Promise<void> {
  const context = await getProblemContext(problemId);
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

  const sourcePath = getProblemSourcePath(context.workspaceFolder, problem);
  if (!(await exists(sourcePath))) {
    vscode.window.showErrorMessage(t('sourceMissing', { source: sourcePath }));
    return;
  }

  const document = vscode.workspace.textDocuments.find((entry) => entry.uri.fsPath === sourcePath);
  await document?.save();

  const report = await runAllSamples(context.workspaceFolder, sourcePath, problem, output);
  if (report) {
    await saveProblemReport(context.workspaceFolder, problem.id, report);
  }
  sampleTreeProvider.refresh();
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

async function getProblemContext(problemId: string | undefined): Promise<{
  workspaceFolder: vscode.WorkspaceFolder;
  problem: ProblemConfig;
} | undefined> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder || !problemId) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return undefined;
  }

  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    vscode.window.showWarningMessage(t('problemNotFound'));
    return undefined;
  }

  return { workspaceFolder, problem };
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
