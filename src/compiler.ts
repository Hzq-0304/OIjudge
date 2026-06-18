import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { getOITestDir } from './config';
import { findCompiler } from './compilerDetection';
import { envPathIncludesDir, getCompilerDir, withCompilerPathEnv } from './compilerRuntime';
import { t } from './i18n';
import { ProcessTracker, runProcess } from './runner';
import { CompileResult, CompileStackReport, OITestConfig, ProcessResult } from './types';

export async function compileSource(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  config: OITestConfig,
  output: vscode.OutputChannel,
  processTracker?: ProcessTracker
): Promise<CompileResult | undefined> {
  const problemId = (config as { id?: string }).id;
  const buildDir = problemId
    ? path.join(getOITestDir(workspaceFolder), 'problems', problemId, 'build')
    : path.join(getOITestDir(workspaceFolder), 'build');
  await fs.mkdir(buildDir, { recursive: true });

  const executableName = process.platform === 'win32' ? 'main.exe' : 'main';
  const executablePath = path.join(buildDir, executableName);
  const compiler = await findCompiler(workspaceFolder, config);
  const compilerCommand = compiler?.command ?? config.compiler.command;
  const compileConfig: OITestConfig = {
    ...config,
    compiler: {
      ...config.compiler,
      command: compilerCommand
    }
  };
  const { args, stack } = buildCompileArgs(workspaceFolder, compileConfig, sourcePath, executablePath);
  const compilerDir = getCompilerDir(compilerCommand);
  const env = withCompilerPathEnv(compilerCommand);

  output.appendLine(`Source: ${sourcePath}`);
  output.appendLine(`Compiler requested: ${config.compiler.command}`);
  output.appendLine(`Compiler: ${compilerCommand}`);
  if (compiler?.source) {
    output.appendLine(`Compiler source: ${compiler.source}`);
  }
  output.appendLine(`Compiler dir: ${compilerDir ?? 'not an absolute compiler path'}`);
  output.appendLine(`Compiler dir in PATH: ${compilerDir ? (envPathIncludesDir(env, compilerDir) ? 'yes' : 'no') : 'n/a'}`);
  output.appendLine(`Compiler family: ${stack.compilerFamily ?? 'unknown'}`);
  output.appendLine(`Compiler kind: ${formatCompilerKind(stack.compilerFamily)}`);
  output.appendLine(`Memory limit: ${config.limits.memoryMb} MB`);
  output.appendLine(`Auto stack size: ${stack.enabled ? 'enabled' : 'disabled'}`);
  if (stack.enabled) {
    output.appendLine(`Stack size: ${stack.sizeMb} MB`);
    output.appendLine(`Stack linker flag: ${stack.flag ?? 'none'}`);
  }
  if (stack.unsupported) {
    output.appendLine(`Auto stack size: unsupported for compiler family: ${stack.compilerFamily ?? 'unknown'}`);
  }
  output.appendLine(`Final compile args: ${args.map(quoteArg).join(' ')}`);
  output.appendLine(`Compile cwd: ${workspaceFolder.uri.fsPath}`);
  output.appendLine(`Compile: ${compilerCommand} ${args.map(quoteArg).join(' ')}`);

  let result: ProcessResult;
  try {
    result = await runProcess(compilerCommand, args, '', workspaceFolder.uri.fsPath, 60_000, env, 60_000, undefined, undefined, processTracker);
  } catch (error) {
    const message = formatSpawnError(error);
    output.appendLine('Compile failed to start.');
    output.appendLine(`Compiler: ${compilerCommand}`);
    output.appendLine(`cwd: ${workspaceFolder.uri.fsPath}`);
    output.appendLine(`args: ${args.map(quoteArg).join(' ')}`);
    output.appendLine(message);
    vscode.window.showErrorMessage(t('compileStartFailed'));
    return {
      status: 'CE',
      timeMs: 0,
      stack,
      compilerCommand,
      compilerBin: compilerDir,
      stderr: message,
      message
    };
  }

  if (result.code !== 0 || result.timedOut) {
    const message = result.timedOut
      ? 'Compile timed out.'
      : `Compile failed with code ${result.code ?? 'null'}.`;
    output.appendLine('Compile failed.');
    if (result.stderr.trim()) {
      output.appendLine(result.stderr.trimEnd());
    }
    if (result.stdout.trim()) {
      output.appendLine(result.stdout.trimEnd());
    }
    vscode.window.showErrorMessage(t('compileFailed'));
    return {
      status: 'CE',
      timeMs: result.timeMs,
      stack,
      compilerCommand,
      compilerBin: compilerDir,
      stdout: result.stdout,
      stderr: result.stderr,
      message,
      exitCode: result.code,
      timedOut: result.timedOut
    };
  }

  output.appendLine('Compile succeeded.');
  output.appendLine(`Compile time: ${formatMs(result.timeMs)} ms`);
  output.appendLine('');
  return {
    status: 'OK',
    timeMs: result.timeMs,
    stack,
    compilerCommand,
    compilerBin: compilerDir,
    executablePath
  };
}

