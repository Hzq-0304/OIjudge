import { execFile } from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { killProcessTree } from '../src/processTree';

describe('process tree cleanup', () => {
  it('uses taskkill arguments on Windows without shell command strings', async () => {
    const child = fakeChild(1234);
    const execFileMock = vi.fn((command, args, options, callback) => {
      expect(command).toBe('taskkill');
      expect(args).toEqual(['/PID', '1234', '/T', '/F']);
      expect(options).toMatchObject({ windowsHide: true, timeout: 5000 });
      setImmediate(() => {
        child.signalCode = 'SIGTERM';
        child.emit('close', null, 'SIGTERM');
        callback(null, 'SUCCESS', '');
      });
      return new EventEmitter();
    }) as unknown as typeof execFile;

    const result = await killProcessTree(child, {
      platform: 'win32',
      execFile: execFileMock
    });

    expect(result).toMatchObject({ ok: true, method: 'taskkill' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('treats Windows process-not-found from taskkill as already exited', async () => {
    const child = fakeChild(4321);
    const execFileMock = vi.fn((_command, _args, _options, callback) => {
      const error = Object.assign(new Error('ERROR: The process "4321" not found.'), { code: 128 });
      callback(error, '', 'not found');
      return new EventEmitter();
    }) as unknown as typeof execFile;

    const result = await killProcessTree(child, {
      platform: 'win32',
      execFile: execFileMock
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyExited: true,
      method: 'taskkill'
    });
  });

  it('kills a POSIX process group with SIGTERM before SIGKILL', async () => {
    const child = fakeChild(2468);
    const signals: Array<[number, NodeJS.Signals]> = [];
    const processKill = vi.fn((pid: number, signal?: NodeJS.Signals | number) => {
      signals.push([pid, signal as NodeJS.Signals]);
      if (signal === 'SIGKILL') {
        child.signalCode = 'SIGKILL';
        child.emit('close', null, 'SIGKILL');
      }
      return true;
    }) as typeof process.kill;

    const result = await killProcessTree(child, {
      platform: 'linux',
      detached: true,
      processKill,
      signalGraceMs: 1,
      timeoutMs: 50
    });

    expect(signals).toEqual([
      [-2468, 'SIGTERM'],
      [-2468, 'SIGKILL']
    ]);
    expect(result).toMatchObject({
      ok: true,
      method: 'posix-process-group'
    });
  });

  it('treats POSIX ESRCH as already exited', async () => {
    const child = fakeChild(3579);
    const processKill = vi.fn(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    }) as typeof process.kill;

    const result = await killProcessTree(child, {
      platform: 'darwin',
      detached: true,
      processKill
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyExited: true,
      method: 'posix-process-group'
    });
  });

  it('keeps repeated kill calls best-effort once the child has exited', async () => {
    const child = fakeChild(9876);
    child.exitCode = 0;

    await expect(killProcessTree(child, { platform: 'linux', detached: true })).resolves.toMatchObject({
      ok: true,
      alreadyExited: true
    });
    await expect(killProcessTree(child, { platform: 'linux', detached: true })).resolves.toMatchObject({
      ok: true,
      alreadyExited: true
    });
  });
});

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    child.signalCode = typeof signal === 'string' ? signal : 'SIGTERM';
    child.emit('close', null, child.signalCode);
    return true;
  }) as unknown as ChildProcess['kill'];
  return child;
}
