import type { ChildProcess } from 'child_process';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  killProcessTree: vi.fn(async (child: ChildProcess) => {
    child.kill('SIGKILL');
    return {
      ok: true,
      method: 'child-kill' as const,
      message: 'mock cleanup'
    };
  })
}));

vi.mock('../src/processTree', () => ({
  killProcessTree: mocks.killProcessTree
}));

import { runProcess } from '../src/runner';

describe('runProcess timeout cleanup', () => {
  it('kills the process tree and reports TLE semantics on timeout', async () => {
    mocks.killProcessTree.mockClear();

    const result = await runProcess(
      process.execPath,
      ['-e', 'setTimeout(() => undefined, 10000);'],
      '',
      process.cwd(),
      50,
      process.env,
      50
    );

    expect(mocks.killProcessTree).toHaveBeenCalledTimes(1);
    expect(result.timedOut).toBe(true);
    expect(result.killedByTimeout).toBe(true);
    expect(result.outputLimitExceeded).toBe(false);
    expect(result.cleanup).toMatchObject({
      ok: true,
      method: 'child-kill'
    });
  });
});
