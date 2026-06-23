import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pickAvailableSampleBaseName,
  sanitizeSampleBaseName,
  saveFailedCaseAsSampleFiles
} from '../../src/failedCaseSamples';
import { createCrossPlatformWorkspace } from './helpers';

let workspacePath: string | undefined;

describe('failed case sample files cross-platform integration', () => {
  afterEach(async () => {
    if (workspacePath) {
      await fs.rm(workspacePath, { recursive: true, force: true });
      workspacePath = undefined;
    }
  });

  it('saves stress failed cases under a samples directory with spaces and resolves conflicts safely', async () => {
    const workspace = await createCrossPlatformWorkspace('OI Judge Failed Case Samples');
    workspacePath = workspace.uri.fsPath;
    const samplesDir = path.join(workspace.uri.fsPath, 'samples');
    await fs.mkdir(samplesDir, { recursive: true });

    const saved = await saveFailedCaseAsSampleFiles({
      source: 'stress',
      round: 37,
      input: '1  2\r\n中文 input\n',
      expected: '3\n',
      actual: '4\r\n'
    }, { samplesDir });

    expect(workspace.uri.fsPath).toContain('OI Judge Failed Case Samples');
    expect(path.basename(saved.inputPath)).toBe('stress-37.in');
    expect(path.basename(saved.answerPath ?? '')).toBe('stress-37.ans');
    expect(path.basename(saved.actualPath ?? '')).toBe('stress-37.actual.txt');
    expect(await fs.readFile(saved.inputPath, 'utf8')).toBe('1  2\r\n中文 input\n');
    expect(await fs.readFile(saved.answerPath ?? '', 'utf8')).toBe('3\n');
    expect(await fs.readFile(saved.actualPath ?? '', 'utf8')).toBe('4\r\n');

    const conflicted = await saveFailedCaseAsSampleFiles({
      source: 'stress',
      round: 37,
      input: 'next',
      expected: 'next ans',
      actual: 'next actual'
    }, { samplesDir });

    expect(path.basename(conflicted.inputPath)).toBe('stress-37-2.in');
    expect(await fs.readFile(saved.inputPath, 'utf8')).toBe('1  2\r\n中文 input\n');
  });

  it('keeps generated names portable across Windows, macOS, and Linux', async () => {
    const workspace = await createCrossPlatformWorkspace('OI Judge Failed Case Samples Safe Names');
    workspacePath = workspace.uri.fsPath;
    const samplesDir = path.join(workspace.uri.fsPath, 'samples');
    await fs.mkdir(samplesDir, { recursive: true });

    const safeName = sanitizeSampleBaseName('a<b>c:d/e\\f|g?h*');
    const saved = await saveFailedCaseAsSampleFiles({
      source: 'judge',
      name: 'a<b>c:d/e\\f|g?h*',
      input: 'input',
      expected: 'answer'
    }, { samplesDir });

    expect(safeName).toBe('a-b-c-d-e-f-g-h');
    expect(path.basename(saved.inputPath)).toBe('failed-a-b-c-d-e-f-g-h.in');
    expect(path.basename(saved.inputPath)).not.toMatch(/[<>:"/\\|?*]/u);

    await fs.writeFile(path.join(samplesDir, 'manual.actual.txt'), 'actual conflict', 'utf8');
    expect(await pickAvailableSampleBaseName(samplesDir, 'manual')).toBe('manual-2');
  });
});
