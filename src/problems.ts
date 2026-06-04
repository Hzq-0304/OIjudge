import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
  createDefaultConfig,
  exists,
  getConfigPath,
  getOiJudgeConfigPath,
  getOITestDir,
  readConfig,
  createSampleInternalId,
  getNextSampleIndex,
  getSampleDisplayNameFromInput,
  normalizeCheckerConfig,
  normalizeFileIoConfig,
  normalizeIoMode,
  normalizeJudgeMode,
  normalizeSetterConfig,
  normalizeStackConfig,
  normalizeSampleInternalId,
  resolveSampleIndex,
  resolveWorkspacePath,
  setCompilerCommand,
  toPosixPath,
  uniqueSampleName
} from './config';
import {
  getProblemSampleOutputPaths,
  inferSampleSourceType,
  isUnderPath,
  resolveSamplePath
} from './sampleFiles';
import {
  removeSetterDataCaseForSample,
  upsertSetterDataCaseForSample
} from './setterMode';
import {
  JudgeReport,
  OITestConfig,
  ProblemConfig,
  ProblemsConfig,
  ProblemSource,
  ProblemStatementType,
  SampleConfig,
  SubtaskConfig,
  SubtaskRunResult
} from './types';

export function getProblemsPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return getOiJudgeConfigPath(workspaceFolder);
}

export function getLegacyProblemsPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'problems.json');
}

export function getProblemRoot(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getOITestDir(workspaceFolder), 'problems', problemId);
}

export function getProblemReportPath(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getProblemRoot(workspaceFolder, problemId), 'outputs', 'report.json');
}

export function getProblemConfigPath(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getProblemRoot(workspaceFolder, problemId), 'config.json');
}

export async function ensureProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig> {
  if (await exists(getProblemsPath(workspaceFolder))) {
    return readProblemsConfig(workspaceFolder);
  }

  const migrated =
    await readLegacyProblemsConfig(workspaceFolder) ??
    await readLegacyProblemFolderConfigs(workspaceFolder) ??
    await readLegacySingleProblemConfig(workspaceFolder);
  if (migrated) {
    await writeProblemsConfig(workspaceFolder, migrated);
    return migrated;
  }

  const config: ProblemsConfig = { version: 1, problems: [] };
  await writeProblemsConfig(workspaceFolder, config);
  return config;
}

async function readLegacyProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig | undefined> {
  const legacyPath = getLegacyProblemsPath(workspaceFolder);
  if (!(await exists(legacyPath))) {
    return undefined;
  }
  return readProblemsConfigFromPath(workspaceFolder, legacyPath);
}

