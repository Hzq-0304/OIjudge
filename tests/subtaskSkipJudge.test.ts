import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSubtaskSkipConfig } from '../src/subtaskSkip';
import { OITestConfig, ProcessResult } from '../src/types';

const mocks = vi.hoisted(() => ({
  compileSource: vi.fn(),
  runNativeProcess: vi.fn(),
  compileChecker: vi.fn(),
  runPlainChecker: vi.fn(),
  runTestlibChecker: vi.fn()
}));

vi.mock('../src/compiler', () => ({
  compileSource: mocks.compileSource
}));

vi.mock('../src/nativeRunner', () => ({
  runNativeProcess: mocks.runNativeProcess
}));

vi.mock('../src/checkerCompiler', () => ({
  compileChecker: mocks.compileChecker,
  getCheckerTimeLimitMs: () => 1000
}));

vi.mock('../src/checkerRunner', () => ({
  runPlainChecker: mocks.runPlainChecker,
  runTestlibChecker: mocks.runTestlibChecker
}));

const workspaces: string[] = [];

describe('subtask skip judge scheduling', () => {
  afterEach(async () => {
    vi.resetAllMocks();
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('keeps old behavior and runs every testcase when subtask skip is not enabled', async () => {
    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await writeSamples(workspaceFolder, ['1', '2', '3']);
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
    mocks.runNativeProcess.mockResolvedValue(result('wrong\n'));

    const report = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), {
      ...config(),
      subtaskSkip: undefined
    }, output());

    expect(mocks.runNativeProcess).toHaveBeenCalledTimes(3);
    expect(report?.samples.map((sample) => sample.status)).toEqual(['WA', 'WA', 'WA']);
  });

  it('skips remaining bundle subtask cases after WA, RE, or TLE', async () => {
    await expectSkipAfterStatus('WA', result('wrong\n'));
    await expectSkipAfterStatus('RE', result('', { code: 1 }));
    await expectSkipAfterStatus('TLE', result('', { timedOut: true, killedByTimeout: true, timeMs: 1250 }));
  });

  it('skips remaining bundle cases when a checker returns WA', async () => {
    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await writeSamples(workspaceFolder, ['1', '2', '3']);
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
    mocks.runNativeProcess
      .mockResolvedValueOnce(result('1\n'))
      .mockResolvedValueOnce(result('2\n'));
    mocks.compileChecker.mockResolvedValue({
      ok: true,
      type: 'plain',
      source: 'checker.cpp',
      exe: path.join(workspaceFolder.uri.fsPath, 'checker.exe')
    });
    mocks.runPlainChecker
      .mockResolvedValueOnce({ status: 'AC', score: 0, report: { enabled: true, type: 'plain', verdict: 'AC', message: 'ok' } })
      .mockResolvedValueOnce({ status: 'WA', score: 0, report: { enabled: true, type: 'plain', verdict: 'WA', message: 'checker rejected' } });

    const report = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), {
      ...config(),
      id: 'checker-skip',
      judgeMode: 'checker',
      checker: { enabled: true, type: 'plain', source: 'checker.cpp' }
    } as OITestConfig, output());

    expect(mocks.runNativeProcess).toHaveBeenCalledTimes(2);
    expect(mocks.runPlainChecker).toHaveBeenCalledTimes(2);
    expect(report?.samples.map((sample) => sample.status)).toEqual(['AC', 'WA', 'Skipped']);
    expect(report?.samples[2]?.skip?.reason).toBe('previous_case_failed');
  });

  it('does not run skipped file-IO testcases', async () => {
    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await writeSamples(workspaceFolder, ['1', '2', '3']);
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
    mocks.runNativeProcess
      .mockImplementationOnce(async (options: { fileOutputPath?: string }) => {
        if (options.fileOutputPath) {
          await fs.mkdir(path.dirname(options.fileOutputPath), { recursive: true });
          await fs.writeFile(options.fileOutputPath, '1\n', 'utf8');
        }
        return result('');
      })
      .mockImplementationOnce(async (options: { fileOutputPath?: string }) => {
        if (options.fileOutputPath) {
          await fs.mkdir(path.dirname(options.fileOutputPath), { recursive: true });
          await fs.writeFile(options.fileOutputPath, 'wrong\n', 'utf8');
        }
        return result('');
      });

    const report = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), {
      ...config(),
      ioMode: 'fileio',
      fileIo: { inputFileName: 'problem.in', outputFileName: 'problem.out' }
    }, output());

    expect(mocks.runNativeProcess).toHaveBeenCalledTimes(2);
    expect(report?.samples.map((sample) => sample.status)).toEqual(['AC', 'WA', 'Skipped']);
    await expect(fs.access(path.join(workspaceFolder.uri.fsPath, '.vscode', '.OIJudge', 'outputs', 'sample-3', 'run'))).rejects.toThrow();
  });

  it('runs dependent subtask when dependency passed and skips it when dependency failed', async () => {
    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await writeSamples(workspaceFolder, ['1', '2']);
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
    mocks.runNativeProcess
      .mockResolvedValueOnce(result('1\n'))
      .mockResolvedValueOnce(result('2\n'));

    const accepted = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), dependencyConfig(), output());
    expect(accepted?.samples.map((sample) => sample.status)).toEqual(['AC', 'AC']);
    expect(mocks.runNativeProcess).toHaveBeenCalledTimes(2);

    vi.resetAllMocks();
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
    mocks.runNativeProcess.mockResolvedValueOnce(result('wrong\n'));

    const skipped = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), dependencyConfig(), output());
    expect(mocks.runNativeProcess).toHaveBeenCalledTimes(1);
    expect(skipped?.samples.map((sample) => sample.status)).toEqual(['WA', 'Skipped']);
    expect(skipped?.samples[1]?.skip).toMatchObject({
      reason: 'dependency_failed',
      dependencyId: 'subtask-1'
    });
  });

  it('propagates skipped dependency through a dependency chain', async () => {
    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await writeSamples(workspaceFolder, ['1', '2', '3']);
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
    mocks.runNativeProcess.mockResolvedValueOnce(result('wrong\n'));

    const report = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), chainConfig(), output());

    expect(mocks.runNativeProcess).toHaveBeenCalledTimes(1);
    expect(report?.samples.map((sample) => sample.status)).toEqual(['WA', 'Skipped', 'Skipped']);
    expect(report?.samples[1]?.skip?.dependencyId).toBe('subtask-1');
    expect(report?.samples[2]?.skip?.dependencyId).toBe('subtask-2');
  });

  it('reports missing dependency and dependency cycles as config errors without running cases', async () => {
    const missing = validateSubtaskSkipConfig({
      ...dependencyConfig(),
      subtasks: [
        { id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1'], scoringMode: 'bundle', dependsOn: ['missing'] }
      ]
    });
    expect(missing.errors.join('\n')).toContain('missing subtask missing');

    const cycle = validateSubtaskSkipConfig({
      ...dependencyConfig(),
      subtasks: [
        { id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1'], scoringMode: 'bundle', dependsOn: ['subtask-2'] },
        { id: 'subtask-2', name: 'Subtask 2', sampleIds: ['sample-2'], scoringMode: 'bundle', dependsOn: ['subtask-1'] }
      ]
    });
    expect(cycle.errors.join('\n')).toContain('cycle');

    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await writeSamples(workspaceFolder, ['1']);
    mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));

    const report = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), {
      ...dependencyConfig(),
      samples: [{ id: 'sample-1', index: 1, name: 'Sample 1', input: '1.in', answer: '1.out', score: 10 }],
      subtasks: [{ id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1'], scoringMode: 'bundle', dependsOn: ['missing'] }]
    }, output());
    expect(mocks.runNativeProcess).not.toHaveBeenCalled();
    expect(report?.samples[0]?.status).toBe('Skipped');
    expect(report?.samples[0]?.skip?.reason).toBe('config_error');
  });
});

