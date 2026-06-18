import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { runProcess } from '../src/runner';
import { createStressRunController, StressRunCancelledError } from '../src/stressRunController';

describe('stress run controller', () => {
  it('tracks and stops active child processes without throwing on repeated cancel', async () => {
    const controller = createStressRunController();
    expect(controller.start()).toBe(true);
    expect(controller.start()).toBe(false);

    const run = runProcess(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10000)'],
      '',
      process.cwd(),
      10000,
      process.env,
      10000,
      undefined,
      undefined,
      controller
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    await controller.cancel();
    await controller.cancel();
    const result = await run;

    expect(controller.cancellationRequested).toBe(true);
    expect(result.code === null || result.code !== 0 || result.signal).toBeTruthy();
    expect(() => controller.throwIfCancelled()).toThrow(StressRunCancelledError);

    controller.finish();
    expect(controller.isRunning).toBe(false);
    expect(controller.cancellationRequested).toBe(false);
    expect(controller.start()).toBe(true);
    controller.finish();
  });

  it('awaits injected process-tree cleanup and keeps repeated cancel safe', async () => {
    const stopProcessTree = vi.fn(async () => ({
      ok: true,
      method: 'taskkill' as const
    }));
    const controller = createStressRunController(stopProcessTree);
    const child = fakeChild(7654);

    expect(controller.start()).toBe(true);
    controller.registerProcess(child);
    await expect(controller.cancel()).resolves.toEqual([{ ok: true, method: 'taskkill' }]);
    await expect(controller.cancel()).resolves.toEqual([{ ok: true, method: 'taskkill' }]);

    expect(stopProcessTree).toHaveBeenCalledTimes(2);
    expect(controller.cancellationRequested).toBe(true);
  });
});

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true) as unknown as ChildProcess['kill'];
  return child;
}
