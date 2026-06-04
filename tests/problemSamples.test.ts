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
  applyAllGeneratedAnswersForProblem,
  applyGeneratedAnswerForSample,
  createProblem,
  deleteGeneratedAnswerForSample,
  getProblem,
  getSampleGeneratedAnswerStatus,
  writeGeneratedAnswerForSample
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

  it('writes generated answers without changing the current answer file', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', 'old\n', { decodeEscapes: false });

    const result = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'new\n');
    const saved = await getProblem(workspaceFolder, problem.id);
    const status = await getSampleGeneratedAnswerStatus(workspaceFolder, saved!, saved!.samples[0]);

    expect(result.generatedPath).toContain('generated-answers');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('old\n');
    await expect(fs.readFile(result.generatedPath ?? '', 'utf8')).resolves.toBe('new\n');
    expect(saved?.setter?.generatedAnswers?.[sample?.id ?? '']).toBe(status.relPath);
    expect(status.exists).toBe(true);
  });

  it('applies generated answers and removes pending state', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', 'old\n', { decodeEscapes: false });
    const generated = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'new\n');

    const result = await applyGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0);
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(result.ok).toBe(true);
    await expect(fs.readFile(result.answerPath ?? '', 'utf8')).resolves.toBe('new\n');
    await expect(fs.access(generated.generatedPath ?? '')).rejects.toThrow();
    expect(saved?.setter?.generatedAnswers?.[sample?.id ?? '']).toBeUndefined();
  });

  it('deletes generated answers without changing the current answer file', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', 'old\n', { decodeEscapes: false });
    const generated = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'new\n');

    const result = await deleteGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0);
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(result.ok).toBe(true);
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('old\n');
    await expect(fs.access(generated.generatedPath ?? '')).rejects.toThrow();
    expect(saved?.setter?.generatedAnswers?.[sample?.id ?? '']).toBeUndefined();
  });

  it('keeps .out answer paths when applying generated answers', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'case.in');
    const answerPath = path.join(workspaceFolder.uri.fsPath, 'case.out');
    await fs.writeFile(inputPath, 'input', 'utf8');
    await fs.writeFile(answerPath, 'old', 'utf8');
    const sample = await addExternalProblemSample(workspaceFolder, problem.id, inputPath, answerPath);
    await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'new');

    const result = await applyGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0);

    expect(result.ok).toBe(true);
    expect(result.answerPath).toBe(path.resolve(answerPath));
    await expect(fs.readFile(answerPath, 'utf8')).resolves.toBe('new');
  });

  it('creates the reserved .ans file when applying an input-only setter sample', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemInputSample(workspaceFolder, problem.id);
    await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'answer\n');

    const result = await applyGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0);

    expect(result.ok).toBe(true);
    expect(result.answerPath?.endsWith('sample-1.ans')).toBe(true);
    await expect(fs.readFile(result.answerPath ?? '', 'utf8')).resolves.toBe('answer\n');
  });

  it('applies all generated answers only for the current problem', async () => {
    const workspaceFolder = await createWorkspace();
    const first = await createProblem(workspaceFolder, 'A');
    const second = await createProblem(workspaceFolder, 'B');
    const firstSample = await addProblemSample(workspaceFolder, first.id, '1\n', 'old-a\n', { decodeEscapes: false });
    const secondSample = await addProblemSample(workspaceFolder, second.id, '2\n', 'old-b\n', { decodeEscapes: false });
    const firstGenerated = await writeGeneratedAnswerForSample(workspaceFolder, first.id, firstSample?.index ?? 0, 'new-a\n');
    const secondGenerated = await writeGeneratedAnswerForSample(workspaceFolder, second.id, secondSample?.index ?? 0, 'new-b\n');

    const result = await applyAllGeneratedAnswersForProblem(workspaceFolder, first.id);

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    await expect(fs.access(firstGenerated.generatedPath ?? '')).rejects.toThrow();
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, firstSample?.answer ?? ''), 'utf8')).resolves.toBe('new-a\n');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, secondSample?.answer ?? ''), 'utf8')).resolves.toBe('old-b\n');
    await expect(fs.readFile(secondGenerated.generatedPath ?? '', 'utf8')).resolves.toBe('new-b\n');
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
    expect(t('setter.generatedOutput.notAppliedForJudge', { sampleName: 'sample-1' })).toContain('sample-1');
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-samples-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}
