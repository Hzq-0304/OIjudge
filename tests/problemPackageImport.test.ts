import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addProblemGenerator,
  addProblemGeneratorInputs,
  addProblemSample,
  addProgramToProblem,
  bindProblemStatement,
  createProblem,
  createProblemSubtask,
  getProblem,
  moveProblemSampleToSubtask,
  setProblemDefaultSource,
  setProblemSampleScore,
  setProblemStdProgram,
  setProblemSubtaskGenerator,
  setProblemSubtaskGeneratorInput,
  setProblemSubtaskScoringMode,
  updateProblemChecker,
  updateProblemJudgeMode
} from '../src/problems';
import { exportProblemPackage } from '../src/problemPackageExport';
import {
  importProblemPackage,
  ProblemPackageVersionError,
  validateProblemPackageManifest
} from '../src/problemPackageImport';

const workspaces: string[] = [];

describe('problem package import', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('imports a minimal package into a new managed problem', async () => {
    const workspaceFolder = await createWorkspace('oijudge-package-import-target-');
    const packageDir = await createPackageDir();
    await writeJson(path.join(packageDir, 'oijudge-package.json'), {
      format: 'oijudge-problem-package',
      version: 1,
      problem: { id: 'A', name: 'A', totalScore: 100, timeLimitMs: 2000, memoryLimitMb: 512 },
      files: {
        data: [
          { sampleId: 'sample-1', sampleName: 'First', index: 1, input: 'data/sample-1.in', answer: 'data/sample-1.out', score: 100 }
        ],
        generators: [],
        generatorInputs: [],
        programs: []
      },
      subtasks: [],
      scoring: { totalScore: 100, samples: [{ sampleId: 'sample-1', score: 100, manual: true }], subtasks: [] },
      config: 'config/oijudge-config.json'
    });
    await write(path.join(packageDir, 'data', 'sample-1.in'), '3 4\n');
    await write(path.join(packageDir, 'data', 'sample-1.out'), '7\n');

    const result = await importProblemPackage(workspaceFolder, packageDir);
    const imported = await mustGetProblem(workspaceFolder, result.problem.id);

    expect(result.warnings).toEqual([]);
    expect(imported.name).toBe('A');
    expect(imported.limits.timeMs).toBe(2000);
    expect(imported.limits.memoryMb).toBe(512);
    expect(imported.score?.total).toBe(100);
    expect(imported.samples).toHaveLength(1);
    expect(imported.samples[0]).toMatchObject({
      id: 'sample-1',
      index: 1,
      name: 'First',
      sourceType: 'managed',
      score: 100
    });
    expect(imported.samples[0].input).toBe('.vscode/.OIJudge/problems/A/samples/sample-1.in');
    expect(imported.samples[0].answer).toBe('.vscode/.OIJudge/problems/A/samples/sample-1.out');
    expect(imported.samples[0].input).not.toContain(packageDir);
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, imported.samples[0].input), 'utf8')).resolves.toBe('3 4\n');
    await expect(fs.readFile(path.join(workspaceFolder.uri.fsPath, imported.samples[0].answer), 'utf8')).resolves.toBe('7\n');
  });

  it('imports an exported complete package with statement, programs, STD, checker, generators, subtasks, and scoring', async () => {
    const sourceWorkspace = await createWorkspace('oijudge-package-import-source-');
    const targetWorkspace = await createWorkspace('oijudge-package-import-target-');
    const sourceProblem = await createProblem(sourceWorkspace, 'A');
    const statementPath = path.join(sourceWorkspace.uri.fsPath, 'docs', 'statement.md');
    const solutionPath = path.join(sourceWorkspace.uri.fsPath, 'src', 'solution.cpp');
    const altPath = path.join(sourceWorkspace.uri.fsPath, 'src', 'alt.cpp');
    const stdPath = path.join(sourceWorkspace.uri.fsPath, 'std.cpp');
    const checkerPath = path.join(sourceWorkspace.uri.fsPath, 'checker.cpp');
    const generatorPath = path.join(sourceWorkspace.uri.fsPath, 'gen.cpp');
    const globalInputPath = path.join(sourceWorkspace.uri.fsPath, 'gen input', 'global.txt');
    const subtaskInputPath = path.join(sourceWorkspace.uri.fsPath, 'gen input', 'subtask.txt');
    await write(statementPath, '# A\n');
    await write(solutionPath, 'int main(){return 0;}\n');
    await write(altPath, 'int main(){return 1;}\n');
    await write(stdPath, 'int main(){return 0;}\n');
    await write(checkerPath, 'int main(){return 0;}\n');
    await write(generatorPath, 'int main(){return 0;}\n');
    await write(globalInputPath, 'global\n');
    await write(subtaskInputPath, 'subtask\n');

    const first = await addProblemSample(sourceWorkspace, sourceProblem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(sourceWorkspace, sourceProblem.id, '2\n', '2\n', { decodeEscapes: false });
    await bindProblemStatement(sourceWorkspace, sourceProblem.id, statementPath);
    await addProgramToProblem(sourceWorkspace, sourceProblem.id, solutionPath, { setDefault: true });
    await addProgramToProblem(sourceWorkspace, sourceProblem.id, altPath);
    await setProblemDefaultSource(sourceWorkspace, sourceProblem.id, solutionPath);
    await setProblemStdProgram(sourceWorkspace, sourceProblem.id, stdPath);
    await updateProblemJudgeMode(sourceWorkspace, sourceProblem.id, 'checker');
    await updateProblemChecker(sourceWorkspace, sourceProblem.id, { enabled: true, type: 'plain', source: checkerPath });
    const generator = await addProblemGenerator(sourceWorkspace, sourceProblem.id, generatorPath);
    await addProblemGeneratorInputs(sourceWorkspace, sourceProblem.id, [globalInputPath]);
    const subtask = await createProblemSubtask(sourceWorkspace, sourceProblem.id, 'Bundle');
    await moveProblemSampleToSubtask(sourceWorkspace, sourceProblem.id, first?.id ?? '', subtask?.id);
    await setProblemSampleScore(sourceWorkspace, sourceProblem.id, first?.id ?? '', 40);
    await setProblemSampleScore(sourceWorkspace, sourceProblem.id, second?.id ?? '', 60);
    await setProblemSubtaskScoringMode(sourceWorkspace, sourceProblem.id, subtask?.id ?? '', 'bundle');
    await setProblemSubtaskGenerator(sourceWorkspace, sourceProblem.id, subtask?.id ?? '', generator?.generator.id ?? '');
    await setProblemSubtaskGeneratorInput(sourceWorkspace, sourceProblem.id, subtask?.id ?? '', subtaskInputPath);
    const packageDir = path.join(sourceWorkspace.uri.fsPath, 'export');
    await exportProblemPackage(sourceWorkspace, await mustGetProblem(sourceWorkspace, sourceProblem.id), packageDir);

    const result = await importProblemPackage(targetWorkspace, packageDir);
    const imported = await mustGetProblem(targetWorkspace, result.problem.id);

    expect(result.warnings).toEqual([]);
    expect(imported.statement?.path).toBe('.vscode/.OIJudge/problems/A/statement/statement.md');
    expect(imported.defaultSource).toBe('.vscode/.OIJudge/problems/A/source/solution.cpp');
    expect(imported.sources?.map((source) => source.path)).toEqual(expect.arrayContaining([
      '.vscode/.OIJudge/problems/A/source/solution.cpp',
      '.vscode/.OIJudge/problems/A/source/programs/solution.cpp',
      '.vscode/.OIJudge/problems/A/source/programs/alt.cpp'
    ]));
    expect(imported.setter?.stdProgram).toBe('.vscode/.OIJudge/problems/A/std/std.cpp');
    expect(imported.checker).toMatchObject({
      enabled: true,
      type: 'plain',
      source: '.vscode/.OIJudge/problems/A/checker/checker.cpp'
    });
    expect(imported.setter?.generator?.generators?.[0].source?.path).toBe('.vscode/.OIJudge/problems/A/generators/gen.cpp');
    expect(imported.generatorInputs?.[0].source?.path).toBe('.vscode/.OIJudge/problems/A/generator-inputs/global.txt');
    expect(imported.subtasks?.[0]).toMatchObject({
      name: 'Bundle',
      scoringMode: 'bundle',
      sampleIds: ['sample-1'],
      generatorId: generator?.generator.id,
      generatorInput: '.vscode/.OIJudge/problems/A/generator-inputs/subtask.txt'
    });
    expect(imported.samples.map((sample) => sample.score)).toEqual([40, 60]);
    expect(imported.samples.every((sample) => !sample.input.includes(packageDir) && !sample.answer.includes(packageDir))).toBe(true);
    await expect(fs.access(path.join(targetWorkspace.uri.fsPath, imported.statement?.path ?? ''))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetWorkspace.uri.fsPath, imported.setter?.stdProgram ?? ''))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetWorkspace.uri.fsPath, imported.checker?.source ?? ''))).resolves.toBeUndefined();
  });

  it('rejects invalid manifests and exposes newer-version confirmation state', () => {
    expect(() => validateProblemPackageManifest({ format: 'other', version: 1 })).toThrow('import.problemPackage.invalidFormat');
    expect(() => validateProblemPackageManifest({ format: 'oijudge-problem-package', version: 2 })).toThrow(ProblemPackageVersionError);
    expect(() => validateProblemPackageManifest(
      { format: 'oijudge-problem-package', version: 2 },
      { allowNewerVersion: true }
    )).not.toThrow();
  });

  it('imports available inputs with warnings for missing files', async () => {
    const workspaceFolder = await createWorkspace('oijudge-package-import-target-');
    const packageDir = await createPackageDir();
    await writeJson(path.join(packageDir, 'oijudge-package.json'), {
      format: 'oijudge-problem-package',
      version: 1,
      problem: { id: 'A', name: 'A' },
      files: {
        data: [
          { sampleId: 'sample-1', index: 1, input: 'data/sample-1.in', answer: 'data/sample-1.out' },
          { sampleId: 'sample-2', index: 2, input: 'data/missing.in' }
        ],
        statement: 'statement/missing.md',
        programs: [],
        generators: [],
        generatorInputs: []
      },
      subtasks: [],
      scoring: { samples: [], subtasks: [] }
    });
    await write(path.join(packageDir, 'data', 'sample-1.in'), '1\n');

    const result = await importProblemPackage(workspaceFolder, packageDir);

    expect(result.problem.samples).toHaveLength(1);
    expect(result.problem.samples[0].answer).toBe('.vscode/.OIJudge/problems/A/samples/sample-1.out');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('sample 1 answer file missing'),
      expect.stringContaining('sample 2 input file missing'),
      expect.stringContaining('statement file missing')
    ]));
    await expect(fs.access(path.join(workspaceFolder.uri.fsPath, result.problem.samples[0].answer))).rejects.toThrow();
  });

  it('uniquifies imported problem names and ids', async () => {
    const workspaceFolder = await createWorkspace('oijudge-package-import-target-');
    await createProblem(workspaceFolder, 'A');
    const packageDir = await createPackageDir();
    await writeJson(path.join(packageDir, 'oijudge-package.json'), {
      format: 'oijudge-problem-package',
      version: 1,
      problem: { id: 'A', name: 'A' },
      files: { data: [], programs: [], generators: [], generatorInputs: [] },
      subtasks: [],
      scoring: { samples: [], subtasks: [] }
    });

    const result = await importProblemPackage(workspaceFolder, packageDir);

    expect(result.problem.id).toBe('A-2');
    expect(result.problem.name).toBe('A 2');
  });
});

async function createWorkspace(prefix: string): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}

async function createPackageDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-package-dir-'));
  workspaces.push(dir);
  return dir;
}

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function mustGetProblem(workspaceFolder: vscode.WorkspaceFolder, problemId: string) {
  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    throw new Error('Problem not found');
  }
  return problem;
}
