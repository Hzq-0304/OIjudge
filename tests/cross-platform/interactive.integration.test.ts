import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { getReportPath } from '../../src/config';
import { runInteractiveJudge } from '../../src/interactiveJudge';
import { renderReportBody } from '../../src/reportView';
import { ProblemConfig } from '../../src/types';
import {
  CompilerInfo,
  compilerConfig,
  createCrossPlatformWorkspace,
  findCppCompiler,
  output,
  writeJsonArtifact,
  writeText
} from './helpers';

describe('cross-platform I/O interactive judge regression', () => {
  it('runs solution and interactor as live processes across verdict paths', async () => {
    const compiler = await findCppCompiler();
    if (!compiler) {
      const skipped = await writeJsonArtifact(`interactive-result-${process.platform}.json`, {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        skipped: true,
        reason: 'No g++ or clang++ compiler found in PATH.'
      });
      console.warn(`I/O interactive judge regression skipped; result JSON: ${skipped}`);
      return;
    }

    const workspaceFolder = await createCrossPlatformWorkspace('OI Judge Interactive Fixtures With Spaces');
    await expectAcceptedAndWrongAnswer(workspaceFolder, compiler);
    await expectSolutionRuntimeError(workspaceFolder, compiler);
    await expectInteractorFailure(workspaceFolder, compiler);
    await expectTimeout(workspaceFolder, compiler);
    await expectTranscriptTruncation(workspaceFolder, compiler);
    await expectCompileErrors(workspaceFolder, compiler);
  }, 180_000);
});

async function expectAcceptedAndWrongAnswer(
  workspaceFolder: Awaited<ReturnType<typeof createCrossPlatformWorkspace>>,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder.uri.fsPath, 'interactive ac wa', {
    'solution.cpp': acceptedSolutionSource(),
    'interactor.cpp': doublingInteractorSource(),
    'samples/1.in': '21\n',
    'samples/1.out': '42\n',
    'samples/2.in': '7\n',
    'samples/2.out': '14\n'
  });
  const problem = createProblem(compiler, 'interactive-ac-wa', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    transcriptLimitBytes: 4096
  }, 1000);

  const acceptedReport = await runInteractiveJudge(workspaceFolder, problem, output());
  expect(acceptedReport?.mode).toBe('interactive');
  expect(acceptedReport?.compile?.status).toBe('OK');
  expect(acceptedReport?.samples.map((sample) => sample.status)).toEqual(['AC', 'AC']);
  expect(acceptedReport?.samples[0]?.interactive?.transcript).toContain('[interactor -> solution]');
  expect(acceptedReport?.samples[0]?.interactive?.transcript).toContain('[solution -> interactor]');
  expect(acceptedReport?.samples[0]?.interactive?.solutionStderr).toContain('solution received');
  expect(acceptedReport?.samples[0]?.interactive?.interactorStderr).toContain('interactor query');
  const html = renderReportBody(workspaceFolder, acceptedReport!, problem.id, problem);
  expect(html).toContain('I/O Interactive Judge');
  expect(html).toContain('Interactor');
  const reportJson = JSON.parse(await fs.readFile(getReportPath(workspaceFolder), 'utf8')) as { mode?: string };
  expect(reportJson.mode).toBe('interactive');

  await writeText(path.join(workspaceFolder.uri.fsPath, fixtureRoot, 'solution.cpp'), wrongSolutionSource());
  const wrongReport = await runInteractiveJudge(workspaceFolder, problem, output());
  expect(wrongReport?.samples.map((sample) => sample.status)).toEqual(['WA', 'WA']);
  expect(wrongReport?.summary.wrongAnswer).toBe(2);
}

async function expectSolutionRuntimeError(
  workspaceFolder: Awaited<ReturnType<typeof createCrossPlatformWorkspace>>,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder.uri.fsPath, 'interactive re', {
    'solution.cpp': runtimeErrorSolutionSource(),
    'interactor.cpp': doublingInteractorSource(),
    'samples/1.in': '3\n',
    'samples/1.out': '6\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createProblem(compiler, 'interactive-re', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp'
  }, 1000), output());

  expect(report?.samples[0]?.status).toBe('RE');
  expect(report?.samples[0]?.interactive?.solutionExitCode).not.toBe(0);
}

