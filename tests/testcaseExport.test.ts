import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { addProblemSample, createProblem, createProblemSubtask, moveProblemSampleToSubtask, setProblemSampleScore, setProblemSubtaskScoringMode } from '../src/problems';
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
