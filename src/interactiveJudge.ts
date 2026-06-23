import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { buildCompileArgs } from './compiler';
import { findCompiler } from './compilerDetection';
import { getCompilerDir, withCompilerPathEnv } from './compilerRuntime';
import { exists, getOiJudgeDataRelPath, getOITestDir, getReportPath } from './config';
import { killProcessTree } from './processTree';
import { ProcessTracker, runProcess } from './runner';
import { calculateEffectiveSampleScores, calculateJudgeScore } from './scoring';
import { getProblemSampleOutputPaths, getSampleFileStatus } from './sampleFiles';
import {
  CompileResult,
  CompileStackReport,
  InteractiveConfig,
  InteractiveReport,
  JudgeReport,
  OITestConfig,
  ProcessResult,
  SampleConfig,
  SampleReport,
  SampleStatus
} from './types';

export const DEFAULT_INTERACTIVE_TRANSCRIPT_LIMIT_BYTES = 256 * 1024;
const INTERACTIVE_COMPILE_TIMEOUT_MS = 60_000;
const INTERACTIVE_PROCESS_GRACE_MS = 1_000;
const STDERR_LIMIT_BYTES = 64 * 1024;

export type ResolvedInteractiveConfig = {
  solution: string;
  interactor: string;
  solutionCompileArgs: string[];
  interactorCompileArgs: string[];
  solutionArgs: string[];
  interactorArgs: string[];
  transcriptLimitBytes: number;
  report: InteractiveReport;
};

export type InteractiveValidationResult =
  | { ok: true; config: ResolvedInteractiveConfig }
  | { ok: false; message: string };

export type InteractiveVerdictMapping = {
  status: SampleStatus;
  message: string;
};

type InteractiveCompileRole = 'solution' | 'interactor';

type InteractiveCompileResult = {
  role: InteractiveCompileRole;
  compile: CompileResult;
};

type InteractiveExecutableSet = {
  solution: CompileResult;
  interactor: CompileResult;
};

type InteractiveRunResult = {
  timeMs: number;
  timedOut: boolean;
  solutionExitCode?: number | null;
  solutionSignal?: NodeJS.Signals | null;
  interactorExitCode?: number | null;
  interactorSignal?: NodeJS.Signals | null;
  solutionStderr: string;
  interactorStderr: string;
  transcript: string;
  transcriptTruncated: boolean;
  diagnostics: string[];
};

