import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { buildCompileArgs } from './compiler';
import { findCompiler } from './compilerDetection';
import { envPathIncludesDir, getCompilerDir, withCompilerPathEnv } from './compilerRuntime';
import { getOITestDir } from './config';
import { ProcessTracker, runProcess } from './runner';
import { CompileResult, CompileStackReport, FunctionStyleConfig, FunctionStyleReport, OITestConfig, ProcessResult } from './types';

export type ResolvedFunctionStyleConfig = {
  grader: string;
  solution: string;
  sources: string[];
  headers: string[];
  compileArgs: string[];
  report: FunctionStyleReport;
};

export type FunctionStyleValidationResult =
  | { ok: true; config: ResolvedFunctionStyleConfig }
  | { ok: false; message: string };

export async function compileFunctionStyleJudge(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  output: vscode.OutputChannel,
  processTracker?: ProcessTracker
): Promise<CompileResult | undefined> {
  const resolved = await resolveFunctionStyleConfig(workspaceFolder, config.functionStyle);
  const problemId = (config as { id?: string }).id;
  if (!resolved.ok) {
    output.appendLine('Function-style compile failed.');
    output.appendLine(resolved.message);
    return createFunctionStyleCompileError(resolved.message);
  }

  const buildDir = problemId
    ? path.join(getOITestDir(workspaceFolder), 'problems', problemId, 'build')
    : path.join(getOITestDir(workspaceFolder), 'build');
  await fs.mkdir(buildDir, { recursive: true });

  const executableName = process.platform === 'win32' ? 'function-judge.exe' : 'function-judge';
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
  const { args, stack } = buildFunctionStyleCompileArgs(workspaceFolder, compileConfig, resolved.config, executablePath);
  const compilerDir = getCompilerDir(compilerCommand);
  const env = withCompilerPathEnv(compilerCommand);

  output.appendLine('Function-style Judge');
  output.appendLine(`Grader: ${resolved.config.grader}`);
  output.appendLine(`Solution: ${resolved.config.solution}`);
  if (resolved.config.sources.length > 0) {
    output.appendLine(`Extra sources: ${resolved.config.sources.join(', ')}`);
  }
  if (resolved.config.headers.length > 0) {
    output.appendLine(`Headers checked: ${resolved.config.headers.join(', ')}`);
  }
  output.appendLine(`Compiler requested: ${config.compiler.command}`);
  output.appendLine(`Compiler: ${compilerCommand}`);
  if (compiler?.source) {
    output.appendLine(`Compiler source: ${compiler.source}`);
  }
  output.appendLine(`Compiler dir: ${compilerDir ?? 'not an absolute compiler path'}`);
  output.appendLine(`Compiler dir in PATH: ${compilerDir ? (envPathIncludesDir(env, compilerDir) ? 'yes' : 'no') : 'n/a'}`);
  output.appendLine(`Compiler family: ${stack.compilerFamily ?? 'unknown'}`);
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
    output.appendLine('Function-style compile failed to start.');
    output.appendLine(message);
    return {
      status: 'CE',
      mode: 'function',
      functionStyle: resolved.config.report,
      timeMs: 0,
      stack,
      compilerCommand,
      compilerBin: compilerDir,
      stderr: message,
      message: `Function-style compile failed: ${message}`
    };
  }

  if (result.code !== 0 || result.timedOut) {
    const message = result.timedOut
      ? 'Function-style compile timed out.'
      : `Function-style compile failed with code ${result.code ?? 'null'}.`;
    output.appendLine('Function-style compile failed.');
    if (result.stderr.trim()) {
      output.appendLine(result.stderr.trimEnd());
    }
    if (result.stdout.trim()) {
      output.appendLine(result.stdout.trimEnd());
    }
    return {
      status: 'CE',
      mode: 'function',
      functionStyle: resolved.config.report,
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

  output.appendLine('Function-style compile succeeded.');
  output.appendLine(`Compile time: ${Math.round(result.timeMs)} ms`);
  output.appendLine('');
  return {
    status: 'OK',
    mode: 'function',
    functionStyle: resolved.config.report,
    timeMs: result.timeMs,
    stack,
    compilerCommand,
    compilerBin: compilerDir,
    executablePath
  };
}

export async function resolveFunctionStyleConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: FunctionStyleConfig | undefined
): Promise<FunctionStyleValidationResult> {
  if (!config) {
    return { ok: false, message: 'Function-style Judge requires functionStyle.grader and functionStyle.solution.' };
  }
  if (!config.grader) {
    return { ok: false, message: 'Function-style Judge requires functionStyle.grader.' };
  }
  if (!config.solution) {
    return { ok: false, message: 'Function-style Judge requires functionStyle.solution.' };
  }

  const grader = resolveWorkspacePath(workspaceFolder, config.grader);
  const solution = resolveWorkspacePath(workspaceFolder, config.solution);
  const sources = (config.sources ?? []).map((entry) => resolveWorkspacePath(workspaceFolder, entry));
  const headers = (config.headers ?? []).map((entry) => resolveWorkspacePath(workspaceFolder, entry));
  const missing = await collectMissingFiles([
    { label: 'grader', filePath: grader },
    { label: 'solution', filePath: solution },
    ...sources.map((filePath) => ({ label: 'extra source', filePath })),
    ...headers.map((filePath) => ({ label: 'header', filePath }))
  ]);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Function-style Judge missing ${missing[0].label} file: ${missing[0].filePath}`
    };
  }

  return {
    ok: true,
    config: {
      grader,
      solution,
      sources,
      headers,
      compileArgs: config.compileArgs ?? [],
      report: {
        grader: config.grader,
        solution: config.solution,
        sources: config.sources?.length ? [...config.sources] : undefined,
        headers: config.headers?.length ? [...config.headers] : undefined,
        compileArgs: config.compileArgs?.length ? [...config.compileArgs] : undefined
      }
    }
  };
}

export function buildFunctionStyleCompileArgs(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  functionConfig: ResolvedFunctionStyleConfig,
  executablePath: string
): { args: string[]; stack: CompileStackReport } {
  const { args, stack } = buildCompileArgs(workspaceFolder, config, functionConfig.grader, executablePath);
  const compileArgs = functionConfig.compileArgs.map((arg) =>
    arg
      .replace(/\$\{grader\}/g, functionConfig.grader)
      .replace(/\$\{solution\}/g, functionConfig.solution)
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath)
  );
  return {
    args: insertFunctionStyleInputs(args, functionConfig.grader, [functionConfig.solution, ...functionConfig.sources], compileArgs),
    stack
  };
}

export function isFunctionStyleMode(config: Pick<OITestConfig, 'mode'>): boolean {
  return config.mode === 'function';
}

function insertFunctionStyleInputs(
  args: string[],
  grader: string,
  sources: string[],
  compileArgs: string[]
): string[] {
  const nextArgs = [...args];
  const graderIndex = nextArgs.findIndex((arg) => isSamePathArg(arg, grader));
  const insertAt = graderIndex >= 0 ? graderIndex + 1 : nextArgs.length;
  nextArgs.splice(insertAt, 0, ...sources);
  if (compileArgs.length > 0) {
    nextArgs.splice(insertAt + sources.length, 0, ...compileArgs);
  }
  return nextArgs;
}

function resolveWorkspacePath(workspaceFolder: vscode.WorkspaceFolder, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(workspaceFolder.uri.fsPath, filePath);
}

async function collectMissingFiles(files: Array<{ label: string; filePath: string }>): Promise<Array<{ label: string; filePath: string }>> {
  const missing: Array<{ label: string; filePath: string }> = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file.filePath);
      if (!stat.isFile()) {
        missing.push(file);
      }
    } catch {
      missing.push(file);
    }
  }
  return missing;
}

function createFunctionStyleCompileError(message: string): CompileResult {
  return {
    status: 'CE',
    mode: 'function',
    timeMs: 0,
    stdout: '',
    stderr: message,
    message: `Function-style compile failed: ${message}`
  };
}

function isSamePathArg(value: string, expected: string): boolean {
  return process.platform === 'win32'
    ? value.toLowerCase() === expected.toLowerCase()
    : value === expected;
}

function quoteArg(value: string): string {
  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
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
