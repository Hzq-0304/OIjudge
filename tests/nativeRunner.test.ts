import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildNativeRunnerCompileArgs,
  getNativeRunnerPlatformConfig,
  isNativeRunnerPlatform,
  runNativeProcess
} from '../src/nativeRunner';
import { OITestConfig } from '../src/types';
import type * as vscode from 'vscode';

describe('native runner platform selection', () => {
  it('keeps the Windows helper source, output path, and link libraries', () => {
    const config = getNativeRunnerPlatformConfig('win32');

    expect(config).toEqual({
      sourceFile: 'oijudge-runner-win.cpp',
      helperFile: 'oijudge-runner-win.exe',
      signature: 'win-runner-output-limit-20260611',
      linkArgs: ['-lpsapi', '-lshell32']
    });
  });

  it('uses the POSIX helper source and extensionless helper on Linux and macOS', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const config = getNativeRunnerPlatformConfig(platform);

      expect(config?.sourceFile).toBe('oijudge-runner-posix.cpp');
      expect(config?.helperFile).toBe('oijudge-runner-posix');
      expect(config?.linkArgs).toEqual([]);
    }
  });

  it('does not add Windows-only libraries to POSIX compile arguments', () => {
    const config = getNativeRunnerPlatformConfig('linux');
    expect(config).toBeDefined();

    const args = buildNativeRunnerCompileArgs(
      path.join('resources', 'runner', config!.sourceFile),
      path.join('.oitest', 'bin', config!.helperFile),
      config!
    );

    expect(args.staticArgs).toContain('-static');
    expect(args.dynamicArgs).toContain(path.join('resources', 'runner', 'oijudge-runner-posix.cpp'));
    expect(args.staticArgs).not.toContain('-lpsapi');
    expect(args.staticArgs).not.toContain('-lshell32');
    expect(args.dynamicArgs).not.toContain('-lpsapi');
    expect(args.dynamicArgs).not.toContain('-lshell32');
  });

  it('reports unsupported platforms so callers can keep the runProcess fallback', async () => {
    expect(isNativeRunnerPlatform('linux')).toBe(true);
    expect(isNativeRunnerPlatform('darwin')).toBe(true);
    expect(isNativeRunnerPlatform('win32')).toBe(true);
    expect(isNativeRunnerPlatform('freebsd')).toBe(false);

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    try {
      const result = await runNativeProcess({
        workspaceFolder: { uri: { fsPath: process.cwd() } } as vscode.WorkspaceFolder,
        config: minimalConfig(),
        command: 'node',
        args: ['-e', 'process.exit(0)'],
        stdin: '',
        cwd: process.cwd(),
        timeoutMs: 1000
      });

      expect(result).toBeUndefined();
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    }
  });
});

function minimalConfig(): OITestConfig {
  return {
    compiler: { command: 'g++', standard: 'c++17', flags: '-O2' },
    limits: { timeMs: 1000, memoryMb: 256, stackMb: 64 },
    output: { limitBytes: 1024 * 1024 },
    checker: { enabled: false, command: '', args: '' },
    fileIO: { enabled: false, inputFile: '', outputFile: '' },
    autoRun: false,
    saveBeforeRun: false,
    showDiff: true,
    problem: undefined
  } as OITestConfig;
}