export async function runInteractiveJudge(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  output: vscode.OutputChannel,
  options: { onSampleComplete?: (report: JudgeReport, sample: SampleReport) => void | Promise<void> } = {}
): Promise<JudgeReport | undefined> {
  const totalStartedAt = process.hrtime.bigint();
  const resolved = await resolveInteractiveConfig(workspaceFolder, config.interactive);
  const sourcePath = resolved.ok ? resolved.config.solution : workspaceFolder.uri.fsPath;

  output.clear();
  output.show(true);
  output.appendLine('OI Judge');
  output.appendLine('Mode: I/O Interactive Judge');
  output.appendLine(`Time limit: ${config.limits.timeMs} ms`);
  output.appendLine(`Memory limit: ${config.limits.memoryMb} MB`);
  output.appendLine('');

  if (!resolved.ok) {
    const compile = createInteractiveCompileError('solution', resolved.message, undefined);
    const report = createInteractiveCompileErrorReport(sourcePath, config, compile, totalStartedAt);
    await writeReport(workspaceFolder, report);
    output.appendLine(resolved.message);
    output.appendLine('Summary: Interactive configuration error');
    return report;
  }

  const compiled = await compileInteractivePrograms(workspaceFolder, config, resolved.config, output);
  if (!compiled) {
    return undefined;
  }
  if (compiled.solution.compile.status === 'CE' || !compiled.solution.compile.executablePath) {
    const report = createInteractiveCompileErrorReport(sourcePath, config, compiled.solution.compile, totalStartedAt, resolved.config.report);
    await writeReport(workspaceFolder, report);
    output.appendLine('Summary: Interactive solution compile failed');
    return report;
  }
  if (compiled.interactor.compile.status === 'CE' || !compiled.interactor.compile.executablePath) {
    const report = createInteractiveCompileErrorReport(sourcePath, config, compiled.interactor.compile, totalStartedAt, resolved.config.report);
    await writeReport(workspaceFolder, report);
    output.appendLine('Summary: Interactive interactor compile failed');
    return report;
  }

  const executables: InteractiveExecutableSet = {
    solution: compiled.solution.compile,
    interactor: compiled.interactor.compile
  };
  const samples: SampleReport[] = [];
  for (const sample of config.samples) {
    const sampleReport = await runInteractiveSample(workspaceFolder, config, resolved.config, executables, sample, output);
    samples.push(sampleReport);
    if (options.onSampleComplete) {
      await options.onSampleComplete(createInteractiveJudgeReport(sourcePath, config, executables, resolved.config.report, totalStartedAt, samples), sampleReport);
    }
  }

  const report = createInteractiveJudgeReport(sourcePath, config, executables, resolved.config.report, totalStartedAt, samples);
  await writeReport(workspaceFolder, report);

  output.appendLine('');
  output.appendLine(`Summary: ${report.summary.accepted}/${report.samples.length} accepted`);
  output.appendLine(`Score: ${report.score?.earned ?? 0}/${report.score?.total ?? 0}`);
  output.appendLine(`Total judge time: ${Math.round(report.totalTimeMs ?? 0)} ms`);
  output.appendLine(`Report: ${getOiJudgeDataRelPath('outputs', 'report.json')}`);
  return report;
}

export async function resolveInteractiveConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: InteractiveConfig | undefined
): Promise<InteractiveValidationResult> {
  if (!config) {
    return { ok: false, message: 'I/O Interactive Judge requires interactive.solution and interactive.interactor.' };
  }
  if (!config.solution) {
    return { ok: false, message: 'I/O Interactive Judge requires interactive.solution.' };
  }
  if (!config.interactor) {
    return { ok: false, message: 'I/O Interactive Judge requires interactive.interactor.' };
  }

  const solution = resolveWorkspacePath(workspaceFolder, config.solution);
  const interactor = resolveWorkspacePath(workspaceFolder, config.interactor);
  const missing = await collectMissingFiles([
    { label: 'solution', filePath: solution },
    { label: 'interactor', filePath: interactor }
  ]);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `I/O Interactive Judge missing ${missing[0].label} file: ${missing[0].filePath}`
    };
  }

  const transcriptLimitBytes = normalizeTranscriptLimit(config.transcriptLimitBytes);
  const interactorArgs = config.interactorArgs?.length ? [...config.interactorArgs] : ['{input}', '{answer}'];
  return {
    ok: true,
    config: {
      solution,
      interactor,
      solutionCompileArgs: config.solutionCompileArgs ?? [],
      interactorCompileArgs: config.interactorCompileArgs ?? [],
      solutionArgs: config.solutionArgs ?? [],
      interactorArgs,
      transcriptLimitBytes,
      report: {
        solution: config.solution,
        interactor: config.interactor,
        solutionCompileArgs: config.solutionCompileArgs?.length ? [...config.solutionCompileArgs] : undefined,
        interactorCompileArgs: config.interactorCompileArgs?.length ? [...config.interactorCompileArgs] : undefined,
        solutionArgs: config.solutionArgs?.length ? [...config.solutionArgs] : undefined,
        interactorArgs: config.interactorArgs?.length ? [...config.interactorArgs] : undefined,
        transcriptLimitBytes
      }
    }
  };
}

export function buildInteractiveArgs(
  args: readonly string[],
  inputPath: string,
  answerPath?: string
): string[] {
  return args
    .map((arg) => arg
      .replace(/\{input\}/g, inputPath)
      .replace(/\{answer\}/g, answerPath ?? '')
      .replace(/\$\{input\}/g, inputPath)
      .replace(/\$\{answer\}/g, answerPath ?? ''))
    .filter((arg) => arg.length > 0);
}

