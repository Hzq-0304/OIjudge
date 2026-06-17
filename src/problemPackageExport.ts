import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { exists, toPosixPath } from './config';
import { resolveProblemReferencePath } from './problems';
import { calculateEffectiveSampleScores, getProblemTotalScore } from './scoring';
import { resolveSamplePath } from './sampleFiles';
import { ProblemConfig, ProblemSource, SampleConfig } from './types';

export type ProblemPackageExportResult = {
  targetDir: string;
  copiedFiles: string[];
  generatedFiles: string[];
  warnings: string[];
};

type PackageFileEntry = {
  id?: string;
  name?: string;
  path: string;
  sourcePath?: string;
};

type PackageDataEntry = {
  sampleId: string;
  sampleName: string;
  index: number;
  input?: string;
  answer?: string;
  score?: number;
  subtaskId?: string;
};

type ProblemPackageManifest = {
  format: 'oijudge-problem-package';
  version: 1;
  exportedAt: string;
  problem: {
    id: string;
    name: string;
    totalScore: number;
    timeLimitMs: number;
    memoryLimitMb: number;
    ioMode: string;
    judgeMode: string;
    checkerType?: string;
  };
  files: {
    statement?: string;
    std?: string;
    checker?: string;
    generators: PackageFileEntry[];
    generatorInputs: PackageFileEntry[];
    programs: PackageFileEntry[];
    solution?: string;
    data: PackageDataEntry[];
  };
  subtasks: NonNullable<ProblemConfig['subtasks']>;
  scoring: ReturnType<typeof createScoringSnapshot>;
  config: string;
  warnings: string[];
};

type CopyContext = {
  workspaceFolder: vscode.WorkspaceFolder;
  targetDir: string;
  copiedFiles: string[];
  warnings: string[];
  usedPackagePaths: Set<string>;
};

export async function exportProblemPackage(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  targetDir: string
): Promise<ProblemPackageExportResult> {
  const copiedFiles: string[] = [];
  const generatedFiles: string[] = [];
  const warnings: string[] = [];
  const context: CopyContext = {
    workspaceFolder,
    targetDir,
    copiedFiles,
    warnings,
    usedPackagePaths: new Set<string>()
  };
  await fs.mkdir(targetDir, { recursive: true });

  const statement = await copyStatement(context, problem);
  const solution = await copyDefaultSolution(context, problem);
  const programs = await copyPrograms(context, problem);
  const std = await copyStd(context, problem);
  const checker = await copyChecker(context, problem);
  const generators = await copyGenerators(context, problem);
  const generatorInputs = await copyGeneratorInputs(context, problem);
  const data = await copySamples(context, problem);
  const subtasks = problem.subtasks ?? [];
  const scoring = createScoringSnapshot(problem);

  const configPath = path.join(targetDir, 'config', 'oijudge-config.json');
  await writeJsonFile(configPath, problem);
  generatedFiles.push(configPath);

  const subtasksPath = path.join(targetDir, 'config', 'subtasks.json');
  await writeJsonFile(subtasksPath, subtasks);
  generatedFiles.push(subtasksPath);

  const scoringPath = path.join(targetDir, 'config', 'scoring.json');
  await writeJsonFile(scoringPath, scoring);
  generatedFiles.push(scoringPath);

  const manifest: ProblemPackageManifest = {
    format: 'oijudge-problem-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    problem: {
      id: problem.id,
      name: problem.name,
      totalScore: getProblemTotalScore(problem),
      timeLimitMs: problem.limits.timeMs,
      memoryLimitMb: problem.limits.memoryMb,
      ioMode: problem.ioMode ?? 'stdio',
      judgeMode: problem.judgeMode ?? (problem.checker?.enabled && problem.checker.type !== 'none' ? 'checker' : 'trimTrailingWhitespace'),
      checkerType: problem.checker?.enabled ? problem.checker.type : undefined
    },
    files: {
      statement,
      std,
      checker,
      generators,
      generatorInputs,
      programs,
      solution,
      data
    },
    subtasks,
    scoring,
    config: 'config/oijudge-config.json',
    warnings
  };

  const manifestPath = path.join(targetDir, 'oijudge-package.json');
  await writeJsonFile(manifestPath, manifest);
  generatedFiles.push(manifestPath);

  const readmePath = path.join(targetDir, 'README.txt');
  await fs.writeFile(readmePath, createPackageReadme(problem, manifest.exportedAt, warnings), 'utf8');
  generatedFiles.push(readmePath);

  return {
    targetDir,
    copiedFiles,
    generatedFiles,
    warnings
  };
}

