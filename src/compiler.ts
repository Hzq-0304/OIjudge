import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { getOITestDir } from './config';
import { t } from './i18n';
import { runProcess } from './runner';
import { CompileResult, OITestConfig, ProcessResult } from './types';

export async function compileSource(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  config: OITestConfig,
  output: vscode.OutputChannel
): Promise<CompileResult | undefined> {
  const problemId = (config as { id?: string }).id;
  const buildDir = problemId
    ? path.join(getOITestDir(workspaceFolder), 'problems', problemId, 'build')
    : path.join(getOITestDir(workspaceFolder), 'build');
  await fs.mkdir(buildDir, { recursive: true });

  const executableName = process.platform === 'win32' ? 'main.exe' : 'main';
  const executablePath = path.join(buildDir, executableName);
  const args = config.compiler.args.map((arg) =>
    arg
      .replace(/\$\{file\}/g, sourcePath)
      .replace(/\$\{output\}/g, executablePath)
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath)
      .replace(/\{source\}/g, sourcePath)
      .replace(/\{exe\}/g, executablePath)
  );

  output.appendLine(`Compile: ${config.compiler.command} ${args.map(quoteArg).join(' ')}`);

  let result: ProcessResult;
  try {
    result = await runProcess(config.compiler.command, args, '', workspaceFolder.uri.fsPath, 60_000);
  } catch (error) {
    output.appendLine(`Compile failed to start: ${String(error)}`);
    vscode.window.showErrorMessage(t('compileStartFailed'));
    return undefined;
  }

  if (result.code !== 0 || result.timedOut) {
    output.appendLine('Compile failed.');
    if (result.stderr.trim()) {
      output.appendLine(result.stderr.trimEnd());
    }
    if (result.stdout.trim()) {
      output.appendLine(result.stdout.trimEnd());
    }
    vscode.window.showErrorMessage(t('compileFailed'));
    return undefined;
  }

  output.appendLine('Compile succeeded.');
  output.appendLine(`Compile time: ${formatMs(result.timeMs)} ms`);
  output.appendLine('');
  return {
    status: 'OK',
    timeMs: result.timeMs,
    executablePath
  };
}

function quoteArg(value: string): string {
  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatMs(value: number): number {
  return Math.round(value);
}
