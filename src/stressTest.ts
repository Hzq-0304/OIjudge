import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { compileSource } from './compiler';
import { getOITestDir, toPosixPath } from './config';
import { isOutputAccepted } from './comparator';
import { withCompilerPathEnv } from './compilerRuntime';
import { t } from './i18n';
import { runProcess } from './runner';
import { OITestConfig, ProcessResult } from './types';

export type StressTestMode = 'generator-std' | 'standalone';

export type GeneratorStdStressInput = {
  workspaceFolder: vscode.WorkspaceFolder;
  config: OITestConfig;
  generatorPath: string;
  stdPath: string;
  solutionPath: string;
  rounds: number;
  output: vscode.OutputChannel;
};

export type StandaloneStressInput = {
  workspaceFolder: vscode.WorkspaceFolder;
  config: OITestConfig;
  programPath: string;
  output: vscode.OutputChannel;
};

export type StressTestResult = {
  mode: StressTestMode;
  sessionDir: string;
  passed: number;
  rounds?: number;
  failedAt?: number;
  savedFiles: string[];
  exitCode?: number | null;
};

type CompiledStressProgram = {
  sourcePath: string;
  executablePath: string;
  compilerCommand?: string;
};

const DEFAULT_STRESS_TIMEOUT_MS = 5000;

export async function runGeneratorStdStressTest(input: GeneratorStdStressInput): Promise<StressTestResult | undefined> {
  const sessionDir = await createStressSessionDir(input.workspaceFolder);
  input.output.clear();
  input.output.show(true);
  input.output.appendLine('Stress Test');
  input.output.appendLine('Mode: Generator + STD');
  input.output.appendLine(`Generator: ${input.generatorPath}`);
  input.output.appendLine(`STD: ${input.stdPath}`);
  input.output.appendLine(`Solution: ${input.solutionPath}`);
  input.output.appendLine(`Rounds: ${input.rounds}`);
  input.output.appendLine('');

  const generator = await compileStressProgram(input.workspaceFolder, input.config, input.generatorPath, 'stress-generator', input.output);
  const std = generator ? await compileStressProgram(input.workspaceFolder, input.config, input.stdPath, 'stress-std', input.output) : undefined;
  const solution = std ? await compileStressProgram(input.workspaceFolder, input.config, input.solutionPath, 'stress-solution', input.output) : undefined;
  if (!generator || !std || !solution) {
    await writeSummary(sessionDir, {
      mode: 'generator-std',
      generator: input.generatorPath,
      std: input.stdPath,
      solution: input.solutionPath,
      rounds: input.rounds,
      passed: 0,
      compileFailed: true
    });
    return undefined;
  }

  const timeoutMs = input.config.limits?.timeMs && input.config.limits.timeMs > 0
    ? input.config.limits.timeMs
    : DEFAULT_STRESS_TIMEOUT_MS;
  let passed = 0;
  for (let round = 1; round <= input.rounds; round += 1) {
    const caseName = formatCaseName(round);
    const generatorResult = await runStressProgram(generator, '', input.workspaceFolder.uri.fsPath, DEFAULT_STRESS_TIMEOUT_MS);
    if (generatorResult.timedOut || generatorResult.code !== 0) {
      const savedFiles = await saveGeneratorStdCase(sessionDir, caseName, generatorResult.stdout, '', '', generatorResult, undefined, undefined);
      await writeSummary(sessionDir, buildGeneratorStdSummary(input, passed, round, savedFiles, 'generator-failed'));
      input.output.appendLine(`[${round}/${input.rounds}] Generator failed`);
      appendSavedFiles(input.output, savedFiles);
      return { mode: 'generator-std', sessionDir, passed, rounds: input.rounds, failedAt: round, savedFiles };
    }

    const stdResult = await runStressProgram(std, generatorResult.stdout, path.dirname(input.stdPath), timeoutMs);
    const solutionResult = await runStressProgram(solution, generatorResult.stdout, path.dirname(input.solutionPath), timeoutMs);
    if (stdResult.timedOut || solutionResult.timedOut) {
      const savedFiles = await saveGeneratorStdCase(sessionDir, caseName, generatorResult.stdout, stdResult.stdout, solutionResult.stdout, generatorResult, stdResult, solutionResult);
      await writeSummary(sessionDir, buildGeneratorStdSummary(input, passed, round, savedFiles, 'timeout'));
      input.output.appendLine(`[${round}/${input.rounds}] Timeout`);
      appendSavedFiles(input.output, savedFiles);
      return { mode: 'generator-std', sessionDir, passed, rounds: input.rounds, failedAt: round, savedFiles };
    }
    if (stdResult.code !== 0 || solutionResult.code !== 0) {
      const savedFiles = await saveGeneratorStdCase(sessionDir, caseName, generatorResult.stdout, stdResult.stdout, solutionResult.stdout, generatorResult, stdResult, solutionResult);
      await writeSummary(sessionDir, buildGeneratorStdSummary(input, passed, round, savedFiles, 'run-failed'));
      input.output.appendLine(`[${round}/${input.rounds}] Run failed`);
      appendSavedFiles(input.output, savedFiles);
      return { mode: 'generator-std', sessionDir, passed, rounds: input.rounds, failedAt: round, savedFiles };
    }
    if (!isOutputAccepted(solutionResult.stdout, stdResult.stdout)) {
      const savedFiles = await saveGeneratorStdCase(sessionDir, caseName, generatorResult.stdout, stdResult.stdout, solutionResult.stdout, generatorResult, stdResult, solutionResult);
      await writeSummary(sessionDir, buildGeneratorStdSummary(input, passed, round, savedFiles, 'wrong-answer'));
      input.output.appendLine(`[${round}/${input.rounds}] Wrong Answer`);
      appendSavedFiles(input.output, savedFiles);
      return { mode: 'generator-std', sessionDir, passed, rounds: input.rounds, failedAt: round, savedFiles };
    }
    passed += 1;
    input.output.appendLine(`[${round}/${input.rounds}] OK`);
  }

  await writeSummary(sessionDir, {
    mode: 'generator-std',
    generator: input.generatorPath,
    std: input.stdPath,
    solution: input.solutionPath,
    rounds: input.rounds,
    passed
  });
  return { mode: 'generator-std', sessionDir, passed, rounds: input.rounds, savedFiles: [] };
}

