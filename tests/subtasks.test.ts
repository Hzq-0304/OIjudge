import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { getOiJudgeConfigPath } from '../src/config';
import {
  addEmptyProblemSample,
  createProblem,
  createProblemSubtask,
  deleteProblemSubtask,
  getProblem,
  getUnassignedProblemSamples,
  moveProblemSampleToSubtask,
  renameProblemSubtask,
  clearProblemSubtaskGeneratorInput,
  setProblemSubtaskGeneratorInput,
  setProblemSubtaskResult,
  writeProblemsConfig
} from '../src/problems';

const workspaces: string[] = [];

describe('problem subtasks', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('treats old configs without subtasks as an empty subtask list', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const { subtasks, ...withoutSubtasks } = problem;
    await writeProblemsConfig(workspaceFolder, {
      version: 1,
      problems: [withoutSubtasks]
    });

    const saved = await getProblem(workspaceFolder, problem.id);

    expect(subtasks).toEqual([]);
    expect(saved?.subtasks).toEqual([]);
  });

  it('creates stable subtask ids and stores them in .vscode/.OIJudge', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');

    const first = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const second = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const renamed = await renameProblemSubtask(workspaceFolder, problem.id, first?.id ?? '', 'Main Group');
    const raw = await fs.readFile(getOiJudgeConfigPath(workspaceFolder), 'utf8');

    expect(first?.id).toBe('subtask-1');
    expect(second?.id).toBe('subtask-2');
    expect(second?.name).toBe('Subtask 1 2');
    expect(renamed?.id).toBe(first?.id);
    expect(renamed?.name).toBe('Main Group');
    expect(raw).toContain('"subtasks"');
  });

  it('moves each sample into at most one subtask and clears affected results', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);
    const first = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const second = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 2');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, sample?.id ?? '', first?.id);
    await setProblemSubtaskResult(workspaceFolder, problem.id, first?.id ?? '', { status: 'passed', passed: 1, total: 1 });
    await setProblemSubtaskResult(workspaceFolder, problem.id, second?.id ?? '', { status: 'passed', passed: 1, total: 1 });

    await moveProblemSampleToSubtask(workspaceFolder, problem.id, sample?.id ?? '', second?.id);
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(saved?.subtasks?.find((entry) => entry.id === first?.id)?.sampleIds).toEqual([]);
    expect(saved?.subtasks?.find((entry) => entry.id === second?.id)?.sampleIds).toEqual([sample?.id]);
    expect(saved?.subtasks?.find((entry) => entry.id === first?.id)?.lastResult).toBeUndefined();
    expect(saved?.subtasks?.find((entry) => entry.id === second?.id)?.lastResult).toBeUndefined();
    expect(getUnassignedProblemSamples(saved!).map((entry) => entry.id)).toEqual([]);
  });

  it('moves samples back to unassigned without deleting sample files', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, sample?.id ?? '', subtask?.id);

    await moveProblemSampleToSubtask(workspaceFolder, problem.id, sample?.id ?? '', undefined);
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(saved?.subtasks?.[0].sampleIds).toEqual([]);
    expect(getUnassignedProblemSamples(saved!).map((entry) => entry.id)).toEqual([sample?.id]);
    await expect(fs.access(path.join(workspaceFolder.uri.fsPath, sample?.input ?? ''))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''))).resolves.toBeUndefined();
  });

  it('deletes subtasks while keeping their samples as unassigned', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, sample?.id ?? '', subtask?.id);

    const deleted = await deleteProblemSubtask(workspaceFolder, problem.id, subtask?.id ?? '');
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(deleted).toBe(true);
    expect(saved?.subtasks).toEqual([]);
    expect(getUnassignedProblemSamples(saved!).map((entry) => entry.id)).toEqual([sample?.id]);
    await expect(fs.access(path.join(workspaceFolder.uri.fsPath, sample?.input ?? ''))).resolves.toBeUndefined();
  });

  it('binds generator input to a subtask using a workspace-relative path', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'data', 'subtask1.txt');
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, 'n=10\n', 'utf8');

    const updated = await setProblemSubtaskGeneratorInput(
      workspaceFolder,
      problem.id,
      subtask?.id ?? '',
      inputPath
    );
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(updated?.generatorInput).toBe('data/subtask1.txt');
    expect(saved?.subtasks?.[0].generatorInput).toBe('data/subtask1.txt');
  });

  it('clears subtask generator input binding without deleting the file', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'data', 'subtask1.txt');
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, 'n=10\n', 'utf8');
    await setProblemSubtaskGeneratorInput(workspaceFolder, problem.id, subtask?.id ?? '', inputPath);

    const updated = await clearProblemSubtaskGeneratorInput(workspaceFolder, problem.id, subtask?.id ?? '');
    const saved = await getProblem(workspaceFolder, problem.id);

    expect(updated?.generatorInput).toBeUndefined();
    expect(saved?.subtasks?.[0].generatorInput).toBeUndefined();
    await expect(fs.access(inputPath)).resolves.toBeUndefined();
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-subtasks-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}
