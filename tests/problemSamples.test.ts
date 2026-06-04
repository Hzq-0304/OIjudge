import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { addSample, createDefaultConfig } from '../src/config';
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
  isAnswerFileEmpty,
  writeProblemsConfig,
  writeGeneratedAnswerForSample
} from '../src/problems';

const workspaces: string[] = [];

describe('problem sample files', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('creates empty manual sample input and .out answer files', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');

    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);

    expect(sample).toMatchObject({
      index: 1,
      id: 'sample-1',
      input: `.oitest/problems/${problem.id}/samples/sample-1.in`,
      answer: `.oitest/problems/${problem.id}/samples/sample-1.out`,
      sourceType: 'managed'
    });
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.input ?? ''), 'utf8')).resolves.toBe('');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('');
  });

  it('stores manually entered problem samples with .in and .out paths', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');

    const sample = await addProblemSample(workspaceFolder, problem.id, '1 2\n', '3\n', { decodeEscapes: false });
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(sample?.input).toBe(`.oitest/problems/${problem.id}/samples/sample-1.in`);
    expect(sample?.answer).toBe(`.oitest/problems/${problem.id}/samples/sample-1.out`);
    expect(saved?.samples[0].input.endsWith('.in')).toBe(true);
    expect(saved?.samples[0].answer.endsWith('.out')).toBe(true);
  });

  it('uses .out for legacy single-problem managed samples too', async () => {
    const workspaceFolder = await createWorkspace();
    const config = createDefaultConfig();

    const sample = await addSample(workspaceFolder, config, '1\n', '2\n', { decodeEscapes: false });

    expect(sample.input).toBe('.oitest/samples/1.in');
    expect(sample.answer).toBe('.oitest/samples/1.out');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample.answer), 'utf8')).resolves.toBe('2\n');
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
      answer: `.oitest/problems/${problem.id}/samples/sample-1.out`,
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
    await fs.writeFile(path.join(samplesDir, 'sample-1.out'), 'old answer', 'utf8');

    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);

    expect(sample?.index).toBe(2);
    expect(sample?.input).toBe(`.oitest/problems/${problem.id}/samples/sample-2.in`);
    await expect(fs.readFile(path.join(samplesDir, 'sample-1.in'), 'utf8')).resolves.toBe('old input');
  });

  it('skips legacy .ans files before choosing the next managed sample index', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const samplesDir = path.join(workspaceFolder.uri.fsPath, '.oitest', 'problems', problem.id, 'samples');
    await fs.mkdir(samplesDir, { recursive: true });
    await fs.writeFile(path.join(samplesDir, 'sample-1.ans'), 'old answer', 'utf8');

    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);

    expect(sample?.index).toBe(2);
    expect(sample?.answer).toBe(`.oitest/problems/${problem.id}/samples/sample-2.out`);
    await expect(fs.readFile(path.join(samplesDir, 'sample-1.ans'), 'utf8')).resolves.toBe('old answer');
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

    expect(result.ok && result.mode).toBe('pending');
    expect(result.ok && result.mode === 'pending' ? result.generatedPath : '').toContain('generated-answers');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('old\n');
    await expect(fs.readFile(result.ok && result.mode === 'pending' ? result.generatedPath : '', 'utf8')).resolves.toBe('new\n');
    expect(saved?.setter?.generatedAnswers?.[sample?.id ?? '']).toBe(status.relPath);
    expect(status.exists).toBe(true);
  });

  it('writes directly to empty and whitespace-only answer files without pending output', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const empty = await addProblemSample(workspaceFolder, problem.id, '1\n', '', { decodeEscapes: false });
    const whitespace = await addProblemSample(workspaceFolder, problem.id, '2\n', ' \n\t', { decodeEscapes: false });

    const emptyResult = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, empty?.index ?? 0, 'answer-1\n');
    const whitespaceResult = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, whitespace?.index ?? 0, 'answer-2\n');
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(emptyResult.ok && emptyResult.mode).toBe('direct');
    expect(whitespaceResult.ok && whitespaceResult.mode).toBe('direct');
    expect(emptyResult.ok && emptyResult.mode === 'direct' ? emptyResult.answerCreated : true).toBe(false);
    expect(whitespaceResult.ok && whitespaceResult.mode === 'direct' ? whitespaceResult.answerCreated : true).toBe(false);
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, empty?.answer ?? ''), 'utf8')).resolves.toBe('answer-1\n');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, whitespace?.answer ?? ''), 'utf8')).resolves.toBe('answer-2\n');
    expect(saved?.setter?.generatedAnswers).toEqual({});
  });

  it('treats missing answer files as empty and creates them directly', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemInputSample(workspaceFolder, problem.id);

    const result = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'answer\n');
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(result.ok && result.mode).toBe('direct');
    expect(result.ok && result.mode === 'direct' ? result.answerCreated : false).toBe(true);
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('answer\n');
    expect(saved?.setter?.generatedAnswers).toEqual({});
  });

  it('creates a default .out path and writes it when answer config is missing', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemInputSample(workspaceFolder, problem.id);
    const withoutAnswer = { ...sample, answer: undefined } as unknown as NonNullable<typeof sample>;
    await writeProblemsConfig(workspaceFolder, {
      version: 1,
      problems: [{ ...problem, samples: [withoutAnswer] }]
    });

    const result = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'answer\n');
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(result.ok && result.mode).toBe('direct');
    expect(saved?.samples[0].answer.endsWith('sample-1.out')).toBe(true);
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, saved?.samples[0].answer ?? ''), 'utf8')).resolves.toBe('answer\n');
    expect(saved?.setter?.generatedAnswers).toEqual({});
  });

  it('detects missing, empty, whitespace-only, and non-empty answer files', async () => {
    const workspaceFolder = await createWorkspace();
    const missing = path.join(workspaceFolder.uri.fsPath, 'missing.ans');
    const empty = path.join(workspaceFolder.uri.fsPath, 'empty.ans');
    const whitespace = path.join(workspaceFolder.uri.fsPath, 'whitespace.ans');
    const nonEmpty = path.join(workspaceFolder.uri.fsPath, 'non-empty.ans');
    await fs.writeFile(empty, '', 'utf8');
    await fs.writeFile(whitespace, ' \n\t', 'utf8');
    await fs.writeFile(nonEmpty, '0\n', 'utf8');

    await expect(isAnswerFileEmpty(missing)).resolves.toBe(true);
    await expect(isAnswerFileEmpty(empty)).resolves.toBe(true);
    await expect(isAnswerFileEmpty(whitespace)).resolves.toBe(true);
    await expect(isAnswerFileEmpty(nonEmpty)).resolves.toBe(false);
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
    await expect(fs.access(generated.ok && generated.mode === 'pending' ? generated.generatedPath : '')).rejects.toThrow();
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
    await expect(fs.access(generated.ok && generated.mode === 'pending' ? generated.generatedPath : '')).rejects.toThrow();
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

  it('writes directly to empty .out answers and keeps non-empty .out answers pending', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const emptyInputPath = path.join(workspaceFolder.uri.fsPath, 'empty-case.in');
    const emptyAnswerPath = path.join(workspaceFolder.uri.fsPath, 'empty-case.out');
    const filledInputPath = path.join(workspaceFolder.uri.fsPath, 'filled-case.in');
    const filledAnswerPath = path.join(workspaceFolder.uri.fsPath, 'filled-case.out');
    await fs.writeFile(emptyInputPath, 'input', 'utf8');
    await fs.writeFile(emptyAnswerPath, '', 'utf8');
    await fs.writeFile(filledInputPath, 'input', 'utf8');
    await fs.writeFile(filledAnswerPath, 'old', 'utf8');
    const emptySample = await addExternalProblemSample(workspaceFolder, problem.id, emptyInputPath, emptyAnswerPath);
    const filledSample = await addExternalProblemSample(workspaceFolder, problem.id, filledInputPath, filledAnswerPath);

    const emptyResult = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, emptySample?.index ?? 0, 'new-empty');
    const filledResult = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, filledSample?.index ?? 0, 'new-filled');

    expect(emptyResult.ok && emptyResult.mode).toBe('direct');
    expect(filledResult.ok && filledResult.mode).toBe('pending');
    await expect(fs.readFile(emptyAnswerPath, 'utf8')).resolves.toBe('new-empty');
    await expect(fs.readFile(filledAnswerPath, 'utf8')).resolves.toBe('old');
    await expect(fs.readFile(filledResult.ok && filledResult.mode === 'pending' ? filledResult.generatedPath : '', 'utf8')).resolves.toBe('new-filled');
  });

  it('clears stale pending output when a later generation writes directly', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', 'old\n', { decodeEscapes: false });
    const pending = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'pending\n');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), '', 'utf8');

    const direct = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'direct\n');
    const saved = await getProblem(workspaceFolder, problem.id);
    const status = await getSampleGeneratedAnswerStatus(workspaceFolder, saved!, saved!.samples[0]);

    expect(pending.ok && pending.mode).toBe('pending');
    expect(direct.ok && direct.mode).toBe('direct');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'utf8')).resolves.toBe('direct\n');
    await expect(fs.access(pending.ok && pending.mode === 'pending' ? pending.generatedPath : '')).rejects.toThrow();
    expect(saved?.setter?.generatedAnswers?.[sample?.id ?? '']).toBeUndefined();
    expect(status.exists).toBe(false);
  });

  it('writes directly to the reserved .out file for an input-only setter sample', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemInputSample(workspaceFolder, problem.id);

    const result = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'answer\n');

    expect(result.ok && result.mode).toBe('direct');
    expect(result.ok && result.mode === 'direct' ? result.answerPath.endsWith('sample-1.out') : false).toBe(true);
    await expect(fs.readFile(result.ok && result.mode === 'direct' ? result.answerPath : '', 'utf8')).resolves.toBe('answer\n');
  });

  it('keeps existing .ans answer paths when writing directly', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'case.in');
    const answerPath = path.join(workspaceFolder.uri.fsPath, 'case.ans');
    await fs.writeFile(inputPath, 'input', 'utf8');
    await fs.writeFile(answerPath, '', 'utf8');
    const sample = await addExternalProblemSample(workspaceFolder, problem.id, inputPath, answerPath);

    const result = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'new');

    expect(result.ok && result.mode).toBe('direct');
    expect(result.ok && result.mode === 'direct' ? result.answerPath : '').toBe(path.resolve(answerPath));
    await expect(fs.readFile(answerPath, 'utf8')).resolves.toBe('new');
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
    await expect(fs.access(firstGenerated.ok && firstGenerated.mode === 'pending' ? firstGenerated.generatedPath : '')).rejects.toThrow();
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, firstSample?.answer ?? ''), 'utf8')).resolves.toBe('new-a\n');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, secondSample?.answer ?? ''), 'utf8')).resolves.toBe('old-b\n');
    await expect(fs.readFile(secondGenerated.ok && secondGenerated.mode === 'pending' ? secondGenerated.generatedPath : '', 'utf8')).resolves.toBe('new-b\n');
  });

  it('has localized manual sample creation guidance', () => {
    const message = t('manualSampleFilesCreatedMessage', {
      inputFile: 'sample-1.in',
      answerFile: 'sample-1.out'
    });

    expect(message).toContain('sample-1.in');
    expect(message).toContain('sample-1.out');
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
    expect(t('setter.generatedOutput.writtenDirectly', { sampleName: 'sample-1' })).toContain('sample-1');
    expect(t('setter.generatedOutput.createdAndWritten', { answerFile: 'sample-1.out' })).toContain('sample-1.out');
    expect(t('setter.generatedOutput.generatedPendingBecauseCurrentNotEmpty', { sampleName: 'sample-1' })).toContain('sample-1');
    expect(t('setter.generatedOutput.processedSummary', { total: 3, direct: 2, pending: 1 })).toContain('3');
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-samples-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}
