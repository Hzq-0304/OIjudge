import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addExternalProblemSample,
  addProblemSample,
  createProblem,
  createProblemSubtask,
  ensureProblemsConfig,
  getProblem,
  moveProblemSampleToSubtask,
  moveProblemSamplesAfterExport,
  setProblemSampleScore,
  setProblemSubtaskResult,
  setProblemSubtaskScoringMode,
  setProblemTotalScore,
  writeGeneratedAnswerForSample,
  writeProblemsConfig
} from '../src/problems';
import { createTestcaseExportModeItems } from '../src/extension';
import { exportTestcases, shouldGenerateTestcaseConfig } from '../src/testcaseExport';

const workspaces: string[] = [];

describe('testcase export', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('skips config.yml when there are no manual scores or bundled subtasks', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    const result = await exportTestcases(workspaceFolder, (await importProblem(workspaceFolder, problem.id)), targetDir);

    expect(result.configGenerated).toBe(false);
    await expect(fs.access(path.join(targetDir, 'sample-1.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'sample-1.out'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, '.OIJudge', 'config.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'config.yml'))).rejects.toThrow();
  });

  it('generates Luogu config from effective scores and bundled subtasks only', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const first = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(workspaceFolder, problem.id, '2\n', '2\n', { decodeEscapes: false });
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Bundle');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, first?.id ?? '', subtask?.id);
    await setProblemSubtaskScoringMode(workspaceFolder, problem.id, subtask?.id ?? '', 'bundle');
    await setProblemSampleScore(workspaceFolder, problem.id, second?.id ?? '', 30);
    const updated = await importProblem(workspaceFolder, problem.id);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    const result = await exportTestcases(workspaceFolder, updated, targetDir, 'luogu');
    const yaml = await fs.readFile(path.join(targetDir, 'config.yml'), 'utf8');

    expect(shouldGenerateTestcaseConfig(updated)).toBe(true);
    expect(result.configGenerated).toBe(true);
    expect(yaml).toContain('sample-1.in:\n  score: 70\n  subtaskId: 1');
    expect(yaml).toContain('sample-2.in:\n  score: 30');
  });

  it('generates Polygon import plan with bundled groups only', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const first = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(workspaceFolder, problem.id, '2\n', '2\n', { decodeEscapes: false });
    const third = await addProblemSample(workspaceFolder, problem.id, '3\n', '3\n', { decodeEscapes: false });
    const bundled = await createProblemSubtask(workspaceFolder, problem.id, 'Bundle');
    const summed = await createProblemSubtask(workspaceFolder, problem.id, 'Sum');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, first?.id ?? '', bundled?.id);
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, second?.id ?? '', summed?.id);
    await setProblemSubtaskScoringMode(workspaceFolder, problem.id, bundled?.id ?? '', 'bundle');
    await setProblemSubtaskScoringMode(workspaceFolder, problem.id, summed?.id ?? '', 'sum');
    await setProblemSampleScore(workspaceFolder, problem.id, first?.id ?? '', 10);
    await setProblemSampleScore(workspaceFolder, problem.id, second?.id ?? '', 20);
    await setProblemSampleScore(workspaceFolder, problem.id, third?.id ?? '', 30);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    const result = await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir, 'polygon');
    const plan = JSON.parse(await fs.readFile(path.join(targetDir, 'polygon.json'), 'utf8')) as {
      format: string;
      tests: Array<{ inputFile: string; points: number; group?: string }>;
      groups: Array<{ name: string; pointsPolicy: string }>;
      notes: string[];
    };
    const readme = await fs.readFile(path.join(targetDir, 'POLYGON_EXPORT_README.txt'), 'utf8');

    expect(result.configGenerated).toBe(true);
    expect(plan.format).toBe('oijudge-polygon-import-plan');
    expect(plan.tests).toEqual([
      expect.objectContaining({ inputFile: 'sample-1.in', points: 10, group: 'subtask-1' }),
      expect.objectContaining({ inputFile: 'sample-2.in', points: 20 }),
      expect.objectContaining({ inputFile: 'sample-3.in', points: 30 })
    ]);
    expect(plan.tests[1]).not.toHaveProperty('group');
    expect(plan.tests[2]).not.toHaveProperty('group');
    expect(plan.groups).toEqual([
      expect.objectContaining({ name: 'subtask-1', pointsPolicy: 'COMPLETE_GROUP' })
    ]);
    expect(plan.notes[0]).toContain('not an official Polygon package');
    expect(readme).toContain('not an official Polygon package file');
  });

  it('generates LemonLime contest with bundled subtasks merged into one testcase', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'Lemon Problem');
    const first = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(workspaceFolder, problem.id, '2\n', '2\n', { decodeEscapes: false });
    const third = await addProblemSample(workspaceFolder, problem.id, '3\n', '3\n', { decodeEscapes: false });
    const bundled = await createProblemSubtask(workspaceFolder, problem.id, 'Bundle');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, first?.id ?? '', bundled?.id);
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, second?.id ?? '', bundled?.id);
    await setProblemSubtaskScoringMode(workspaceFolder, problem.id, bundled?.id ?? '', 'bundle');
    await setProblemSampleScore(workspaceFolder, problem.id, first?.id ?? '', 10);
    await setProblemSampleScore(workspaceFolder, problem.id, second?.id ?? '', 20);
    await setProblemSampleScore(workspaceFolder, problem.id, third?.id ?? '', 30);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    const result = await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir, 'lemonlime');
    const contest = JSON.parse(await fs.readFile(path.join(targetDir, 'contest.cdf'), 'utf8')) as {
      tasks: Array<{
        problemTitle: string;
        sourceFileName: string;
        testCases: Array<{ fullScore: number; inputFiles: string[]; outputFiles: string[] }>;
      }>;
    };
    const readme = await fs.readFile(path.join(targetDir, 'LEMONLIME_EXPORT_README.txt'), 'utf8');

    expect(result.configGenerated).toBe(true);
    await expect(fs.access(path.join(targetDir, 'data', 'Lemon_Problem', 'sample-1.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'data', 'Lemon_Problem', 'sample-1.out'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'source'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, '.OIJudge', 'config.json'))).resolves.toBeUndefined();
    expect(contest.tasks[0].problemTitle).toBe('Lemon Problem');
    expect(contest.tasks[0].sourceFileName).toBe('Lemon_Problem');
    expect(contest.tasks[0].testCases).toEqual([
      expect.objectContaining({
        fullScore: 30,
        inputFiles: ['Lemon_Problem/sample-3.in'],
        outputFiles: ['Lemon_Problem/sample-3.out']
      }),
      expect.objectContaining({
        fullScore: 30,
        inputFiles: ['Lemon_Problem/sample-1.in', 'Lemon_Problem/sample-2.in'],
        outputFiles: ['Lemon_Problem/sample-1.out', 'Lemon_Problem/sample-2.out']
      })
    ]);
    expect(readme).toContain('Bundled OI Judge subtasks are exported as one LemonLime TestCase');
  });

  it('records warnings for missing outputs without skipping inputs', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    await fs.rm(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''));
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    const result = await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir);

    expect(result.warnings).toHaveLength(1);
    await expect(fs.access(path.join(targetDir, 'sample-1.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'sample-1.out'))).rejects.toThrow();
  });

  it('keeps copy export non-destructive for managed samples', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const inputPath = path.join(workspaceFolder.uri.fsPath, sample?.input ?? '');
    const answerPath = path.join(workspaceFolder.uri.fsPath, sample?.answer ?? '');
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir);
    const updated = await importProblem(workspaceFolder, problem.id);

    expect(updated.samples.map((entry) => entry.id)).toEqual([sample?.id]);
    await expect(fs.access(inputPath)).resolves.toBeUndefined();
    await expect(fs.access(answerPath)).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'sample-1.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'sample-1.out'))).resolves.toBeUndefined();
  });

  it('moves managed samples after successful export and persists related config cleanup', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', 'answer\n', { decodeEscapes: false });
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Bundle');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, sample?.id ?? '', subtask?.id);
    await setProblemSubtaskScoringMode(workspaceFolder, problem.id, subtask?.id ?? '', 'bundle');
    await setProblemSubtaskResult(workspaceFolder, problem.id, subtask?.id ?? '', {
      status: 'passed',
      passed: 1,
      total: 1,
      updatedAt: '2026-06-16T00:00:00.000Z'
    });
    await setProblemTotalScore(workspaceFolder, problem.id, 150);
    await setProblemSampleScore(workspaceFolder, problem.id, sample?.id ?? '', 50);
    const pending = await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'generated\n');
    const inputPath = path.join(workspaceFolder.uri.fsPath, sample?.input ?? '');
    const answerPath = path.join(workspaceFolder.uri.fsPath, sample?.answer ?? '');
    const generatedPath = pending.ok && pending.mode === 'pending' ? pending.generatedPath : undefined;
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir, 'luogu');
    const moved = await moveProblemSamplesAfterExport(workspaceFolder, problem.id, [sample?.id ?? '']);
    const updated = await importProblem(workspaceFolder, problem.id);

    expect(moved.samples.map((entry) => entry.id)).toEqual([sample?.id]);
    expect(moved.cleanupErrors).toEqual([]);
    expect(updated.samples).toEqual([]);
    expect(updated.score?.total).toBe(150);
    expect(updated.subtasks?.[0].sampleIds).toEqual([]);
    expect(updated.subtasks?.[0].scoringMode).toBe('bundle');
    expect(updated.subtasks?.[0].lastResult).toBeUndefined();
    expect(updated.setter?.generatedAnswers?.[sample?.id ?? '']).toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'sample-1.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'sample-1.out'))).resolves.toBeUndefined();
    await expect(fs.access(inputPath)).rejects.toThrow();
    await expect(fs.access(answerPath)).rejects.toThrow();
    if (generatedPath) {
      await expect(fs.access(generatedPath)).rejects.toThrow();
    }
    expect((await getProblem(workspaceFolder, problem.id))?.samples).toEqual([]);
  });

  it('moves external sample references without deleting external files', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const externalDir = path.join(workspaceFolder.uri.fsPath, 'external');
    const inputPath = path.join(externalDir, 'case.in');
    const answerPath = path.join(externalDir, 'case.out');
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(inputPath, 'input\n', 'utf8');
    await fs.writeFile(answerPath, 'answer\n', 'utf8');
    const sample = await addExternalProblemSample(workspaceFolder, problem.id, inputPath, answerPath);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir);
    const moved = await moveProblemSamplesAfterExport(workspaceFolder, problem.id, [sample?.id ?? '']);
    const updated = await importProblem(workspaceFolder, problem.id);

    expect(moved.cleanupErrors).toEqual([]);
    expect(updated.samples).toEqual([]);
    await expect(fs.access(path.join(targetDir, 'case.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'case.out'))).resolves.toBeUndefined();
    await expect(fs.access(inputPath)).resolves.toBeUndefined();
    await expect(fs.access(answerPath)).resolves.toBeUndefined();
  });

  it('does not remove samples or source files when export fails', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const first = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(workspaceFolder, problem.id, '2\n', '2\n', { decodeEscapes: false });
    await setProblemTotalScore(workspaceFolder, problem.id, 10);
    await setProblemSampleScore(workspaceFolder, problem.id, first?.id ?? '', 10);
    await setProblemSampleScore(workspaceFolder, problem.id, second?.id ?? '', 10);
    const firstInput = path.join(workspaceFolder.uri.fsPath, first?.input ?? '');
    const secondInput = path.join(workspaceFolder.uri.fsPath, second?.input ?? '');
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    await expect(exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir, 'luogu'))
      .rejects.toThrow('score.invalid');
    const updated = await importProblem(workspaceFolder, problem.id);

    expect(updated.samples.map((sample) => sample.id)).toEqual([first?.id, second?.id]);
    await expect(fs.access(firstInput)).resolves.toBeUndefined();
    await expect(fs.access(secondInput)).resolves.toBeUndefined();
  });

  it('skips unsafe generated answer cleanup paths during move', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const unsafeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-external-generated-'));
    workspaces.push(unsafeDir);
    const unsafePath = path.join(unsafeDir, 'generated.out');
    await fs.writeFile(unsafePath, 'do not delete\n', 'utf8');
    const problems = await ensureProblemsConfig(workspaceFolder);
    const stored = problems.problems.find((entry) => entry.id === problem.id);
    if (!stored) {
      throw new Error('Problem not found');
    }
    stored.setter = {
      ...(stored.setter ?? {}),
      generatedAnswers: {
        ...(stored.setter?.generatedAnswers ?? {}),
        [sample?.id ?? '']: unsafePath
      }
    };
    await writeProblemsConfig(workspaceFolder, problems);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    await exportTestcases(workspaceFolder, await importProblem(workspaceFolder, problem.id), targetDir);
    const moved = await moveProblemSamplesAfterExport(workspaceFolder, problem.id, [sample?.id ?? '']);

    expect(moved.cleanupErrors.some((warning) => warning.includes('Skipped unsafe managed cleanup path'))).toBe(true);
    await expect(fs.access(unsafePath)).resolves.toBeUndefined();
    expect((await importProblem(workspaceFolder, problem.id)).setter?.generatedAnswers?.[sample?.id ?? '']).toBeUndefined();
  });

  it('keeps copy and move export mode items wired to the correct modes', () => {
    const items = createTestcaseExportModeItems();

    expect(items.map((item) => item.mode)).toEqual(['copy', 'move']);
    expect(items[0].label).toBe('Copy');
    expect(items[1].label).toBe('Move');
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-export-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}

async function importProblem(workspaceFolder: vscode.WorkspaceFolder, problemId: string) {
  const { getProblem } = await import('../src/problems');
  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    throw new Error('Problem not found');
  }
  return problem;
}
