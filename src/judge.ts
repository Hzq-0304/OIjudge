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
  const totalStartedAt = process.hrtime.bigint();
  output.clear();
  output.show(true);
  output.appendLine('OIjudger');
  output.appendLine(`Source: ${sourcePath}`);
  output.appendLine(`Time limit: ${config.limits.timeMs} ms`);
  output.appendLine(`Memory limit: ${config.limits.memoryMb} MB`);
  output.appendLine('');

  const compile = await compileSource(workspaceFolder, sourcePath, config, output);
  if (!compile) {
    return undefined;
  }

  const samples: SampleReport[] = [];
  for (const sample of config.samples) {
    samples.push(await judgeSample(workspaceFolder, compile.executablePath, sample, config.limits.timeMs, output));
  }

  const accepted = samples.filter((sample) => sample.status === 'AC').length;
  const totalTimeMs = elapsedMs(totalStartedAt);
  const report: JudgeReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    compile: {
      status: compile.status,
      timeMs: compile.timeMs
    },
    totalTimeMs,
    timeLimitMs: config.limits.timeMs,
    memoryLimitMb: config.limits.memoryMb,
    summary: {
      accepted,
      total: samples.length
    },
    results: samples,
    samples
  };

  await fs.mkdir(resolveWorkspacePath(workspaceFolder, '.oitest/outputs'), { recursive: true });
  await fs.writeFile(getReportPath(workspaceFolder), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  output.appendLine('');
  output.appendLine(`Summary: ${accepted}/${samples.length} accepted`);
  output.appendLine(`Total judge time: ${formatMs(totalTimeMs)} ms`);
  output.appendLine('Report: .oitest/outputs/report.json');
  if (process.platform === 'win32') {
    output.appendLine(
      'Note: On Windows, sample time includes process startup and pipe I/O overhead, so very small programs may still show tens of milliseconds.'
    );
    output.appendLine(
      '说明：在 Windows 上，样例运行时间包含进程启动和管道 I/O 开销，因此极小程序也可能显示几十毫秒。'
    );
  }

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
    return createSampleReport(sample, 'ERR', 0, 0, actualOutputRel, `Failed to read sample files: ${String(error)}`);
  }

  let result: ProcessResult;
  try {
    result = await runProcess(executablePath, [], input, workspaceFolder.uri.fsPath, timeLimitMs);
  } catch (error) {
    await saveActualOutput(actualOutputPath, '');
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to start executable: ${String(error)}`);
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'ERR', 0, 0, actualOutputRel, `Failed to start executable: ${String(error)}`);
  }

  await saveActualOutput(actualOutputPath, result.stdout);

  if (result.timedOut) {
    output.appendLine(`[TLE] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'TLE', result.timeMs, 0, actualOutputRel, 'Time limit exceeded.');
  }

  if (result.code !== 0) {
    const message = `Runtime error, exit code ${result.code ?? 'unknown'}.`;
    output.appendLine(`[RE] ${sample.name} (${formatMs(result.timeMs)} ms, exit code ${result.code ?? 'unknown'})`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    if (result.stderr.trim()) {
      output.appendLine(indent(result.stderr.trimEnd()));
    }
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'RE', result.timeMs, 0, actualOutputRel, message);
  }

  const compareStartedAt = process.hrtime.bigint();
  const accepted = isOutputAccepted(result.stdout, answer);
  const compareTimeMs = elapsedMs(compareStartedAt);

  if (!accepted) {
    output.appendLine(`[WA] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
    output.appendLine(`  answer: ${sample.answer}`);
    output.appendLine(`  actual output: ${actualOutputRel}`);
    return createSampleReport(sample, 'WA', result.timeMs, compareTimeMs, actualOutputRel, 'Output differs from answer.');
  }

  output.appendLine(`[AC] ${sample.name} (${formatMs(result.timeMs)} ms)`);
  output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
  output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
  return createSampleReport(sample, 'AC', result.timeMs, compareTimeMs, actualOutputRel);
}

async function saveActualOutput(actualOutputPath: string, stdout: string): Promise<void> {
  await fs.mkdir(resolveDirname(actualOutputPath), { recursive: true });
  await fs.writeFile(actualOutputPath, stdout, 'utf8');
}

function createSampleReport(
  sample: SampleConfig,
  status: SampleReport['status'],
  timeMs: number,
  compareTimeMs: number,
  actualOutput: string,
  message?: string
): SampleReport {
  return {
    id: sample.id,
    name: sample.name,
    status,
    timeMs,
    compareTimeMs,
    elapsedMs: Math.round(timeMs),
    input: sample.input,
    answer: sample.answer,
    actualOutput,
    message
  };
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatMs(value: number): number {
  return Math.round(value);
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