export function buildCompileArgs(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  sourcePath: string,
  executablePath: string
): { args: string[]; stack: CompileStackReport } {
  const stack = getCompileStackReport(config.compiler.command, config);
  const baseArgs = config.compiler.args.map((arg) =>
    arg
      .replace(/\$\{file\}/g, sourcePath)
      .replace(/\$\{output\}/g, executablePath)
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath)
      .replace(/\{source\}/g, sourcePath)
      .replace(/\{exe\}/g, executablePath)
  );
  const compilerFamily = stack.compilerFamily;
  const compilerArgs = compilerFamily === 'msvc'
    ? buildMsvcCompileArgs(baseArgs, sourcePath, executablePath)
    : baseArgs;

  if (!stack.enabled) {
    return { args: compilerArgs, stack };
  }

  const args = removeStackArgs(compilerArgs);
  if (stack.flag) {
    args.push(stack.flag);
  }
  return { args, stack };
}

function getCompileStackReport(command: string, config: OITestConfig): CompileStackReport {
  const compilerFamily = detectCompilerFamily(command);
  const stackConfig = {
    auto: config.stack?.auto ?? true,
    sizeMb: config.stack?.sizeMb ?? null
  };

  if (!stackConfig.auto) {
    return { enabled: false, compilerFamily };
  }

  const sizeMb = stackConfig.sizeMb ?? config.limits.memoryMb;
  const sizeBytes = sizeMb * 1024 * 1024;
  if (process.platform !== 'win32') {
    return { enabled: false, sizeMb, sizeBytes, compilerFamily, unsupported: true };
  }

  if (compilerFamily === 'gcc' || compilerFamily === 'clang') {
    const flag = `-Wl,--stack,${sizeBytes}`;
    return { enabled: true, sizeMb, sizeBytes, flag, compilerFamily };
  }

  return { enabled: false, sizeMb, sizeBytes, compilerFamily, unsupported: compilerFamily === 'msvc' };
}

function buildMsvcCompileArgs(args: string[], sourcePath: string, executablePath: string): string[] {
  const nextArgs: string[] = [];
  let outputArg: string | undefined;
  let hasStandard = false;
  let hasExceptionHandling = false;
  let hasOptimization = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === sourcePath) {
      continue;
    }
    if (arg === executablePath) {
      continue;
    }
    if (arg === '-o') {
      if (args[index + 1] === executablePath) {
        index += 1;
      }
      outputArg ??= `/Fe:${executablePath}`;
      continue;
    }
    if (arg.startsWith('-std=')) {
      const standard = arg.slice('-std='.length);
      if (!hasStandard) {
        nextArgs.push(`/std:${standard}`);
        hasStandard = true;
      }
      continue;
    }
    if (arg === '-O2') {
      if (!hasOptimization) {
        nextArgs.push('/O2');
        hasOptimization = true;
      }
      continue;
    }
    if (arg === '-pipe' || arg === '-Wall' || arg === '-s') {
      continue;
    }
    if (/^\/std:/iu.test(arg)) {
      hasStandard = true;
    }
    if (/^\/EH/iu.test(arg)) {
      hasExceptionHandling = true;
    }
    if (/^\/O[12xdis]/iu.test(arg)) {
      hasOptimization = true;
    }
    if (/^\/Fe[:]?/iu.test(arg)) {
      outputArg = arg;
      continue;
    }
    nextArgs.push(arg);
  }

  if (!hasStandard) {
    nextArgs.unshift('/std:c++17');
  }
  if (!hasExceptionHandling) {
    const standardIndex = nextArgs.findIndex((arg) => /^\/std:/iu.test(arg));
    nextArgs.splice(standardIndex >= 0 ? standardIndex + 1 : 0, 0, '/EHsc');
  }
  nextArgs.push(sourcePath);
  nextArgs.push(outputArg ?? `/Fe:${executablePath}`);

  return nextArgs;
}

function detectCompilerFamily(command: string): string {
  const name = path.basename(command).toLowerCase();
  if (name === 'cl.exe' || name === 'cl' || name === 'clang-cl.exe' || name === 'clang-cl') {
    return 'msvc';
  }
  if (name.includes('clang')) {
    return 'clang';
  }
  if (name.includes('g++') || name.includes('gcc') || name.includes('mingw')) {
    return 'gcc';
  }
  return 'unknown';
}

function formatCompilerKind(compilerFamily: string | undefined): string {
  if (compilerFamily === 'msvc') {
    return 'msvc';
  }
  if (compilerFamily === 'gcc' || compilerFamily === 'clang') {
    return 'gcc-like';
  }
  return 'unknown';
}

function removeStackArgs(args: string[]): string[] {
  const nextArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (/^-Wl,--stack(?:[=,]\d+)?$/u.test(arg)) {
      if (arg === '-Wl,--stack' && /^\d+$/u.test(args[index + 1] ?? '')) {
        index += 1;
      }
      continue;
    }
    nextArgs.push(arg);
  }
  return nextArgs;
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

function formatSpawnError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = error as NodeJS.ErrnoException;
  return [
    `message: ${error.message}`,
    details.code ? `code: ${details.code}` : undefined,
    details.errno !== undefined ? `errno: ${details.errno}` : undefined,
    details.path ? `path: ${details.path}` : undefined,
    details.syscall ? `syscall: ${details.syscall}` : undefined
  ].filter(Boolean).join('\n');
}