async function readLegacyProblemFolderConfigs(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig | undefined> {
  const legacyProblemsDir = path.join(getOITestDir(workspaceFolder), 'problems');
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(legacyProblemsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  const config: ProblemsConfig = { version: 1, problems: [] };
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const legacyPath = path.join(legacyProblemsDir, entry.name, 'config.json');
    if (!(await exists(legacyPath))) {
      continue;
    }

    const parsed = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as Partial<ProblemConfig>;
    const problem = {
      ...createDefaultConfig(),
      ...parsed,
      id: parsed.id ?? entry.name,
      name: parsed.name ?? entry.name,
      standard: parsed.standard ?? getStandardFromArgs((parsed.compiler ?? parsed.compile ?? createDefaultConfig().compiler).args),
      samples: parsed.samples ?? []
    } as ProblemConfig;
    config.problems.push(normalizeProblem(workspaceFolder, problem));
  }

  return config.problems.length > 0 ? config : undefined;
}

async function readLegacySingleProblemConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig | undefined> {
  if (!(await exists(getConfigPath(workspaceFolder)))) {
    return undefined;
  }

  const legacy = await readConfig(workspaceFolder);
  const source = guessLegacySource(workspaceFolder);
  const baseName = source ? path.basename(source, path.extname(source)) : 'legacy';
  const config: ProblemsConfig = { version: 1, problems: [] };
  const problem: ProblemConfig = {
    ...legacy,
    id: createProblemId(baseName, config),
    name: createProblemName(baseName, config),
    source: source ? toPosixPath(path.relative(workspaceFolder.uri.fsPath, source)) : '',
    defaultSource: source ? toPosixPath(path.relative(workspaceFolder.uri.fsPath, source)) : undefined,
    sources: source ? [createProblemSource(workspaceFolder, source)] : [],
    standard: getStandardFromArgs(legacy.compiler.args)
  };

  config.problems.push(normalizeProblem(workspaceFolder, problem));
  return config;
}

export async function readProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig> {
  return readProblemsConfigFromPath(workspaceFolder, getProblemsPath(workspaceFolder));
}

async function readProblemsConfigFromPath(
  workspaceFolder: vscode.WorkspaceFolder,
  configPath: string
): Promise<ProblemsConfig> {
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as ProblemsConfig;
  return {
    version: 1,
    problems: (parsed.problems ?? []).map((problem) => normalizeProblem(workspaceFolder, problem))
  };
}

export async function writeProblemsConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: ProblemsConfig
): Promise<void> {
  await fs.mkdir(path.dirname(getProblemsPath(workspaceFolder)), { recursive: true });
  await fs.writeFile(getProblemsPath(workspaceFolder), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function createProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  name: string
): Promise<ProblemConfig> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem: ProblemConfig = {
    ...createDefaultConfig(),
    id: createProblemId(name, problems),
    name: createProblemName(name, problems),
    standard: 'c++17',
    sources: [],
    subtasks: []
  };

  await ensureProblemFolders(workspaceFolder, problem.id);
  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

export async function addProblemFromSource(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string
): Promise<ProblemConfig> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const relativeSource = toPosixPath(path.relative(workspaceFolder.uri.fsPath, sourcePath));
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const problem: ProblemConfig = {
    ...createDefaultConfig(),
    id: createProblemId(baseName, problems),
    name: createProblemName(baseName, problems),
    source: relativeSource,
    defaultSource: relativeSource,
    sources: [createProblemSource(workspaceFolder, sourcePath)],
    standard: 'c++17',
    subtasks: []
  };

  await ensureProblemFolders(workspaceFolder, problem.id);
  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

export async function importLegacyProblem(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemConfig | undefined> {
  if (!(await exists(getConfigPath(workspaceFolder)))) {
    return undefined;
  }
  const legacy = await readConfig(workspaceFolder);
  const problems = await ensureProblemsConfig(workspaceFolder);
  const source = guessLegacySource(workspaceFolder);
  const baseName = source ? path.basename(source, path.extname(source)) : 'legacy';
  const problem: ProblemConfig = {
    ...legacy,
    id: createProblemId(baseName, problems),
    name: createProblemName(baseName, problems),
    source: source ? toPosixPath(path.relative(workspaceFolder.uri.fsPath, source)) : '',
    defaultSource: source ? toPosixPath(path.relative(workspaceFolder.uri.fsPath, source)) : undefined,
    sources: source ? [createProblemSource(workspaceFolder, source)] : [],
    standard: getStandardFromArgs(legacy.compiler.args)
  };

  await ensureProblemFolders(workspaceFolder, problem.id);
  const copiedSamples: SampleConfig[] = [];
  for (const sample of legacy.samples) {
    const input = await readOptional(resolveWorkspacePath(workspaceFolder, sample.input));
    const answer = await readOptional(resolveWorkspacePath(workspaceFolder, sample.answer));
    copiedSamples.push(await addProblemSampleFiles(workspaceFolder, problem, input, answer));
  }
  problem.samples = copiedSamples;
  problems.problems.push(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

export async function addProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  input: string,
  answer: string,
  options: { decodeEscapes?: boolean } = {}
): Promise<SampleConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  const sample = await addProblemSampleFiles(
    workspaceFolder,
    problem,
    formatSampleText(input, options.decodeEscapes ?? true),
    formatSampleText(answer, options.decodeEscapes ?? true)
  );
  problem.samples.push(sample);
  clearAllSubtaskResults(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
}

export async function addEmptyProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<SampleConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  const sample = await addProblemSampleFiles(workspaceFolder, problem, '', '');
  problem.samples.push(sample);
  clearAllSubtaskResults(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
}

export async function addProblemInputSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<SampleConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  const sample = await addProblemInputSampleFile(workspaceFolder, problem);
  problem.samples.push(sample);
  problem.setter = upsertSetterDataCaseForSample(problem.setter, sample);
  clearAllSubtaskResults(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
}

export async function addExternalProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  inputPath: string,
  answerPath: string
): Promise<SampleConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  await ensureProblemFolders(workspaceFolder, problem.id);
  const index = getNextSampleIndex(problem);
  const outputRel = getProblemSampleOutputPaths(workspaceFolder, problem.id, index).outputRel;
  const baseName = getSampleDisplayNameFromInput(inputPath);
  const sample: SampleConfig = {
    id: createSampleInternalId(index),
    index,
    name: uniqueSampleName(problem.samples, baseName),
    input: path.resolve(inputPath),
    answer: path.resolve(answerPath),
    actualOutput: outputRel,
    sourceType: 'external'
  };

  problem.samples.push(sample);
  clearAllSubtaskResults(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
}

export async function batchAddExternalProblemSamples(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  pairs: Array<{ inputPath: string; answerPath: string; baseName?: string }>
): Promise<{ added: SampleConfig[]; duplicates: Array<{ inputPath: string; answerPath: string }> } | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  await ensureProblemFolders(workspaceFolder, problem.id);
  const added: SampleConfig[] = [];
  const duplicates: Array<{ inputPath: string; answerPath: string }> = [];

  for (const pair of pairs) {
    const inputPath = path.resolve(pair.inputPath);
    const answerPath = path.resolve(pair.answerPath);
    const duplicate = problem.samples.some((sample) => sample.input === inputPath && sample.answer === answerPath);
    if (duplicate) {
      duplicates.push({ inputPath, answerPath });
      continue;
    }

    const index = getNextSampleIndex(problem);
    const baseName = pair.baseName?.trim() || getSampleDisplayNameFromInput(inputPath);
    const sample: SampleConfig = {
      id: createSampleInternalId(index),
      index,
      name: uniqueSampleName([...problem.samples, ...added], baseName),
      input: inputPath,
      answer: answerPath,
      actualOutput: getProblemSampleOutputPaths(workspaceFolder, problem.id, index).outputRel,
      sourceType: 'external'
    };
    problem.samples.push(sample);
    clearAllSubtaskResults(problem);
    added.push(sample);
  }

  if (added.length > 0) {
    await writeProblemsConfig(workspaceFolder, problems);
  }
  return { added, duplicates };
}

export async function updateProblemLimits(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  limits: Partial<ProblemConfig['limits']>
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.limits = { ...problem.limits, ...limits };
  });
}

