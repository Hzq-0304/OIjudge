import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { getReportPath } from '../../src/config';
import { runFunctionStyleJudge } from '../../src/judge';
import { renderReportBody } from '../../src/reportView';
import { ProblemConfig } from '../../src/types';
import {
  CompilerInfo,
  compilerConfig,
  findCppCompiler,
  output,
  writeJsonArtifact
} from './helpers';

const workspaces: string[] = [];

describe('cross-platform function-style judge regression', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('covers IOI-style public grader interface patterns with toy fixtures', async () => {
    const compiler = await findCppCompiler();
    if (!compiler) {
      const skipped = await writeJsonArtifact(`function-style-result-${process.platform}.json`, {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        skipped: true,
        reason: 'No g++ or clang++ compiler found in PATH.'
      });
      console.warn(`Function-style judge regression skipped; result JSON: ${skipped}`);
      return;
    }

    const workspaceFolder = await createTempWorkspace('OI Judge Function Style Fixtures ');

    await expectWallStyle(workspaceFolder, compiler);
    await expectRailStyle(workspaceFolder, compiler);
    await expectGameStyle(workspaceFolder, compiler);
    await expectParrotsStyle(workspaceFolder, compiler);
    await expectCompileError(workspaceFolder, compiler);
  }, 180_000);
});

async function expectWallStyle(workspaceFolder: vscode.WorkspaceFolder, compiler: CompilerInfo): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder, 'wall style', {
    'grader.cpp': wallGraderSource(),
    'wall.h': wallHeaderSource(),
    'solution.cpp': wallAcceptedSolutionSource(),
    'samples/1.in': [
      '5 4',
      '1 0 4 3',
      '2 1 3 2',
      '1 2 4 5',
      '2 0 2 4',
      ''
    ].join('\n'),
    'samples/1.out': '3 2 4 5 5\n'
  });
  const problem = createProblem(compiler, 'function-wall', fixtureRoot, {
    grader: 'grader.cpp',
    solution: 'solution.cpp',
    headers: ['wall.h']
  });

  const acceptedReport = await runFunctionStyleJudge(workspaceFolder, problem, output());
  expect(acceptedReport?.mode).toBe('function');
  expect(acceptedReport?.compile?.status).toBe('OK');
  expect(acceptedReport?.samples[0]?.status).toBe('AC');
  expect(renderReportBody(workspaceFolder, acceptedReport!, problem.id, problem)).toContain('Function-style Judge');
  expect(renderReportBody(workspaceFolder, acceptedReport!, problem.id, problem)).toContain('wall style');

  await writeText(path.join(workspaceFolder.uri.fsPath, fixtureRoot, 'solution.cpp'), wallWrongSolutionSource());
  const wrongReport = await runFunctionStyleJudge(workspaceFolder, problem, output());
  expect(wrongReport?.compile?.status).toBe('OK');
  expect(wrongReport?.samples[0]?.status).toBe('WA');
  expect(wrongReport?.summary.wrongAnswer ?? 0).toBe(1);
}

async function expectRailStyle(workspaceFolder: vscode.WorkspaceFolder, compiler: CompilerInfo): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder, 'rail style', {
    'grader.cpp': railGraderSource(),
    'rail.h': railHeaderSource(),
    'solution.cpp': railSolutionSource(),
    'samples/1.in': '4 10\n10 13 18 21\n',
    'samples/1.out': 'Correct.\n'
  });
  const problem = createProblem(compiler, 'function-rail', fixtureRoot, {
    grader: 'grader.cpp',
    solution: 'solution.cpp',
    headers: ['rail.h']
  });

  const report = await runFunctionStyleJudge(workspaceFolder, problem, output());
  expect(report?.compile?.status).toBe('OK');
  expect(report?.samples[0]?.status).toBe('AC');
  await expectSampleOutput(workspaceFolder, report, 'Correct.\n');
  await expectSampleStderr(workspaceFolder, report, '');
}

async function expectGameStyle(workspaceFolder: vscode.WorkspaceFolder, compiler: CompilerInfo): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder, 'game style', {
    'grader.cpp': gameGraderSource(),
    'game.h': gameHeaderSource(),
    'solution.cpp': gameSolutionSource(),
    'samples/1.in': '5 4\n0 1\n1 2\n2 4\n3 4\n',
    'samples/1.out': '0\n0\n1\n0\n'
  });
  const problem = createProblem(compiler, 'function-game', fixtureRoot, {
    grader: 'grader.cpp',
    solution: 'solution.cpp',
    headers: ['game.h']
  });

  const report = await runFunctionStyleJudge(workspaceFolder, problem, output());
  expect(report?.compile?.status).toBe('OK');
  expect(report?.samples[0]?.status).toBe('AC');
  await expectSampleOutput(workspaceFolder, report, '0\n0\n1\n0\n');
}

