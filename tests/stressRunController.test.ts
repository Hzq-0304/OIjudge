import { describe, expect, it } from 'vitest';
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

    controller.cancel();
    controller.cancel();
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
});