export function mapInteractorExitCode(code: number | null | undefined): InteractiveVerdictMapping {
  if (code === 0) {
    return { status: 'AC', message: 'Accepted by interactor.' };
  }
  if (code === 1) {
    return { status: 'WA', message: 'Wrong Answer reported by interactor.' };
  }
  if (code === 2) {
    return { status: 'PE', message: 'Presentation Error reported by interactor.' };
  }
  return { status: 'Interactor Error', message: `Interactor exited with code ${code ?? 'null'}.` };
}

export function isInteractiveMode(config: Pick<OITestConfig, 'mode'>): boolean {
  return config.mode === 'interactive';
}

export function appendTranscriptChunk(
  current: { text: string; bytes: number; truncated: boolean },
  direction: string,
  chunk: Buffer,
  limitBytes: number
): void {
  if (current.truncated) {
    return;
  }
  const prefix = `\n[${direction}]\n`;
  const payload = prefix + chunk.toString('utf8');
  const payloadBytes = Buffer.byteLength(payload);
  const remaining = limitBytes - current.bytes;
  if (remaining <= 0) {
    current.truncated = true;
    return;
  }
  if (payloadBytes > remaining) {
    current.text += Buffer.from(payload).subarray(0, remaining).toString('utf8');
    current.bytes = limitBytes;
    current.truncated = true;
    return;
  }
  current.text += payload;
  current.bytes += payloadBytes;
}

async function compileInteractivePrograms(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  interactive: ResolvedInteractiveConfig,
  output: vscode.OutputChannel
): Promise<{ solution: InteractiveCompileResult; interactor: InteractiveCompileResult } | undefined> {
  const solution = await compileInteractiveProgram(workspaceFolder, config, interactive, 'solution', interactive.solution, interactive.solutionCompileArgs, output);
  if (!solution) {
    return undefined;
  }
  if (solution.compile.status === 'CE') {
    return {
      solution,
      interactor: {
        role: 'interactor',
        compile: createInteractiveCompileError('interactor', 'Interactor compile skipped because solution compile failed.', interactive.report)
      }
    };
  }
  const interactor = await compileInteractiveProgram(workspaceFolder, config, interactive, 'interactor', interactive.interactor, interactive.interactorCompileArgs, output);
  if (!interactor) {
    return undefined;
  }
  return { solution, interactor };
}

async function compileInteractiveProgram(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  interactive: ResolvedInteractiveConfig,
  role: InteractiveCompileRole,
  sourcePath: string,
  extraCompileArgs: string[],
  output: vscode.OutputChannel,
  processTracker?: ProcessTracker
): Promise<InteractiveCompileResult | undefined> {
  const problemId = (config as { id?: string }).id;
  const buildDir = problemId
    ? path.join(getOITestDir(workspaceFolder), 'problems', problemId, 'build')
    : path.join(getOITestDir(workspaceFolder), 'build');
  await fs.mkdir(buildDir, { recursive: true });
  const executableName = process.platform === 'win32' ? `interactive-${role}.exe` : `interactive-${role}`;
  const executablePath = path.join(buildDir, executableName);
  const compiler = await findCompiler(workspaceFolder, config);
  const compilerCommand = compiler?.command ?? config.compiler.command;
  const compileConfig: OITestConfig = {
    ...config,
    compiler: {
      ...config.compiler,
      command: compilerCommand
    }
  };
  const { args, stack } = buildInteractiveCompileArgs(workspaceFolder, compileConfig, sourcePath, executablePath, extraCompileArgs);
  const env = withCompilerPathEnv(compilerCommand);
  const compilerDir = getCompilerDir(compilerCommand);

  output.appendLine(`Interactive ${role}: ${sourcePath}`);
  output.appendLine(`Compiler: ${compilerCommand}`);
  output.appendLine(`Final ${role} compile args: ${args.map(quoteArg).join(' ')}`);

  let result: ProcessResult;
  try {
    result = await runProcess(compilerCommand, args, '', workspaceFolder.uri.fsPath, INTERACTIVE_COMPILE_TIMEOUT_MS, env, INTERACTIVE_COMPILE_TIMEOUT_MS, undefined, undefined, processTracker);
  } catch (error) {
    const message = formatSpawnError(error);
    return {
      role,
      compile: createInteractiveCompileError(role, `Interactive ${role} compile failed to start: ${message}`, interactive.report, stack, compilerCommand, compilerDir)
    };
  }

  if (result.code !== 0 || result.timedOut) {
    const message = result.timedOut
      ? `Interactive ${role} compile timed out.`
      : `Interactive ${role} compile failed with code ${result.code ?? 'null'}.`;
    return {
      role,
      compile: {
        status: 'CE',
        mode: 'interactive',
        interactive: interactive.report,
        timeMs: result.timeMs,
        stack,
        compilerCommand,
        compilerBin: compilerDir,
        stdout: result.stdout,
        stderr: result.stderr,
        message,
        exitCode: result.code,
        timedOut: result.timedOut
      }
    };
  }

  return {
    role,
    compile: {
      status: 'OK',
      mode: 'interactive',
      interactive: interactive.report,
      timeMs: result.timeMs,
      stack,
      compilerCommand,
      compilerBin: compilerDir,
      executablePath
    }
  };
}