export async function updateProblemStack(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  stack: ProblemConfig['stack']
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.stack = normalizeStackConfig(stack);
  });
}

export async function updateProblemStandard(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  standard: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.standard = standard;
    problem.compiler.args = setStandardArg(problem.compiler.args, standard);
    if (problem.compile) {
      problem.compile.args = setStandardArg(problem.compile.args, standard);
    }
  });
}

export async function updateProblemCompiler(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  command: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    setCompilerCommand(problem, command);
  });
}

export async function updateProblemChecker(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  checker: ProblemConfig['checker']
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.checker = normalizeCheckerConfig(checker);
  });
}

export async function updateProblemJudgeMode(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  judgeMode: ProblemConfig['judgeMode']
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.judgeMode = judgeMode ?? 'normal';
    if (problem.judgeMode === 'checker' && !problem.checker) {
      problem.checker = { enabled: false, type: 'none' };
    }
  });
}

export async function updateProblemIoMode(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  ioMode: ProblemConfig['ioMode'],
  fileIo?: ProblemConfig['fileIo']
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.ioMode = normalizeIoMode(ioMode);
    problem.fileIo = normalizeFileIoConfig(fileIo ?? problem.fileIo);
  });
}

export async function updateProblemFileIo(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  fileIo: ProblemConfig['fileIo']
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.fileIo = normalizeFileIoConfig(fileIo);
  });
}

export async function getProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  return findProblem(problems, problemId);
}

export async function bindProblemStatement(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  statementPath: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    problem.statement = {
      path: path.resolve(statementPath),
      type: getStatementType(statementPath),
      sourceType: 'external'
    };
  });
}

export async function unbindProblemStatement(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    delete problem.statement;
  });
}

export async function addProgramToProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sourcePath: string,
  options: { setDefault?: boolean } = {}
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const source = createProblemSource(workspaceFolder, sourcePath);
    problem.sources = upsertProblemSource(problem.sources ?? [], source);
    if (options.setDefault || !getDefaultProblemSource(problem)) {
      problem.defaultSource = source.path;
      problem.source = source.path;
    }
  });
}

export async function setProblemDefaultSource(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sourcePath: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const source = createProblemSource(workspaceFolder, sourcePath);
    problem.sources = upsertProblemSource(problem.sources ?? [], source);
    problem.defaultSource = source.path;
    problem.source = source.path;
  });
}

export async function setProblemStdProgram(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  stdPath: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const source = createProblemSource(workspaceFolder, stdPath);
    problem.setter = normalizeSetterConfig({
      ...problem.setter,
      stdProgram: source.path
    });
  });
}

export async function clearProblemStdProgram(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const setter = normalizeSetterConfig(problem.setter);
    delete setter.stdProgram;
    problem.setter = setter;
  });
}

export function getProblemGeneratorProgram(problem: ProblemConfig): string | undefined {
  return problem.setter?.generator?.generators?.[0]?.source;
}

export async function setProblemGeneratorProgram(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  generatorPath: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const source = createProblemSource(workspaceFolder, generatorPath);
    const setter = normalizeSetterConfig(problem.setter);
    problem.setter = {
      ...setter,
      generator: {
        enabled: true,
        generators: [
          {
            id: 'default-generator',
            name: source.name ?? path.basename(generatorPath),
            source: source.path
          }
        ]
      }
    };
  });
}

export async function clearProblemGeneratorProgram(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  return updateProblem(workspaceFolder, problemId, (problem) => {
    const setter = normalizeSetterConfig(problem.setter);
    problem.setter = {
      ...setter,
      generator: {
        enabled: false,
        generators: []
      }
    };
  });
}

export async function createProblemSubtask(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  name: string
): Promise<SubtaskConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  const subtasks = normalizeSubtasks(problem);
  const subtask: SubtaskConfig = {
    id: createSubtaskId(subtasks),
    name: uniqueSubtaskName(subtasks, name.trim() || `Subtask ${subtasks.length + 1}`),
    sampleIds: []
  };
  problem.subtasks = [...subtasks, subtask];
  await writeProblemsConfig(workspaceFolder, problems);
  return subtask;
}

export async function renameProblemSubtask(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  subtaskId: string,
  name: string
): Promise<SubtaskConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const subtask = problem?.subtasks?.find((entry) => entry.id === subtaskId);
  if (!problem || !subtask) {
    return undefined;
  }

  subtask.name = uniqueSubtaskName(problem.subtasks?.filter((entry) => entry.id !== subtaskId) ?? [], name.trim() || subtask.name);
  await writeProblemsConfig(workspaceFolder, problems);
  return subtask;
}

export async function deleteProblemSubtask(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  subtaskId: string
): Promise<boolean> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return false;
  }

  const before = problem.subtasks?.length ?? 0;
  problem.subtasks = (problem.subtasks ?? []).filter((entry) => entry.id !== subtaskId);
  if (problem.subtasks.length === before) {
    return false;
  }

  await writeProblemsConfig(workspaceFolder, problems);
  return true;
}

