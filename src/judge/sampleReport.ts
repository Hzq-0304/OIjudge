import * as vscode from 'vscode';
import { resolveWorkspacePath } from '../config';
import {
  getLegacyOutputRel,
  getProblemSampleOutputPaths,
  inferSampleSourceType,
  resolveSamplePath
} from '../sampleFiles';
import { SubtaskSkipDecision } from '../subtaskSkip';
import { CheckerSampleReport, IoMode, SampleConfig, SampleReport } from '../types';

export type JudgeSampleOutputPaths = {
  outputRel: string;
  outputPath: string;
  stderrRel: string;
  stderrPath: string;
  runResultRel: string;
  runResultPath: string;
  runDirRel: string;
  runDirPath: string;
  diffRel: string;
  diffPath: string;
};

export type SampleReportDiagnostics = Partial<Pick<
  SampleReport,
  'source' | 'exe' | 'sourcePath' | 'exePath' | 'cwd' | 'exitCode' | 'signal' | 'killedByTimeout' |
  'hardKillLimitMs' | 'outputLimitExceeded' | 'outputBytes' | 'outputLimitBytes' | 'stdinError' |
  'stdoutError' | 'stderrError' | 'stderrPreview' | 'memoryBytes' | 'memoryKiB' | 'spawnError' |
  'runnerError' | 'compareError' | 'runtimeError' | 'ioMode' | 'fileIo' | 'skip'
>>;

export function createSampleReport(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  status: SampleReport['status'],
  timeMs: number,
  compareTimeMs: number,
  outputRel: string,
  stderrRel: string,
  diffRel: string,
  diagnostics: SampleReportDiagnostics = {},
  message?: string,
  score?: number,
  checker?: CheckerSampleReport
): SampleReport {
  const sampleSourceType = inferSampleSourceType(workspaceFolder, sample);
  return {
    id: sample.id,
    index: sample.index,
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
    runResult: deriveRunResultRel(outputRel),
    diff: diffRel,
    sampleSourceType,
    ...diagnostics,
    score,
    checker,
    message
  };
}

export function createSkippedSampleReport(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId: string | undefined,
  ioMode: IoMode,
  decision: SubtaskSkipDecision
): SampleReport {
  const outputPaths = getSampleOutputPaths(workspaceFolder, sample, problemId);
  return createSampleReport(
    workspaceFolder,
    sample,
    'Skipped',
    0,
    0,
    outputPaths.outputRel,
    outputPaths.stderrRel,
    outputPaths.diffRel,
    {
      killedByTimeout: false,
      ioMode,
      skip: {
        reason: decision.reason,
        subtaskId: decision.subtask?.id,
        subtaskName: decision.subtask?.name,
        dependencyId: decision.dependency?.id,
        dependencyName: decision.dependency?.name
      }
    },
    decision.message,
    0
  );
}

export function deriveRunResultRel(outputRel: string): string {
  if (/useroutput\.txt$/u.test(outputRel)) {
    return outputRel.replace(/useroutput\.txt$/u, 'run-result.txt');
  }
  if (/\.out$/u.test(outputRel)) {
    return outputRel.replace(/\.out$/u, '.run-result.txt');
  }
  return `${outputRel}.run-result.txt`;
}

export function getSampleOutputPaths(
  workspaceFolder: vscode.WorkspaceFolder,
  sample: SampleConfig,
  problemId: string | undefined
): JudgeSampleOutputPaths {
  if (problemId) {
    const paths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.index);
    return {
      outputRel: paths.outputRel,
      outputPath: paths.outputPath,
      stderrRel: paths.stderrRel,
      stderrPath: paths.stderrPath,
      runResultRel: paths.runResultRel,
      runResultPath: paths.runResultPath,
      runDirRel: paths.runDirRel,
      runDirPath: paths.runDirPath,
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
    runResultRel: outputRel.replace(/\.out$/u, '.run-result.txt'),
    runResultPath: outputPath.replace(/\.out$/u, '.run-result.txt'),
    runDirRel: outputRel.replace(/\.out$/u, '-run'),
    runDirPath: outputPath.replace(/\.out$/u, '-run'),
    diffRel: outputRel.replace(/\.out$/u, '.diff'),
    diffPath: outputPath.replace(/\.out$/u, '.diff')
  };
}