export function buildInteractiveCompileArgs(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  sourcePath: string,
  executablePath: string,
  extraCompileArgs: string[]
): { args: string[]; stack: CompileStackReport } {
  const { args, stack } = buildCompileArgs(workspaceFolder, config, sourcePath, executablePath);
  const resolvedExtraArgs = extraCompileArgs.map((arg) =>
    arg
      .replace(/\$\{file\}/g, sourcePath)
      .replace(/\$\{output\}/g, executablePath)
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath)
      .replace(/\{source\}/g, sourcePath)
      .replace(/\{exe\}/g, executablePath)
  );
  if (resolvedExtraArgs.length === 0) {
    return { args, stack };
  }
  const sourceIndex = args.findIndex((arg) => isSamePathArg(arg, sourcePath));
  const nextArgs = [...args];
  nextArgs.splice(sourceIndex >= 0 ? sourceIndex + 1 : nextArgs.length, 0, ...resolvedExtraArgs);
  return { args: nextArgs, stack };
}

async function runInteractiveSample(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  interactive: ResolvedInteractiveConfig,
  executables: InteractiveExecutableSet,
  sample: SampleConfig,
  output: vscode.OutputChannel
): Promise<SampleReport> {
  const problemId = (config as { id?: string }).id ?? 'interactive';
  const fileStatus = await getSampleFileStatus(workspaceFolder, sample);
  const outputPaths = getProblemSampleOutputPaths(workspaceFolder, problemId, sample.index);
  await fs.mkdir(path.dirname(outputPaths.outputPath), { recursive: true });
  await fs.rm(outputPaths.diffPath, { force: true });

  if (fileStatus.inputMissing) {
    return {
      id: sample.id,
      index: sample.index,
      name: sample.name,
      status: 'Missing',
      timeMs: 0,
      compareTimeMs: 0,
      elapsedMs: 0,
      input: sample.input,
      answer: sample.answer,
      actualOutput: outputPaths.outputRel,
      output: outputPaths.outputRel,
      stderr: outputPaths.stderrRel,
      diff: outputPaths.diffRel,
      message: `Missing input file: ${fileStatus.inputPath}`
    };
  }

  output.appendLine(`Run interactive sample ${sample.index}: ${sample.name}`);
  const answerPath = fileStatus.answerMissing ? undefined : fileStatus.answerPath;
  const result = await runInteractiveProcesses(
    executables.solution,
    executables.interactor,
    {
      cwd: workspaceFolder.uri.fsPath,
      inputPath: fileStatus.inputPath,
      answerPath,
      solutionArgs: interactive.solutionArgs,
      interactorArgs: interactive.interactorArgs,
      timeoutMs: config.limits.timeMs,
      transcriptLimitBytes: interactive.transcriptLimitBytes
    }
  );
  const verdict = classifyInteractiveRun(result);
  const stderrText = [
    result.solutionStderr.trim() ? `[solution stderr]\n${result.solutionStderr.trimEnd()}` : '',
    result.interactorStderr.trim() ? `[interactor stderr]\n${result.interactorStderr.trimEnd()}` : ''
  ].filter(Boolean).join('\n\n');
  const runResultText = buildInteractiveRunResultText(result, verdict.message);
  await fs.writeFile(outputPaths.outputPath, result.transcript, 'utf8');
  await fs.writeFile(outputPaths.stderrPath, stderrText, 'utf8');
  await fs.writeFile(outputPaths.runResultPath, runResultText, 'utf8');

  return {
    id: sample.id,
    index: sample.index,
    name: sample.name,
    status: verdict.status,
    timeMs: result.timeMs,
    compareTimeMs: 0,
    elapsedMs: result.timeMs,
    input: sample.input,
    answer: sample.answer,
    actualOutput: outputPaths.outputRel,
    output: outputPaths.outputRel,
    stderr: outputPaths.stderrRel,
    runResult: outputPaths.runResultRel,
    diff: outputPaths.diffRel,
    source: interactive.solution,
    exe: executables.solution.executablePath,
    sourcePath: interactive.solution,
    exePath: executables.solution.executablePath,
    cwd: workspaceFolder.uri.fsPath,
    exitCode: result.solutionExitCode,
    signal: result.solutionSignal,
    killedByTimeout: result.timedOut,
    hardKillLimitMs: config.limits.timeMs,
    stderrPreview: stderrText.slice(0, 4000),
    systemMessage: runResultText,
    interactive: {
      solutionExitCode: result.solutionExitCode,
      solutionSignal: result.solutionSignal,
      interactorExitCode: result.interactorExitCode,
      interactorSignal: result.interactorSignal,
      solutionStderr: result.solutionStderr,
      interactorStderr: result.interactorStderr,
      transcript: result.transcript,
      transcriptTruncated: result.transcriptTruncated,
      diagnostics: result.diagnostics
    },
    message: verdict.message
  };
}