export async function moveProblemSampleToSubtask(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: string,
  targetSubtaskId?: string
): Promise<boolean> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem || !problem.samples.some((sample) => sample.id === sampleId)) {
    return false;
  }
  if (targetSubtaskId && !problem.subtasks?.some((subtask) => subtask.id === targetSubtaskId)) {
    return false;
  }

  const affected = new Set<string>();
  for (const subtask of problem.subtasks ?? []) {
    if (subtask.sampleIds.includes(sampleId)) {
      affected.add(subtask.id);
    }
    subtask.sampleIds = subtask.sampleIds.filter((entry) => entry !== sampleId);
  }

  if (targetSubtaskId) {
    const target = problem.subtasks?.find((subtask) => subtask.id === targetSubtaskId);
    if (!target) {
      return false;
    }
    target.sampleIds = [...target.sampleIds, sampleId];
    affected.add(target.id);
  }

  clearSubtaskResults(problem, affected);
  await writeProblemsConfig(workspaceFolder, problems);
  return true;
}

export async function setProblemSubtaskResult(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  subtaskId: string,
  result: Omit<SubtaskRunResult, 'updatedAt'> & { updatedAt?: string }
): Promise<SubtaskConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const subtask = problem?.subtasks?.find((entry) => entry.id === subtaskId);
  if (!problem || !subtask) {
    return undefined;
  }

  subtask.lastResult = {
    ...result,
    updatedAt: result.updatedAt ?? new Date().toISOString()
  };
  await writeProblemsConfig(workspaceFolder, problems);
  return subtask;
}

export function getSubtaskSamples(problem: ProblemConfig, subtaskId: string): SampleConfig[] {
  const subtask = problem.subtasks?.find((entry) => entry.id === subtaskId);
  if (!subtask) {
    return [];
  }
  const ids = new Set(subtask.sampleIds);
  return problem.samples.filter((sample) => ids.has(sample.id));
}

export function getUnassignedProblemSamples(problem: ProblemConfig): SampleConfig[] {
  const assigned = new Set((problem.subtasks ?? []).flatMap((subtask) => subtask.sampleIds));
  return problem.samples.filter((sample) => !assigned.has(sample.id));
}

export type GeneratedAnswerStatus = {
  path?: string;
  relPath?: string;
  exists: boolean;
};

export type ApplyGeneratedAnswerResult = {
  ok: boolean;
  sample?: SampleConfig;
  answerPath?: string;
  generatedPath?: string;
  error?: string;
};

export type WriteGeneratedAnswerResult =
  | {
    ok: true;
    mode: 'direct';
    problem: ProblemConfig;
    sample: SampleConfig;
    answerPath: string;
    answerCreated: boolean;
  }
  | {
    ok: true;
    mode: 'pending';
    problem: ProblemConfig;
    sample: SampleConfig;
    answerPath: string;
    generatedPath: string;
  }
  | {
    ok: false;
    error: string;
  };

export async function isAnswerFileEmpty(answerPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(answerPath);
    if (stat.size === 0) {
      return true;
    }
    const content = await fs.readFile(answerPath, 'utf8');
    return content.trim().length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

export async function getSampleGeneratedAnswerStatus(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  sample: SampleConfig
): Promise<GeneratedAnswerStatus> {
  const relPath = problem.setter?.generatedAnswers?.[sample.id];
  if (!relPath) {
    return { exists: false };
  }

  const generatedPath = resolveProblemReferencePath(workspaceFolder, relPath);
  return {
    path: generatedPath,
    relPath,
    exists: await exists(generatedPath)
  };
}

export async function hasProblemGeneratedAnswers(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<boolean> {
  for (const sample of problem.samples) {
    if ((await getSampleGeneratedAnswerStatus(workspaceFolder, problem, sample)).exists) {
      return true;
    }
  }
  return false;
}

export async function writeGeneratedAnswerForSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number,
  content: string
): Promise<WriteGeneratedAnswerResult> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const sample = problem?.samples.find((entry) => entry.index === sampleId);
  if (!problem || !sample) {
    return { ok: false, error: 'Sample not found.' };
  }

  const answerPathAssigned = !sample.answer?.trim();
  if (answerPathAssigned) {
    sample.answer = getDefaultAnswerPathForSample(sample);
  }
  const answerPath = resolveSamplePath(workspaceFolder, sample.answer);
  const answerCreated = !(await exists(answerPath));

  let answerEmpty: boolean;
  try {
    answerEmpty = await isAnswerFileEmpty(answerPath);
  } catch (error) {
    return { ok: false, error: `Failed to inspect current answer file: ${String(error)}` };
  }

  if (answerEmpty) {
    try {
      await fs.mkdir(path.dirname(answerPath), { recursive: true });
      await fs.writeFile(answerPath, content, 'utf8');
      await removeGeneratedAnswerFile(workspaceFolder, problem, sample);
      clearGeneratedAnswerMapping(problem, sample);
      await writeProblemsConfig(workspaceFolder, problems);
      return {
        ok: true,
        mode: 'direct',
        problem,
        sample,
        answerPath,
        answerCreated
      };
    } catch (error) {
      return { ok: false, error: `Failed to write current answer file: ${String(error)}` };
    }
  }

  const generatedRel = getGeneratedAnswerRelPath(problem.id, sample);
  const generatedPath = resolveWorkspacePath(workspaceFolder, generatedRel);
  try {
    await fs.mkdir(path.dirname(generatedPath), { recursive: true });
    await fs.writeFile(generatedPath, content, 'utf8');

    const setter = normalizeSetterConfig(problem.setter);
    problem.setter = {
      ...setter,
      generatedAnswers: {
        ...(setter.generatedAnswers ?? {}),
        [sample.id]: generatedRel
      }
    };
    await writeProblemsConfig(workspaceFolder, problems);
    return { ok: true, mode: 'pending', problem, sample, answerPath, generatedPath };
  } catch (error) {
    return { ok: false, error: `Failed to write generated output: ${String(error)}` };
  }
}

export async function applyGeneratedAnswerForSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number
): Promise<ApplyGeneratedAnswerResult> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const sample = problem?.samples.find((entry) => entry.index === sampleId);
  if (!problem || !sample) {
    return { ok: false, error: 'Sample not found.' };
  }

  const generatedRel = problem.setter?.generatedAnswers?.[sample.id];
  if (!generatedRel) {
    return { ok: false, sample, error: 'No generated output exists.' };
  }

  const generatedPath = resolveProblemReferencePath(workspaceFolder, generatedRel);
  if (!(await exists(generatedPath))) {
    clearGeneratedAnswerMapping(problem, sample);
    await writeProblemsConfig(workspaceFolder, problems);
    return { ok: false, sample, generatedPath, error: 'Generated output file is missing.' };
  }

  if (!sample.answer) {
    sample.answer = getDefaultAnswerPathForSample(sample);
  }
  const answerPath = resolveSamplePath(workspaceFolder, sample.answer);
  await fs.mkdir(path.dirname(answerPath), { recursive: true });
  await fs.copyFile(generatedPath, answerPath);
  await fs.rm(generatedPath, { force: true });
  clearGeneratedAnswerMapping(problem, sample);
  await writeProblemsConfig(workspaceFolder, problems);

  return { ok: true, sample, answerPath, generatedPath };
}

export async function applyAllGeneratedAnswersForProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<{ applied: ApplyGeneratedAnswerResult[]; failed: ApplyGeneratedAnswerResult[] }> {
  const problem = await getProblem(workspaceFolder, problemId);
  if (!problem) {
    return { applied: [], failed: [{ ok: false, error: 'Problem not found.' }] };
  }

  const applied: ApplyGeneratedAnswerResult[] = [];
  const failed: ApplyGeneratedAnswerResult[] = [];
  for (const sample of problem.samples) {
    if (!problem.setter?.generatedAnswers?.[sample.id]) {
      continue;
    }
    const result = await applyGeneratedAnswerForSample(workspaceFolder, problemId, sample.index);
    if (result.ok) {
      applied.push(result);
    } else {
      failed.push(result);
    }
  }
  return { applied, failed };
}

export async function deleteGeneratedAnswerForSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number
): Promise<{ ok: boolean; sample?: SampleConfig; generatedPath?: string; error?: string }> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const sample = problem?.samples.find((entry) => entry.index === sampleId);
  if (!problem || !sample) {
    return { ok: false, error: 'Sample not found.' };
  }

  const generatedRel = problem.setter?.generatedAnswers?.[sample.id];
  const generatedPath = generatedRel ? resolveProblemReferencePath(workspaceFolder, generatedRel) : undefined;
  if (generatedPath) {
    await fs.rm(generatedPath, { force: true });
  }
  clearGeneratedAnswerMapping(problem, sample);
  await writeProblemsConfig(workspaceFolder, problems);
  return { ok: true, sample, generatedPath };
}

export async function renameProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number,
  desiredName: string
): Promise<{ problem?: ProblemConfig; sample?: SampleConfig; renamed?: boolean } | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const sample = problem?.samples.find((entry) => entry.index === sampleId);
  if (!problem || !sample) {
    return undefined;
  }

  const originalName = desiredName.trim();
  const finalName = uniqueSampleName(problem.samples.filter((entry) => entry.id !== sample.id), originalName);
  sample.name = finalName;
  problem.setter = upsertSetterDataCaseForSample(problem.setter, sample);
  await writeProblemsConfig(workspaceFolder, problems);
  return {
    problem,
    sample,
    renamed: finalName !== originalName
  };
}

export async function deleteProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sampleId: number
): Promise<{ sample?: SampleConfig; cleanupErrors: string[]; reportCleared: boolean }> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  const sampleIndex = problem?.samples.findIndex((entry) => entry.index === sampleId) ?? -1;
  if (!problem || sampleIndex < 0) {
    return { cleanupErrors: [], reportCleared: false };
  }

  const [sample] = problem.samples.splice(sampleIndex, 1);
  const generatedRel = problem.setter?.generatedAnswers?.[sample.id];
  problem.setter = removeSetterDataCaseForSample(problem.setter, sample);
  removeSampleFromSubtasks(problem, sample.id);
  await writeProblemsConfig(workspaceFolder, problems);

  const cleanupErrors: string[] = [];
  if (generatedRel) {
    await removePath(resolveProblemReferencePath(workspaceFolder, generatedRel), cleanupErrors);
  }
  if (inferSampleSourceType(workspaceFolder, sample) === 'managed') {
    await removeManagedSampleFiles(workspaceFolder, sample, cleanupErrors);
  }
  await removeSampleOutputs(workspaceFolder, problemId, sample, cleanupErrors);
  const reportCleared = await updateReportAfterSampleDeleted(workspaceFolder, problemId, sample);

  return { sample, cleanupErrors, reportCleared };
}

