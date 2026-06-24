import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { runInteractiveJudge } from '../../src/interactiveJudge';
import { ProblemConfig } from '../../src/types';
import {
  CompilerInfo,
  compilerConfig,
  findCppCompiler,
  output,
  workspace,
  writeJsonArtifact,
  writeText
} from './helpers';

const workspaces: string[] = [];

describe('cross-platform guess-number I/O interactive regression', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('covers realistic multi-round guess-number protocol behavior', async () => {
    const compiler = await findCppCompiler();
    if (!compiler) {
      const skipped = await writeJsonArtifact(`interactive-guess-number-result-${process.platform}.json`, {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        skipped: true,
        reason: 'No g++ or clang++ compiler found in PATH.'
      });
      console.warn(`Guess-number interactive regression skipped; result JSON: ${skipped}`);
      return;
    }

    const workspaceFolder = await createGuessWorkspace();
    await expectGuessNumberAccepted(workspaceFolder, compiler);
    await expectGuessNumberWrongAnswer(workspaceFolder, compiler);
    await expectGuessNumberProtocolViolation(workspaceFolder, compiler);
    await expectGuessNumberNoFlushTimeout(workspaceFolder, compiler);
    await expectGuessNumberTranscriptTruncation(workspaceFolder, compiler);
  }, 180_000);
});

async function expectGuessNumberAccepted(
  workspaceFolder: vscode.WorkspaceFolder,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeGuessFixture(workspaceFolder, 'guess number accepted with spaces', {
    'solution.cpp': guessAcceptedSolutionSource(),
    'interactor.cpp': guessInteractorSource(),
    'samples with spaces/1.in': '100 73\n',
    'samples with spaces/1.out': '73\n',
    'samples with spaces/2.in': '50 1\n',
    'samples with spaces/2.out': '1\n',
    'samples with spaces/3.in': '999 999\n',
    'samples with spaces/3.out': '999\n'
  });
  const problem = createGuessProblem(compiler, 'guess-number-ac', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    interactorArgs: ['{input}', '{answer}'],
    transcriptLimitBytes: 4096
  }, 1000, [
    ['100 73', 'samples with spaces/1.in', 'samples with spaces/1.out'],
    ['50 1', 'samples with spaces/2.in', 'samples with spaces/2.out'],
    ['999 999', 'samples with spaces/3.in', 'samples with spaces/3.out']
  ]);

  const report = await runInteractiveJudge(workspaceFolder, problem, output());
  expect(report?.samples.map((sample) => sample.status)).toEqual(['AC', 'AC', 'AC']);
  expect(report?.samples.every((sample) => sample.interactive?.solutionStderr === '')).toBe(true);
  expect(report?.samples.every((sample) => sample.interactive?.interactorStderr === '')).toBe(true);

  const transcript = report?.samples[0]?.interactive?.transcript ?? '';
  expect(transcript).toContain('[interactor -> solution]');
  expect(transcript).toContain('[solution -> interactor]');
  expect(firstTranscriptPayload(transcript)).toContain('100');
  expect(countDirection(transcript, '[interactor -> solution]')).toBeGreaterThanOrEqual(2);
  expect(countDirection(transcript, '[solution -> interactor]')).toBeGreaterThanOrEqual(2);
  expect(transcript.indexOf('[interactor -> solution]')).toBeLessThan(transcript.indexOf('[solution -> interactor]'));
}

async function expectGuessNumberWrongAnswer(
  workspaceFolder: vscode.WorkspaceFolder,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeGuessFixture(workspaceFolder, 'guess number wrong answer', {
    'solution.cpp': guessWrongSolutionSource(),
    'interactor.cpp': guessInteractorSource(),
    'samples with spaces/1.in': '100 73\n',
    'samples with spaces/1.out': '73\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createGuessProblem(compiler, 'guess-number-wa', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    interactorArgs: ['{input}', '{answer}']
  }, 1000), output());

  expect(report?.samples[0]?.status).toBe('WA');
  expect(report?.samples[0]?.interactive?.interactorExitCode).toBe(1);
  expect(report?.samples[0]?.interactive?.interactorStderr).toContain('solution stopped before finding the answer');
}