async function runInteractiveProcesses(
  solution: CompileResult,
  interactor: CompileResult,
  options: {
    cwd: string;
    inputPath: string;
    answerPath?: string;
    solutionArgs: string[];
    interactorArgs: string[];
    timeoutMs: number;
    transcriptLimitBytes: number;
  }
): Promise<InteractiveRunResult> {
  const startedAt = process.hrtime.bigint();
  const diagnostics: string[] = [];
  const transcriptState = { text: '', bytes: 0, truncated: false };
  const solutionStderr = createLimitedCollector(STDERR_LIMIT_BYTES);
  const interactorStderr = createLimitedCollector(STDERR_LIMIT_BYTES);
  const detached = process.platform !== 'win32';
  const solutionChild = spawn(solution.executablePath!, buildInteractiveArgs(options.solutionArgs, options.inputPath, options.answerPath), {
    cwd: options.cwd,
    env: withCompilerPathEnv(solution.compilerCommand),
    shell: false,
    windowsHide: true,
    detached
  });
  const interactorChild = spawn(interactor.executablePath!, buildInteractiveArgs(options.interactorArgs, options.inputPath, options.answerPath), {
    cwd: options.cwd,
    env: withCompilerPathEnv(interactor.compilerCommand),
    shell: false,
    windowsHide: true,
    detached
  });

  pipeWithTranscript(solutionChild, interactorChild, 'solution -> interactor', transcriptState, options.transcriptLimitBytes, diagnostics);
  pipeWithTranscript(interactorChild, solutionChild, 'interactor -> solution', transcriptState, options.transcriptLimitBytes, diagnostics);
  solutionChild.stderr.on('data', (chunk: Buffer) => solutionStderr.append(chunk));
  interactorChild.stderr.on('data', (chunk: Buffer) => interactorStderr.append(chunk));

  let timedOut = false;
  let timeoutTimeMs: number | undefined;
  let killed = false;
  const killBoth = async (reason: string): Promise<void> => {
    if (killed) {
      return;
    }
    killed = true;
    diagnostics.push(reason);
    await Promise.all([
      killProcessTree(solutionChild, { detached }).catch((error) => ({ ok: false, method: 'none' as const, message: formatSpawnError(error) })),
      killProcessTree(interactorChild, { detached }).catch((error) => ({ ok: false, method: 'none' as const, message: formatSpawnError(error) }))
    ]);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutTimeMs = elapsedMs(startedAt);
    void killBoth(`Interactive judge timed out after ${options.timeoutMs} ms.`);
  }, options.timeoutMs);

  const solutionClose = waitForClose(solutionChild, 'solution', diagnostics);
  const interactorClose = waitForClose(interactorChild, 'interactor', diagnostics);
  void solutionClose.then(() => {
    safeEnd(interactorChild.stdin, diagnostics, 'interactor stdin after solution exit');
    setTimeout(() => {
      if (!hasClosed(interactorChild)) {
        void killBoth('Interactor did not exit after solution closed.');
      }
    }, INTERACTIVE_PROCESS_GRACE_MS);
  });
  void interactorClose.then(() => {
    safeEnd(solutionChild.stdin, diagnostics, 'solution stdin after interactor exit');
    setTimeout(() => {
      if (!hasClosed(solutionChild)) {
        void killBoth('Solution did not exit after interactor closed.');
      }
    }, INTERACTIVE_PROCESS_GRACE_MS);
  });

  const [solutionResult, interactorResult] = await Promise.all([solutionClose, interactorClose]);
  clearTimeout(timer);
  const timeMs = timedOut && timeoutTimeMs !== undefined ? timeoutTimeMs : elapsedMs(startedAt);
  return {
    timeMs,
    timedOut,
    solutionExitCode: solutionResult.code,
    solutionSignal: solutionResult.signal,
    interactorExitCode: interactorResult.code,
    interactorSignal: interactorResult.signal,
    solutionStderr: solutionStderr.text(),
    interactorStderr: interactorStderr.text(),
    transcript: transcriptState.text,
    transcriptTruncated: transcriptState.truncated,
    diagnostics
  };
}