export function getDefaultProblemSource(problem: ProblemConfig): string | undefined {
  return problem.defaultSource || problem.source || problem.sources?.[0]?.path;
}

export function getProblemSourcePath(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): string | undefined {
  const source = getDefaultProblemSource(problem);
  return source ? resolveProblemReferencePath(workspaceFolder, source) : undefined;
}

export function resolveProblemReferencePath(workspaceFolder: vscode.WorkspaceFolder, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : resolveWorkspacePath(workspaceFolder, filePath);
}

export async function saveProblemReport(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  report: unknown
): Promise<void> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function updateProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  update: (problem: ProblemConfig) => void
): Promise<ProblemConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  const problem = findProblem(problems, problemId);
  if (!problem) {
    return undefined;
  }

  update(problem);
  await writeProblemsConfig(workspaceFolder, problems);
  return problem;
}

async function addProblemSampleFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  input: string,
  answer: string
): Promise<SampleConfig> {
  await ensureProblemFolders(workspaceFolder, problem.id);
  const index = await getNextAvailableProblemSampleIndex(workspaceFolder, problem);
  const { inputRel, answerRel } = getProblemSampleFilePaths(problem.id, index);
  const outputRel = getProblemSampleOutputPaths(workspaceFolder, problem.id, index).outputRel;

  await fs.writeFile(resolveWorkspacePath(workspaceFolder, inputRel), input, 'utf8');
  await fs.writeFile(resolveWorkspacePath(workspaceFolder, answerRel), answer, 'utf8');

  return {
    id: createSampleInternalId(index),
    index,
    name: `Sample ${index}`,
    input: inputRel,
    answer: answerRel,
    actualOutput: outputRel,
    sourceType: 'managed'
  };
}

async function addProblemInputSampleFile(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<SampleConfig> {
  await ensureProblemFolders(workspaceFolder, problem.id);
  const index = await getNextAvailableProblemSampleIndex(workspaceFolder, problem);
  const { inputRel, answerRel } = getProblemSampleFilePaths(problem.id, index);
  const outputRel = getProblemSampleOutputPaths(workspaceFolder, problem.id, index).outputRel;

  await fs.writeFile(resolveWorkspacePath(workspaceFolder, inputRel), '', 'utf8');

  return {
    id: createSampleInternalId(index),
    index,
    name: `sample-${index}`,
    input: inputRel,
    answer: answerRel,
    actualOutput: outputRel,
    sourceType: 'managed'
  };
}

function getProblemSampleFilePaths(problemId: string, index: number): { inputRel: string; answerRel: string } {
  return {
    inputRel: toPosixPath(path.join('.oitest', 'problems', problemId, 'samples', `sample-${index}.in`)),
    answerRel: toPosixPath(path.join('.oitest', 'problems', problemId, 'samples', `sample-${index}.out`))
  };
}

function getGeneratedAnswerRelPath(problemId: string, sample: Pick<SampleConfig, 'id'>): string {
  const safeId = sample.id.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'sample';
  return toPosixPath(path.join('.oitest', 'problems', problemId, 'generated-answers', `${safeId}.generated.ans`));
}

function clearGeneratedAnswerMapping(problem: ProblemConfig, sample: Pick<SampleConfig, 'id'>): void {
  const setter = normalizeSetterConfig(problem.setter);
  const generatedAnswers = { ...(setter.generatedAnswers ?? {}) };
  delete generatedAnswers[sample.id];
  problem.setter = {
    ...setter,
    generatedAnswers
  };
}

async function removeGeneratedAnswerFile(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  sample: Pick<SampleConfig, 'id'>
): Promise<void> {
  const generatedRel = problem.setter?.generatedAnswers?.[sample.id];
  if (generatedRel) {
    await fs.rm(resolveProblemReferencePath(workspaceFolder, generatedRel), { force: true });
  }
}

function getDefaultAnswerPathForSample(sample: Pick<SampleConfig, 'input'>): string {
  const parsed = path.parse(sample.input);
  if (parsed.ext.toLowerCase() === '.in') {
    return toPosixPath(path.join(parsed.dir, `${parsed.name}.out`));
  }
  return toPosixPath(path.join(parsed.dir, `${parsed.base}.out`));
}

async function getNextAvailableProblemSampleIndex(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<number> {
  let index = getNextSampleIndex(problem);
  while (await problemSampleArtifactsExist(workspaceFolder, problem.id, index)) {
    index += 1;
  }
  return index;
}

async function problemSampleArtifactsExist(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  index: number
): Promise<boolean> {
  const { inputRel, answerRel } = getProblemSampleFilePaths(problemId, index);
  const legacyAnswerRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'samples', `sample-${index}.ans`));
  const outputDir = path.dirname(getProblemSampleOutputPaths(workspaceFolder, problemId, index).outputPath);
  return (
    (await exists(resolveWorkspacePath(workspaceFolder, inputRel))) ||
    (await exists(resolveWorkspacePath(workspaceFolder, answerRel))) ||
    (await exists(resolveWorkspacePath(workspaceFolder, legacyAnswerRel))) ||
    (await exists(outputDir))
  );
}

