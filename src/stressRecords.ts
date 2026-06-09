import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { compileSource } from './compiler';
import { getOITestDir } from './config';
import { isOutputAccepted } from './comparator';
import { withCompilerPathEnv } from './compilerRuntime';
import { runProcess } from './runner';
import { OITestConfig } from './types';

export type StressSessionMode = 'generator-std' | 'standalone' | 'unknown';

export type StressFailedCase = {
  round?: number;
  name: string;
  input?: string;
  stdOutput?: string;
  testOutput?: string;
  generatorErr?: string;
  stdErr?: string;
  testErr?: string;
};

export type StressSession = {
  id: string;
  dir: string;
  summaryPath?: string;
  mode: StressSessionMode;
  label: string;
  description: string;
  invalid?: boolean;
  invalidReason?: string;
  summary?: Record<string, unknown>;
  failedCase?: StressFailedCase;
  standalone?: {
    stdout?: string;
    stderr?: string;
  };
};

export type StressRerunResult = {
  status: 'Accepted' | 'Wrong Answer' | 'Runtime Error' | 'Time Limit Exceeded';
  outputPath: string;
  stderrPath: string;
  summaryPath: string;
};

export async function listStressSessions(workspaceFolder: vscode.WorkspaceFolder): Promise<StressSession[]> {
  const root = getStressRoot(workspaceFolder);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const sessions = await Promise.all(entries.map((entry) => readStressSession(path.join(root, entry), entry)));
  return sessions
    .filter((session): session is StressSession => Boolean(session))
    .sort((left, right) => right.id.localeCompare(left.id));
}

export function getStressRoot(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'stress');
}

