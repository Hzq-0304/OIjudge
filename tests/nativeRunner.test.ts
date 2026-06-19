import { readFileSync } from 'fs';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  __nativeRunnerTestHooks,
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
      expect(config?.signature).toBe('posix-runner-macos-rss-bytes-20260618');
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

  it('keeps ru_maxrss units platform-correct in the POSIX helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'resources', 'runner', 'oijudge-runner-posix.cpp'), 'utf8');

    expect(source).toContain('#ifdef __APPLE__');
    expect(source).toContain('uint64_t memoryBytes = static_cast<uint64_t>(usage.ru_maxrss);');
    expect(source).toContain('uint64_t memoryBytes = static_cast<uint64_t>(usage.ru_maxrss) * 1024ULL;');
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

describe('native runner helper spawn', () => {
  it('resolves stdout and stderr when the helper process closes normally', async () => {
    const child = fakeChild(1001);
    const spawnProcess = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('ok stdout'));
        child.stderr.emit('data', Buffer.from('note stderr'));
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof import('child_process').spawn;

    const result = await __nativeRunnerTestHooks.runSpawn('helper', ['--version'], 'C:\\work dir', {
      spawnProcess,
      timeoutMs: 100,
      label: 'Native runner helper build'
    });

    expect(result).toMatchObject({
      stdout: 'ok stdout',
      stderr: 'note stderr',
      code: 0,
      signal: null,
      command: 'helper',
      args: ['--version'],
      cwd: 'C:\\work dir',
      timeoutMs: 100
    });
    expect(spawnProcess).toHaveBeenCalledWith('helper', ['--version'], expect.objectContaining({
      cwd: 'C:\\work dir',
      shell: false,
      windowsHide: true
    }));
  });

  it('rejects spawn errors with command, args, cwd, timeout, stdout, and stderr diagnostics', async () => {
    const child = fakeChild(1002);
    const spawnProcess = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('compiler stdout'));
        child.stderr.emit('data', Buffer.from('compiler stderr'));
        child.emit('error', new Error('spawn failed'));
      });
      return child;
    }) as unknown as typeof import('child_process').spawn;

    await expect(__nativeRunnerTestHooks.runSpawn('g++', ['-o', 'runner'], 'D:\\workspace', {
      spawnProcess,
      timeoutMs: 123,
      label: 'Native runner helper build'
    })).rejects.toThrow(/Native runner helper build failed to start\.[\s\S]*command: g\+\+[\s\S]*args: \["-o","runner"\][\s\S]*cwd: D:\\workspace[\s\S]*timeoutMs: 123[\s\S]*stdout: compiler stdout[\s\S]*stderr: compiler stderr[\s\S]*details: spawn failed/);
  });

  it('kills the process tree and reports diagnostics when the helper process times out', async () => {
    const child = fakeChild(1003);
    const spawnProcess = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('partial stdout'));
        child.stderr.emit('data', Buffer.from('partial stderr'));
      });
      return child;
    }) as unknown as typeof import('child_process').spawn;
    const stopProcessTree = vi.fn(async () => ({
      ok: true,
      method: 'taskkill' as const,
      message: 'mock taskkill completed'
    }));

    await expect(__nativeRunnerTestHooks.runSpawn('g++', ['helper.cpp'], 'D:\\workspace with spaces', {
      spawnProcess,
      stopProcessTree,
      timeoutMs: 5,
      label: 'Native runner helper build'
    })).rejects.toThrow(/Native runner helper build timed out after 5ms\.[\s\S]*command: g\+\+[\s\S]*args: \["helper.cpp"\][\s\S]*cwd: D:\\workspace with spaces[\s\S]*timeoutMs: 5[\s\S]*stdout: partial stdout[\s\S]*stderr: partial stderr[\s\S]*details: cleanup: mock taskkill completed/);

    expect(stopProcessTree).toHaveBeenCalledTimes(1);
    expect(stopProcessTree).toHaveBeenCalledWith(child);
  });

  it('settles only once when timeout cleanup races with later process events', async () => {
    const child = fakeChild(1004);
    const spawnProcess = vi.fn(() => child) as unknown as typeof import('child_process').spawn;
    const stopProcessTree = vi.fn(async () => {
      child.emit('close', 0, null);
      child.emit('error', new Error('late error'));
      return {
        ok: true,
        method: 'posix-process-group' as const,
        message: 'mock cleanup completed'
      };
    });

    await expect(__nativeRunnerTestHooks.runSpawn('g++', ['helper.cpp'], '/workspace', {
      spawnProcess,
      stopProcessTree,
      timeoutMs: 5,
      label: 'Native runner helper build'
    })).rejects.toThrow(/timed out after 5ms/);

    expect(stopProcessTree).toHaveBeenCalledTimes(1);
  });

  it('truncates long stdout and stderr diagnostics', async () => {
    const child = fakeChild(1005);
    const spawnProcess = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(Array.from({ length: 30 }, (_, index) => `out-${index}`).join('\n')));
        child.stderr.emit('data', Buffer.from('x'.repeat(5000)));
        child.emit('error', new Error('spawn failed'));
      });
      return child;
    }) as unknown as typeof import('child_process').spawn;

    let message = '';
    try {
      await __nativeRunnerTestHooks.runSpawn('g++', ['helper.cpp'], '/workspace', {
        spawnProcess,
        timeoutMs: 50,
        label: 'Native runner helper build'
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('out-19');
    expect(message).not.toContain('out-20');
    expect(message).toContain('... (truncated)');
    expect(message.length).toBeLessThan(9000);
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

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter() as ChildProcess['stdout'];
  child.stderr = new EventEmitter() as ChildProcess['stderr'];
  child.kill = vi.fn(() => true) as unknown as ChildProcess['kill'];
  return child;
}
