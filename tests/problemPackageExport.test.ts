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

const workspaces: string[] = [];

describe('problem package export', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('exports a complete problem package with manifest, readme, files, subtasks, and scoring', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const statementPath = path.join(workspaceFolder.uri.fsPath, 'docs', 'statement.md');
    const solutionPath = path.join(workspaceFolder.uri.fsPath, 'src', 'solution.cpp');
    const altPath = path.join(workspaceFolder.uri.fsPath, 'src', 'alt.cpp');
    const stdPath = path.join(workspaceFolder.uri.fsPath, 'std.cpp');
    const checkerPath = path.join(workspaceFolder.uri.fsPath, 'checker.cpp');
    const generatorPath = path.join(workspaceFolder.uri.fsPath, 'gen.cpp');
    const globalInputPath = path.join(workspaceFolder.uri.fsPath, 'gen input', 'global.txt');
    const subtaskInputPath = path.join(workspaceFolder.uri.fsPath, 'gen input', 'subtask.txt');
    await write(statementPath, '# A\n');
    await write(solutionPath, 'int main(){}\n');
    await write(altPath, 'int main(){return 1;}\n');
    await write(stdPath, 'int main(){return 0;}\n');
    await write(checkerPath, 'int main(){return 0;}\n');
    await write(generatorPath, 'int main(){return 0;}\n');
    await write(globalInputPath, 'global\n');
    await write(subtaskInputPath, 'subtask\n');

    const first = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(workspaceFolder, problem.id, '2\n', '2\n', { decodeEscapes: false });
    await bindProblemStatement(workspaceFolder, problem.id, statementPath);
    await addProgramToProblem(workspaceFolder, problem.id, solutionPath, { setDefault: true });
    await addProgramToProblem(workspaceFolder, problem.id, altPath);
    await setProblemDefaultSource(workspaceFolder, problem.id, solutionPath);
    await setProblemStdProgram(workspaceFolder, problem.id, stdPath);
    await updateProblemJudgeMode(workspaceFolder, problem.id, 'checker');
    await updateProblemChecker(workspaceFolder, problem.id, { enabled: true, type: 'plain', source: checkerPath });
    const generator = await addProblemGenerator(workspaceFolder, problem.id, generatorPath);
    await addProblemGeneratorInputs(workspaceFolder, problem.id, [globalInputPath]);
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Bundle');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, first?.id ?? '', subtask?.id);
    await setProblemSampleScore(workspaceFolder, problem.id, first?.id ?? '', 40);
    await setProblemSampleScore(workspaceFolder, problem.id, second?.id ?? '', 60);
    await setProblemSubtaskScoringMode(workspaceFolder, problem.id, subtask?.id ?? '', 'bundle');
    await setProblemSubtaskGenerator(workspaceFolder, problem.id, subtask?.id ?? '', generator?.generator.id ?? '');
    await setProblemSubtaskGeneratorInput(workspaceFolder, problem.id, subtask?.id ?? '', subtaskInputPath);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'package with spaces');

    const result = await exportProblemPackage(workspaceFolder, await mustGetProblem(workspaceFolder, problem.id), targetDir);
    const manifest = JSON.parse(await fs.readFile(path.join(targetDir, 'oijudge-package.json'), 'utf8')) as {
      format: string;
      problem: { name: string; totalScore: number; judgeMode: string; checkerType: string };
      files: {
        statement: string;
        solution: string;
        std: string;
        checker: string;
        generators: Array<{ path: string }>;
        generatorInputs: Array<{ path: string }>;
        programs: Array<{ path: string }>;
        data: Array<{ input?: string; answer?: string; score?: number; subtaskId?: string }>;
      };
      subtasks: Array<{ id: string; scoringMode?: string; sampleIds: string[] }>;
      scoring: { samples: Array<{ sampleId: string; score: number; manual: boolean }> };
      config: string;
      warnings: string[];
    };
    const readme = await fs.readFile(path.join(targetDir, 'README.txt'), 'utf8');

    expect(result.warnings).toEqual([]);
    expect(manifest.format).toBe('oijudge-problem-package');
    expect(manifest.problem.name).toBe('A');
    expect(manifest.problem.totalScore).toBe(100);
    expect(manifest.problem.judgeMode).toBe('checker');
    expect(manifest.problem.checkerType).toBe('plain');
    expect(manifest.files.statement).toBe('statement/statement.md');
    expect(manifest.files.solution).toBe('source/solution.cpp');
    expect(manifest.files.std).toBe('std/std.cpp');
    expect(manifest.files.checker).toBe('checker/checker.cpp');
    expect(manifest.files.programs.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'source/programs/solution.cpp',
      'source/programs/alt.cpp'
    ]));
    expect(manifest.files.generators[0].path).toBe('generators/gen.cpp');
    expect(manifest.files.generatorInputs.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'generators/generator-inputs/global.txt',
      'generators/generator-inputs/subtask.txt'
    ]));
    expect(manifest.files.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ input: 'data/sample-1.in', answer: 'data/sample-1.out', score: 40, subtaskId: subtask?.id }),
      expect.objectContaining({ input: 'data/sample-2.in', answer: 'data/sample-2.out', score: 60 })
    ]));
    expect(manifest.files.data.map((entry) => [entry.input, entry.answer]).flat().filter(Boolean).every((entry) => !path.isAbsolute(entry))).toBe(true);
    expect(manifest.subtasks[0]).toEqual(expect.objectContaining({ id: subtask?.id, scoringMode: 'bundle', sampleIds: [first?.id] }));
    expect(manifest.scoring.samples).toEqual(expect.arrayContaining([
      expect.objectContaining({ sampleId: first?.id, score: 40, manual: true }),
      expect.objectContaining({ sampleId: second?.id, score: 60, manual: true })
    ]));
    expect(manifest.config).toBe('config/oijudge-config.json');
    expect(readme).toContain('OI Judge Problem Package');
    await expect(fs.access(path.join(targetDir, 'statement', 'statement.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'source', 'solution.cpp'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'std', 'std.cpp'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'checker', 'checker.cpp'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'generators', 'gen.cpp'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'config', 'oijudge-config.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'config', 'subtasks.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'config', 'scoring.json'))).resolves.toBeUndefined();
  });

  it('records warnings for missing files and keeps exporting available inputs', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    await bindProblemStatement(workspaceFolder, problem.id, path.join(workspaceFolder.uri.fsPath, 'missing.md'));
    await setProblemStdProgram(workspaceFolder, problem.id, path.join(workspaceFolder.uri.fsPath, 'missing-std.cpp'));
    await fs.rm(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''));
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    const result = await exportProblemPackage(workspaceFolder, await mustGetProblem(workspaceFolder, problem.id), targetDir);
    const manifest = JSON.parse(await fs.readFile(path.join(targetDir, 'oijudge-package.json'), 'utf8')) as {
      files: { data: Array<{ input?: string; answer?: string }> };
      warnings: string[];
    };

    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
    expect(manifest.files.data[0].input).toBe('data/sample-1.in');
    expect(manifest.files.data[0].answer).toBeUndefined();
    expect(manifest.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('statement file missing'),
      expect.stringContaining('STD file missing'),
      expect.stringContaining('sample 1 answer file missing')
    ]));
    await expect(fs.access(path.join(targetDir, 'data', 'sample-1.in'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(targetDir, 'data', 'sample-1.out'))).rejects.toThrow();
  });

  it('deduplicates package filenames when source names collide', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const firstStd = path.join(workspaceFolder.uri.fsPath, 'a', 'std.cpp');
    const secondStd = path.join(workspaceFolder.uri.fsPath, 'b', 'std.cpp');
    await write(firstStd, 'int main(){return 0;}\n');
    await write(secondStd, 'int main(){return 1;}\n');
    await addProgramToProblem(workspaceFolder, problem.id, firstStd, { setDefault: true });
    await addProgramToProblem(workspaceFolder, problem.id, secondStd);
    await setProblemStdProgram(workspaceFolder, problem.id, firstStd);
    const targetDir = path.join(workspaceFolder.uri.fsPath, 'export');

    await exportProblemPackage(workspaceFolder, await mustGetProblem(workspaceFolder, problem.id), targetDir);
    const manifest = JSON.parse(await fs.readFile(path.join(targetDir, 'oijudge-package.json'), 'utf8')) as {
      files: { programs: Array<{ path: string }>; std: string };
    };

    expect(manifest.files.programs.map((entry) => entry.path)).toEqual([
      'source/programs/std.cpp',
      'source/programs/std-2.cpp'
    ]);
    expect(manifest.files.std).toBe('std/std.cpp');
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-package-export-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function mustGetProblem(workspaceFolder: vscode.WorkspaceFolder, problemId: string) {
  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    throw new Error('Problem not found');
  }
  return problem;
}