async function expectParrotsStyle(workspaceFolder: vscode.WorkspaceFolder, compiler: CompilerInfo): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder, 'parrots style with spaces', {
    'grader.cpp': parrotsGraderSource(),
    'encoder.h': parrotsEncoderHeaderSource(),
    'decoder.h': parrotsDecoderHeaderSource(),
    'encoder.cpp': parrotsEncoderSource(),
    'decoder.cpp': parrotsDecoderSource(),
    'samples/1.in': '5\n4 1 3 1 5\n',
    'samples/1.out': 'Correct.\n'
  });
  const problem = createProblem(compiler, 'function-parrots', fixtureRoot, {
    grader: 'grader.cpp',
    solution: 'encoder.cpp',
    sources: ['decoder.cpp'],
    headers: ['encoder.h', 'decoder.h'],
    compileArgs: ['-DFUNCTION_STYLE_PARROTS=1']
  });

  const report = await runFunctionStyleJudge(workspaceFolder, problem, output());
  expect(report?.compile?.status).toBe('OK');
  expect(report?.samples[0]?.status).toBe('AC');
  expect(report?.functionStyle?.sources).toEqual([path.join(fixtureRoot, 'decoder.cpp')]);
  expect(report?.functionStyle?.compileArgs).toEqual(['-DFUNCTION_STYLE_PARROTS=1']);
  await expectSampleOutput(workspaceFolder, report, 'Correct.\n');
}

async function expectCompileError(workspaceFolder: vscode.WorkspaceFolder, compiler: CompilerInfo): Promise<void> {
  const fixtureRoot = await writeFixture(workspaceFolder, 'compile error style', {
    'grader.cpp': simpleGraderSource(),
    'solution.cpp': 'int solve(int x) { return x * }\n',
    'samples/1.in': '21\n',
    'samples/1.out': '42\n'
  });
  const problem = createProblem(compiler, 'function-compile-error', fixtureRoot, {
    grader: 'grader.cpp',
    solution: 'solution.cpp'
  });

  const report = await runFunctionStyleJudge(workspaceFolder, problem, output());
  expect(report?.compile?.status).toBe('CE');
  expect(report?.compile?.message).toContain('Function-style compile failed');
  expect(report?.samples[0]?.status).toBe('CE');
  const reportJson = JSON.parse(await fs.readFile(getReportPath(workspaceFolder), 'utf8')) as { mode?: string };
  expect(reportJson.mode).toBe('function');
}

function createProblem(
  compiler: CompilerInfo,
  id: string,
  fixtureRoot: string,
  functionStyle: NonNullable<ProblemConfig['functionStyle']>
): ProblemConfig {
  const rel = (filePath: string) => path.join(fixtureRoot, filePath);
  return {
    version: 1,
    id,
    name: id,
    standard: 'c++17',
    mode: 'function',
    functionStyle: {
      ...functionStyle,
      grader: rel(functionStyle.grader ?? 'grader.cpp'),
      solution: rel(functionStyle.solution ?? 'solution.cpp'),
      sources: functionStyle.sources?.map(rel),
      headers: functionStyle.headers?.map(rel)
    },
    ...compilerConfig(compiler),
    limits: { timeMs: 3000, memoryMb: 256 },
    judgeMode: 'trimTrailingWhitespace',
    samples: [
      {
        id: `${id}-sample-1`,
        index: 1,
        name: `${id} sample`,
        input: rel(path.join('samples', '1.in')),
        answer: rel(path.join('samples', '1.out'))
      }
    ]
  };
}

async function createTempWorkspace(prefix: string): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir, scheme: 'file' },
    name: path.basename(dir),
    index: 0
  } as vscode.WorkspaceFolder;
}