export async function readStressSession(sessionDir: string, id = path.basename(sessionDir)): Promise<StressSession | undefined> {
  try {
    const stat = await fs.stat(sessionDir);
    if (!stat.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const summaryPath = path.join(sessionDir, 'summary.json');
  try {
    const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8')) as Record<string, unknown>;
    return parseStressSession(id, sessionDir, summaryPath, summary);
  } catch (error) {
    return {
      id,
      dir: sessionDir,
      summaryPath,
      mode: 'unknown',
      label: id,
      description: 'Invalid stress session',
      invalid: true,
      invalidReason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function resolveStressFile(session: StressSession, fileName: string | undefined): string | undefined {
  return fileName ? path.join(session.dir, fileName) : undefined;
}

export async function stressFileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function rerunStressFailedCase(input: {
  workspaceFolder: vscode.WorkspaceFolder;
  config: OITestConfig;
  session: StressSession;
  failedCase: StressFailedCase;
  solutionPath: string;
  output: vscode.OutputChannel;
}): Promise<StressRerunResult | undefined> {
  const inputPath = resolveStressFile(input.session, input.failedCase.input);
  const expectedPath = resolveStressFile(input.session, input.failedCase.stdOutput);
  if (!inputPath || !expectedPath) {
    return undefined;
  }
  const testcaseInput = await fs.readFile(inputPath, 'utf8');
  const expected = await fs.readFile(expectedPath, 'utf8');
  const compileConfig: OITestConfig & { id: string } = {
    ...input.config,
    id: 'stress-rerun'
  };
  input.output.clear();
  input.output.show(true);
  input.output.appendLine('Rerun Stress Case');
  input.output.appendLine(`Session: ${input.session.id}`);
  input.output.appendLine(`Case: ${input.failedCase.name}`);
  input.output.appendLine(`Input: ${input.failedCase.input ?? '-'}`);
  input.output.appendLine(`Expected: ${input.failedCase.stdOutput ?? '-'}`);
  input.output.appendLine(`Solution: ${input.solutionPath}`);
  input.output.appendLine('');

  const compile = await compileSource(input.workspaceFolder, input.solutionPath, compileConfig, input.output);
  if (!compile) {
    return undefined;
  }

  const result = await runProcess(
    compile.executablePath,
    [],
    testcaseInput,
    path.dirname(input.solutionPath),
    input.config.limits?.timeMs ?? 5000,
    withCompilerPathEnv(compile.compilerCommand)
  );
  const baseName = input.failedCase.name;
  const outputPath = path.join(input.session.dir, `${baseName}.rerun.out`);
  const stderrPath = path.join(input.session.dir, `${baseName}.rerun.err`);
  const summaryPath = path.join(input.session.dir, `${baseName}.rerun.summary.json`);
  const status = result.timedOut
    ? 'Time Limit Exceeded'
    : result.code !== 0
      ? 'Runtime Error'
      : isOutputAccepted(result.stdout, expected)
        ? 'Accepted'
        : 'Wrong Answer';
  await fs.writeFile(outputPath, result.stdout, 'utf8');
  await fs.writeFile(stderrPath, result.stderr, 'utf8');
  await fs.writeFile(summaryPath, `${JSON.stringify({
    session: input.session.id,
    case: input.failedCase.name,
    solution: input.solutionPath,
    status,
    exitCode: result.code,
    timedOut: result.timedOut,
    output: path.basename(outputPath),
    stderr: path.basename(stderrPath)
  }, null, 2)}\n`, 'utf8');
  input.output.appendLine(`Result: ${status}`);
  input.output.appendLine('Saved:');
  input.output.appendLine(`  ${path.basename(outputPath)}`);
  input.output.appendLine(`  ${path.basename(stderrPath)}`);
  return { status, outputPath, stderrPath, summaryPath };
}

function parseStressSession(
  id: string,
  dir: string,
  summaryPath: string,
  summary: Record<string, unknown>
): StressSession {
  const mode = summary.mode === 'generator-std' || summary.mode === 'standalone' ? summary.mode : 'unknown';
  if (mode === 'generator-std') {
    const failedAt = asNumber(summary.failedAt);
    const failedCaseSummary = asRecord(summary.failedCase);
    const failedCase = failedAt !== undefined || failedCaseSummary
      ? buildFailedCase(failedAt, failedCaseSummary)
      : undefined;
    return {
      id,
      dir,
      summaryPath,
      mode,
      label: formatSessionLabel(id),
      description: failedAt !== undefined
        ? `Wrong Answer at #${failedAt}`
        : `Passed ${asNumber(summary.passed) ?? 0}/${asNumber(summary.rounds) ?? 0}`,
      summary,
      failedCase
    };
  }

  if (mode === 'standalone') {
    return {
      id,
      dir,
      summaryPath,
      mode,
      label: formatSessionLabel(id),
      description: `Standalone exit code ${summary.exitCode ?? 'unknown'}`,
      summary,
      standalone: {
        stdout: asString(summary.stdout),
        stderr: asString(summary.stderr)
      }
    };
  }

  return {
    id,
    dir,
    summaryPath,
    mode,
    label: formatSessionLabel(id),
    description: 'Invalid stress session',
    invalid: true,
    invalidReason: 'Unknown stress session mode',
    summary
  };
}

function buildFailedCase(round: number | undefined, failedCase: Record<string, unknown> | undefined): StressFailedCase {
  const input = asString(failedCase?.input);
  const name = input ? path.basename(input, path.extname(input)) : `case-${String(round ?? 0).padStart(4, '0')}`;
  return {
    round,
    name,
    input,
    stdOutput: asString(failedCase?.stdOutput),
    testOutput: asString(failedCase?.testOutput),
    generatorErr: `${name}.generator.err`,
    stdErr: `${name}.std.err`,
    testErr: `${name}.test.err`
  };
}

function formatSessionLabel(id: string): string {
  const match = /^(?<date>\d{4}-\d{2}-\d{2})-(?<time>\d{6})$/u.exec(id);
  if (!match?.groups) {
    return id;
  }
  const time = match.groups.time;
  return `${match.groups.date} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