async function expectSkipAfterStatus(status: 'WA' | 'RE' | 'TLE', secondResult: ProcessResult): Promise<void> {
  vi.resetAllMocks();
  const { runAllSamples } = await import('../src/judge');
  const workspaceFolder = await createWorkspace();
  await writeSamples(workspaceFolder, ['1', '2', '3']);
  mocks.compileSource.mockResolvedValue(compileOk(workspaceFolder));
  mocks.runNativeProcess
    .mockResolvedValueOnce(result('1\n'))
    .mockResolvedValueOnce(secondResult);

  const report = await runAllSamples(workspaceFolder, sourcePath(workspaceFolder), config(), output());

  expect(mocks.runNativeProcess).toHaveBeenCalledTimes(2);
  expect(report?.samples.map((sample) => sample.status)).toEqual(['AC', status, 'Skipped']);
  expect(report?.samples[2]?.skip).toMatchObject({
    reason: 'previous_case_failed',
    subtaskId: 'subtask-1'
  });
  expect(report?.samples[2]?.score).toBe(0);
}

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-subtask-skip-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir, scheme: 'file' },
    name: 'work',
    index: 0
  } as vscode.WorkspaceFolder;
}

async function writeSamples(workspaceFolder: vscode.WorkspaceFolder, answers: string[]): Promise<void> {
  await fs.mkdir(workspaceFolder.uri.fsPath, { recursive: true });
  for (const [index, answer] of answers.entries()) {
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, `${index + 1}.in`), `${index + 1}\n`, 'utf8');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, `${index + 1}.out`), `${answer}\n`, 'utf8');
  }
}