async function expectInteractorFailure(
  workspaceFolder: Awaited<ReturnType<typeof createCrossPlatformWorkspace>>,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder.uri.fsPath, 'interactive fail', {
    'solution.cpp': acceptedSolutionSource(),
    'interactor.cpp': failingInteractorSource(),
    'samples/1.in': '9\n',
    'samples/1.out': '18\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createProblem(compiler, 'interactive-fail', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp'
  }, 1000), output());

  expect(report?.samples[0]?.status).toBe('Interactor Error');
  expect(report?.samples[0]?.interactive?.interactorStderr).toContain('interactor failed intentionally');
}

async function expectTimeout(
  workspaceFolder: Awaited<ReturnType<typeof createCrossPlatformWorkspace>>,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder.uri.fsPath, 'interactive timeout', {
    'solution.cpp': timeoutSolutionSource(),
    'interactor.cpp': doublingInteractorSource(),
    'samples/1.in': '5\n',
    'samples/1.out': '10\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createProblem(compiler, 'interactive-timeout', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp'
  }, 500), output());

  expect(report?.samples[0]?.status).toBe('TLE');
  expect(report?.samples[0]?.killedByTimeout).toBe(true);
  expect(report?.samples[0]?.interactive?.diagnostics?.join('\n')).toContain('timed out');
}

async function expectTranscriptTruncation(
  workspaceFolder: Awaited<ReturnType<typeof createCrossPlatformWorkspace>>,
  compiler: CompilerInfo
): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder.uri.fsPath, 'interactive transcript truncation', {
    'solution.cpp': verboseSolutionSource(),
    'interactor.cpp': consumingInteractorSource(),
    'samples with spaces/1.in': '21\n',
    'samples with spaces/1.out': '42\n'
  });
  const report = await runInteractiveJudge(workspaceFolder, createProblem(compiler, 'interactive-truncate', fixtureRoot, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp',
    interactorArgs: ['{input}', '{answer}'],
    transcriptLimitBytes: 128
  }, 1000, path.join('samples with spaces', '1.in'), path.join('samples with spaces', '1.out')), output());

  expect(report?.samples[0]?.status).toBe('AC');
  expect(report?.samples[0]?.interactive?.transcriptTruncated).toBe(true);
  expect(Buffer.byteLength(report?.samples[0]?.interactive?.transcript ?? '')).toBeLessThanOrEqual(128);
}

async function expectCompileErrors(
  workspaceFolder: Awaited<ReturnType<typeof createCrossPlatformWorkspace>>,
  compiler: CompilerInfo
): Promise<void> {
  const solutionFixture = await writeFixture(workspaceFolder.uri.fsPath, 'interactive solution ce', {
    'solution.cpp': 'int main() { return }\n',
    'interactor.cpp': doublingInteractorSource(),
    'samples/1.in': '1\n',
    'samples/1.out': '2\n'
  });
  const solutionReport = await runInteractiveJudge(workspaceFolder, createProblem(compiler, 'interactive-solution-ce', solutionFixture, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp'
  }, 1000), output());
  expect(solutionReport?.compile?.status).toBe('CE');
  expect(solutionReport?.compile?.message).toContain('Interactive solution compile failed');

  const interactorFixture = await writeFixture(workspaceFolder.uri.fsPath, 'interactive interactor ce', {
    'solution.cpp': acceptedSolutionSource(),
    'interactor.cpp': 'int main() { return }\n',
    'samples/1.in': '1\n',
    'samples/1.out': '2\n'
  });
  const interactorReport = await runInteractiveJudge(workspaceFolder, createProblem(compiler, 'interactive-interactor-ce', interactorFixture, {
    solution: 'solution.cpp',
    interactor: 'interactor.cpp'
  }, 1000), output());
  expect(interactorReport?.compile?.status).toBe('CE');
  expect(interactorReport?.compile?.message).toContain('Interactive interactor compile failed');
}

