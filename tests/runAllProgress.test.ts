import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OITestConfig, ProcessResult } from '../src/types';

const mocks = vi.hoisted(() => ({
  compileSource: vi.fn(),
  runNativeProcess: vi.fn()
}));

vi.mock('../src/compiler', () => ({
  compileSource: mocks.compileSource
}));

vi.mock('../src/nativeRunner', () => ({
  runNativeProcess: mocks.runNativeProcess
}));

const workspaces: string[] = [];

describe('run all sample progress', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('notifies after each sample finishes before the whole batch completes', async () => {
    const { runAllSamples } = await import('../src/judge');
    const workspaceFolder = await createWorkspace();
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, '1.in'), 'ok\n', 'utf8');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, '1.out'), 'ok\n', 'utf8');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, '2.in'), 'bad\n', 'utf8');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, '2.out'), 'expected\n', 'utf8');
    let runnerCalls = 0;
    mocks.compileSource.mockResolvedValue({
      status: 'OK',
      timeMs: 1,
      executablePath: path.join(workspaceFolder.uri.fsPath, 'main.exe')
    });
    mocks.runNativeProcess.mockImplementation(async (options: { stdin: string }): Promise<ProcessResult> => {
      runnerCalls += 1;
      return {
        stdout: options.stdin,
        stderr: '',
        code: 0,
        signal: null,
        timedOut: false,
        killedByTimeout: false,
        timeMs: runnerCalls,
        elapsedMs: runnerCalls
      };
    });
    const progress: Array<{ status: string; partialCount: number; runnerCalls: number }> = [];

    const report = await runAllSamples(workspaceFolder, path.join(workspaceFolder.uri.fsPath, 'main.cpp'), config(), output(), {
      onSampleComplete: async (partialReport, sampleReport) => {
        progress.push({
          status: sampleReport.status,
          partialCount: partialReport.samples.length,
          runnerCalls
        });
        if (progress.length === 1) {
          expect(runnerCalls).toBe(1);
        }
      }
    });

    expect(progress).toEqual([
      { status: 'AC', partialCount: 1, runnerCalls: 1 },
      { status: 'WA', partialCount: 2, runnerCalls: 2 }
    ]);
    expect(report?.samples.map((sample) => sample.status)).toEqual(['AC', 'WA']);
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-progress-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}

function config(): OITestConfig {
  return {
    version: 1,
    compiler: { command: 'g++', args: [] },
    limits: { timeMs: 1000, memoryMb: 256 },
    standard: 'c++17',
    samples: [
      { id: 'sample-1', index: 1, name: 'Sample 1', input: '1.in', answer: '1.out' },
      { id: 'sample-2', index: 2, name: 'Sample 2', input: '2.in', answer: '2.out' }
    ]
  } as OITestConfig;
}

function output(): vscode.OutputChannel {
  return {
    clear: () => undefined,
    show: () => undefined,
    appendLine: () => undefined
  } as unknown as vscode.OutputChannel;
}
