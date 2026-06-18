import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { withCompilerPathEnv } from './compilerRuntime';
import { getNativeRunnerUnavailableReason, isNativeRunnerPlatform, runNativeProcess } from './nativeRunner';
import { killProcessTree } from './stressRunController';
import { OITestConfig } from './types';

export type EnvironmentCheckStatus = 'pass' | 'warn' | 'fail' | 'info';
export type EnvironmentCheckOverallStatus = 'pass' | 'warn' | 'fail';

export interface EnvironmentCheckItem {
  id: string;
  title: string;
  status: EnvironmentCheckStatus;
  summary: string;
  details?: string;
  suggestion?: string;
  durationMs?: number;
}

export interface EnvironmentCheckReport {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  vscodeVersion?: string;
  extensionVersion?: string;
  startedAt: string;
  finishedAt: string;
  overallStatus: EnvironmentCheckOverallStatus;
  items: EnvironmentCheckItem[];
}

export type CompilerDiscoveryResult = {
  command: string;
  versionLine: string;
};

export type EnvironmentCheckOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  nodeVersion?: string;
  vscodeVersion?: string;
  extensionVersion?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
  configuredCompiler?: string;
  output?: Pick<vscode.OutputChannel, 'appendLine'>;
  compilerCandidates?: string[];
  runNativeRunner?: typeof runNativeProcess;
  killProcess?: (child: ChildProcess) => void | Promise<void>;
  discoverCompiler?: typeof discoverCompiler;
  compileCpp?: typeof compileCpp;
  runCompiledProbe?: typeof runCompiledProbe;
};

type ProcessRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  timeMs: number;
};

type CheckContext = {
  platform: NodeJS.Platform;
  tempRoot?: string;
  compiler?: CompilerDiscoveryResult;
  helloExe?: string;
};

export const ENVIRONMENT_CHECK_RUN_TIMEOUT_MS = 5000;
export const ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS = 15_000;
const STOP_CHECK_TIMEOUT_MS = 4000;