function createScoringSnapshot(problem: ProblemConfig): {
  totalScore: number;
  samples: Array<{ sampleId: string; sampleName: string; index: number; score: number; manual: boolean }>;
  subtasks: Array<{ id: string; name: string; scoringMode: 'sum' | 'bundle'; sampleIds: string[] }>;
  errors: string[];
} {
  const effective = calculateEffectiveSampleScores(problem);
  return {
    totalScore: effective.totalScore,
    samples: problem.samples.map((sample) => {
      const score = effective.sampleScores.get(sample.id);
      return {
        sampleId: sample.id,
        sampleName: sample.name,
        index: sample.index,
        score: score?.score ?? 0,
        manual: score?.manual ?? false
      };
    }),
    subtasks: (problem.subtasks ?? []).map((subtask) => ({
      id: subtask.id,
      name: subtask.name,
      scoringMode: subtask.scoringMode ?? 'sum',
      sampleIds: [...subtask.sampleIds]
    })),
    errors: effective.errors
  };
}

async function copyStatement(context: CopyContext, problem: ProblemConfig): Promise<string | undefined> {
  if (!problem.statement?.path) {
    context.warnings.push('Statement file is not configured.');
    return undefined;
  }
  const result = await copyReferenceFile(context, problem.statement.path, 'statement', path.basename(problem.statement.path), 'statement');
  return result?.packagePath;
}

async function copyDefaultSolution(context: CopyContext, problem: ProblemConfig): Promise<string | undefined> {
  const defaultSource = problem.defaultSource || problem.source || problem.sources?.[0]?.path;
  if (!defaultSource) {
    context.warnings.push('Default solution source is not configured.');
    return undefined;
  }
  const ext = path.extname(defaultSource) || '.cpp';
  const result = await copyReferenceFile(context, defaultSource, 'source', `solution${ext}`, 'default solution');
  return result?.packagePath;
}

async function copyPrograms(context: CopyContext, problem: ProblemConfig): Promise<PackageFileEntry[]> {
  const entries: PackageFileEntry[] = [];
  for (const source of problem.sources ?? []) {
    const copied = await copyProblemSource(context, source, 'source/programs', 'program');
    if (copied) {
      entries.push(copied);
    }
  }
  return entries;
}

async function copyStd(context: CopyContext, problem: ProblemConfig): Promise<string | undefined> {
  const std = problem.setter?.stdProgram;
  if (!std) {
    context.warnings.push('STD source is not configured.');
    return undefined;
  }
  const result = await copyReferenceFile(context, std, 'std', `std${path.extname(std) || '.cpp'}`, 'STD');
  return result?.packagePath;
}

async function copyChecker(context: CopyContext, problem: ProblemConfig): Promise<string | undefined> {
  const checker = problem.checker;
  if (!checker?.enabled || checker.type === 'none') {
    return undefined;
  }
  if (!checker.source) {
    context.warnings.push('Checker is enabled, but checker source is not configured.');
    return undefined;
  }
  if (checker.type === 'testlib') {
    context.warnings.push('Checker uses testlib. testlib.h is not bundled in this first package export version.');
  }
  const result = await copyReferenceFile(context, checker.source, 'checker', path.basename(checker.source), 'checker');
  return result?.packagePath;
}

async function copyGenerators(context: CopyContext, problem: ProblemConfig): Promise<PackageFileEntry[]> {
  const entries: PackageFileEntry[] = [];
  for (const generator of problem.setter?.generator?.generators ?? []) {
    if (!generator.source?.path) {
      context.warnings.push(`Generator ${generator.name || generator.id} has no source file configured.`);
      continue;
    }
    const copied = await copyProblemSource(context, generator.source, 'generators', 'generator', generator.id);
    if (copied) {
      entries.push({
        ...copied,
        id: generator.id,
        name: generator.name || copied.name
      });
    }
  }
  return entries;
}

async function copyGeneratorInputs(context: CopyContext, problem: ProblemConfig): Promise<PackageFileEntry[]> {
  const entries: PackageFileEntry[] = [];
  for (const input of problem.generatorInputs ?? []) {
    if (!input.source?.path) {
      context.warnings.push(`Global generator input ${input.name || input.id} has no source file configured.`);
      continue;
    }
    const copied = await copyProblemSource(context, input.source, 'generators/generator-inputs', 'global generator input', input.id);
    if (copied) {
      entries.push({
        ...copied,
        id: input.id,
        name: input.name || copied.name
      });
    }
  }

  for (const subtask of problem.subtasks ?? []) {
    if (!subtask.generatorInput) {
      continue;
    }
    const copied = await copyReferenceFile(
      context,
      subtask.generatorInput,
      'generators/generator-inputs',
      path.basename(subtask.generatorInput),
      `subtask generator input ${subtask.name}`
    );
    if (copied) {
      entries.push({
        id: subtask.id,
        name: subtask.name,
        ...copied
      });
    }
  }
  return entries;
}

