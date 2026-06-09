import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EffectiveScoreResult, calculateEffectiveSampleScores } from './scoring';
import { resolveSamplePath } from './sampleFiles';
import { ProblemConfig, SampleConfig, SubtaskConfig } from './types';

export type TestcaseExportMode = 'copy' | 'move';
export type TestcaseExportFormat = 'luogu' | 'polygon' | 'lemonlime';

export type ExportedSample = {
  sample: SampleConfig;
  inputFileName: string;
  outputFileName: string;
  inputPath: string;
  outputPath: string;
  outputMissing: boolean;
  lemonLimeInputFile?: string;
  lemonLimeOutputFile?: string;
  bundledSubtaskNumber?: number;
  bundledSubtask?: SubtaskConfig;
};

export type TestcaseExportResult = {
  targetDir: string;
  format?: TestcaseExportFormat;
  configGenerated: boolean;
  copiedFiles: string[];
  generatedFiles: string[];
  warnings: string[];
};

export async function exportTestcases(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  targetDir: string,
  format?: TestcaseExportFormat
): Promise<TestcaseExportResult> {
  const copiedFiles: string[] = [];
  const generatedFiles: string[] = [];
  const warnings: string[] = [];
  await fs.mkdir(targetDir, { recursive: true });

  const configGenerated = Boolean(format) && shouldGenerateTestcaseConfig(problem);
  const testcaseTargetDir = configGenerated && format === 'lemonlime'
    ? path.join(targetDir, 'data', getLemonLimeProblemDirName(problem))
    : targetDir;
  const exportedSamples = await copyTestcaseFiles(workspaceFolder, problem, testcaseTargetDir, warnings, copiedFiles);
  await writeOIJudgeExportConfig(problem, targetDir);
  generatedFiles.push(path.join(targetDir, '.OIJudge', 'config.json'));

  if (configGenerated && format) {
    const score = calculateEffectiveSampleScores(problem);
    if (score.errors.length > 0) {
      throw new Error('score.invalid');
    }
    await writePlatformConfig(problem, targetDir, format, exportedSamples, score, generatedFiles);
  }

  return {
    targetDir,
    format,
    configGenerated,
    copiedFiles,
    generatedFiles,
    warnings
  };
}

export function shouldGenerateTestcaseConfig(problem: ProblemConfig): boolean {
  return getManualScoreChanged(problem) || getHasBundledSubtasks(problem);
}

export function getManualScoreChanged(problem: ProblemConfig): boolean {
  return problem.samples.some((sample) => typeof sample.score === 'number');
}

export function getHasBundledSubtasks(problem: ProblemConfig): boolean {
  return (problem.subtasks ?? []).some((subtask) => subtask.scoringMode === 'bundle');
}