async function ensureProblemFolders(workspaceFolder: vscode.WorkspaceFolder, problemId: string): Promise<void> {
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'samples'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'outputs'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'build'), { recursive: true });
}

function normalizeProblem(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): ProblemConfig {
  const defaults = createDefaultConfig();
  const id = problem.id ?? 'problem';
  const defaultSource = problem.defaultSource || problem.source || problem.sources?.[0]?.path;
  const sources = normalizeProblemSources(workspaceFolder, problem, defaultSource);
  return {
    ...defaults,
    ...problem,
    id,
    compiler: problem.compiler ?? problem.compile ?? defaults.compiler,
    compile: problem.compile ?? problem.compiler ?? defaults.compile,
    limits: {
      ...defaults.limits,
      ...problem.limits
    },
    stack: normalizeStackConfig(problem.stack),
    judgeMode: normalizeJudgeMode(problem.judgeMode, problem.checker),
    ioMode: normalizeIoMode(problem.ioMode),
    fileIo: normalizeFileIoConfig(problem.fileIo),
    checker: normalizeCheckerConfig(problem.checker),
    setter: normalizeSetterConfig(problem.setter),
    samples: (problem.samples ?? []).map((sample, index) => normalizeProblemSample(workspaceFolder, sample, id, index + 1)),
    subtasks: normalizeProblemSubtasks(problem),
    standard: problem.standard ?? getStandardFromArgs((problem.compiler ?? defaults.compiler).args),
    source: problem.source,
    defaultSource,
    sources
  };
}

function normalizeProblemSubtasks(problem: ProblemConfig): SubtaskConfig[] {
  const sampleIds = new Set((problem.samples ?? []).map((sample, index) => sample.id ?? createSampleInternalId(index + 1)));
  const usedSampleIds = new Set<string>();
  const usedSubtaskIds = new Set<string>();
  return (problem.subtasks ?? []).map((subtask, index) => {
    const id = normalizeSubtaskId(subtask.id, index + 1, usedSubtaskIds);
    const cleanSampleIds: string[] = [];
    for (const sampleId of subtask.sampleIds ?? []) {
      if (!sampleIds.has(sampleId) || usedSampleIds.has(sampleId)) {
        continue;
      }
      usedSampleIds.add(sampleId);
      cleanSampleIds.push(sampleId);
    }
    return {
      id,
      name: subtask.name?.trim() || `Subtask ${index + 1}`,
      sampleIds: cleanSampleIds,
      lastResult: normalizeSubtaskResult(subtask.lastResult)
    };
  });
}

function normalizeSubtaskResult(result: SubtaskRunResult | undefined): SubtaskRunResult | undefined {
  if (!result || !['passed', 'failed', 'notRun'].includes(result.status)) {
    return undefined;
  }
  return {
    status: result.status,
    passed: Math.max(0, Number(result.passed) || 0),
    total: Math.max(0, Number(result.total) || 0),
    updatedAt: result.updatedAt || new Date(0).toISOString()
  };
}

function normalizeSubtaskId(id: string | undefined, fallbackIndex: number, used: Set<string>): string {
  const base = id?.trim() || `subtask-${fallbackIndex}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeSubtasks(problem: ProblemConfig): SubtaskConfig[] {
  problem.subtasks = normalizeProblemSubtasks(problem);
  return problem.subtasks;
}

function createSubtaskId(subtasks: SubtaskConfig[]): string {
  const used = new Set(subtasks.map((subtask) => subtask.id));
  let index = subtasks.length + 1;
  let candidate = `subtask-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `subtask-${index}`;
  }
  return candidate;
}