async function writeFixture(workspaceFolder: vscode.WorkspaceFolder, name: string, files: Record<string, string>): Promise<string> {
  const root = name;
  for (const [relativePath, content] of Object.entries(files)) {
    await writeText(path.join(workspaceFolder.uri.fsPath, root, relativePath), content);
  }
  return root;
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function expectSampleOutput(
  workspaceFolder: vscode.WorkspaceFolder,
  report: Awaited<ReturnType<typeof runFunctionStyleJudge>>,
  expected: string
): Promise<void> {
  const outputRel = report?.samples[0]?.actualOutput;
  expect(outputRel).toBeTruthy();
  const content = await fs.readFile(path.join(workspaceFolder.uri.fsPath, outputRel!), 'utf8');
  expect(content.replace(/\r\n/gu, '\n')).toBe(expected);
}

async function expectSampleStderr(
  workspaceFolder: vscode.WorkspaceFolder,
  report: Awaited<ReturnType<typeof runFunctionStyleJudge>>,
  expected: string
): Promise<void> {
  const stderrRel = report?.samples[0]?.stderr;
  expect(stderrRel).toBeTruthy();
  const content = await fs.readFile(path.join(workspaceFolder.uri.fsPath, stderrRel!), 'utf8');
  expect(content.replace(/\r\n/gu, '\n')).toBe(expected);
}

function wallHeaderSource(): string {
  return `#pragma once
void buildWall(int n, int k, int op[], int left[], int right[], int height[], int finalHeight[]);
`;
}

function wallGraderSource(): string {
  return `#include <iostream>
#include <vector>
#include "wall.h"

int main() {
  int n = 0;
  int k = 0;
  std::cin >> n >> k;
  std::vector<int> op(k), left(k), right(k), height(k), finalHeight(n, 0);
  for (int i = 0; i < k; ++i) {
    std::cin >> op[i] >> left[i] >> right[i] >> height[i];
  }
  buildWall(n, k, op.data(), left.data(), right.data(), height.data(), finalHeight.data());
  for (int i = 0; i < n; ++i) {
    if (i) {
      std::cout << ' ';
    }
    std::cout << finalHeight[i];
  }
  std::cout << '\\n';
  return 0;
}
`;
}

function wallAcceptedSolutionSource(): string {
  return `#include <algorithm>
#include "wall.h"

void buildWall(int n, int k, int op[], int left[], int right[], int height[], int finalHeight[]) {
  for (int i = 0; i < n; ++i) {
    finalHeight[i] = 0;
  }
  for (int command = 0; command < k; ++command) {
    for (int i = left[command]; i <= right[command]; ++i) {
      if (op[command] == 1) {
        finalHeight[i] = std::max(finalHeight[i], height[command]);
      } else {
        finalHeight[i] = std::min(finalHeight[i], height[command]);
      }
    }
  }
}
`;
}

function wallWrongSolutionSource(): string {
  return `#include "wall.h"

void buildWall(int n, int, int[], int[], int[], int[], int finalHeight[]) {
  for (int i = 0; i < n; ++i) {
    finalHeight[i] = 0;
  }
}
`;
}

function railHeaderSource(): string {
  return `#pragma once
int getDistance(int i, int j);
void findLocation(int n, int first, int location[], int stype[]);
`;
}

function railGraderSource(): string {
  return `#include <cstdlib>
#include <iostream>
#include <vector>
#include "rail.h"

static std::vector<int> hiddenLocation;

int getDistance(int i, int j) {
  return std::abs(hiddenLocation[i] - hiddenLocation[j]);
}

int main() {
  int n = 0;
  int first = 0;
  std::cin >> n >> first;
  hiddenLocation.resize(n);
  for (int i = 0; i < n; ++i) {
    std::cin >> hiddenLocation[i];
  }
  std::vector<int> outLocation(n, 0), outType(n, 0);
  findLocation(n, first, outLocation.data(), outType.data());
  bool ok = true;
  for (int i = 0; i < n; ++i) {
    ok = ok && outLocation[i] == getDistance(0, i) + first;
    ok = ok && outType[i] == 2;
  }
  std::cout << (ok ? "Correct." : "Incorrect.") << '\\n';
  return 0;
}
`;
}

function railSolutionSource(): string {
  return `#include "rail.h"

void findLocation(int n, int first, int location[], int stype[]) {
  for (int i = 0; i < n; ++i) {
    location[i] = getDistance(0, i) + first;
    stype[i] = 2;
  }
}
`;
}

function gameHeaderSource(): string {
  return `#pragma once
void initialize(int n);
int hasEdge(int u, int v);
`;
}

function gameGraderSource(): string {
  return `#include <iostream>
#include "game.h"

int main() {
  int n = 0;
  int q = 0;
  std::cin >> n >> q;
  initialize(n);
  for (int i = 0; i < q; ++i) {
    int u = 0;
    int v = 0;
    std::cin >> u >> v;
    std::cout << hasEdge(u, v) << '\\n';
  }
  return 0;
}
`;
}

function gameSolutionSource(): string {
  return `#include "game.h"

static int storedN = 0;

void initialize(int n) {
  storedN = n;
}

int hasEdge(int u, int v) {
  return (u + v + storedN) % 2;
}
`;
}

function parrotsEncoderHeaderSource(): string {
  return `#pragma once
void encode(int n, int message[]);
void send(int value);
`;
}

function parrotsDecoderHeaderSource(): string {
  return `#pragma once
void decode(int n, int l, int encoded[]);
void output(int value);
`;
}

function parrotsGraderSource(): string {
  return `#include <iostream>
#include <vector>
#include "encoder.h"
#include "decoder.h"

static std::vector<int> encoded;
static std::vector<int> decoded;

void send(int value) {
  encoded.push_back(value);
}

void output(int value) {
  decoded.push_back(value);
}

int main() {
  int n = 0;
  std::cin >> n;
  std::vector<int> message(n, 0);
  for (int i = 0; i < n; ++i) {
    std::cin >> message[i];
  }
  encode(n, message.data());
  decode(n, static_cast<int>(encoded.size()), encoded.data());
  std::cout << (decoded == message ? "Correct." : "Incorrect.") << '\\n';
  return 0;
}
`;
}

function parrotsEncoderSource(): string {
  return `#include "encoder.h"

void encode(int n, int message[]) {
  for (int i = 0; i < n; ++i) {
    send(message[i]);
  }
}
`;
}

function parrotsDecoderSource(): string {
  return `#include "decoder.h"

void decode(int, int l, int encoded[]) {
  for (int i = 0; i < l; ++i) {
    output(encoded[i]);
  }
}
`;
}

function simpleGraderSource(): string {
  return `#include <iostream>
int solve(int x);
int main() {
  int x = 0;
  std::cin >> x;
  std::cout << solve(x) << '\\n';
  return 0;
}
`;
}
