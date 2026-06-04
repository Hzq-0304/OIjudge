import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import {
  addEmptyProblemSample,
  addExternalProblemSample,
  addProblemInputSample,
  addProblemSample,
  createProblem,
  getProblem
} from '../src/problems';

const workspaces: string[] = [];

describe('problem sample files', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('creates empty manual sample input and answer files', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');

    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);

    expect(sample).toMatchObject({
      index: 1,
      id: 'sample-1',
      input: `.oitest/problems/${problem.id}/samples/sample-1.in`,
      answer: `.oitest/problems/${problem.id}/samples/sample-1.ans`,
      sourceType: 'managed'
    });
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.input ?? ''), 'utf8')).resolves.toBe('');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('');
  });

  it('stores manually entered problem samples with .in and .ans paths', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');

    const sample = await addProblemSample(workspaceFolder, problem.id, '1 2\n', '3\n', { decodeEscapes: false });
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(sample?.input).toBe(`.oitest/problems/${problem.id}/samples/sample-1.in`);
    expect(sample?.answer).toBe(`.oitest/problems/${problem.id}/samples/sample-1.ans`);
    expect(saved?.samples[0].input.endsWith('.in')).toBe(true);
    expect(saved?.samples[0].answer.endsWith('.ans')).toBe(true);
  });

  it('creates a setter input sample without creating its reserved answer file', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');

    const sample = await addProblemInputSample(workspaceFolder, problem.id);
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(sample).toMatchObject({
      index: 1,
      id: 'sample-1',
      name: 'sample-1',
      input: `.oitest/problems/${problem.id}/samples/sample-1.in`,
      answer: `.oitest/problems/${problem.id}/samples/sample-1.ans`,
      sourceType: 'managed'
    });
    expect(saved?.setter?.dataCases?.[0]).toMatchObject({
      sampleId: 'sample-1',
      sampleIndex: 1,
      name: 'sample-1'
    });
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.input ?? ''), 'utf8')).resolves.toBe('');
    await expect(fs.access(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''))).rejects.toThrow();
  });

  it('skips existing sample files before choosing the next index', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const samplesDir = path.join(workspaceFolder.uri.fsPath, '.oitest', 'problems', problem.id, 'samples');
    await fs.mkdir(samplesDir, { recursive: true });
    await fs.writeFile(path.join(samplesDir, 'sample-1.in'), 'old input', 'utf8');
    await fs.writeFile(path.join(samplesDir, 'sample-1.ans'), 'old answer', 'utf8');

    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);

    expect(sample?.index).toBe(2);
    expect(sample?.input).toBe(`.oitest/problems/${problem.id}/samples/sample-2.in`);
    await expect(fs.readFile(path.join(samplesDir, 'sample-1.in'), 'utf8')).resolves.toBe('old input');
  });

  it('keeps external .out answer samples supported', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'case.in');
    const answerPath = path.join(workspaceFolder.uri.fsPath, 'case.out');
    await fs.writeFile(inputPath, 'input', 'utf8');
    await fs.writeFile(answerPath, 'answer', 'utf8');

    const sample = await addExternalProblemSample(workspaceFolder, problem.id, inputPath, answerPath);

    expect(sample?.input).toBe(path.resolve(inputPath));
    expect(sample?.answer).toBe(path.resolve(answerPath));
    expect(sample?.answer.endsWith('.out')).toBe(true);
  });

  it('has localized manual sample creation guidance', () => {
    const message = t('manualSampleFilesCreatedMessage', {
      inputFile: 'sample-1.in',
      answerFile: 'sample-1.ans'
    });

    expect(message).toContain('sample-1.in');
    expect(message).toContain('sample-1.ans');
    expect(message).toContain('Ctrl+S');
  });

  it('has localized setter input sample guidance', () => {
    const message = t('setter.sample.inputCreated', {
      inputFile: 'sample-1.in'
    });

    expect(message).toContain('sample-1.in');
    expect(message).toContain('Ctrl+S');
    expect(t('setter.sample.answerMissing')).toBeTruthy();
    expect(t('setter.sample.noAnswerForJudge', { sampleName: 'sample-1' })).toContain('sample-1');
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-samples-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}
