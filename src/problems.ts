import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
  createDefaultConfig,
  exists,
  getConfigPath,
  getOITestDir,
  readConfig,
  resolveWorkspacePath,
  setCompilerCommand,
  toPosixPath
} from './config';
import { OITestConfig, ProblemConfig, ProblemsConfig, SampleConfig } from './types';

export function getProblemsPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'problems.json');
}

export function getProblemRoot(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getOITestDir(workspaceFolder), 'problems', problemId);
}

export function getProblemReportPath(workspaceFolder: vscode.WorkspaceFolder, problemId: string): string {
  return path.join(getProblemRoot(workspaceFolder, problemId), 'outputs', 'report.json');
}

export async function ensureProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig> {
  if (!(await exists(getProblemsPath(workspaceFolder)))) {
    const config: ProblemsConfig = { version: 1, problems: [] };
    await writeProblemsConfig(workspaceFolder, config);
    return config;
  }
  return readProblemsConfig(workspaceFolder);
}

export async function readProblemsConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<ProblemsConfig> {
  const raw = await fs.readFile(getProblemsPath(workspaceFolder), 'utf8');
  const parsed = JSON.parse(raw) as ProblemsConfig;
  return {
    version: 1,
    problems: (parsed.problems ?? []).map(normalizeProblem)
  };
}

export async function writeProblemsConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: ProblemsConfig
): Promise<void> {
  await fs.mkdir(path.dirname(getProblemsPath(workspaceFolder)), { recursive: true });
  await fs.writeFile(getProblemsPath(workspaceFolder), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
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
    standard: 'c++17'
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
  await writeProblemsConfig(workspaceFolder, problems);
  return sample;
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

export async function getProblem(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<ProblemConfig | undefined> {
  const problems = await ensureProblemsConfig(workspaceFolder);
  return findProblem(problems, problemId);
}

export function getProblemSourcePath(workspaceFolder: vscode.WorkspaceFolder, problem: ProblemConfig): string {
  return resolveWorkspacePath(workspaceFolder, problem.source);
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
  const id = nextSampleId(problem);
  const inputRel = toPosixPath(path.join('.oitest', 'problems', problem.id, 'samples', `${id}.in`));
  const answerRel = toPosixPath(path.join('.oitest', 'problems', problem.id, 'samples', `${id}.ans`));
  const outputRel = toPosixPath(path.join('.oitest', 'problems', problem.id, 'outputs', `${id}.out`));

  await fs.writeFile(resolveWorkspacePath(workspaceFolder, inputRel), input, 'utf8');
  await fs.writeFile(resolveWorkspacePath(workspaceFolder, answerRel), answer, 'utf8');

  return {
    id,
    name: `Sample ${id}`,
    input: inputRel,
    answer: answerRel,
    actualOutput: outputRel
  };
}

async function ensureProblemFolders(workspaceFolder: vscode.WorkspaceFolder, problemId: string): Promise<void> {
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'samples'), { recursive: true });
  await fs.mkdir(path.join(getProblemRoot(workspaceFolder, problemId), 'outputs'), { recursive: true });
}

function normalizeProblem(problem: ProblemConfig): ProblemConfig {
  const defaults = createDefaultConfig();
  return {
    ...defaults,
    ...problem,
    compiler: problem.compiler ?? problem.compile ?? defaults.compiler,
    compile: problem.compile ?? problem.compiler ?? defaults.compile,
    limits: {
      ...defaults.limits,
      ...problem.limits
    },
    samples: problem.samples ?? [],
    standard: problem.standard ?? getStandardFromArgs((problem.compiler ?? defaults.compiler).args),
    source: problem.source ?? ''
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

function nextSampleId(problem: OITestConfig): number {
  return problem.samples.reduce((maxId, sample) => Math.max(maxId, sample.id ?? 0), 0) + 1;
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