function pipeWithTranscript(
  from: ChildProcessWithoutNullStreams,
  to: ChildProcessWithoutNullStreams,
  direction: string,
  transcript: { text: string; bytes: number; truncated: boolean },
  transcriptLimitBytes: number,
  diagnostics: string[]
): void {
  from.stdout.on('data', (chunk: Buffer) => {
    appendTranscriptChunk(transcript, direction, chunk, transcriptLimitBytes);
    if (!to.stdin.destroyed && to.stdin.writable) {
      const ok = to.stdin.write(chunk);
      if (!ok) {
        from.stdout.pause();
        to.stdin.once('drain', () => from.stdout.resume());
      }
    }
  });
  from.stdout.on('end', () => safeEnd(to.stdin, diagnostics, `${direction} EOF`));
  from.stdout.on('error', (error) => diagnostics.push(`${direction} stdout error: ${formatSpawnError(error)}`));
  to.stdin.on('error', (error) => diagnostics.push(`${direction} stdin error: ${formatSpawnError(error)}`));
}

function classifyInteractiveRun(result: InteractiveRunResult): InteractiveVerdictMapping {
  if (result.timedOut) {
    return { status: 'TLE', message: 'Interactive judge timed out.' };
  }
  if (result.solutionSignal) {
    return { status: 'RE', message: `Solution terminated by signal ${result.solutionSignal}.` };
  }
  if (result.solutionExitCode !== undefined && result.solutionExitCode !== null && result.solutionExitCode !== 0) {
    return { status: 'RE', message: `Solution exited with code ${result.solutionExitCode}.` };
  }
  if (result.interactorSignal) {
    return { status: 'Interactor Error', message: `Interactor terminated by signal ${result.interactorSignal}.` };
  }
  return mapInteractorExitCode(result.interactorExitCode);
}

