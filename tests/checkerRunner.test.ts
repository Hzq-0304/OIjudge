import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runProcess: vi.fn()
}));

vi.mock('../src/runner', () => ({
  runProcess: mocks.runProcess
}));

const tempDirs: string[] = [];

describe('checker runner file arguments', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it.each(['testlib', 'plain'] as const)('passes user output before the answer to the %s checker', async (type) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-checker-order-'));
    tempDirs.push(dir);
    const inputPath = path.join(dir, 'sample.in');
    const userOutputPath = path.join(dir, 'useroutput.txt');
    const answerPath = path.join(dir, 'sample.ans');
    const checkerOutputPath = path.join(dir, 'checker-output.txt');
    mocks.runProcess.mockResolvedValue({
      stdout: type === 'plain' ? 'AC\n' : '',
      stderr: '',
      code: 0,
      signal: null,
      timedOut: false,
      killedByTimeout: false,
      timeMs: 1,
      elapsedMs: 1
    });

    const runner = await import('../src/checkerRunner');
    const run = type === 'plain' ? runner.runPlainChecker : runner.runTestlibChecker;
    await run({
      checkerSource: path.join(dir, 'checker.cpp'),
      checkerExe: path.join(dir, 'checker.exe'),
      inputPath,
      userOutputPath,
      answerPath,
      outputPath: checkerOutputPath,
      outputRel: 'checker-output.txt',
      timeLimitMs: 1000
    });

    expect(mocks.runProcess).toHaveBeenCalledWith(
      path.join(dir, 'checker.exe'),
      [inputPath, userOutputPath, answerPath],
      '',
      dir,
      1000,
      undefined
    );
  });
});
