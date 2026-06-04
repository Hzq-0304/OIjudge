import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  clearProblemGeneratorProgram,
  createProblem,
  getProblem,
  getProblemGeneratorProgram,
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
          source: 'gen.cpp'
        }
      ]
    });
    expect(updated ? getProblemGeneratorProgram(updated) : undefined).toBe('gen.cpp');
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
