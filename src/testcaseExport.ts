import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { calculateEffectiveSampleScores } from './scoring';
import { resolveSamplePath } from './sampleFiles';
import { ProblemConfig, SampleConfig } from './types';

export type TestcaseExportMode = 'copy' | 'move';
export type TestcaseExportFormat = 'luogu';

export type ExportedSample = {
  sample: SampleConfig;
  inputFileName: string;
  outputFileName: string;
  inputPath: string;
  outputPath: string;
  outputMissing: boolean;
  bundledSubtaskNumber?: number;
};

export type TestcaseExportResult = {
  targetDir: string;
  format?: TestcaseExportFormat;
  configGenerated: boolean;
  copiedFiles: string[];
  warnings: string[];
};

export async function exportTestcases(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  targetDir: string,
  format?: TestcaseExportFormat
): Promise<TestcaseExportResult> {
  const copiedFiles: string[] = [];
  const warnings: string[] = [];
  await fs.mkdir(targetDir, { recursive: true });

  const exportedSamples = await copyTestcaseFiles(workspaceFolder, problem, targetDir, warnings, copiedFiles);
  await writeOIJudgeExportConfig(problem, targetDir);
  copiedFiles.push(path.join(targetDir, '.OIJudge', 'config.json'));

  const configGenerated = Boolean(format) && shouldGenerateTestcaseConfig(problem);
  if (configGenerated && format === 'luogu') {
    const score = calculateEffectiveSampleScores(problem);
    if (score.errors.length > 0) {
      throw new Error('score.invalid');
    }
    const configPath = path.join(targetDir, 'config.yml');
    await fs.writeFile(configPath, buildLuoguConfigYaml(problem, exportedSamples), 'utf8');
    copiedFiles.push(configPath);
  }

  return {
    targetDir,
    format,
    configGenerated,
    copiedFiles,
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

async function copyTestcaseFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig,
  targetDir: string,
  warnings: string[],
  copiedFiles: string[]
): Promise<ExportedSample[]> {
  const bundledSubtaskNumbers = createBundledSubtaskNumberMap(problem);
  const exportedSamples: ExportedSample[] = [];
  for (const sample of problem.samples) {
    const inputPath = resolveSamplePath(workspaceFolder, sample.input);
    const outputPath = resolveSamplePath(workspaceFolder, sample.answer);
    const inputFileName = path.basename(sample.input);
    const outputFileName = path.basename(sample.answer);
    const targetInput = path.join(targetDir, inputFileName);
    const targetOutput = path.join(targetDir, outputFileName);

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
      bundledSubtaskNumber: getBundledSubtaskNumber(problem, sample.id, bundledSubtaskNumbers)
    });
  }
  return exportedSamples;
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

function quoteYamlKey(value: string): string {
  return /^[A-Za-z0-9._-]+$/u.test(value)
    ? value
    : `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}
