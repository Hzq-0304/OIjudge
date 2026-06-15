import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import {
  createDefaultConfig,
  createSampleInternalId,
  ensureOiJudgeDataDir,
  exists,
  getOiJudgeDataRelPath
} from './config';
import {
  ensureProblemsConfig,
  getProblemRoot,
  writeProblemsConfig
} from './problems';
import {
  CheckerConfig,
  ProblemConfig,
  ProblemGeneratorInputConfig,
  ProblemSource,
  ProblemStatement,
  SampleConfig,
  SetterGeneratorItem,
  SubtaskConfig
} from './types';

export const SUPPORTED_PROBLEM_PACKAGE_VERSION = 1;

export type ProblemPackageImportResult = {
  problem: ProblemConfig;
  copiedFiles: string[];
  warnings: string[];
};

export class ProblemPackageVersionError extends Error {
  constructor(readonly version: number) {
    super(`Problem package version ${version} is newer than supported version ${SUPPORTED_PROBLEM_PACKAGE_VERSION}.`);
  }
}

type PackageFileEntry = {
  id?: string;
  name?: string;
  path: string;
  sourcePath?: string;
};

type PackageDataEntry = {
  sampleId?: string;
  sampleName?: string;
  index?: number;
  input?: string;
  answer?: string;
  score?: number;
  subtaskId?: string;
};

type ProblemPackageManifest = {
  format?: string;
  version?: number;
  problem?: {
    id?: string;
    name?: string;
    totalScore?: number;
    timeLimitMs?: number;
    memoryLimitMb?: number;
    ioMode?: string;
    judgeMode?: string;
    checkerType?: string;
  };
  files?: {
    statement?: string;
    std?: string;
    checker?: string;
    generators?: PackageFileEntry[];
    generatorInputs?: PackageFileEntry[];
    programs?: PackageFileEntry[];
    solution?: string;
    data?: PackageDataEntry[];
  };
  subtasks?: SubtaskConfig[];
  scoring?: {
    totalScore?: number;
    samples?: Array<{ sampleId?: string; score?: number; manual?: boolean }>;
    subtasks?: Array<{ id?: string; name?: string; scoringMode?: 'sum' | 'bundle'; sampleIds?: string[] }>;
  };
  config?: string;
};

type ImportContext = {
  workspaceFolder: vscode.WorkspaceFolder;
  packageDir: string;
  problemId: string;
  copiedFiles: string[];
  warnings: string[];
};

type CopiedFile = {
  relPath: string;
  absPath: string;
};

type SampleImportResult = {
  samples: SampleConfig[];
  sampleIdMap: Map<string, string>;
};

export async function readProblemPackageManifest(packageDir: string): Promise<ProblemPackageManifest> {
  const manifestPath = path.join(packageDir, 'oijudge-package.json');
  if (!(await exists(manifestPath))) {
    throw new Error('import.problemPackage.manifestMissing');
  }
  return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ProblemPackageManifest;
}

export function validateProblemPackageManifest(manifest: ProblemPackageManifest, options: { allowNewerVersion?: boolean } = {}): void {
  if (manifest.format !== 'oijudge-problem-package') {
    throw new Error('import.problemPackage.invalidFormat');
  }
  const version = typeof manifest.version === 'number' ? manifest.version : 0;
  if (version < 1) {
    throw new Error('import.problemPackage.invalidVersion');
  }
  if (version > SUPPORTED_PROBLEM_PACKAGE_VERSION && !options.allowNewerVersion) {
    throw new ProblemPackageVersionError(version);
  }
}

export async function loadProblemPackageConfigSnapshot(packageDir: string, manifest: ProblemPackageManifest): Promise<Partial<ProblemConfig> | undefined> {
  const configRel = typeof manifest.config === 'string' && manifest.config.trim()
    ? manifest.config
    : 'config/oijudge-config.json';
  const configPath = resolvePackagePath(packageDir, configRel);
  if (!(await exists(configPath))) {
    return undefined;
  }
  return JSON.parse(await fs.readFile(configPath, 'utf8')) as Partial<ProblemConfig>;
}