function createProblem(
  compiler: CompilerInfo,
  id: string,
  fixtureRoot: string,
  interactive: NonNullable<ProblemConfig['interactive']>,
  timeLimitMs: number,
  sampleInput = path.join('samples', '1.in'),
  sampleAnswer = path.join('samples', '1.out')
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
    samples: [
      {
        id: `${id}-sample-1`,
        index: 1,
        name: `${id} sample 1`,
        input: rel(sampleInput),
        answer: rel(sampleAnswer)
      },
      ...(id === 'interactive-ac-wa'
        ? [{
            id: `${id}-sample-2`,
            index: 2,
            name: `${id} sample 2`,
            input: rel(path.join('samples', '2.in')),
            answer: rel(path.join('samples', '2.out'))
          }]
        : [])
    ]
  };
}

async function writeFixture(workspaceRoot: string, fixtureName: string, files: Record<string, string>): Promise<string> {
  const fixtureRoot = path.join('fixtures with spaces', fixtureName);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeText(path.join(workspaceRoot, fixtureRoot, relativePath), content);
  }
  return fixtureRoot;
}

function acceptedSolutionSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  int value = 0;',
    '  if (std::cin >> value) {',
    '    std::cerr << "solution received " << value << "\\n";',
    '    std::cout << value * 2 << "\\n" << std::flush;',
    '  }',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function wrongSolutionSource(): string {
  return acceptedSolutionSource().replace('value * 2', 'value * 2 + 1');
}

function runtimeErrorSolutionSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  int value = 0;',
    '  std::cin >> value;',
    '  std::cerr << "solution exits badly\\n";',
    '  return 7;',
    '}',
    ''
  ].join('\n');
}

function timeoutSolutionSource(): string {
  return [
    '#include <chrono>',
    '#include <thread>',
    'int main() {',
    '  std::this_thread::sleep_for(std::chrono::seconds(10));',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function verboseSolutionSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  int value = 0;',
    '  if (!(std::cin >> value)) {',
    '    return 0;',
    '  }',
    '  std::cout << value * 2;',
    '  for (int i = 0; i < 200; ++i) {',
    '    std::cout << " " << i;',
    '  }',
    '  std::cout << "\\n" << std::flush;',
    '  return 0;',
    '}',
    ''
  ].join('\n');
}

function doublingInteractorSource(): string {
  return [
    '#include <fstream>',
    '#include <iostream>',
    '#include <string>',
    'int main(int argc, char** argv) {',
    '  if (argc < 2) {',
    '    std::cerr << "missing input path\\n";',
    '    return 3;',
    '  }',
    '  std::ifstream input(argv[1]);',
    '  int value = 0;',
    '  input >> value;',
    '  std::cerr << "interactor query " << value << "\\n";',
    '  std::cout << value << "\\n" << std::flush;',
    '  int answer = 0;',
    '  if (!(std::cin >> answer)) {',
    '    std::cerr << "missing answer from solution\\n";',
    '    return 3;',
    '  }',
    '  if (answer == value * 2) {',
    '    return 0;',
    '  }',
    '  std::cerr << "expected " << value * 2 << " got " << answer << "\\n";',
    '  return 1;',
    '}',
    ''
  ].join('\n');
}

function failingInteractorSource(): string {
  return [
    '#include <iostream>',
    'int main() {',
    '  std::cerr << "interactor failed intentionally\\n";',
    '  return 3;',
    '}',
    ''
  ].join('\n');
}

function consumingInteractorSource(): string {
  return [
    '#include <fstream>',
    '#include <iostream>',
    'int main(int argc, char** argv) {',
    '  if (argc < 2) {',
    '    return 3;',
    '  }',
    '  std::ifstream input(argv[1]);',
    '  int value = 0;',
    '  input >> value;',
    '  std::cout << value << "\\n" << std::flush;',
    '  int answer = 0;',
    '  if (!(std::cin >> answer)) {',
    '    return 1;',
    '  }',
    '  int ignored = 0;',
    '  while (std::cin >> ignored) {}',
    '  return answer == value * 2 ? 0 : 1;',
    '}',
    ''
  ].join('\n');
}
