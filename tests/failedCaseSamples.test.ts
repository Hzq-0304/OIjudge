import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFailedCaseBaseName,
  pickAvailableSampleBaseName,
  sanitizeSampleBaseName,
  saveFailedCaseAsSampleFiles
} from '../src/failedCaseSamples';

const tempDirs: string[] = [];

describe('failed case sample helpers', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('sanitizes unsafe file names while keeping Chinese names', () => {
    expect(sanitizeSampleBaseName('a<b>c:d/e\\f|g?h*')).toBe('a-b-c-d-e-f-g-h');
    expect(sanitizeSampleBaseName('   ...   ')).toBe('failed-case');
    expect(sanitizeSampleBaseName('CON')).toBe('CON-case');
    expect(sanitizeSampleBaseName('失败 用例')).toBe('失败-用例');
    expect(sanitizeSampleBaseName('x'.repeat(120))).toHaveLength(80);
  });

  it('builds stable base names for stress and judge failed cases', () => {
    expect(buildFailedCaseBaseName({ source: 'stress', round: 37, input: '1' })).toBe('stress-37');
    expect(buildFailedCaseBaseName({ source: 'judge', name: 'case 1', input: '1' })).toBe('failed-case-1');
    expect(buildFailedCaseBaseName({ source: 'judge', input: '1' })).toBe('failed-case');
  });

  it('picks an unused base name when any sample sidecar conflicts', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'stress-37.in'), 'input', 'utf8');
    expect(await pickAvailableSampleBaseName(dir, 'stress-37')).toBe('stress-37-2');

    await fs.writeFile(path.join(dir, 'stress-38.ans'), 'answer', 'utf8');
    expect(await pickAvailableSampleBaseName(dir, 'stress-38')).toBe('stress-38-2');

    await fs.writeFile(path.join(dir, 'stress-39.actual.txt'), 'actual', 'utf8');
    expect(await pickAvailableSampleBaseName(dir, 'stress-39')).toBe('stress-39-2');
  });

  it('saves complete failed cases and preserves content exactly', async () => {
    const dir = await tempDir();
    const saved = await saveFailedCaseAsSampleFiles({
      source: 'judge',
      name: '中文 case',
      input: '1  2\r\n\n',
      expected: '3\n',
      actual: '4\r\n'
    }, { samplesDir: dir });

    expect(path.basename(saved.inputPath)).toBe('failed-中文-case.in');
    expect(path.basename(saved.answerPath ?? '')).toBe('failed-中文-case.ans');
    expect(path.basename(saved.actualPath ?? '')).toBe('failed-中文-case.actual.txt');
    expect(await fs.readFile(saved.inputPath, 'utf8')).toBe('1  2\r\n\n');
    expect(await fs.readFile(saved.answerPath ?? '', 'utf8')).toBe('3\n');
    expect(await fs.readFile(saved.actualPath ?? '', 'utf8')).toBe('4\r\n');
  });

  it('does not write an answer file when expected output is missing', async () => {
    const dir = await tempDir();
    const saved = await saveFailedCaseAsSampleFiles({
      source: 'stress',
      round: 8,
      input: 'input only'
    }, { samplesDir: dir });

    expect(path.basename(saved.inputPath)).toBe('stress-8.in');
    expect(saved.answerPath).toBeUndefined();
    expect(saved.warning).toBe('expectedMissing');
    expect(await fs.readdir(dir)).toEqual(['stress-8.in']);
  });

  it('generates a new name by default and overwrites only when requested', async () => {
    const dir = await tempDir();
    await saveFailedCaseAsSampleFiles({
      source: 'stress',
      round: 5,
      input: 'old',
      expected: 'old ans'
    }, { samplesDir: dir });
    const second = await saveFailedCaseAsSampleFiles({
      source: 'stress',
      round: 5,
      input: 'new',
      expected: 'new ans'
    }, { samplesDir: dir });

    expect(path.basename(second.inputPath)).toBe('stress-5-2.in');
    expect(await fs.readFile(path.join(dir, 'stress-5.in'), 'utf8')).toBe('old');

    const overwritten = await saveFailedCaseAsSampleFiles({
      source: 'stress',
      round: 5,
      input: 'overwrite',
      expected: 'overwrite ans'
    }, { samplesDir: dir, overwrite: true });

    expect(path.basename(overwritten.inputPath)).toBe('stress-5.in');
    expect(await fs.readFile(path.join(dir, 'stress-5.in'), 'utf8')).toBe('overwrite');
  });
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-failed-case-'));
  tempDirs.push(dir);
  return dir;
}