export async function runEnvironmentCheck(options: EnvironmentCheckOptions = {}): Promise<EnvironmentCheckReport> {
  const platform = options.platform ?? process.platform;
  const startedAt = new Date().toISOString();
  const items: EnvironmentCheckItem[] = [];
  const context: CheckContext = { platform };

  const append = (line: string) => options.output?.appendLine(line);
  append('OI Judge Environment Check started.');

  await runCheck(items, 'platform', 'Platform information', async () => ({
    status: 'info',
    summary: `${platform} ${options.arch ?? process.arch}`,
    details: [
      `Platform: ${platform}`,
      `Arch: ${options.arch ?? process.arch}`,
      `Node: ${options.nodeVersion ?? process.version}`,
      options.vscodeVersion ? `VS Code: ${options.vscodeVersion}` : undefined,
      options.extensionVersion ? `Extension: ${options.extensionVersion}` : undefined
    ].filter(Boolean).join('\n')
  }));

  await runCheck(items, 'temp-directory', 'Temp directory writable', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'OI Judge Environment Check '));
    context.tempRoot = tempRoot;
    const probePath = path.join(tempRoot, 'write read delete.txt');
    await fs.writeFile(probePath, 'ok', 'utf8');
    const content = await fs.readFile(probePath, 'utf8');
    await fs.rm(probePath, { force: true });
    if (content !== 'ok') {
      return {
        status: 'fail',
        summary: 'Temp file content mismatch.',
        details: `Read back: ${content}`
      };
    }
    return {
      status: 'pass',
      summary: 'Temporary directory with spaces is writable.',
      details: tempRoot
    };
  });

  await runCheck(items, 'compiler', 'Compiler discovery', async () => {
    const findCompiler = options.discoverCompiler ?? discoverCompiler;
    const compiler = await findCompiler({
      platform,
      configuredCompiler: options.configuredCompiler,
      candidates: options.compilerCandidates
    });
    if (!compiler) {
      return {
        status: 'fail',
        summary: preferredCompilerMissingSummary(platform),
        suggestion: compilerInstallSuggestion(platform)
      };
    }
    context.compiler = compiler;
    return {
      status: 'pass',
      summary: `Found ${compiler.command}`,
      details: compiler.versionLine
    };
  });

  await runDependentCheck(items, context, 'cpp17-compile', 'C++17 compile', async () => {
    const sourcePath = path.join(context.tempRoot!, 'hello.cpp');
    const exePath = executablePath(path.join(context.tempRoot!, 'hello'), platform);
    await fs.writeFile(sourcePath, helloSource(), 'utf8');
    const compile = options.compileCpp ?? compileCpp;
    const result = await compile(context.compiler!.command, sourcePath, exePath, context.tempRoot!);
    if (result.code !== 0 || !(await exists(exePath))) {
      return {
        status: 'fail',
        summary: `Compiler exited with code ${formatExitCode(result.code)}.`,
        details: compileFailureDetails(
          context.compiler!.command,
          buildCompileArgs(sourcePath, exePath),
          context.tempRoot!,
          sourcePath,
          exePath,
          result
        )
      };
    }
    context.helloExe = exePath;
    return {
      status: 'pass',
      summary: 'C++17 source compiled successfully.',
      details: buildCompileArgs(sourcePath, exePath).join('\n')
    };
  });

  await runDependentCheck(items, context, 'run-executable', 'Run executable', async () => {
    if (!context.helloExe) {
      return {
        status: 'warn',
        summary: 'Skipped because C++17 compile failed.',
        suggestion: 'Fix C++17 compile first.'
      };
    }
    const runProbe = options.runCompiledProbe ?? runCompiledProbe;
    const result = await runProbe(context, context.helloExe!, '', context.tempRoot!);
    const stdout = normalizeStdout(result.stdout);
    if (result.code !== 0 || stdout !== '6') {
      return {
        status: 'fail',
        summary: `Expected stdout 6, got ${JSON.stringify(stdout)}.`,
        details: processDetails(result)
      };
    }
    return {
      status: 'pass',
      summary: 'Executable ran and printed 6.',
      details: processDetails(result)
    };
  });

  await runDependentCheck(items, context, 'stdin-stdout', 'stdin/stdout', async () => {
    const exePath = await compileFixture(context, 'echo_sum.cpp', echoSumSource());
    const result = await runCompiledProbe(context, exePath, '123 456\n', context.tempRoot!);
    const stdout = normalizeStdout(result.stdout);
    if (result.code !== 0 || stdout !== '579') {
      return {
        status: 'fail',
        summary: `Expected stdout 579, got ${JSON.stringify(stdout)}.`,
        details: processDetails(result)
      };
    }
    return {
      status: 'pass',
      summary: 'stdin was passed and stdout was captured correctly.',
      details: processDetails(result)
    };
  });

  await runDependentCheck(items, context, 'file-io', 'File IO', async () => {
    const fileIoDir = path.join(context.tempRoot!, 'file io cwd');
    await fs.mkdir(fileIoDir, { recursive: true });
    const exePath = await compileFixture(context, 'file_io.cpp', fileIoSource());
    await fs.writeFile(path.join(fileIoDir, 'input.txt'), '10 20\n', 'utf8');
    const result = await runCompiledProbe(context, exePath, '', fileIoDir);
    const outputPath = path.join(fileIoDir, 'output.txt');
    const output = (await readTextIfExists(outputPath)).trim();
    if (result.code !== 0 || output !== '30') {
      return {
        status: 'fail',
        summary: `Expected output.txt = 30, got ${JSON.stringify(output)}.`,
        details: processDetails(result)
      };
    }
    return {
      status: 'pass',
      summary: 'Program read input.txt and wrote output.txt from a cwd with spaces.',
      details: `output.txt: ${output}`
    };
  });

  await runDependentCheck(items, context, 'native-runner', 'Native runner', async () => {
    if (!isNativeRunnerPlatform(platform)) {
      return {
        status: 'warn',
        summary: `Native runner is not supported on ${platform}.`,
        details: 'memorySupported: false'
      };
    }
    const runNative = options.runNativeRunner ?? runNativeProcess;
    if (!context.helloExe) {
      return {
        status: 'warn',
        summary: 'Skipped because C++17 compile failed.',
        suggestion: 'Fix C++17 compile first.'
      };
    }
    const workspaceFolder = makeWorkspaceFolder(context.tempRoot!);
    const config = makeNativeRunnerConfig(context.compiler!.command);
    const result = await runNative({
      workspaceFolder,
      config,
      command: context.helloExe!,
      args: [],
      stdin: '',
      cwd: context.tempRoot!,
      timeoutMs: ENVIRONMENT_CHECK_RUN_TIMEOUT_MS
    });
    if (!result) {
      return {
        status: 'warn',
        summary: 'Native runner is unavailable.',
        details: getNativeRunnerUnavailableReason() ?? 'No runner details available.',
        suggestion: 'Samples can still run without memory measurement, but native runner diagnostics are unavailable.'
      };
    }
    const timeOk = Number.isFinite(result.timeMs) && result.timeMs >= 0;
    const memoryBytes = result.memoryBytes;
    const memorySupported = memoryBytes !== undefined;
    const memoryOk = !memorySupported || (Number.isFinite(memoryBytes) && memoryBytes >= 0);
    if (!timeOk || !memoryOk) {
      return {
        status: 'warn',
        summary: 'Native runner returned suspicious timing or memory data.',
        details: `timeMs: ${result.timeMs}\nmemorySupported: ${memorySupported}\nmemoryBytes: ${result.memoryBytes ?? 'unsupported'}`
      };
    }
    return {
      status: 'pass',
      summary: 'Native runner executed the probe program.',
      details: [
        `exitCode: ${formatExitCode(result.code)}`,
        `timeMs: ${result.timeMs}`,
        `memorySupported: ${memorySupported}`,
        `memoryBytes: ${memoryBytes ?? 'unsupported'}`,
        `stdout: ${normalizeStdout(result.stdout)}`
      ].join('\n')
    };
  });

  await runDependentCheck(items, context, 'time-memory', 'Time and memory sanity', async () => {
    const nativeItem = items.find((item) => item.id === 'native-runner');
    if (!nativeItem || nativeItem.status === 'fail') {
      return {
        status: 'warn',
        summary: 'Native runner metrics were not available for sanity checks.',
        details: 'Time measurement: unavailable\nMemory measurement: unsupported'
      };
    }
    return {
      status: nativeItem.status === 'pass' ? 'pass' : 'warn',
      summary: nativeItem.status === 'pass'
        ? 'Timing is non-negative; memory is non-negative or explicitly unsupported.'
        : 'Metrics are partially unavailable.',
      details: nativeItem.details
    };
  });

  await runDependentCheck(items, context, 'stop-process', 'Stop process support', async () => {
    const exePath = await compileFixture(context, 'sleep_probe.cpp', sleepProbeSource());
    const stopped = await runStopProcessProbe(
      exePath,
      context.tempRoot!,
      options.killProcess ?? killEnvironmentCheckProcessTree,
      withCompilerPathEnv(context.compiler!.command)
    );
    if (!stopped) {
      return {
        status: 'fail',
        summary: 'Probe process did not stop within the timeout.',
        suggestion: 'Check whether the OS allows OI Judge to terminate child processes.'
      };
    }
    return {
      status: 'pass',
      summary: 'A long-running child process was stopped successfully.'
    };
  });

  if (context.tempRoot) {
    try {
      await fs.rm(context.tempRoot, { recursive: true, force: true });
    } catch (error) {
      items.push({
        id: 'cleanup',
        title: 'Cleanup',
        status: 'warn',
        summary: 'Failed to clean up the environment check temp directory.',
        details: formatError(error),
        suggestion: `Remove manually if needed: ${context.tempRoot}`
      });
    }
  }

  const report: EnvironmentCheckReport = {
    platform,
    arch: options.arch ?? process.arch,
    nodeVersion: options.nodeVersion ?? process.version,
    vscodeVersion: options.vscodeVersion,
    extensionVersion: options.extensionVersion,
    startedAt,
    finishedAt: new Date().toISOString(),
    overallStatus: calculateEnvironmentOverallStatus(items),
    items
  };
  append(formatEnvironmentCheckReport(report));
  append('OI Judge Environment Check finished.');
  return report;
}