export async function runStandaloneStressTest(input: StandaloneStressInput): Promise<StressTestResult | undefined> {
  const sessionDir = await createStressSessionDir(input.workspaceFolder);
  input.output.clear();
  input.output.show(true);
  input.output.appendLine('Stress Test');
  input.output.appendLine('Mode: Standalone');
  input.output.appendLine(`Program: ${input.programPath}`);
  input.output.appendLine('');

  const program = await compileStressProgram(input.workspaceFolder, input.config, input.programPath, 'stress-standalone', input.output);
  if (!program) {
    await writeSummary(sessionDir, {
      mode: 'standalone',
      program: input.programPath,
      compileFailed: true
    });
    return undefined;
  }

  const result = await runStressProgram(program, '', path.dirname(input.programPath), input.config.limits?.timeMs ?? DEFAULT_STRESS_TIMEOUT_MS);
  const stdoutPath = path.join(sessionDir, 'standalone.stdout.txt');
  const stderrPath = path.join(sessionDir, 'standalone.stderr.txt');
  await fs.writeFile(stdoutPath, result.stdout, 'utf8');
  await fs.writeFile(stderrPath, result.stderr, 'utf8');
  await writeSummary(sessionDir, {
    mode: 'standalone',
    program: input.programPath,
    exitCode: result.code,
    timedOut: result.timedOut,
    stdout: 'standalone.stdout.txt',
    stderr: 'standalone.stderr.txt'
  });
  const savedFiles = [stdoutPath, stderrPath, path.join(sessionDir, 'summary.json')];
  input.output.appendLine(`Exit code: ${result.code ?? 'null'}`);
  appendSavedFiles(input.output, savedFiles);
  return { mode: 'standalone', sessionDir, passed: result.code === 0 && !result.timedOut ? 1 : 0, savedFiles, exitCode: result.code };
}

async function compileStressProgram(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  sourcePath: string,
  id: string,
  output: vscode.OutputChannel
): Promise<CompiledStressProgram | undefined> {
  const compileConfig: OITestConfig & { id: string } = {
    ...config,
    id
  };
  const result = await compileSource(workspaceFolder, sourcePath, compileConfig, output);
  return result ? { sourcePath, executablePath: result.executablePath, compilerCommand: result.compilerCommand } : undefined;
}

async function runStressProgram(
  program: CompiledStressProgram,
  input: string,
  cwd: string,
  timeoutMs: number
): Promise<ProcessResult> {
  return runProcess(program.executablePath, [], input, cwd, timeoutMs, withCompilerPathEnv(program.compilerCommand));
}

async function createStressSessionDir(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
  const sessionDir = path.join(getOITestDir(workspaceFolder), 'stress', createTimestamp());
  await fs.mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

async function saveGeneratorStdCase(
  sessionDir: string,
  caseName: string,
  input: string,
  stdOutput: string,
  testOutput: string,
  generatorResult: ProcessResult,
  stdResult: ProcessResult | undefined,
  testResult: ProcessResult | undefined
): Promise<string[]> {
  const files = [
    [path.join(sessionDir, `${caseName}.in`), input],
    [path.join(sessionDir, `${caseName}.std.out`), stdOutput],
    [path.join(sessionDir, `${caseName}.test.out`), testOutput],
    [path.join(sessionDir, `${caseName}.generator.err`), generatorResult.stderr],
    [path.join(sessionDir, `${caseName}.std.err`), stdResult?.stderr ?? ''],
    [path.join(sessionDir, `${caseName}.test.err`), testResult?.stderr ?? '']
  ] as const;
  await Promise.all(files.map(([filePath, content]) => fs.writeFile(filePath, content, 'utf8')));
  return files.map(([filePath]) => filePath);
}

function buildGeneratorStdSummary(
  input: GeneratorStdStressInput,
  passed: number,
  failedAt: number,
  savedFiles: string[],
  reason: string
): Record<string, unknown> {
  return {
    mode: 'generator-std',
    generator: input.generatorPath,
    std: input.stdPath,
    solution: input.solutionPath,
    rounds: input.rounds,
    passed,
    failedAt,
    reason,
    failedCase: {
      input: path.basename(savedFiles.find((file) => file.endsWith('.in')) ?? ''),
      stdOutput: path.basename(savedFiles.find((file) => file.endsWith('.std.out')) ?? ''),
      testOutput: path.basename(savedFiles.find((file) => file.endsWith('.test.out')) ?? '')
    }
  };
}

async function writeSummary(sessionDir: string, summary: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(sessionDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function appendSavedFiles(output: vscode.OutputChannel, savedFiles: string[]): void {
  output.appendLine('');
  output.appendLine('Saved:');
  for (const file of savedFiles) {
    output.appendLine(`  ${toPosixPath(file)}`);
  }
}

function formatCaseName(round: number): string {
  return `case-${String(round).padStart(4, '0')}`;
}

function createTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('-') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}