async function expectGuessNumberProtocolViolation(
  workspaceFolder: vscode.WorkspaceFolder,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeGuessFixture(workspaceFolder, 'guess number protocol violation', {
    'solution.cpp': guessProtocolViolationSolutionSource(),
    'interactor.cpp': guessInteractorSource(),
    'samples with spaces/1.in': '100 73\n',
    'samples with spaces/1.out': '73\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createGuessProblem(compiler, 'guess-number-protocol', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    interactorArgs: ['{input}', '{answer}']
  }, 1000), output());

  expect(report?.samples[0]?.status).toBe('WA');
  expect(report?.samples[0]?.interactive?.interactorExitCode).toBe(1);
  expect(report?.samples[0]?.interactive?.interactorStderr).toContain('guess out of range');
}

async function expectGuessNumberNoFlushTimeout(
  workspaceFolder: vscode.WorkspaceFolder,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeGuessFixture(workspaceFolder, 'guess number no flush timeout', {
    'solution.cpp': guessNoFlushTimeoutSolutionSource(),
    'interactor.cpp': guessInteractorSource(),
    'samples with spaces/1.in': '100 73\n',
    'samples with spaces/1.out': '73\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createGuessProblem(compiler, 'guess-number-timeout', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    interactorArgs: ['{input}', '{answer}']
  }, 500), output());

  expect(report?.samples[0]?.status).toBe('TLE');
  expect(report?.samples[0]?.killedByTimeout).toBe(true);
  expect(report?.samples[0]?.interactive?.diagnostics?.join('\n')).toContain('timed out');
}

async function expectGuessNumberTranscriptTruncation(
  workspaceFolder: vscode.WorkspaceFolder,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeGuessFixture(workspaceFolder, 'guess number transcript truncation', {
    'solution.cpp': guessAcceptedSolutionSource(),
    'interactor.cpp': guessVerboseInteractorSource(),
    'samples with spaces/1.in': '999 999\n',
    'samples with spaces/1.out': '999\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createGuessProblem(compiler, 'guess-number-truncate', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    interactorArgs: ['{input}', '{answer}'],
    transcriptLimitBytes: 128
  }, 1000), output());

  expect(report?.samples[0]?.status).toBe('AC');
  expect(report?.samples[0]?.interactive?.transcriptTruncated).toBe(true);
  expect(Buffer.byteLength(report?.samples[0]?.interactive?.transcript ?? '')).toBeLessThanOrEqual(128);
}

function createGuessProblem(
  compiler: CompilerInfo,
  id: string,
  fixtureRoot: string,
  interactive: NonNullable<ProblemConfig['interactive']>,
  timeLimitMs: number,
  sampleSpecs: Array<[string, string, string]> = [['100 73', 'samples with spaces/1.in', 'samples with spaces/1.out']]
): ProblemConfig {
  const rel = (filePath: string) => path.join(fixtureRoot, filePath);
  return {
    version: 1,
    id,
    name: id,
    standard: 'c++17',
    mode: 'interactive',
    interactive: {
      ...interactive,
      solution: rel(interactive.solution ?? 'solution.cpp'),
      interactor: rel(interactive.interactor ?? 'interactor.cpp'),
      interactorArgs: interactive.interactorArgs ?? ['{input}', '{answer}']
    },
    ...compilerConfig(compiler),
    limits: { timeMs: timeLimitMs, memoryMb: 256 },
    judgeMode: 'trimTrailingWhitespace',
    samples: sampleSpecs.map(([, input, answer], index) => ({
      id: `${id}-sample-${index + 1}`,
      index: index + 1,
      name: `${id} sample ${index + 1}`,
      input: rel(input),
      answer: rel(answer)
    }))
  };
}

async function createGuessWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'OI Judge Guess Number Interactive '));
  workspaces.push(dir);
  return workspace(dir);
}