export async function targetContainsFiles(targetDir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export function buildLuoguConfigYaml(problem: ProblemConfig, exportedSamples: ExportedSample[]): string {
  const score = calculateEffectiveSampleScores(problem);
  const lines: string[] = [];
  for (const exported of exportedSamples) {
    const sampleScore = score.sampleScores.get(exported.sample.id)?.score ?? 0;
    lines.push(`${quoteYamlKey(exported.inputFileName)}:`);
    lines.push(`  score: ${sampleScore}`);
    if (exported.bundledSubtaskNumber !== undefined) {
      lines.push(`  subtaskId: ${exported.bundledSubtaskNumber}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function buildPolygonImportPlan(
  problem: ProblemConfig,
  exportedSamples: ExportedSample[],
  score: EffectiveScoreResult = calculateEffectiveSampleScores(problem)
): string {
  const bundledGroups = Array.from(createBundledSubtaskNumberMap(problem).entries())
    .map(([subtaskId, number]) => ({ subtaskId, name: `subtask-${number}` }));
  const tests = exportedSamples.map((exported, index) => {
    const test: {
      index: number;
      inputFile: string;
      answerFile: string;
      points: number;
      group?: string;
    } = {
      index: index + 1,
      inputFile: exported.inputFileName,
      answerFile: exported.outputFileName,
      points: score.sampleScores.get(exported.sample.id)?.score ?? 0
    };
    if (exported.bundledSubtaskNumber !== undefined) {
      test.group = `subtask-${exported.bundledSubtaskNumber}`;
    }
    return test;
  });

  return `${JSON.stringify({
    format: 'oijudge-polygon-import-plan',
    version: 1,
    testset: 'tests',
    enablePoints: true,
    tests,
    groups: bundledGroups.map((group) => ({
      name: group.name,
      pointsPolicy: 'COMPLETE_GROUP',
      feedbackPolicy: 'POINTS',
      dependencies: []
    })),
    notes: [
      'This file is an OI Judge Polygon import plan, not an official Polygon package file.'
    ]
  }, null, 2)}\n`;
}

export function buildLemonLimeContestCdf(
  problem: ProblemConfig,
  exportedSamples: ExportedSample[],
  score: EffectiveScoreResult = calculateEffectiveSampleScores(problem)
): string {
  const problemDirName = getLemonLimeProblemDirName(problem);
  const bundledSamples = new Map<string, ExportedSample[]>();
  const standaloneSamples: ExportedSample[] = [];

  for (const exported of exportedSamples) {
    if (exported.bundledSubtask) {
      const entries = bundledSamples.get(exported.bundledSubtask.id) ?? [];
      entries.push(exported);
      bundledSamples.set(exported.bundledSubtask.id, entries);
      continue;
    }
    standaloneSamples.push(exported);
  }

  const testCases = [
    ...standaloneSamples.map((exported) => buildLemonLimeTestCase(
      [exported],
      score.sampleScores.get(exported.sample.id)?.score ?? 0,
      problemDirName
    )),
    ...Array.from(bundledSamples.values()).map((samples) => buildLemonLimeTestCase(
      samples,
      samples.reduce((sum, exported) => sum + (score.sampleScores.get(exported.sample.id)?.score ?? 0), 0),
      problemDirName
    ))
  ];

  return `${JSON.stringify({
    version: '1.0',
    contestTitle: 'OI Judge Export',
    tasks: [
      {
        problemTitle: problem.name || 'problem',
        sourceFileName: problemDirName,
        inputFileName: `${problemDirName}.in`,
        outputFileName: `${problemDirName}.out`,
        standardInputCheck: true,
        standardOutputCheck: true,
        taskType: 0,
        subFolderCheck: false,
        comparisonMode: 1,
        diffArguments: '--ignore-space-change --text --brief',
        realPrecision: 3,
        specialJudge: '',
        compilerConfiguration: {},
        answerFileExtension: 'out',
        testCases
      }
    ],
    contestants: []
  }, null, 2)}\n`;
}

export function buildPolygonReadme(): string {
  return [
    'This export targets Codeforces Polygon conceptually.',
    '',
    'polygon.json is an OI Judge import plan, not an official Polygon package file.',
    'It records tests, points, bundled groups, and group scoring policy.',
    'Use it as a source for future Polygon API import or manual Polygon configuration.',
    '',
    '该导出面向 Codeforces Polygon 的配置模型。',
    '',
    'polygon.json 是 OI Judge 生成的导入计划，不是官方 Polygon 题目包文件。',
    '它记录测试点、分值、捆绑分组和组计分策略。',
    '可用于未来 Polygon API 导入或人工配置参考。',
    ''
  ].join('\n');
}

export function buildLemonLimeReadme(): string {
  return [
    'This export is intended for LemonLime.',
    '',
    'contest.cdf is generated as JSON.',
    'data/<problemName>/ contains input/output files.',
    'source/ is created for LemonLime project layout.',
    '',
    'Bundled OI Judge subtasks are exported as one LemonLime TestCase with multiple input/output file pairs.',
    'Non-bundled subtasks are exported as independent test cases.',
    '',
    '该导出面向 LemonLime。',
    '',
    'contest.cdf 使用 JSON 格式生成。',
    'data/<problemName>/ 存放输入输出文件。',
    'source/ 目录用于 LemonLime 项目结构。',
    '',
    'OI Judge 中的捆绑 Subtask 会导出为一个包含多组输入输出的 LemonLime TestCase。',
    '非捆绑 Subtask 会导出为普通独立测试点。',
    ''
  ].join('\n');
}

async function copyTestcaseFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  targetDir: string,
  warnings: string[],
  copiedFiles: string[]
): Promise<ExportedSample[]> {
  await fs.mkdir(targetDir, { recursive: true });
  const bundledSubtaskNumbers = createBundledSubtaskNumberMap(problem);
  const exportedSamples: ExportedSample[] = [];
  for (const sample of problem.samples) {
    const inputPath = resolveSamplePath(workspaceFolder, sample.input);
    const outputPath = resolveSamplePath(workspaceFolder, sample.answer);
    const inputFileName = path.basename(sample.input);
    const outputFileName = path.basename(sample.answer);
    const targetInput = path.join(targetDir, inputFileName);
    const targetOutput = path.join(targetDir, outputFileName);
    const bundledSubtask = getBundledSubtask(problem, sample.id);

    await fs.copyFile(inputPath, targetInput);
    copiedFiles.push(targetInput);

    let outputMissing = false;
    try {
      await fs.copyFile(outputPath, targetOutput);
      copiedFiles.push(targetOutput);
    } catch {
      outputMissing = true;
      warnings.push(`export.testcases.outputMissing:${outputPath}`);
    }

    exportedSamples.push({
      sample,
      inputFileName,
      outputFileName,
      inputPath: targetInput,
      outputPath: targetOutput,
      outputMissing,
      lemonLimeInputFile: toPosixPath(path.join(getLemonLimeProblemDirName(problem), inputFileName)),
      lemonLimeOutputFile: toPosixPath(path.join(getLemonLimeProblemDirName(problem), outputFileName)),
      bundledSubtaskNumber: getBundledSubtaskNumber(problem, sample.id, bundledSubtaskNumbers),
      bundledSubtask
    });
  }
  return exportedSamples;
}

async function writePlatformConfig(
  problem: ProblemConfig,
  targetDir: string,
  format: TestcaseExportFormat,
  exportedSamples: ExportedSample[],
  score: EffectiveScoreResult,
  generatedFiles: string[]
): Promise<void> {
  if (format === 'luogu') {
    const configPath = path.join(targetDir, 'config.yml');
    await fs.writeFile(configPath, buildLuoguConfigYaml(problem, exportedSamples), 'utf8');
    generatedFiles.push(configPath);
    return;
  }

  if (format === 'polygon') {
    const planPath = path.join(targetDir, 'polygon.json');
    const readmePath = path.join(targetDir, 'POLYGON_EXPORT_README.txt');
    await fs.writeFile(planPath, buildPolygonImportPlan(problem, exportedSamples, score), 'utf8');
    await fs.writeFile(readmePath, buildPolygonReadme(), 'utf8');
    generatedFiles.push(planPath, readmePath);
    return;
  }

  const cdfPath = path.join(targetDir, 'contest.cdf');
  const readmePath = path.join(targetDir, 'LEMONLIME_EXPORT_README.txt');
  const sourceDir = path.join(targetDir, 'source');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(cdfPath, buildLemonLimeContestCdf(problem, exportedSamples, score), 'utf8');
  await fs.writeFile(readmePath, buildLemonLimeReadme(), 'utf8');
  generatedFiles.push(cdfPath, readmePath, sourceDir);
}

async function writeOIJudgeExportConfig(problem: ProblemConfig, targetDir: string): Promise<void> {
  const configDir = path.join(targetDir, '.OIJudge');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.json'), `${JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    problem
  }, null, 2)}\n`, 'utf8');
}

function createBundledSubtaskNumberMap(problem: ProblemConfig): Map<string, number> {
  const map = new Map<string, number>();
  let next = 1;
  for (const subtask of problem.subtasks ?? []) {
    if (subtask.scoringMode !== 'bundle') {
      continue;
    }
    map.set(subtask.id, next);
    next += 1;
  }
  return map;
}

function getBundledSubtaskNumber(
  problem: ProblemConfig,
  sampleId: string,
  bundledSubtaskNumbers: Map<string, number>
): number | undefined {
  const subtask = (problem.subtasks ?? []).find((entry) => entry.sampleIds.includes(sampleId));
  return subtask ? bundledSubtaskNumbers.get(subtask.id) : undefined;
}

function getBundledSubtask(problem: ProblemConfig, sampleId: string): SubtaskConfig | undefined {
  return (problem.subtasks ?? []).find((entry) =>
    entry.scoringMode === 'bundle' && entry.sampleIds.includes(sampleId)
  );
}

function buildLemonLimeTestCase(samples: ExportedSample[], fullScore: number, problemDirName: string): {
  fullScore: number;
  timeLimit: number;
  memoryLimit: number;
  inputFiles: string[];
  outputFiles: string[];
} {
  return {
    fullScore,
    timeLimit: 1000,
    memoryLimit: 256,
    inputFiles: samples.map((exported) => exported.lemonLimeInputFile ?? toPosixPath(path.join(problemDirName, exported.inputFileName))),
    outputFiles: samples.map((exported) => exported.lemonLimeOutputFile ?? toPosixPath(path.join(problemDirName, exported.outputFileName)))
  };
}

function getLemonLimeProblemDirName(problem: ProblemConfig): string {
  const normalized = (problem.name || problem.id || 'problem')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_')
    .replace(/\s+/gu, '_');
  return normalized || 'problem';
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function quoteYamlKey(value: string): string {
  return /^[A-Za-z0-9._-]+$/u.test(value)
    ? value
    : `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}