function config(): OITestConfig {
  return {
    version: 1,
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    subtaskSkip: { enabled: true, skipRemainingCasesOnFailure: true },
    samples: [1, 2, 3].map((index) => ({
      id: `sample-${index}`,
      index,
      name: `Sample ${index}`,
      input: `${index}.in`,
      answer: `${index}.out`,
      score: 10
    })),
    subtasks: [{
      id: 'subtask-1',
      name: 'Subtask 1',
      sampleIds: ['sample-1', 'sample-2', 'sample-3'],
      scoringMode: 'bundle'
    }],
    score: { total: 30 }
  } as OITestConfig;
}

function dependencyConfig(): OITestConfig {
  return {
    version: 1,
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    subtaskSkip: { enabled: true, skipRemainingCasesOnFailure: true, skipDependentSubtasks: true },
    samples: [1, 2].map((index) => ({
      id: `sample-${index}`,
      index,
      name: `Sample ${index}`,
      input: `${index}.in`,
      answer: `${index}.out`,
      score: 10
    })),
    subtasks: [
      { id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1'], scoringMode: 'bundle' },
      { id: 'subtask-2', name: 'Subtask 2', sampleIds: ['sample-2'], scoringMode: 'bundle', dependsOn: ['subtask-1'] }
    ],
    score: { total: 20 }
  } as OITestConfig;
}

function chainConfig(): OITestConfig {
  return {
    ...config(),
    subtaskSkip: { enabled: true, skipRemainingCasesOnFailure: true, skipDependentSubtasks: true },
    subtasks: [
      { id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1'], scoringMode: 'bundle' },
      { id: 'subtask-2', name: 'Subtask 2', sampleIds: ['sample-2'], scoringMode: 'bundle', dependsOn: ['subtask-1'] },
      { id: 'subtask-3', name: 'Subtask 3', sampleIds: ['sample-3'], scoringMode: 'bundle', dependsOn: ['subtask-2'] }
    ]
  } as OITestConfig;
}

function compileOk(workspaceFolder: vscode.WorkspaceFolder) {
  return {
    status: 'OK' as const,
    timeMs: 1,
    executablePath: path.join(workspaceFolder.uri.fsPath, 'main.exe'),
    compilerCommand: 'g++'
  };
}

function result(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout,
    stderr: '',
    code: 0,
    signal: null,
    timedOut: false,
    killedByTimeout: false,
    timeMs: 1,
    elapsedMs: 1,
    ...overrides
  };
}

function sourcePath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, 'main.cpp');
}

function output(): vscode.OutputChannel {
  return {
    clear: () => undefined,
    show: () => undefined,
    appendLine: () => undefined
  } as unknown as vscode.OutputChannel;
}