async function copySamples(context: CopyContext, problem: ProblemConfig): Promise<PackageDataEntry[]> {
  const entries: PackageDataEntry[] = [];
  const sampleToSubtask = new Map<string, string>();
  for (const subtask of problem.subtasks ?? []) {
    for (const sampleId of subtask.sampleIds) {
      sampleToSubtask.set(sampleId, subtask.id);
    }
  }
  for (const sample of [...problem.samples].sort((left, right) => left.index - right.index)) {
    entries.push(await copySample(context, sample, sampleToSubtask.get(sample.id)));
  }
  return entries;
}

async function copySample(context: CopyContext, sample: SampleConfig, subtaskId: string | undefined): Promise<PackageDataEntry> {
  const entry: PackageDataEntry = {
    sampleId: sample.id,
    sampleName: sample.name,
    index: sample.index,
    score: sample.score,
    subtaskId
  };
  const inputPath = resolveSamplePath(context.workspaceFolder, sample.input);
  const inputPackagePath = toPosixPath(path.join('data', `sample-${sample.index}.in`));
  if (await copyExistingFile(context, inputPath, inputPackagePath, `sample ${sample.index} input`)) {
    entry.input = inputPackagePath;
  }

  const answerPath = resolveSamplePath(context.workspaceFolder, sample.answer);
  const answerPackagePath = toPosixPath(path.join('data', `sample-${sample.index}.out`));
  if (await copyExistingFile(context, answerPath, answerPackagePath, `sample ${sample.index} answer`)) {
    entry.answer = answerPackagePath;
  }

  return entry;
}

async function copyProblemSource(
  context: CopyContext,
  source: ProblemSource,
  packageDir: string,
  label: string,
  id?: string
): Promise<PackageFileEntry | undefined> {
  if (!source.path) {
    context.warnings.push(`${label} source path is empty.`);
    return undefined;
  }
  const copied = await copyReferenceFile(context, source.path, packageDir, source.name || path.basename(source.path), label);
  return copied
    ? {
      id,
      name: source.name || path.basename(source.path),
      ...copied
    }
    : undefined;
}

async function copyReferenceFile(
  context: CopyContext,
  sourcePath: string,
  packageDir: string,
  preferredName: string,
  label: string
): Promise<{ path: string; packagePath: string; sourcePath: string } | undefined> {
  const absoluteSource = resolveProblemReferencePath(context.workspaceFolder, sourcePath);
  const packagePath = uniquePackagePath(context, packageDir, preferredName);
  const copied = await copyExistingFile(context, absoluteSource, packagePath, label);
  return copied
    ? {
      path: packagePath,
      packagePath,
      sourcePath: toDisplayPath(context.workspaceFolder, absoluteSource)
    }
    : undefined;
}

async function copyExistingFile(context: CopyContext, sourcePath: string, packagePath: string, label: string): Promise<boolean> {
  if (!(await exists(sourcePath))) {
    context.warnings.push(`${label} file missing: ${sourcePath}`);
    return false;
  }
  try {
    const targetPath = path.join(context.targetDir, packagePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    context.copiedFiles.push(targetPath);
    return true;
  } catch (error) {
    context.warnings.push(`${label} copy failed: ${sourcePath}: ${String(error)}`);
    return false;
  }
}

function uniquePackagePath(context: CopyContext, packageDir: string, preferredName: string): string {
  const parsed = path.parse(sanitizeFileName(preferredName));
  const base = parsed.name || 'file';
  const ext = parsed.ext;
  let index = 1;
  let candidate: string;
  do {
    candidate = toPosixPath(path.join(packageDir, index === 1 ? `${base}${ext}` : `${base}-${index}${ext}`));
    index += 1;
  } while (context.usedPackagePaths.has(candidate));
  context.usedPackagePaths.add(candidate);
  return candidate;
}

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1F]/gu, '-').replace(/^-+|-+$/gu, '');
  return baseName || 'file';
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createPackageReadme(problem: ProblemConfig, exportedAt: string, warnings: string[]): string {
  return [
    `OI Judge Problem Package / OI Judge 完整题目包`,
    ``,
    `Problem / 题目: ${problem.name}`,
    `Exported At / 导出时间: ${exportedAt}`,
    ``,
    `Directory structure / 目录结构:`,
    `- oijudge-package.json: package manifest for future import.`,
    `- statement/: statement file, when configured.`,
    `- source/: default solution and extra programs.`,
    `- std/: standard solution, when configured.`,
    `- checker/: custom checker, when configured.`,
    `- generators/: generator sources and generator-inputs/.`,
    `- data/: sample input/output files.`,
    `- config/: OI Judge config snapshot, subtasks, and scoring metadata.`,
    ``,
    `Warnings / 警告:`,
    warnings.length > 0 ? warnings.map((warning) => `- ${warning}`).join('\n') : `- None`,
    ``
  ].join('\n');
}

function toDisplayPath(workspaceFolder: vscode.WorkspaceFolder, absolutePath: string): string {
  const relative = path.relative(workspaceFolder.uri.fsPath, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? toPosixPath(relative)
    : path.basename(absolutePath);
}