export async function importProblemPackage(
  workspaceFolder: vscode.WorkspaceFolder,
  packageDir: string,
  options: { allowNewerVersion?: boolean } = {}
): Promise<ProblemPackageImportResult> {
  const manifest = await readProblemPackageManifest(packageDir);
  validateProblemPackageManifest(manifest, options);
  const snapshot = await loadProblemPackageConfigSnapshot(packageDir, manifest);
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problemId = createUniqueProblemId(snapshot?.id || manifest.problem?.id || manifest.problem?.name || 'problem', problems.problems);
  const problemName = createUniqueProblemName(manifest.problem?.name || snapshot?.name || 'Problem', problems.problems);
  const context: ImportContext = {
    workspaceFolder,
    packageDir,
    problemId,
    copiedFiles: [],
    warnings: []
  };

  await ensureOiJudgeDataDir(workspaceFolder);
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'samples'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'outputs'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'build'), { recursive: true });

  const baseProblem = createImportedProblemBase(snapshot, manifest, problemId, problemName);
  const sampleResult = await importPackageSamples(context, manifest, snapshot);
  const statement = await importPackageStatement(context, manifest, snapshot);
  const programs = await importPackagePrograms(context, manifest, snapshot);
  const stdProgram = await importPackageStd(context, manifest, snapshot);
  const checker = await importPackageChecker(context, manifest, snapshot);
  const generators = await importPackageGenerators(context, manifest, snapshot);
  const generatorInputs = await importPackageGeneratorInputs(context, manifest, snapshot);
  const subtasks = importPackageSubtasksAndScoring(
    manifest,
    snapshot,
    sampleResult.sampleIdMap,
    generators.idMap,
    generatorInputs.pathMap
  );

  const problem: ProblemConfig = {
    ...baseProblem,
    samples: sampleResult.samples,
    statement,
    source: programs.defaultSource,
    defaultSource: programs.defaultSource,
    sources: programs.sources,
    checker,
    setter: {
      ...(baseProblem.setter ?? {}),
      stdProgram,
      generator: {
        enabled: generators.generators.length > 0,
        generators: generators.generators
      },
      generatedAnswers: remapGeneratedAnswers(baseProblem.setter?.generatedAnswers, sampleResult.sampleIdMap, problemId)
    },
    generatorInputs: generatorInputs.inputs,
    subtasks,
    score: {
      ...(baseProblem.score ?? {}),
      total: manifest.scoring?.totalScore ?? baseProblem.score?.total ?? manifest.problem?.totalScore
    }
  };

  if (!problem.setter?.stdProgram && !problem.setter?.generator?.generators?.length && !Object.keys(problem.setter?.generatedAnswers ?? {}).length) {
    delete problem.setter;
  }

  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  await fs.writeFile(path.join(getProblemRoot(workspaceFolder, problem.id), 'config.json'), `${JSON.stringify(problem, null, 2)}\n`, 'utf8');

  return {
    problem,
    copiedFiles: context.copiedFiles,
    warnings: context.warnings
  };
}

function createImportedProblemBase(
  snapshot: Partial<ProblemConfig> | undefined,
  manifest: ProblemPackageManifest,
  problemId: string,
  problemName: string
): ProblemConfig {
  const defaults = createDefaultConfig();
  return {
    ...defaults,
    ...snapshot,
    id: problemId,
    name: problemName,
    limits: {
      ...defaults.limits,
      ...snapshot?.limits,
      timeMs: snapshot?.limits?.timeMs ?? manifest.problem?.timeLimitMs ?? defaults.limits.timeMs,
      memoryMb: snapshot?.limits?.memoryMb ?? manifest.problem?.memoryLimitMb ?? defaults.limits.memoryMb
    },
    stack: snapshot?.stack ?? defaults.stack,
    ioMode: (snapshot?.ioMode ?? manifest.problem?.ioMode ?? defaults.ioMode) as ProblemConfig['ioMode'],
    judgeMode: (snapshot?.judgeMode ?? manifest.problem?.judgeMode ?? defaults.judgeMode) as ProblemConfig['judgeMode'],
    checker: snapshot?.checker ?? defaults.checker,
    samples: [],
    sources: [],
    subtasks: [],
    standard: snapshot?.standard ?? 'c++17'
  };
}