export async function discoverCompiler(input: {
  platform?: NodeJS.Platform;
  configuredCompiler?: string;
  candidates?: string[];
} = {}): Promise<CompilerDiscoveryResult | undefined> {
  const platform = input.platform ?? process.platform;
  const candidates = input.candidates ?? getCompilerCandidates(platform, input.configuredCompiler);
  const seen = new Set<string>();
  for (const candidate of candidates.map((entry) => entry.trim()).filter(Boolean)) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      const result = await runProcessWithTimeout(candidate, ['--version'], '', process.cwd(), ENVIRONMENT_CHECK_RUN_TIMEOUT_MS, withCompilerPathEnv(candidate));
      if (result.code === 0) {
        return {
          command: candidate,
          versionLine: firstLine(result.stdout || result.stderr) || candidate
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

export function getCompilerCandidates(platform: NodeJS.Platform, configuredCompiler?: string): string[] {
  const pathCandidates = platform === 'darwin' ? ['clang++', 'g++'] : ['g++', 'clang++'];
  return [configuredCompiler, ...pathCandidates].filter((entry): entry is string => Boolean(entry));
}

export function calculateEnvironmentOverallStatus(items: readonly EnvironmentCheckItem[]): EnvironmentCheckOverallStatus {
  if (items.some((item) => item.status === 'fail')) {
    return 'fail';
  }
  if (items.some((item) => item.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
}

export function formatEnvironmentCheckReport(report: EnvironmentCheckReport): string {
  const lines = [
    'OI Judge Environment Check',
    `Overall: ${report.overallStatus.toUpperCase()}`,
    `Platform: ${report.platform} ${report.arch}`,
    `Node: ${report.nodeVersion}`,
    report.vscodeVersion ? `VS Code: ${report.vscodeVersion}` : undefined,
    report.extensionVersion ? `Extension: ${report.extensionVersion}` : undefined,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    ''
  ].filter((line): line is string => line !== undefined);

  for (const item of report.items) {
    lines.push(`[${item.status.toUpperCase()}] ${item.title} - ${item.summary}`);
    if (item.durationMs !== undefined) {
      lines.push(`Duration: ${Math.round(item.durationMs)}ms`);
    }
    if (item.details) {
      lines.push(truncateText(item.details));
    }
    if (item.suggestion) {
      lines.push(`Suggestion: ${item.suggestion}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function truncateText(value: string, maxLines = 20, maxChars = 4000): string {
  const normalized = value.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const truncatedLines = lines.length > maxLines
    ? `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length - maxLines} more lines truncated)`
    : normalized;
  return truncatedLines.length > maxChars
    ? `${truncatedLines.slice(0, maxChars)}\n... (truncated)`
    : truncatedLines;
}

export function executablePath(basePath: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' && !basePath.toLowerCase().endsWith('.exe') ? `${basePath}.exe` : basePath;
}

export function buildCompileArgs(sourcePath: string, exePath: string): string[] {
  return ['-std=c++17', sourcePath, '-o', exePath];
}

async function runCheck(
  items: EnvironmentCheckItem[],
  id: string,
  title: string,
  check: () => Promise<Omit<EnvironmentCheckItem, 'id' | 'title' | 'durationMs'>>
): Promise<void> {
  const started = process.hrtime.bigint();
  try {
    const item = await check();
    items.push({
      id,
      title,
      durationMs: elapsedMs(started),
      ...item
    });
  } catch (error) {
    items.push({
      id,
      title,
      status: 'fail',
      summary: 'Check failed unexpectedly.',
      details: formatError(error),
      durationMs: elapsedMs(started)
    });
  }
}

async function runDependentCheck(
  items: EnvironmentCheckItem[],
  context: CheckContext,
  id: string,
  title: string,
  check: () => Promise<Omit<EnvironmentCheckItem, 'id' | 'title' | 'durationMs'>>
): Promise<void> {
  if (!context.tempRoot) {
    items.push({
      id,
      title,
      status: 'warn',
      summary: 'Skipped because the temporary directory check failed.'
    });
    return;
  }
  if (!context.compiler) {
    items.push({
      id,
      title,
      status: 'warn',
      summary: 'Skipped because no C++ compiler was found.'
    });
    return;
  }
  await runCheck(items, id, title, check);
}

async function compileFixture(context: CheckContext, fileName: string, source: string): Promise<string> {
  const sourcePath = path.join(context.tempRoot!, fileName);
  const exePath = executablePath(path.join(context.tempRoot!, path.basename(fileName, '.cpp')), context.platform);
  await fs.writeFile(sourcePath, source, 'utf8');
  const result = await compileCpp(context.compiler!.command, sourcePath, exePath, context.tempRoot!);
  if (result.code !== 0) {
    throw new Error(`Compilation failed for ${fileName}: ${truncateText(result.stderr || result.stdout)}`);
  }
  return exePath;
}

async function compileCpp(compiler: string, sourcePath: string, exePath: string, cwd: string): Promise<ProcessRunResult> {
  return runProcessWithTimeout(
    compiler,
    buildCompileArgs(sourcePath, exePath),
    '',
    cwd,
    ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS,
    withCompilerPathEnv(compiler)
  );
}

function runCompiledProbe(context: CheckContext, command: string, input: string, cwd: string): Promise<ProcessRunResult> {
  return runProcessWithTimeout(
    command,
    [],
    input,
    cwd,
    ENVIRONMENT_CHECK_RUN_TIMEOUT_MS,
    withCompilerPathEnv(context.compiler!.command)
  );
}

function runProcessWithTimeout(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code,
        signal,
        timedOut,
        timeMs: elapsedMs(started)
      });
    });
    child.stdin.end(input);
  });
}

async function runStopProcessProbe(
  command: string,
  cwd: string,
  killProcess: (child: ChildProcess) => void | Promise<void>,
  env?: NodeJS.ProcessEnv
): Promise<boolean> {
  const child = spawn(command, [], { cwd, env, shell: false, windowsHide: true });
  let closed = false;
  let stdout = '';
  const closePromise = new Promise<void>((resolve) => {
    child.on('close', () => {
      closed = true;
      resolve();
    });
    child.on('error', () => {
      closed = true;
      resolve();
    });
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  try {
    await waitUntil(() => stdout.includes('started') || closed, 2000);
    await killProcess(child);
    await promiseWithTimeout(closePromise, STOP_CHECK_TIMEOUT_MS);
    return closed;
  } finally {
    if (!closed) {
      await killProcess(child);
      child.kill('SIGKILL');
      await promiseWithTimeout(closePromise, 1000).catch(() => undefined);
    }
  }
}

export const environmentCheckTestHooks = {
  discoverCompiler,
  compileCpp,
  runCompiledProbe,
  runStopProcessProbe
};

async function killEnvironmentCheckProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }

  if (process.platform !== 'win32') {
    killProcessTree(child);
    return;
  }

  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => {
      child.kill('SIGKILL');
      resolve();
    });
    killer.on('close', () => resolve());
  });
}

function makeNativeRunnerConfig(compiler: string): OITestConfig {
  return {
    version: 1,
    compiler: { command: compiler, args: [] },
    limits: { timeMs: ENVIRONMENT_CHECK_RUN_TIMEOUT_MS, memoryMb: 256 },
    samples: []
  };
}

function makeWorkspaceFolder(tempRoot: string): vscode.WorkspaceFolder {
  return {
    uri: { fsPath: tempRoot, scheme: 'file' } as vscode.Uri,
    name: 'OI Judge Environment Check',
    index: 0
  };
}

function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (predicate() || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 25);
  });
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function preferredCompilerMissingSummary(platform: NodeJS.Platform): string {
  return platform === 'darwin'
    ? 'clang++ / g++ was not found.'
    : 'g++ was not found.';
}

function compilerInstallSuggestion(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'Install MinGW-w64 and add its bin directory to PATH.';
  }
  if (platform === 'darwin') {
    return 'Install Xcode Command Line Tools: xcode-select --install.';
  }
  return 'Install g++ with your system package manager.';
}

function processDetails(result: ProcessRunResult): string {
  return [
    `exitCode: ${formatExitCode(result.code)}`,
    `signal: ${result.signal ?? ''}`,
    `timedOut: ${result.timedOut}`,
    `timeMs: ${result.timeMs}`,
    `stdout: ${truncateText(result.stdout)}`,
    `stderr: ${truncateText(result.stderr)}`
  ].join('\n');
}

function compileFailureDetails(
  compiler: string,
  args: string[],
  cwd: string,
  sourcePath: string,
  exePath: string,
  result: ProcessRunResult
): string {
  return [
    `compiler: ${compiler}`,
    `args: ${args.map(quoteArg).join(' ')}`,
    `cwd: ${cwd}`,
    `source: ${sourcePath}`,
    `output: ${exePath}`,
    `exitCode: ${formatExitCode(result.code)}`,
    `signal: ${result.signal ?? ''}`,
    `timedOut: ${result.timedOut}`,
    `timeMs: ${result.timeMs}`,
    `stdout: ${truncateText(result.stdout)}`,
    `stderr: ${truncateText(result.stderr)}`
  ].join('\n');
}

function quoteArg(value: string): string {
  return /\s/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function normalizeStdout(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function firstLine(value: string): string {
  return value.replace(/\r\n/g, '\n').split('\n')[0]?.trim() ?? '';
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatExitCode(code: number | null): string {
  return code === null ? 'null' : String(code);
}

function helloSource(): string {
  return [
    '#include <iostream>',
    '#include <vector>',
    '#include <numeric>',
    '',
    'int main() {',
    '    std::vector<int> a{1, 2, 3};',
    '    std::cout << std::accumulate(a.begin(), a.end(), 0) << "\\n";',
    '    return 0;',
    '}',
    ''
  ].join('\n');
}

function echoSumSource(): string {
  return [
    '#include <iostream>',
    '',
    'int main() {',
    '    long long a, b;',
    '    if (!(std::cin >> a >> b)) return 1;',
    '    std::cout << (a + b) << "\\n";',
    '    return 0;',
    '}',
    ''
  ].join('\n');
}

function fileIoSource(): string {
  return [
    '#include <fstream>',
    '',
    'int main() {',
    '    std::ifstream fin("input.txt");',
    '    std::ofstream fout("output.txt");',
    '    long long a, b;',
    '    fin >> a >> b;',
    '    fout << (a + b) << "\\n";',
    '    return 0;',
    '}',
    ''
  ].join('\n');
}

function sleepProbeSource(): string {
  return [
    '#include <chrono>',
    '#include <thread>',
    '#include <iostream>',
    '',
    'int main() {',
    '    std::cout << "started" << std::endl;',
    '    std::this_thread::sleep_for(std::chrono::seconds(30));',
    '    return 0;',
    '}',
    ''
  ].join('\n');
}
