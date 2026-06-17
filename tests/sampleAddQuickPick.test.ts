import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGeneratorInputBindModeItems, createJudgeModeItems, createProblemSampleAddModeItems, scanSamplePairs } from '../src/extension';

const workspaces: string[] = [];

describe('sample add QuickPick items', () => {
  afterEach(async () => {
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