async function importPackageSamples(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<SampleImportResult> {
  const entries = [...(manifest.files?.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  const snapshotSamples = snapshot?.samples ?? [];
  const scoringSamples = manifest.scoring?.samples ?? [];
  const sampleIdMap = new Map<string, string>();
  const samples: SampleConfig[] = [];
  let nextIndex = 1;

  for (const entry of entries) {
    const oldId = entry.sampleId || createSampleInternalId(entry.index ?? nextIndex);
    const snapshotSample = snapshotSamples.find((sample) => sample.id === oldId || sample.index === entry.index);
    const scoringSample = scoringSamples.find((sample) => sample.sampleId === oldId);
    if (!entry.input) {
      context.warnings.push(`sample input missing from manifest: ${entry.sampleName || oldId}`);
      continue;
    }
    const input = await copyPackageFile(context, entry.input, 'samples', `sample-${nextIndex}.in`, `sample ${nextIndex} input`);
    if (!input) {
      continue;
    }
    const answer = entry.answer
      ? await copyPackageFile(context, entry.answer, 'samples', `sample-${nextIndex}.out`, `sample ${nextIndex} answer`)
      : undefined;
    if (entry.answer && !answer) {
      context.warnings.push(`sample ${nextIndex} answer missing; imported input without output.`);
    }
    const sampleId = createSampleInternalId(nextIndex);
    sampleIdMap.set(oldId, sampleId);
    samples.push({
      id: sampleId,
      index: nextIndex,
      name: entry.sampleName || snapshotSample?.name || `Sample ${nextIndex}`,
      input: input.relPath,
      answer: answer?.relPath ?? getOiJudgeDataRelPath('problems', context.problemId, 'samples', `sample-${nextIndex}.out`),
      actualOutput: getOiJudgeDataRelPath('problems', context.problemId, 'outputs', `sample-${nextIndex}`, 'useroutput.txt'),
      sourceType: 'managed',
      score: entry.score ?? (scoringSample?.manual ? scoringSample.score : undefined) ?? snapshotSample?.score
    });
    nextIndex += 1;
  }

  return { samples, sampleIdMap };
}

async function importPackageStatement(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<ProblemStatement | undefined> {
  const statementPath = manifest.files?.statement ?? snapshot?.statement?.path;
  if (!statementPath) {
    return undefined;
  }
  const copied = await copyPackageFile(context, statementPath, 'statement', path.basename(statementPath), 'statement');
  if (!copied) {
    return undefined;
  }
  return {
    path: copied.relPath,
    type: snapshot?.statement?.type ?? getStatementType(copied.relPath),
    sourceType: 'managed'
  };
}

async function importPackagePrograms(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<{ sources: ProblemSource[]; defaultSource?: string }> {
  const sources: ProblemSource[] = [];
  const sourceEntries = manifest.files?.programs ?? [];
  for (const entry of sourceEntries) {
    const copied = await copyPackageFile(context, entry.path, 'source/programs', entry.name || path.basename(entry.path), `program ${entry.name || entry.path}`);
    if (copied) {
      sources.push(createProblemSource(copied.relPath, entry.name || path.basename(copied.relPath)));
    }
  }

  let defaultSource: string | undefined;
  const solution = manifest.files?.solution ?? snapshot?.defaultSource ?? snapshot?.source;
  if (solution) {
    const copied = await copyPackageFile(context, solution, 'source', path.basename(solution), 'default solution');
    if (copied) {
      defaultSource = copied.relPath;
      if (!sources.some((source) => source.path === copied.relPath)) {
        sources.unshift(createProblemSource(copied.relPath, path.basename(copied.relPath)));
      }
    }
  }

  return { sources, defaultSource: defaultSource ?? sources[0]?.path };
}

async function importPackageStd(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<string | undefined> {
  const stdPath = manifest.files?.std ?? snapshot?.setter?.stdProgram;
  if (!stdPath) {
    return undefined;
  }
  return (await copyPackageFile(context, stdPath, 'std', path.basename(stdPath), 'STD'))?.relPath;
}

async function importPackageChecker(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<CheckerConfig | undefined> {
  const checker = snapshot?.checker;
  const checkerSource = manifest.files?.checker ?? checker?.source;
  if (!checker?.enabled && !checkerSource) {
    return checker;
  }
  const copied = checkerSource
    ? await copyPackageFile(context, checkerSource, 'checker', path.basename(checkerSource), 'checker')
    : undefined;
  if (checkerSource && !copied) {
    context.warnings.push('checker source missing; checker was disabled.');
    return { enabled: false, type: 'none' };
  }
  const imported: CheckerConfig = {
    enabled: checker?.enabled ?? true,
    type: checker?.type ?? (manifest.problem?.checkerType === 'testlib' ? 'testlib' : manifest.problem?.checkerType === 'plain' ? 'plain' : 'none'),
    source: copied?.relPath,
    timeLimitMs: checker?.timeLimitMs,
    plain: checker?.plain,
    testlib: checker?.testlib
      ? {
        ...checker.testlib,
        path: checker.testlib.path && !path.isAbsolute(checker.testlib.path) ? checker.testlib.path : undefined
      }
      : undefined
  };
  if (imported.type === 'testlib') {
    const testlib = await copyOptionalPackageFile(context, 'checker/testlib.h', 'checker', 'testlib.h', 'testlib.h');
    if (testlib) {
      imported.testlib = { mode: 'custom', path: testlib.relPath };
    } else if (!imported.testlib?.path) {
      context.warnings.push('checker uses testlib, but package does not contain checker/testlib.h.');
    }
  }
  return imported;
}

async function importPackageGenerators(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<{ generators: SetterGeneratorItem[]; idMap: Map<string, string> }> {
  const snapshotGenerators = snapshot?.setter?.generator?.generators ?? [];
  const generators: SetterGeneratorItem[] = [];
  const idMap = new Map<string, string>();
  for (const entry of manifest.files?.generators ?? []) {
    const copied = await copyPackageFile(context, entry.path, 'generators', entry.name || path.basename(entry.path), `generator ${entry.name || entry.path}`);
    if (!copied) {
      continue;
    }
    const snapshotGenerator = snapshotGenerators.find((generator) => generator.id === entry.id || generator.source?.path === entry.sourcePath);
    const id = entry.id || snapshotGenerator?.id || createUniqueId(path.basename(copied.relPath), generators.map((generator) => generator.id), 'generator');
    if (entry.id) {
      idMap.set(entry.id, id);
    }
    generators.push({
      ...(snapshotGenerator ?? {}),
      id,
      name: entry.name || snapshotGenerator?.name || path.basename(copied.relPath),
      source: createProblemSource(copied.relPath, entry.name || snapshotGenerator?.name || path.basename(copied.relPath))
    });
  }
  return { generators, idMap };
}

async function importPackageGeneratorInputs(
  context: ImportContext,
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined
): Promise<{ inputs: ProblemGeneratorInputConfig[]; pathMap: Map<string, string> }> {
  const snapshotInputs = snapshot?.generatorInputs ?? [];
  const inputs: ProblemGeneratorInputConfig[] = [];
  const pathMap = new Map<string, string>();
  for (const entry of manifest.files?.generatorInputs ?? []) {
    const copied = await copyPackageFile(context, entry.path, 'generator-inputs', path.basename(entry.path), `generator input ${entry.name || entry.path}`);
    if (!copied) {
      continue;
    }
      pathMap.set(entry.path, copied.relPath);
      if (entry.id) {
        pathMap.set(entry.id, copied.relPath);
      }
    const snapshotInput = snapshotInputs.find((input) => input.id === entry.id || input.source?.path === entry.sourcePath);
    if (entry.id && snapshotInput?.source?.path) {
      pathMap.set(snapshotInput.source.path, copied.relPath);
    }
    inputs.push({
      id: entry.id || snapshotInput?.id || createUniqueId(path.basename(copied.relPath), inputs.map((input) => input.id), 'input'),
      name: entry.name || snapshotInput?.name || path.basename(copied.relPath),
      source: createProblemSource(copied.relPath, entry.name || snapshotInput?.name || path.basename(copied.relPath))
    });
  }
  return { inputs, pathMap };
}

function importPackageSubtasksAndScoring(
  manifest: ProblemPackageManifest,
  snapshot: Partial<ProblemConfig> | undefined,
  sampleIdMap: Map<string, string>,
  generatorIdMap: Map<string, string>,
  generatorInputPathMap: Map<string, string>
): SubtaskConfig[] {
  const sourceSubtasks = snapshot?.subtasks?.length ? snapshot.subtasks : manifest.subtasks ?? [];
  const scoringSubtasks = manifest.scoring?.subtasks ?? [];
  return sourceSubtasks.map((subtask, index) => {
    const scoring = scoringSubtasks.find((entry) => entry.id === subtask.id);
    return {
      id: subtask.id || createUniqueId(scoring?.name || `subtask-${index + 1}`, [], 'subtask'),
      name: subtask.name || scoring?.name || `Subtask ${index + 1}`,
      sampleIds: (subtask.sampleIds?.length ? subtask.sampleIds : scoring?.sampleIds ?? [])
        .map((sampleId) => sampleIdMap.get(sampleId))
        .filter((sampleId): sampleId is string => Boolean(sampleId)),
      scoringMode: subtask.scoringMode ?? scoring?.scoringMode,
      generatorId: subtask.generatorId ? generatorIdMap.get(subtask.generatorId) ?? subtask.generatorId : undefined,
      generatorInput: subtask.generatorInput
        ? generatorInputPathMap.get(subtask.generatorInput) ?? generatorInputPathMap.get(subtask.id)
        : generatorInputPathMap.get(subtask.id)
    };
  });
}

function remapGeneratedAnswers(
  generatedAnswers: Record<string, string> | undefined,
  sampleIdMap: Map<string, string>,
  problemId: string
): Record<string, string> {
  const remapped: Record<string, string> = {};
  for (const [oldSampleId] of Object.entries(generatedAnswers ?? {})) {
    const sampleId = sampleIdMap.get(oldSampleId);
    if (sampleId) {
      remapped[sampleId] = getOiJudgeDataRelPath('problems', problemId, 'generated-answers', `${sampleId}.generated.ans`);
    }
  }
  return remapped;
}

async function copyPackageFile(
  context: ImportContext,
  packageRelPath: string,
  targetDir: string,
  preferredName: string,
  label: string
): Promise<CopiedFile | undefined> {
  const sourcePath = resolvePackagePath(context.packageDir, packageRelPath);
  if (!(await exists(sourcePath))) {
    context.warnings.push(`${label} file missing: ${packageRelPath}`);
    return undefined;
  }
  const relPath = uniqueManagedPath(context, targetDir, preferredName);
  const targetPath = path.join(context.workspaceFolder.uri.fsPath, relPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  context.copiedFiles.push(targetPath);
  return { relPath, absPath: targetPath };
}

async function copyOptionalPackageFile(
  context: ImportContext,
  packageRelPath: string,
  targetDir: string,
  preferredName: string,
  label: string
): Promise<CopiedFile | undefined> {
  const sourcePath = resolvePackagePath(context.packageDir, packageRelPath);
  if (!(await exists(sourcePath))) {
    return undefined;
  }
  return copyPackageFile(context, packageRelPath, targetDir, preferredName, label);
}

function resolvePackagePath(packageDir: string, packageRelPath: string): string {
  if (path.isAbsolute(packageRelPath)) {
    throw new Error('import.problemPackage.unsafePath');
  }
  const resolved = path.resolve(packageDir, packageRelPath);
  const relative = path.relative(packageDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('import.problemPackage.unsafePath');
  }
  return resolved;
}

function uniqueManagedPath(context: ImportContext, targetDir: string, preferredName: string): string {
  const parsed = path.parse(sanitizeFileName(preferredName));
  const base = parsed.name || 'file';
  const ext = parsed.ext;
  let index = 1;
  let candidate: string;
  do {
    candidate = getOiJudgeDataRelPath(
      'problems',
      context.problemId,
      targetDir,
      index === 1 ? `${base}${ext}` : `${base}-${index}${ext}`
    );
    index += 1;
  } while (context.copiedFiles.some((file) => path.normalize(file) === path.normalize(path.join(context.workspaceFolder.uri.fsPath, candidate))));
  return candidate;
}

function createUniqueProblemId(baseName: string, problems: ProblemConfig[]): string {
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'problem';
  let candidate = safeBase;
  let suffix = 2;
  while (problems.some((problem) => problem.id === candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createUniqueProblemName(baseName: string, problems: ProblemConfig[]): string {
  const safeBase = baseName || 'Problem';
  let candidate = safeBase;
  let suffix = 2;
  while (problems.some((problem) => problem.name === candidate)) {
    candidate = `${safeBase} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createProblemSource(sourcePath: string, name: string): ProblemSource {
  return {
    path: sourcePath,
    name,
    lastUsedAt: new Date().toISOString()
  };
}

function getStatementType(statementPath: string): ProblemStatement['type'] {
  switch (path.extname(statementPath).toLowerCase()) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.pdf':
      return 'pdf';
    case '.txt':
      return 'text';
    default:
      return 'unknown';
  }
}

function sanitizeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1F]/gu, '-').replace(/^-+|-+$/gu, '') || 'file';
}

function createUniqueId(baseName: string, usedIds: string[], fallback: string): string {
  const safeBase = path.basename(baseName, path.extname(baseName)).replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || fallback;
  let candidate = safeBase;
  let suffix = 2;
  while (usedIds.includes(candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