async function writeGuessFixture(
  workspaceFolder: vscode.WorkspaceFolder,
  fixtureName: string,
  files: Record<string, string>
): Promise<string> {
  const fixtureRoot = path.join('guess fixtures with spaces', fixtureName);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeText(path.join(workspaceFolder.uri.fsPath, fixtureRoot, relativePath), content);
  }
  return fixtureRoot;
}

function firstTranscriptPayload(transcript: string): string {
  const parts = transcript.split(/\n\[[^\]]+\]\n/u);
  return parts.find((part) => part.trim().length > 0) ?? '';
}

function countDirection(transcript: string, direction: string): number {
  return transcript.split(direction).length - 1;
}

function guessAcceptedSolutionSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  int n;',
    '  if (!(std::cin >> n)) {',
    '    return 0;',
    '  }',
    '  int left = 1;',
    '  int right = n;',
    '  while (left <= right) {',
    '    int mid = (left + right) / 2;',
    '    std::cout << mid << std::endl;',
    '    int response;',
    '    if (!(std::cin >> response)) {',
    '      return 0;',
    '    }',
    '    if (response == 0) {',
    '      return 0;',
    '    }',
    '    if (response > 0) {',
    '      left = mid + 1;',
    '    } else {',
    '      right = mid - 1;',
    '    }',
    '  }',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function guessWrongSolutionSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  int n;',
    '  if (!(std::cin >> n)) {',
    '    return 0;',
    '  }',
    '  std::cout << 1 << std::endl;',
    '  int response;',
    '  if (std::cin >> response) {',
    '    return 0;',
    '  }',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function guessProtocolViolationSolutionSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  int n;',
    '  if (!(std::cin >> n)) {',
    '    return 0;',
    '  }',
    '  std::cout << (n + 1) << std::endl;',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function guessNoFlushTimeoutSolutionSource(): string {
  return [
    '#include <chrono>',
    '#include <iostream>',
    '#include <thread>',
    'int main() {',
    '  int n;',
    '  if (!(std::cin >> n)) {',
    '    return 0;',
    '  }',
    '  std::cout << (n / 2);',
    '  std::this_thread::sleep_for(std::chrono::seconds(10));',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function guessInteractorSource(): string {
  return [
    '#include <fstream>',
    '#include <iostream>',
    'int main(int argc, char** argv) {',
    '  if (argc < 2) {',
    '    std::cerr << "missing input file\\n";',
    '    return 3;',
    '  }',
    '  std::ifstream fin(argv[1]);',
    '  int n = 0;',
    '  int secret = 0;',
    '  if (!(fin >> n >> secret)) {',
    '    std::cerr << "invalid input file\\n";',
    '    return 3;',
    '  }',
    '  if (n <= 0 || secret < 1 || secret > n) {',
    '    std::cerr << "invalid n or secret\\n";',
    '    return 3;',
    '  }',
    '  std::cout << n << std::endl;',
    '  const int maxQueries = 20;',
    '  for (int query = 1; query <= maxQueries; ++query) {',
    '    int guess = 0;',
    '    if (!(std::cin >> guess)) {',
    '      std::cerr << "solution stopped before finding the answer\\n";',
    '      return 1;',
    '    }',
    '    if (guess < 1 || guess > n) {',
    '      std::cerr << "guess out of range: " << guess << "\\n";',
    '      return 1;',
    '    }',
    '    if (guess == secret) {',
    '      std::cout << 0 << std::endl;',
    '      return 0;',
    '    }',
    '    if (guess < secret) {',
    '      std::cout << 1 << std::endl;',
    '    } else {',
    '      std::cout << -1 << std::endl;',
    '    }',
    '  }',
    '  std::cerr << "too many queries\\n";',
    '  return 1;',
    '}',
    ''
  ].join('\n');
}

function guessVerboseInteractorSource(): string {
  return guessInteractorSource().replace(
    'std::cout << n << std::endl;',
    [
      'std::cout << n << std::endl;',
      'for (int i = 0; i < 100; ++i) {',
      '  std::cout << " ";',
      '}',
      'std::cout << std::endl;'
    ].join('\n')
  );
}
