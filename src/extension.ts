import * as vscode from 'vscode';
import {
  addSample,
  clearOutputs,
  ensureConfig,
  exists,
  getReportPath,
  getWorkspaceFolder,
  initProblem,
  isCppFile,
  setMemoryLimit,
  setTimeLimit,
  validatePositiveInteger
} from './config';
import { runAllSamples } from './judge';
import { SampleTreeProvider } from './sampleTreeProvider';

const output = vscode.window.createOutputChannel('OIjudger');

export function activate(context: vscode.ExtensionContext): void {
  const sampleTreeProvider = new SampleTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('oijudgerSamples', sampleTreeProvider),
    vscode.commands.registerCommand('oijudger.initProblem', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      await initProblem(workspaceFolder);
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage('OIjudger problem initialized.');
    }),
    vscode.commands.registerCommand('oijudger.addSample', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      const input = await vscode.window.showInputBox({
        title: 'OIjudger: Add Sample',
        prompt: 'Sample input. Use \\n for new lines.',
        value: ''
      });
      if (input === undefined) {
        return;
      }

      const answer = await vscode.window.showInputBox({
        title: 'OIjudger: Add Sample',
        prompt: 'Standard output. Use \\n for new lines.',
        value: ''
      });
      if (answer === undefined) {
        return;
      }

      const sample = await addSample(workspaceFolder, config, input, answer);
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage(`OIjudger ${sample.name} added.`);
    }),
    vscode.commands.registerCommand('oijudger.runAllSamples', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Open a C++ file before running OIjudger.');
        return;
      }

      const sourceUri = editor.document.uri;
      if (sourceUri.scheme !== 'file' || !isCppFile(sourceUri.fsPath)) {
        vscode.window.showErrorMessage('OIjudger only supports the active C++ file.');
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('The active C++ file must be inside a VSCode workspace.');
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      if (config.samples.length === 0) {
        vscode.window.showWarningMessage('No OIjudger samples found. Add a sample first.');
        return;
      }

      await editor.document.save();
      const report = await runAllSamples(workspaceFolder, sourceUri.fsPath, config, output);
      sampleTreeProvider.refresh();
      if (!report) {
        return;
      }

      if (report.summary.accepted === report.summary.total) {
        vscode.window.showInformationMessage(`OIjudger: all ${report.summary.total} samples accepted.`);
      } else {
        vscode.window.showWarningMessage(
          `OIjudger: ${report.summary.accepted}/${report.summary.total} samples accepted. See output for details.`
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
        title: 'OIjudger: Set Time Limit',
        prompt: 'Time limit in milliseconds',
        value: String(config.limits.timeMs),
        validateInput: validatePositiveInteger
      });
      if (timeMsText === undefined) {
        return;
      }

      await setTimeLimit(workspaceFolder, Number(timeMsText));
      vscode.window.showInformationMessage('OIjudger time limit updated.');
    }),
    vscode.commands.registerCommand('oijudger.setMemoryLimit', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const config = await ensureConfig(workspaceFolder);
      const memoryMbText = await vscode.window.showInputBox({
        title: 'OIjudger: Set Memory Limit',
        prompt: 'Memory limit in MB',
        value: String(config.limits.memoryMb),
        validateInput: validatePositiveInteger
      });
      if (memoryMbText === undefined) {
        return;
      }

      await setMemoryLimit(workspaceFolder, Number(memoryMbText));
      vscode.window.showInformationMessage('OIjudger memory limit updated.');
    }),
    vscode.commands.registerCommand('oijudger.openLastReport', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const reportPath = getReportPath(workspaceFolder);
      if (!(await exists(reportPath))) {
        vscode.window.showWarningMessage('No OIjudger report found. Run all samples first.');
        return;
      }

      const document = await vscode.workspace.openTextDocument(reportPath);
      await vscode.window.showTextDocument(document);
    }),
    vscode.commands.registerCommand('oijudger.clearOutputs', async () => {
      const workspaceFolder = getWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      await clearOutputs(workspaceFolder);
      sampleTreeProvider.refresh();
      vscode.window.showInformationMessage('OIjudger outputs cleared.');
    }),
    output
  );
}

export function deactivate(): void {
  // Nothing to clean up.
}
