import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStressRunController } from '../src/stressRunController';
import { OITestConfig, ProcessResult } from '../src/types';

const mocks = vi.hoisted(() => ({
  compileSource: vi.fn(),
  runProcess: vi.fn()
}));

vi.mock('../src/compiler', () => ({
  compileSource: mocks.compileSource
}));

vi.mock('../src/runner', () => ({
  runProcess: mocks.runProcess
}));

const workspaces: string[] = [];

describe('stress test cancellation', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('writes a cancelled summary and does not continue to the next split-file round', async () => {
    const { runGeneratorStdStressTest } = await import('../src/stressTest');
    const workspaceFolder = await createWorkspace();
    const controller = createStressRunController();
    controller.start();
    mocks.compileSource.mockImplementation(async (_workspace: unknown, sourcePath: string) => ({
      status: 'OK',
      timeMs: 1,
      executablePath: sourcePath.replace(/\.cpp$/u, '.exe')
    }));
    mocks.runProcess.mockImplementation(async (_command: string, _args: string[], input: string): Promise<ProcessResult> => {
      if (mocks.runProcess.mock.calls.length === 1) {
        controller.cancel();
        return result('1 2\n');
      }
      return result(input);
    });

    const stress = await runGeneratorStdStressTest({
      workspaceFolder,
      config: config(),
      generatorPath: path.join(workspaceFolder.uri.fsPath, 'gen.cpp'),
      stdPath: path.join(workspaceFolder.uri.fsPath, 'std.cpp'),
      solutionPath: path.join(workspaceFolder.uri.fsPath, 'main.cpp'),
      rounds: 10,
      output: output(),
      controller,
      source: 'currentCode'
    });
    const summary = JSON.parse(await fs.readFile(path.join(stress!.sessionDir, 'summary.json'), 'utf8')) as Record<string, unknown>;

    expect(stress?.cancelled).toBe(true);
    expect(mocks.runProcess).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      mode: 'generator-std',
      source: 'currentCode',
      status: 'cancelled',
      reason: 'Stopped by user',
      completedRounds: 0,
      totalRounds: 10
    });
  });

  it('writes a cancelled summary for single-file stress runs', async () => {
    const { runStandaloneStressTest } = await import('../src/stressTest');
    const workspaceFolder = await createWorkspace();
    const controller = createStressRunController();
    controller.start();
    mocks.compileSource.mockResolvedValue({
      status: 'OK',
      timeMs: 1,
      executablePath: path.join(workspaceFolder.uri.fsPath, 'stress.exe')
    });
    mocks.runProcess.mockImplementation(async (): Promise<ProcessResult> => {
      controller.cancel();
      return result('');
    });

    const stress = await runStandaloneStressTest({
      workspaceFolder,
      config: config(),
      programPath: path.join(workspaceFolder.uri.fsPath, 'stress.cpp'),
      output: output(),
      controller
    });
    const summary = JSON.parse(await fs.readFile(path.join(stress!.sessionDir, 'summary.json'), 'utf8')) as Record<string, unknown>;

    expect(stress?.cancelled).toBe(true);
    expect(summary).toMatchObject({
      mode: 'standalone',
      status: 'cancelled',
      reason: 'Stopped by user',
      completedRounds: 0,
      totalRounds: 1
    });
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-stress-cancel-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir, scheme: 'file' },
    name: 'work',
    index: 0
  } as vscode.WorkspaceFolder;
}

function config(): OITestConfig {
  return {
    version: 1,
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    samples: []
  };
}

function result(stdout: string): ProcessResult {
  return {
    stdout,
    stderr: '',
    code: 0,
    signal: null,
    timedOut: false,
    killedByTimeout: false,
    timeMs: 1,
    elapsedMs: 1
  };
}

function output(): vscode.OutputChannel {
  return {
    clear: () => undefined,
    show: () => undefined,
    appendLine: () => undefined
  } as unknown as vscode.OutputChannel;
}
