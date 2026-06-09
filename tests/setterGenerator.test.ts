import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  addProblemGenerator,
  clearProblemGeneratorProgram,
  createProblem,
  createProblemSubtask,
  getProblem,
  getProblemGenerators,
  getProblemGeneratorProgram,
  removeProblemGenerator,
  setProblemSubtaskGenerator,
  setProblemGeneratorProgram
} from '../src/problems';

const workspaces: string[] = [];

describe('setter generator binding', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('stores a selected generator as a workspace-relative setter source', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const generatorPath = path.join(workspaceFolder.uri.fsPath, 'gen.cpp');
    await fs.writeFile(generatorPath, 'int main() { return 0; }\n', 'utf8');

    await setProblemGeneratorProgram(workspaceFolder, problem.id, generatorPath);
    const updated = await getProblem(workspaceFolder, problem.id);

    expect(updated?.setter?.generator).toMatchObject({
      enabled: true,
      generators: [
        {
          id: 'default-generator',
          name: 'gen.cpp',
          source: {
            path: 'gen.cpp',
            name: 'gen.cpp'
          }
        }
      ]
    });
    expect(updated ? getProblemGeneratorProgram(updated) : undefined).toBe('gen.cpp');
  });

  it('supports multiple problem generators and subtask generator references', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const randomPath = path.join(workspaceFolder.uri.fsPath, 'generator', 'random.cpp');
    const chainPath = path.join(workspaceFolder.uri.fsPath, 'generator', 'chain.cpp');
    await fs.mkdir(path.dirname(randomPath), { recursive: true });
    await fs.writeFile(randomPath, 'int main() { return 0; }\n', 'utf8');
    await fs.writeFile(chainPath, 'int main() { return 0; }\n', 'utf8');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');

    const random = await addProblemGenerator(workspaceFolder, problem.id, randomPath);
    const chain = await addProblemGenerator(workspaceFolder, problem.id, chainPath);
    await setProblemSubtaskGenerator(workspaceFolder, problem.id, subtask?.id ?? '', random?.generator.id ?? '');
    const updated = await getProblem(workspaceFolder, problem.id);

    expect(updated ? getProblemGenerators(updated).map((generator) => generator.name) : []).toEqual(['chain.cpp', 'random.cpp']);
    expect(updated?.subtasks?.[0].generatorId).toBe(random?.generator.id);
    expect(chain?.generator.source.path).toBe('generator/chain.cpp');
  });

  it('removes a generator and clears subtask references without deleting files', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const generatorPath = path.join(workspaceFolder.uri.fsPath, 'gen.cpp');
    await fs.writeFile(generatorPath, 'int main() { return 0; }\n', 'utf8');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const added = await addProblemGenerator(workspaceFolder, problem.id, generatorPath);
    await setProblemSubtaskGenerator(workspaceFolder, problem.id, subtask?.id ?? '', added?.generator.id ?? '');

    const result = await removeProblemGenerator(workspaceFolder, problem.id, added?.generator.id ?? '');
    const updated = await getProblem(workspaceFolder, problem.id);

    expect(result?.clearedSubtasks).toBe(1);
    expect(updated ? getProblemGenerators(updated) : []).toEqual([]);
    expect(updated?.subtasks?.[0].generatorId).toBeUndefined();
    await expect(fs.access(generatorPath)).resolves.toBeUndefined();
  });

  it('migrates old string generator source entries to problem source objects', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, 'gen.cpp'), 'int main() { return 0; }\n', 'utf8');
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, '.vscode', '.OIJudge', 'config.json'), `${JSON.stringify({
      version: 1,
      problems: [{
        ...problem,
        setter: {
          ...problem.setter,
          generator: {
            enabled: true,
            generators: [{ id: 'default-generator', name: 'gen.cpp', source: 'gen.cpp' }]
          }
        }
      }]
    }, null, 2)}\n`, 'utf8');

    const updated = await getProblem(workspaceFolder, problem.id);

    expect(updated?.setter?.generator?.generators?.[0].source).toMatchObject({
      path: 'gen.cpp',
      name: 'gen.cpp'
    });
  });

  it('clears the generator binding without deleting the local generator file', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const generatorPath = path.join(workspaceFolder.uri.fsPath, 'gen.cpp');
    await fs.writeFile(generatorPath, 'int main() { return 0; }\n', 'utf8');

    await setProblemGeneratorProgram(workspaceFolder, problem.id, generatorPath);
    await clearProblemGeneratorProgram(workspaceFolder, problem.id);
    const updated = await getProblem(workspaceFolder, problem.id);

    expect(updated?.setter?.generator).toEqual({
      enabled: false,
      generators: []
    });
    expect(updated ? getProblemGeneratorProgram(updated) : undefined).toBeUndefined();
    await expect(fs.access(generatorPath)).resolves.toBeUndefined();
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-generator-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}
