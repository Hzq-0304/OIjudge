import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { compileSource } from './compiler';
import { isOutputAccepted } from './comparator';
import { getReportPath, resolveWorkspacePath } from './config';
import { t } from './i18n';
import { runProcess } from './runner';
import {
  getLegacyOutputRel,
  getProblemSampleOutputPaths,
  getSampleFileStatus,
  inferSampleSourceType,
  resolveSamplePath
} from './sampleFiles';
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
  const problemId = (config as { id?: string }).id;
  for (const sample of config.samples) {
    samples.push(await judgeSample(workspaceFolder, compile.executablePath, sample, config.limits.timeMs, output, problemId));
  }

  const accepted = samples.filter((sample) => sample.status === 'AC').length;
  const totalTimeMs = elapsedMs(totalStartedAt);
  const report: JudgeReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    sourceName: sourcePath.replace(/^.*[\\/]/u, ''),
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
  if (samples.some((sample) => sample.status === 'Missing')) {
    vscode.window.showWarningMessage(t('someSamplesMissing'));
  }
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
  output: vscode.OutputChannel,
  problemId?: string
): Promise<SampleReport> {
  const fileStatus = await getSampleFileStatus(workspaceFolder, sample);
  const outputPaths = getSampleOutputPaths(workspaceFolder, sample, problemId);

  if (fileStatus.inputMissing || fileStatus.answerMissing) {
    output.appendLine(`[Missing] ${sample.name}`);
    output.appendLine(`  missing sample file: ${fileStatus.missingPaths.join(', ')}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'Missing',
      0,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      'Sample input or expected output file is missing.'
    );
  }

  let input: string;
  let answer: string;
  try {
    input = await fs.readFile(fileStatus.inputPath, 'utf8');
    answer = await fs.readFile(fileStatus.answerPath, 'utf8');
  } catch (error) {
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to read sample files: ${String(error)}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'ERR',
      0,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      `Failed to read sample files: ${String(error)}`
    );
  }

  let result: ProcessResult;
  try {
    result = await runProcess(executablePath, [], input, workspaceFolder.uri.fsPath, timeLimitMs);
  } catch (error) {
    await saveTextOutput(outputPaths.outputPath, '');
    await saveTextOutput(outputPaths.stderrPath, String(error));
    output.appendLine(`[ERR] ${sample.name}`);
    output.appendLine(`  failed to start executable: ${String(error)}`);
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'ERR',
      0,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      `Failed to start executable: ${String(error)}`
    );
  }

  await saveTextOutput(outputPaths.outputPath, result.stdout);
  await saveTextOutput(outputPaths.stderrPath, result.stderr);

  if (result.timedOut) {
    output.appendLine(`[TLE] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'TLE',
      result.timeMs,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      'Time limit exceeded.'
    );
  }

  if (result.code !== 0) {
    const message = `Runtime error, exit code ${result.code ?? 'unknown'}.`;
    output.appendLine(`[RE] ${sample.name} (${formatMs(result.timeMs)} ms, exit code ${result.code ?? 'unknown'})`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: 0 ms`);
    if (result.stderr.trim()) {
      output.appendLine(indent(result.stderr.trimEnd()));
    }
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'RE',
      result.timeMs,
      0,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      message
    );
  }

  const compareStartedAt = process.hrtime.bigint();
  const accepted = isOutputAccepted(result.stdout, answer);
  const compareTimeMs = elapsedMs(compareStartedAt);

  if (!accepted) {
    await saveTextOutput(outputPaths.diffPath, createDiffSummary(answer, result.stdout));
    output.appendLine(`[WA] ${sample.name} (${formatMs(result.timeMs)} ms)`);
    output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
    output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
    output.appendLine(`  answer: ${sample.answer}`);
    output.appendLine(`  actual output: ${outputPaths.outputRel}`);
    return createSampleReport(
      workspaceFolder,
      sample,
      'WA',
      result.timeMs,
      compareTimeMs,
      outputPaths.outputRel,
      outputPaths.stderrRel,
      outputPaths.diffRel,
      'Output differs from answer.'
    );
  }

  await saveTextOutput(outputPaths.diffPath, '');
  output.appendLine(`[AC] ${sample.name} (${formatMs(result.timeMs)} ms)`);
  output.appendLine(`${sample.name} run time: ${formatMs(result.timeMs)} ms`);
  output.appendLine(`${sample.name} compare time: ${formatMs(compareTimeMs)} ms`);
  return createSampleReport(
    workspaceFolder,
    sample,
    'AC',
    result.timeMs,
    compareTimeMs,
    outputPaths.outputRel,
    outputPaths.stderrRel,
    outputPaths.diffRel
  );
}

async function saveTextOutput(filePath: string, text: string): Promise<void> {
  await fs.mkdir(resolveDirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

function createSampleReport(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  status: SampleReport['status'],
  timeMs: number,
  compareTimeMs: number,
  outputRel: string,
  stderrRel: string,
  diffRel: string,
  message?: string
): SampleReport {
  const sampleSourceType = inferSampleSourceType(workspaceFolder, sample);
  return {
    id: sample.id,
    name: sample.name,
    status,
    timeMs,
    compareTimeMs,
    elapsedMs: Math.round(timeMs),
    input: resolveSamplePath(workspaceFolder, sample.input),
    answer: resolveSamplePath(workspaceFolder, sample.answer),
    actualOutput: outputRel,
    output: outputRel,
    stderr: stderrRel,
    diff: diffRel,
    sampleSourceType,
    message
  };
}

function getSampleOutputPaths(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId: string | undefined
): {
  outputRel: string;
  outputPath: string;
  stderrRel: string;
  stderrPath: string;
  diffRel: string;
  diffPath: string;
} {
  if (problemId) {
    const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.id);
    return {
      outputRel: paths.outputRel,
      outputPath: paths.outputPath,
      stderrRel: paths.stderrRel,
      stderrPath: paths.stderrPath,
      diffRel: paths.diffRel,
      diffPath: paths.diffPath
    };
  }

  const outputRel = getLegacyOutputRel(sample);
  const outputPath = resolveWorkspacePath(workspaceFolder, outputRel);
  return {
    outputRel,
    outputPath,
    stderrRel: outputRel.replace(/\.out$/u, '.err'),
    stderrPath: outputPath.replace(/\.out$/u, '.err'),
    diffRel: outputRel.replace(/\.out$/u, '.diff'),
    diffPath: outputPath.replace(/\.out$/u, '.diff')
  };
}

function createDiffSummary(answer: string, actual: string): string {
  return [
    'Expected output:',
    answer,
    '',
    'User output:',
    actual
  ].join('\n');
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