function buildInteractiveRunResultText(result: InteractiveRunResult, verdictMessage: string): string {
  const lines = [
    verdictMessage,
    `Solution exit code: ${result.solutionExitCode ?? 'null'}`,
    result.solutionSignal ? `Solution signal: ${result.solutionSignal}` : undefined,
    `Interactor exit code: ${result.interactorExitCode ?? 'null'}`,
    result.interactorSignal ? `Interactor signal: ${result.interactorSignal}` : undefined,
    result.solutionStderr.trim() ? `\nSolution stderr:\n${result.solutionStderr.trimEnd()}` : undefined,
    result.interactorStderr.trim() ? `\nInteractor stderr:\n${result.interactorStderr.trimEnd()}` : undefined,
    result.transcript ? `\nTranscript:\n${result.transcript.trimEnd()}` : '\nTranscript: <empty>',
    result.transcriptTruncated ? '\nTranscript truncated.' : undefined,
    result.diagnostics.length ? `\nDiagnostics:\n${result.diagnostics.join('\n')}` : undefined
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

function createInteractiveJudgeReport(
  sourcePath: string,
  config: OITestConfig,
  compile: InteractiveExecutableSet,
  interactive: InteractiveReport,
  totalStartedAt: bigint,
  sampleReports: SampleReport[]
): JudgeReport {
  const samples = sampleReports.map((sample) => ({ ...sample }));
  const accepted = samples.filter((sample) => sample.status === 'AC').length;
  const wrongAnswer = samples.filter((sample) => sample.status === 'WA' || sample.status === 'PE').length;
  const score = calculateJudgeScore(config, samples);
  const effectiveScores = calculateEffectiveSampleScores(config);
  for (const sample of samples) {
    sample.score = score.sampleScores.get(sample.id) ?? 0;
    sample.scoreTotal = effectiveScores.sampleScores.get(sample.id)?.score ?? 0;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    sourceName: sourcePath.replace(/^.*[\\/]/u, ''),
    mode: 'interactive',
    interactive,
    compile: {
      status: compile.solution.status === 'OK' && compile.interactor.status === 'OK' ? 'OK' : 'CE',
      timeMs: (compile.solution.timeMs ?? 0) + (compile.interactor.timeMs ?? 0),
      mode: 'interactive',
      interactive
    },
    totalTimeMs: elapsedMs(totalStartedAt),
    judgeMode: config.judgeMode,
    ioMode: 'stdio',
    timeLimitMs: config.limits.timeMs,
    memoryLimitMb: config.limits.memoryMb,
    summary: {
      accepted,
      total: samples.length,
      wrongAnswer,
      scored: 0,
      checkerError: 0
    },
    score: {
      earned: score.earnedScore,
      total: score.totalScore
    },
    results: samples,
    samples
  };
}

function createInteractiveCompileErrorReport(
  sourcePath: string,
  config: OITestConfig,
  compile: CompileResult,
  totalStartedAt: bigint,
  interactive?: InteractiveReport
): JudgeReport {
  const samples: SampleReport[] = config.samples.map((sample) => ({
    id: sample.id,
    index: sample.index,
    name: sample.name,
    status: 'CE',
    timeMs: 0,
    compareTimeMs: 0,
    elapsedMs: 0,
    input: sample.input,
    answer: sample.answer,
    actualOutput: '',
    output: '',
    stderr: '',
    diff: '',
    message: compile.message ?? 'Interactive compile failed'
  }));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    sourceName: sourcePath.replace(/^.*[\\/]/u, ''),
    mode: 'interactive',
    interactive: interactive ?? compile.interactive,
    compile: {
      status: 'CE',
      timeMs: compile.timeMs,
      stack: compile.stack,
      mode: 'interactive',
      interactive: interactive ?? compile.interactive,
      stdout: compile.stdout,
      stderr: compile.stderr,
      message: compile.message,
      exitCode: compile.exitCode,
      timedOut: compile.timedOut
    },
    totalTimeMs: elapsedMs(totalStartedAt),
    judgeMode: config.judgeMode,
    ioMode: 'stdio',
    timeLimitMs: config.limits.timeMs,
    memoryLimitMb: config.limits.memoryMb,
    summary: {
      accepted: 0,
      total: samples.length,
      wrongAnswer: 0,
      scored: 0,
      checkerError: 0
    },
    score: {
      earned: 0,
      total: calculateJudgeScore(config, samples).totalScore
    },
    results: samples,
    samples
  };
}

function createInteractiveCompileError(
  role: InteractiveCompileRole,
  message: string,
  interactive?: InteractiveReport,
  stack?: CompileStackReport,
  compilerCommand?: string,
  compilerBin?: string
): CompileResult {
  const prefix = role === 'solution' ? 'Interactive solution compile failed' : 'Interactive interactor compile failed';
  return {
    status: 'CE',
    mode: 'interactive',
    interactive,
    timeMs: 0,
    stack,
    compilerCommand,
    compilerBin,
    stdout: '',
    stderr: message,
    message: `${prefix}: ${message}`
  };
}

async function writeReport(workspaceFolder: vscode.WorkspaceFolder, report: JudgeReport): Promise<void> {
  await fs.mkdir(path.dirname(getReportPath(workspaceFolder)), { recursive: true });
  await fs.writeFile(getReportPath(workspaceFolder), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function createLimitedCollector(limitBytes: number): { append(chunk: Buffer): void; text(): string } {
  let bytes = 0;
  let truncated = false;
  const chunks: Buffer[] = [];
  return {
    append(chunk: Buffer) {
      if (truncated) {
        return;
      }
      const remaining = limitBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        bytes = limitBytes;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    },
    text() {
      const value = Buffer.concat(chunks).toString('utf8');
      return truncated ? `${value}\n[truncated]` : value;
    }
  };
}

function waitForClose(
  child: ChildProcessWithoutNullStreams,
  label: string,
  diagnostics: string[]
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.on('error', (error) => {
      diagnostics.push(`${label} spawn error: ${formatSpawnError(error)}`);
      resolve({ code: -1, signal: null });
    });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

function safeEnd(stream: NodeJS.WritableStream, diagnostics: string[], label: string): void {
  try {
    stream.end();
  } catch (error) {
    diagnostics.push(`${label}: ${formatSpawnError(error)}`);
  }
}

function hasClosed(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function normalizeTranscriptLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_INTERACTIVE_TRANSCRIPT_LIMIT_BYTES;
}

function resolveWorkspacePath(workspaceFolder: vscode.WorkspaceFolder, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(workspaceFolder.uri.fsPath, filePath);
}

async function collectMissingFiles(files: Array<{ label: string; filePath: string }>): Promise<Array<{ label: string; filePath: string }>> {
  const missing: Array<{ label: string; filePath: string }> = [];
  for (const file of files) {
    if (!(await exists(file.filePath))) {
      missing.push(file);
    }
  }
  return missing;
}

function isSamePathArg(value: string, expected: string): boolean {
  return process.platform === 'win32'
    ? value.toLowerCase() === expected.toLowerCase()
    : value === expected;
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function quoteArg(value: string): string {
  if (/[\s"]/u.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatSpawnError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const details = error as NodeJS.ErrnoException;
  return [
    `message: ${error.message}`,
    details.code ? `code: ${details.code}` : undefined,
    details.errno !== undefined ? `errno: ${details.errno}` : undefined,
    details.path ? `path: ${details.path}` : undefined,
    details.syscall ? `syscall: ${details.syscall}` : undefined
  ].filter(Boolean).join('\n');
}
