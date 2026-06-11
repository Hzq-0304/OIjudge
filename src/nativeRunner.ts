import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { getOITestDir } from './config';
import { findCompiler } from './compilerDetection';
import { withCompilerPathEnv } from './compilerRuntime';
import { OITestConfig, ProcessResult } from './types';

type NativeRunResult = {
  exitCode?: number | null;
  timedOut?: boolean;
  timeMs?: number;
  memoryBytes?: number;
  stdoutError?: string;
  stderrError?: string;
  message?: string;
};

let helperUnavailableReason: string | undefined;
let loggedUnavailableReason: string | undefined;

export async function runNativeProcess(input: {
  workspaceFolder: vscode.WorkspaceFolder;
  config: OITestConfig;
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  output?: vscode.OutputChannel;
}): Promise<ProcessResult | undefined> {
  if (process.platform !== 'win32') {
    return undefined;
  }

  let helperPath: string | undefined;
  try {
    helperPath = await ensureNativeRunnerHelper(input.workspaceFolder, input.config, input.output);
    if (!helperPath) {
      logNativeRunnerUnavailable(input.output);
      return undefined;
    }
  } catch (error) {
    helperUnavailableReason = formatError(error);
    logNativeRunnerUnavailable(input.output);
    return undefined;
  }

  const tempDir = path.join(getOITestDir(input.workspaceFolder), 'runner-temp');
  await fs.mkdir(tempDir, { recursive: true });
  const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stdinPath = path.join(tempDir, `${runId}.in`);
  const stdoutPath = path.join(tempDir, `${runId}.out`);
  const stderrPath = path.join(tempDir, `${runId}.err`);
  await fs.writeFile(stdinPath, input.stdin, 'utf8');

  try {
    const helperResult = await runHelper(helperPath, [
      '--exe', input.command,
      '--cwd', input.cwd,
      '--stdin', stdinPath,
      '--stdout', stdoutPath,
      '--stderr', stderrPath,
      '--time-limit-ms', String(input.timeoutMs),
      '--memory-limit-mib', String(input.config.limits.memoryMb),
      ...input.args.flatMap((arg) => ['--arg', arg])
    ], input.cwd, input.env);
    if (helperResult.code !== 0) {
      helperUnavailableReason = helperResult.stderr.trim() || helperResult.stdout.trim() || `helper exited with code ${helperResult.code ?? 'null'}`;
      logNativeRunnerUnavailable(input.output);
      return undefined;
    }
    const stdout = await readTextIfExists(stdoutPath);
    const stderr = await readTextIfExists(stderrPath);
    const parsed = parseNativeRunResult(helperResult.stdout);
    if (!parsed) {
      helperUnavailableReason = `invalid helper output${helperResult.stderr.trim() ? `: ${helperResult.stderr.trim()}` : ''}`;
      logNativeRunnerUnavailable(input.output);
      return undefined;
    }

    const timeMs = validTimeMs(parsed.timeMs);
    const memoryBytes = validMemoryBytes(parsed.memoryBytes);
    return {
      stdout,
      stderr,
      code: parsed.timedOut ? null : parsed.exitCode ?? null,
      signal: null,
      timedOut: Boolean(parsed.timedOut),
      killedByTimeout: Boolean(parsed.timedOut),
      timeMs,
      elapsedMs: Math.round(timeMs),
      memoryBytes,
      memoryKiB: memoryBytes === undefined ? undefined : Math.ceil(memoryBytes / 1024),
      stdoutError: parsed.stdoutError,
      stderrError: parsed.stderrError
    };
  } catch (error) {
    helperUnavailableReason = formatError(error);
    logNativeRunnerUnavailable(input.output);
    return undefined;
  } finally {
    await Promise.all([
      fs.rm(stdinPath, { force: true }),
      fs.rm(stdoutPath, { force: true }),
      fs.rm(stderrPath, { force: true })
    ]);
  }
}

export function getNativeRunnerUnavailableReason(): string | undefined {
  return helperUnavailableReason;
}

async function ensureNativeRunnerHelper(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  output?: vscode.OutputChannel
): Promise<string | undefined> {
  const sourcePath = path.resolve(__dirname, '..', 'resources', 'runner', 'oijudge-runner-win.cpp');
  const helperPath = path.join(getOITestDir(workspaceFolder), 'bin', 'oijudge-runner-win.exe');
  if (!(await exists(sourcePath))) {
    helperUnavailableReason = 'helper source file is missing';
    return undefined;
  }

  if (await isHelperFresh(sourcePath, helperPath)) {
    return helperPath;
  }

  const compiler = await findCompiler(workspaceFolder, config);
  const compilerCommand = compiler?.command ?? config.compiler.command;
  if (!compilerCommand) {
    helperUnavailableReason = 'C++ compiler is not configured';
    return undefined;
  }

  await fs.mkdir(path.dirname(helperPath), { recursive: true });
  const args = [
    sourcePath,
    '-std=c++17',
    '-O2',
    '-s',
    '-o',
    helperPath,
    '-lpsapi'
  ];
  const result = await runSpawn(compilerCommand, args, workspaceFolder.uri.fsPath, withCompilerPathEnv(compilerCommand));
  if (result.code !== 0) {
    helperUnavailableReason = result.stderr.trim() || result.stdout.trim() || `helper compiler exited with code ${result.code ?? 'null'}`;
    return undefined;
  }

  helperUnavailableReason = undefined;
  output?.appendLine('Native runner: enabled');
  output?.appendLine(`Runner: ${helperPath}`);
  return helperPath;
}

function logNativeRunnerUnavailable(output?: vscode.OutputChannel): void {
  if (!helperUnavailableReason || loggedUnavailableReason === helperUnavailableReason) {
    return;
  }
  loggedUnavailableReason = helperUnavailableReason;
  output?.appendLine(`Native runner unavailable, memory reporting disabled: ${helperUnavailableReason}`);
}

async function runHelper(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const result = await runSpawn(command, args, cwd, env);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code
  };
}

function runSpawn(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code
      });
    });
  });
}

function parseNativeRunResult(value: string): NativeRunResult | undefined {
  try {
    const parsed = JSON.parse(value) as NativeRunResult;
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function validTimeMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function validMemoryBytes(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isHelperFresh(sourcePath: string, helperPath: string): Promise<boolean> {
  try {
    const [sourceStat, helperStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(helperPath)
    ]);
    return helperStat.mtimeMs >= sourceStat.mtimeMs;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