function uniqueSubtaskName(subtasks: SubtaskConfig[], name: string): string {
  const baseName = name.trim() || 'Subtask';
  let candidate = baseName;
  let suffix = 2;
  while (subtasks.some((subtask) => subtask.name === candidate)) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function clearSubtaskResults(problem: ProblemConfig, subtaskIds: Set<string>): void {
  for (const subtask of problem.subtasks ?? []) {
    if (subtaskIds.has(subtask.id)) {
      delete subtask.lastResult;
    }
  }
}

function clearAllSubtaskResults(problem: ProblemConfig): void {
  for (const subtask of problem.subtasks ?? []) {
    delete subtask.lastResult;
  }
}

function removeSampleFromSubtasks(problem: ProblemConfig, sampleId: string): void {
  const affected = new Set<string>();
  for (const subtask of problem.subtasks ?? []) {
    if (subtask.sampleIds.includes(sampleId)) {
      affected.add(subtask.id);
    }
    subtask.sampleIds = subtask.sampleIds.filter((entry) => entry !== sampleId);
  }
  clearSubtaskResults(problem, affected);
}

function normalizeProblemSources(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  defaultSource: string | undefined
): ProblemSource[] {
  const sources = [...(problem.sources ?? [])];
  if (defaultSource && !sources.some((source) => source.path === defaultSource)) {
    sources.unshift(createProblemSource(workspaceFolder, defaultSource));
  }
  return sources;
}

function normalizeProblemSample(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId: string,
  fallbackId: number
): SampleConfig {
  const index = resolveSampleIndex(sample, fallbackId);
  const outputRel = toPosixPath(path.join('.oitest', 'problems', problemId, 'outputs', `sample-${index}`, 'useroutput.txt'));
  const answer = sample.answer?.trim()
    ? sample.answer
    : sample.expectedOutput?.trim()
      ? sample.expectedOutput
      : getDefaultAnswerPathForSample(sample);
  return {
    ...sample,
    id: normalizeSampleInternalId(sample.id, index),
    index,
    name: sample.name ?? `Sample ${index}`,
    answer,
    actualOutput: sample.actualOutput?.endsWith(`${index}.out`) ? outputRel : (sample.actualOutput ?? outputRel),
    sourceType: sample.sourceType ?? inferSampleSourceType(workspaceFolder, { ...sample, answer })
  };
}

function findProblem(config: ProblemsConfig, problemId: string): ProblemConfig | undefined {
  return config.problems.find((problem) => problem.id === problemId);
}

function createProblemId(baseName: string, config: ProblemsConfig): string {
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'problem';
  let candidate = safeBase;
  let suffix = 2;
  while (config.problems.some((problem) => problem.id === candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createProblemName(baseName: string, config: ProblemsConfig): string {
  let candidate = baseName || 'Problem';
  let suffix = 2;
  while (config.problems.some((problem) => problem.name === candidate)) {
    candidate = `${baseName || 'Problem'} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createProblemSource(workspaceFolder: vscode.WorkspaceFolder, sourcePath: string): ProblemSource {
  const resolved = resolveProblemReferencePath(workspaceFolder, sourcePath);
  const workspaceRelative = path.relative(workspaceFolder.uri.fsPath, resolved);
  const storedPath =
    workspaceRelative && !workspaceRelative.startsWith('..') && !path.isAbsolute(workspaceRelative)
      ? toPosixPath(workspaceRelative)
      : path.resolve(resolved);
  return {
    path: storedPath,
    name: path.basename(resolved),
    lastUsedAt: new Date().toISOString()
  };
}

function upsertProblemSource(sources: ProblemSource[], source: ProblemSource): ProblemSource[] {
  const filtered = sources.filter((entry) => entry.path !== source.path);
  return [source, ...filtered];
}

function getStatementType(statementPath: string): ProblemStatementType {
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

async function removeManagedSampleFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  cleanupErrors: string[]
): Promise<void> {
  const oitestRoot = getOITestDir(workspaceFolder);
  for (const samplePath of [sample.input, sample.answer]) {
    const resolved = resolveSamplePath(workspaceFolder, samplePath);
    if (!isUnderPath(resolved, oitestRoot)) {
      continue;
    }
    await removePath(resolved, cleanupErrors);
  }
}

async function removeSampleOutputs(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sample: SampleConfig,
  cleanupErrors: string[]
): Promise<void> {
  const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.index);
  await removePath(path.dirname(paths.outputPath), cleanupErrors);
  await removePath(paths.legacyOutputPath, cleanupErrors);
  await removePath(paths.legacyStderrPath, cleanupErrors);
  await removePath(paths.legacyDiffPath, cleanupErrors);

  if (sample.actualOutput) {
    const resolved = resolveSamplePath(workspaceFolder, sample.actualOutput);
    if (isUnderPath(resolved, path.join(getProblemRoot(workspaceFolder, problemId), 'outputs'))) {
      await removePath(resolved, cleanupErrors);
    }
  }
}

async function updateReportAfterSampleDeleted(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string,
  sample: SampleConfig
): Promise<boolean> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  if (!(await exists(reportPath))) {
    return false;
  }

  try {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
    const filter = (entry: { id?: string; index?: number; name?: string; input?: string; answer?: string }) =>
      entry.id !== sample.id &&
      entry.index !== sample.index &&
      entry.name !== sample.name &&
      (entry.input !== sample.input || entry.answer !== sample.answer);
    report.samples = (report.samples ?? []).filter(filter);
    report.results = (report.results ?? report.samples).filter(filter);
    report.summary = {
      accepted: report.samples.filter((entry) => entry.status === 'AC').length,
      total: report.samples.length
    };
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return false;
  } catch {
    await fs.rm(reportPath, { force: true });
    return true;
  }
}

async function removePath(targetPath: string, cleanupErrors: string[]): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(`${targetPath}: ${String(error)}`);
  }
}

function formatSampleText(value: string, shouldDecodeEscapes: boolean): string {
  return shouldDecodeEscapes ? value.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : value;
}

function setStandardArg(args: string[], standard: string): string[] {
  const nextArgs = args.filter((arg) => !arg.startsWith('-std='));
  return [`-std=${standard}`, ...nextArgs];
}

function getStandardFromArgs(args: string[]): string {
  return args.find((arg) => arg.startsWith('-std='))?.replace('-std=', '') ?? 'c++17';
}

function guessLegacySource(workspaceFolder: vscode.WorkspaceFolder): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath === workspaceFolder.uri.fsPath) {
    return editor.document.uri.fsPath;
  }
  return undefined;
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
