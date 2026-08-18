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

  it('uses the CCR header argument order and does not accept a zero-exit format error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-checker-ccr-'));
    tempDirs.push(dir);
    const checkerSource = path.join(dir, 'checker.cpp');
    const inputPath = path.join(dir, 'sample.in');
    const userOutputPath = path.join(dir, 'useroutput.txt');
    const answerPath = path.join(dir, 'sample.ans');
    await fs.writeFile(checkerSource, '#include "testlib_for_CCR.h"\n', 'utf8');
    mocks.runProcess.mockResolvedValue({
      stdout: '',
      stderr: 'wrong output format 0\nUnexpected end of file - int32 expected\n',
      code: 0,
      signal: null,
      timedOut: false,
      killedByTimeout: false,
      timeMs: 1,
      elapsedMs: 1
    });

    const runner = await import('../src/checkerRunner');
    const result = await runner.runTestlibChecker({
      checkerSource,
      checkerExe: path.join(dir, 'checker.exe'),
      inputPath,
      userOutputPath,
      answerPath,
      outputPath: path.join(dir, 'checker-output.txt'),
      outputRel: 'checker-output.txt',
      timeLimitMs: 1000
    });

    expect(mocks.runProcess).toHaveBeenCalledWith(
      path.join(dir, 'checker.exe'),
      [inputPath, answerPath, userOutputPath],
      '',
      dir,
      1000,
      undefined
    );
    expect(result.status).toBe('PE');
    expect(result.report).toMatchObject({
      verdict: 'PE',
      protocol: 'ccr',
      argumentOrder: 'input-answer-user'
    });
  });

  it.each([
    ['ok 1\nanswer accepted\n', 'AC', 1],
    ['points 1\n1.000000 OK\n', 'AC', 1],
    ['wrong answer 0\nanswer differs\n', 'WA', 0],
    ['points 0.25\n0.250000 OK\n', 'Scored', 0.25]
  ] as const)('parses an explicit CCR verdict from %j', async (stderr, status, score) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-checker-ccr-verdict-'));
    tempDirs.push(dir);
    const checkerSource = path.join(dir, 'checker.cpp');
    await fs.writeFile(checkerSource, '# include <testlib_for_CCR.h>\n', 'utf8');
    mocks.runProcess.mockResolvedValue({
      stdout: '',
      stderr,
      code: 0,
      signal: null,
      timedOut: false,
      killedByTimeout: false,
      timeMs: 1,
      elapsedMs: 1
    });

    const { runTestlibChecker } = await import('../src/checkerRunner');
    const result = await runTestlibChecker({
      checkerSource,
      checkerExe: path.join(dir, 'checker.exe'),
      inputPath: path.join(dir, 'sample.in'),
      userOutputPath: path.join(dir, 'useroutput.txt'),
      answerPath: path.join(dir, 'sample.ans'),
      outputPath: path.join(dir, 'checker-output.txt'),
      outputRel: 'checker-output.txt',
      timeLimitMs: 1000
    });

    expect(result.status).toBe(status);
    expect(result.score).toBe(score);
  });

  it('returns unknown error when a CCR checker has no explicit verdict marker', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-checker-ccr-unknown-'));
    tempDirs.push(dir);
    const checkerSource = path.join(dir, 'checker.cpp');
    await fs.writeFile(checkerSource, '#include "testlib_for_CCR.h"\n', 'utf8');
    mocks.runProcess.mockResolvedValue({
      stdout: '',
      stderr: 'checker stopped without a result\n',
      code: 0,
      signal: null,
      timedOut: false,
      killedByTimeout: false,
      timeMs: 1,
      elapsedMs: 1
    });

    const { runTestlibChecker } = await import('../src/checkerRunner');
    const result = await runTestlibChecker({
      checkerSource,
      checkerExe: path.join(dir, 'checker.exe'),
      inputPath: path.join(dir, 'sample.in'),
      userOutputPath: path.join(dir, 'useroutput.txt'),
      answerPath: path.join(dir, 'sample.ans'),
      outputPath: path.join(dir, 'checker-output.txt'),
      outputRel: 'checker-output.txt',
      timeLimitMs: 1000
    });

    expect(result.status).toBe('ERR');
    expect(result.report).toMatchObject({
      verdict: 'UnknownError',
      errorName: 'Unknown Checker Verdict'
    });
    expect(result.report.message).toContain('without an explicit result marker');
  });
});
