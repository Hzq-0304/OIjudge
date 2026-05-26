import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { compileSource } from './compiler';
import { isOutputAccepted } from './comparator';
import { getReportPath, resolveWorkspacePath } from './config';
import { runProcess } from './runner';
import { JudgeReport, OITestConfig, ProcessResult, SampleConfig, SampleReport } from './types';

export async function runAllSamples(
  workspaceFolder: vscode.WorkspaceFolder,
  sourcePath: string,
  config: OITestConfig,
  output: vscode.OutputChannel
): Promise<JudgeReport | undefined> {
  output.clear();
  output.show(true);
  output.appendLine('OIjudger');
  output.appendLine(`Source: ${sourcePath}`);
  output.appendLine(`Time limit: ${config.limits.timeMs} ms`);
  output.appendLine(`Memory limit: ${config.limits.memoryMb} MB`);
  output.appendLine('');

  const executablePath = await compileSource(workspaceFolder, sourcePath, config, output);
  if (!executablePath) {
    return undefined;
  }

  const samples: SampleReport[] = [];
  for (const sample of config.samples) {
    samples.push(await judgeSample(workspaceFolder, executablePath, sample, config.limits.timeMs, output));
  }

  const accepted = samples.filter((sample) => sample.status === 'AC').length;
  const report: JudgeReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    timeLimitMs: config.limits.timeMs,
    memoryLimitMb: config.limits.memoryMb,
    summary: {
      accepted,
      total: samples.length
    },
    samples
  };

  await fs.mkdir(resolveWorkspacePath(workspaceFolder, '.oitest/outputs'), { recursive: true });
  await fs.writeFile(getReportPath(workspaceFolder), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  output.appendLine('');
  output.appendLine(`Summary: ${accepted}/${samples.length} accepted`);
  output.appendLine('Report: .oitest/outputs/report.json');

  return report;
}

async function judgeSample(
  workspaceFolder: vscode.WorkspaceFolder,
  executablePath: string,
  sample: SampleConfig,
  timeLimitMs: number,
  output: vscode.OutputChannel
): Promise<SampleReport> {
  const inputPath = resolveWorkspacePath(workspaceFolder, sample.input);
  const answerPath = resolveWorkspacePath(workspaceFolder, sample.answer);
  const actualOutputRel = sample.actualOutput ?? `.oitest/outputs/${sample.id}.out`;
  const actualOutputPath = resolveWorkspacePath(workspaceFolder, actualOutputRel);

  let input: string;
  let answer: string;
  try {
    input = await fs.readFile(inputPath, 'utf8');
    answer = await fs.readFile(answerPath, 'utf8');
  } catch (error) {
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to read sample files: ${String(error)}`);
    return createSampleReport(sample, 'ERR', 0, actualOutputRel, `Failed to read sample files: ${String(error)}`);
  }

  let result: ProcessResult;
  try {
    result = await runProcess(executablePath, [], input, workspaceFolder.uri.fsPath, timeLimitMs);
  } catch (error) {
    await saveActualOutput(actualOutputPath, '');
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to start executable: ${String(error)}`);
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'ERR', 0, actualOutputRel, `Failed to start executable: ${String(error)}`);
  }

  await saveActualOutput(actualOutputPath, result.stdout);

  if (result.timedOut) {
    output.appendLine(`[TLE] ${sample.name} (${result.elapsedMs} ms)`);
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'TLE', result.elapsedMs, actualOutputRel, 'Time limit exceeded.');
  }

  if (result.code !== 0) {
    const message = `Runtime error, exit code ${result.code ?? 'unknown'}.`;
    output.appendLine(`[RE] ${sample.name} (${result.elapsedMs} ms, exit code ${result.code ?? 'unknown'})`);
    if (result.stderr.trim()) {
      output.appendLine(indent(result.stderr.trimEnd()));
    }
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'RE', result.elapsedMs, actualOutputRel, message);
  }

  if (!isOutputAccepted(result.stdout, answer)) {
    output.appendLine(`[WA] ${sample.name} (${result.elapsedMs} ms)`);
    output.appendLine(`  answer: ${sample.answer}`);
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'WA', result.elapsedMs, actualOutputRel, 'Output differs from answer.');
  }

  output.appendLine(`[AC] ${sample.name} (${result.elapsedMs} ms)`);
  return createSampleReport(sample, 'AC', result.elapsedMs, actualOutputRel);
}

async function saveActualOutput(actualOutputPath: string, stdout: string): Promise<void> {
  await fs.mkdir(resolveDirname(actualOutputPath), { recursive: true });
  await fs.writeFile(actualOutputPath, stdout, 'utf8');
}

function createSampleReport(
  sample: SampleConfig,
  status: SampleReport['status'],
  elapsedMs: number,
  actualOutput: string,
  message?: string
): SampleReport {
  return {
    id: sample.id,
    name: sample.name,
    status,
    elapsedMs,
    input: sample.input,
    answer: sample.answer,
    actualOutput,
    message
  };
}

function resolveDirname(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]*$/u, '');
}

function indent(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => `  ${line}`)
    .join('\n');
}
