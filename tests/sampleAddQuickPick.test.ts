import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  createGeneratorInputBindModeItems,
  createJudgeModeItems,
  createProblemSampleAddModeItems,
  createStressTestModeItems,
  getStressStandalonePickerTitle,
  scanSamplePairs
} from '../src/extension';

const workspaces: string[] = [];
const vscodeMock = vscode as unknown as {
  __resetConfiguration: () => void;
  __setConfiguration: (key: string, value: unknown) => void;
};

describe('sample add QuickPick items', () => {
  afterEach(async () => {
    vscodeMock.__resetConfiguration();
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('keeps manual, file import, and batch import modes available', () => {
    const items = createProblemSampleAddModeItems();

    expect(items.map((item) => item.mode)).toEqual(['manual', 'files', 'batch']);
    expect(items.every((item) => item.label && item.description)).toBe(true);
    expect(items.find((item) => item.mode === 'manual')?.description).toContain('.out');
  });

  it('keeps generator input creation before file selection', () => {
    const items = createGeneratorInputBindModeItems();

    expect(items.map((item) => item.mode)).toEqual(['create', 'files']);
    expect(items.every((item) => item.label && item.description)).toBe(true);
    expect(items.find((item) => item.mode === 'create')?.description).toContain('.txt');
  });

  it('offers strict text, OI-style text, and custom checker judge modes', () => {
    const items = createJudgeModeItems();

    expect(items.map((item) => item.mode)).toEqual(['strictText', 'trimTrailingWhitespace', 'checker']);
    expect(items.map((item) => item.label)).toEqual([
      'Text Compare',
      'Text Compare (ignore trailing whitespace and final newlines)',
      'Custom Checker'
    ]);
    expect(items.every((item) => item.description)).toBe(true);
  });

  it('describes split-file and single-file stress modes clearly in English', () => {
    const items = createStressTestModeItems();

    expect(items.map((item) => item.mode)).toEqual(['generator-std', 'standalone']);
    expect(items.find((item) => item.mode === 'generator-std')).toMatchObject({
      label: expect.stringContaining('Generator + STD + Solution'),
      description: expect.stringContaining('runs the generator, STD, and solution separately'),
      detail: expect.stringContaining('compile and orchestrate all three')
    });
    expect(items.find((item) => item.mode === 'standalone')).toMatchObject({
      label: expect.stringContaining('Single-file stress test'),
      description: expect.stringContaining('self-contained contest-style stress program'),
      detail: expect.stringContaining('OI Judge only compiles and runs it')
    });
    expect(items.find((item) => item.mode === 'standalone')?.detail).toContain('generate tests and decide pass/fail');
    expect(getStressStandalonePickerTitle()).toContain('Single-file');
  });

  it('describes split-file and contest-style single-file stress modes in Chinese', () => {
    vscodeMock.__setConfiguration('language', 'zh');
    const items = createStressTestModeItems();

    expect(items.find((item) => item.mode === 'generator-std')).toMatchObject({
      label: expect.stringContaining('分文件对拍'),
      description: expect.stringContaining('分别运行生成器、STD 和待测程序'),
      detail: expect.stringContaining('组织三者运行')
    });
    expect(items.find((item) => item.mode === 'standalone')).toMatchObject({
      label: expect.stringContaining('单文件对拍（考场式）'),
      description: expect.stringContaining('自包含的考场式对拍程序'),
      detail: expect.stringContaining('生成数据和判断对错应由该程序内部完成')
    });
    expect(getStressStandalonePickerTitle()).toContain('单文件');
  });

  it('prefers .out over .ans when batch importing with the default answer suffix', async () => {
    const dir = await createWorkspace();
    await fs.writeFile(path.join(dir, 'a.in'), '', 'utf8');
    await fs.writeFile(path.join(dir, 'a.out'), 'out', 'utf8');
    await fs.writeFile(path.join(dir, 'a.ans'), 'ans', 'utf8');

    const scan = await scanSamplePairs(dir, '.in', '.out');

    expect(scan.matched).toHaveLength(1);
    expect(path.basename(scan.matched[0].answerPath)).toBe('a.out');
  });

  it('falls back to .ans when batch importing with the default answer suffix and .out is missing', async () => {
    const dir = await createWorkspace();
    await fs.writeFile(path.join(dir, 'b.in'), '', 'utf8');
    await fs.writeFile(path.join(dir, 'b.ans'), 'ans', 'utf8');

    const scan = await scanSamplePairs(dir, '.in', '.out');

    expect(scan.matched).toHaveLength(1);
    expect(path.basename(scan.matched[0].answerPath)).toBe('b.ans');
    expect(scan.missingAnswers).toHaveLength(0);
  });
});

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-scan-'));
  workspaces.push(dir);
  return dir;
}
