import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  addProblemGenerator,
  addProblemGeneratorInputs,
  clearProblemGeneratorProgram,
  createProblemSubtaskGeneratorInputFile,
  createProblem,
  createProblemSubtask,
  getProblem,
  getProblemGeneratorInputs,
  getProblemGenerators,
  getProblemGeneratorProgram,
  removeProblemGeneratorInput,
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

  it('stores global generator inputs independently from subtask generator bindings', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'generator-inputs', 'small.txt');
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, 'n = 10\n', 'utf8');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const generatorPath = path.join(workspaceFolder.uri.fsPath, 'gen.cpp');
    await fs.writeFile(generatorPath, 'int main() { return 0; }\n', 'utf8');
    const generator = await addProblemGenerator(workspaceFolder, problem.id, generatorPath);
    await setProblemSubtaskGenerator(workspaceFolder, problem.id, subtask?.id ?? '', generator?.generator.id ?? '');

    const first = await addProblemGeneratorInputs(workspaceFolder, problem.id, [inputPath, inputPath]);
    const removed = await removeProblemGeneratorInput(workspaceFolder, problem.id, first?.added[0].id ?? '');
    const updated = await getProblem(workspaceFolder, problem.id);

    expect(first?.added).toHaveLength(1);
    expect(first?.added[0].source?.path).toBe('generator-inputs/small.txt');
    expect(removed?.input.name).toBe('small.txt');
    expect(updated ? getProblemGeneratorInputs(updated) : []).toEqual([]);
    expect(updated?.subtasks?.[0].generatorId).toBe(generator?.generator.id);
    await expect(fs.access(inputPath)).resolves.toBeUndefined();
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

  it('creates and binds an editable subtask generator input file', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');

    const result = await createProblemSubtaskGeneratorInputFile(workspaceFolder, problem.id, subtask?.id ?? '');
    const updated = await getProblem(workspaceFolder, problem.id);

    expect(result?.created).toBe(true);
    expect(result?.inputRel).toBe(`.vscode/.OIJudge/problems/${problem.id}/generator-inputs/${subtask?.id}.txt`);
    expect(updated?.subtasks?.[0].generatorInput).toBe(result?.inputRel);
    await expect(fs.readFile(result?.inputPath ?? '', 'utf8')).resolves.toBe('');
    expect(result?.inputRel.endsWith('.in')).toBe(false);
    expect(result?.inputRel.endsWith('.out')).toBe(false);
  });

  it('reuses an existing subtask generator input file without overwriting it', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    const first = await createProblemSubtaskGeneratorInputFile(workspaceFolder, problem.id, subtask?.id ?? '');
    await fs.writeFile(first?.inputPath ?? '', 'n = 10\n', 'utf8');

    const second = await createProblemSubtaskGeneratorInputFile(workspaceFolder, problem.id, subtask?.id ?? '');

    expect(second?.created).toBe(false);
    expect(second?.inputPath).toBe(first?.inputPath);
    await expect(fs.readFile(second?.inputPath ?? '', 'utf8')).resolves.toBe('n = 10\n');
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
