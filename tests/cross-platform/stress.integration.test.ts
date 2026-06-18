import { promises as fs } from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { getStressRoot, readStressSession } from '../../src/stressRecords';
import { createStressRunController } from '../../src/stressRunController';
import { runGeneratorStdStressTest, runStandaloneStressTest } from '../../src/stressTest';
import { OITestConfig } from '../../src/types';
import {
  compilerConfig,
  CompilerInfo,
  createCrossPlatformWorkspace,
  findCppCompiler,
  output,
  writeJsonArtifact,
  writeText
} from './helpers';

describe('cross-platform stress regression', () => {
  it('runs split-file stress AC fixture', async () => {
    const fixture = await createStressFixture('split-file-ac');
    if (!fixture) {
      return;
    }

    const generatorPath = await writeText(path.join(fixture.fixtureDir, 'generator.cpp'), generatorSource(false));
    const stdPath = await writeText(path.join(fixture.fixtureDir, 'std.cpp'), maxSolutionSource(false));
    const solutionPath = await writeText(path.join(fixture.fixtureDir, 'solution.cpp'), maxSolutionSource(false));
    const splitAccepted = await runGeneratorStdStressTest({
      workspaceFolder: fixture.workspaceFolder,
      config: fixture.config,
      generatorPath,
      stdPath,
      solutionPath,
      rounds: 20,
      output: output(),
      source: 'manual'
    });
    expect(splitAccepted).toMatchObject({ mode: 'generator-std', passed: 20, rounds: 20 });
    expect(splitAccepted?.failedAt).toBeUndefined();

    await writeStressResult('split-file-ac', fixture.compiler, {
      splitAccepted: { passed: splitAccepted?.passed, rounds: splitAccepted?.rounds }
    });
  }, 120_000);

  it('runs split-file stress WA fixture and records the mismatch', async () => {
    const fixture = await createStressFixture('split-file-wa');
    if (!fixture) {
      return;
    }

    const generatorPath = await writeText(path.join(fixture.fixtureDir, 'generator-negative.cpp'), generatorSource(true));
    const stdPath = await writeText(path.join(fixture.fixtureDir, 'std.cpp'), maxSolutionSource(false));
    const wrongSolutionPath = await writeText(path.join(fixture.fixtureDir, 'solution-wrong.cpp'), maxSolutionSource(true));
    const splitWrong = await runGeneratorStdStressTest({
      workspaceFolder: fixture.workspaceFolder,
      config: fixture.config,
      generatorPath,
      stdPath,
      solutionPath: wrongSolutionPath,
      rounds: 3,
      output: output(),
      source: 'currentCode'
    });
    expect(splitWrong).toMatchObject({ mode: 'generator-std', failedAt: 1 });
    const failedSummary = JSON.parse(await fs.readFile(path.join(splitWrong!.sessionDir, 'summary.json'), 'utf8')) as Record<string, unknown>;
    expect(failedSummary).toMatchObject({
      mode: 'generator-std',
      reason: 'wrong-answer'
    });
    for (const fileName of ['case-0001.in', 'case-0001.std.out', 'case-0001.test.out', 'summary.json']) {
      await expect(fs.access(path.join(splitWrong!.sessionDir, fileName))).resolves.toBeUndefined();
    }
    const failedSession = await readStressSession(splitWrong!.sessionDir);
    expect(failedSession?.failedCase?.input).toBe('case-0001.in');

    await writeStressResult('split-file-wa', fixture.compiler, {
      splitWrong: { failedAt: splitWrong?.failedAt, reason: failedSummary.reason }
    });
  }, 120_000);

  it('runs stress current code style with configured generator and STD', async () => {
    const fixture = await createStressFixture('current-code-style');
    if (!fixture) {
      return;
    }

    const generatorPath = await writeText(path.join(fixture.fixtureDir, 'generator.cpp'), generatorSource(false));
    const stdPath = await writeText(path.join(fixture.fixtureDir, 'std.cpp'), maxSolutionSource(false));
    const solutionPath = await writeText(path.join(fixture.fixtureDir, 'solution.cpp'), maxSolutionSource(false));
    const currentCodeStyle = await runGeneratorStdStressTest({
      workspaceFolder: fixture.workspaceFolder,
      config: fixture.config,
      generatorPath,
      stdPath,
      solutionPath,
      rounds: 10,
      output: output(),
      source: 'currentCode'
    });
    expect(currentCodeStyle).toMatchObject({ mode: 'generator-std', passed: 10, rounds: 10 });
    expect(currentCodeStyle?.failedAt).toBeUndefined();

    await writeStressResult('current-code-style', fixture.compiler, {
      currentCodeStyle: { passed: currentCodeStyle?.passed, rounds: currentCodeStyle?.rounds }
    });
  }, 120_000);

  it('runs single-file contest-style stress fixture', async () => {
    const fixture = await createStressFixture('single-file');
    if (!fixture) {
      return;
    }

    const standalonePath = await writeText(path.join(fixture.fixtureDir, 'stress.cpp'), standaloneStressSource());
    const standalone = await runStandaloneStressTest({
      workspaceFolder: fixture.workspaceFolder,
      config: fixture.config,
      programPath: standalonePath,
      output: output()
    });
    expect(standalone).toMatchObject({ mode: 'standalone', exitCode: 0 });
    await expect(fs.readFile(path.join(standalone!.sessionDir, 'standalone.stdout.txt'), 'utf8')).resolves.toContain('OK');

    await writeStressResult('single-file', fixture.compiler, {
      standalone: { exitCode: standalone?.exitCode }
    });
  }, 120_000);

  it('stops infinite single-file stress without reporting AC or mismatch', async () => {
    const fixture = await createStressFixture('stop-single-file');
    if (!fixture) {
      return;
    }

    const infinitePath = await writeText(path.join(fixture.fixtureDir, 'stress_infinite.cpp'), infiniteStressSource());
    const controller = createStressRunController();
    expect(controller.start()).toBe(true);
    const running = runStandaloneStressTest({
      workspaceFolder: fixture.workspaceFolder,
      config: fixture.config,
      programPath: infinitePath,
      output: output(),
      controller
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    controller.cancel();
    const cancelled = await running;
    controller.finish();
    expect(cancelled?.cancelled).toBe(true);
    const cancelledSummary = JSON.parse(await fs.readFile(path.join(cancelled!.sessionDir, 'summary.json'), 'utf8')) as Record<string, unknown>;
    expect(cancelledSummary).toMatchObject({
      mode: 'standalone',
      status: 'cancelled',
      reason: 'Stopped by user'
    });
    expect(cancelledSummary.reason).not.toBe('Accepted');
    expect(cancelledSummary.reason).not.toBe('wrong-answer');
    expect(controller.start()).toBe(true);
    controller.finish();

    const sessions = await fs.readdir(getStressRoot(fixture.workspaceFolder));
    await writeStressResult('stop-single-file', fixture.compiler, {
      cancelled: { cancelled: cancelled?.cancelled },
      stressSessions: sessions.length
    });
  }, 120_000);
});

type StressFixture = {
  compiler: CompilerInfo;
  workspaceFolder: vscode.WorkspaceFolder;
  fixtureDir: string;
  config: OITestConfig;
};

async function createStressFixture(name: string): Promise<StressFixture | undefined> {
  const compiler = await findCppCompiler();
  if (!compiler) {
    const skipped = await writeJsonArtifact(`cross-platform-stress-${process.platform}-${name}.json`, {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      skipped: true,
      reason: 'No g++ or clang++ compiler found in PATH or VS Code C/C++ settings.'
    });
    console.warn(`Cross-platform stress regression skipped; result JSON: ${skipped}`);
    return undefined;
  }

  const workspaceFolder = await createCrossPlatformWorkspace(`OI Judge Cross Platform Stress ${name}`);
  return {
    compiler,
    workspaceFolder,
    fixtureDir: path.join(workspaceFolder.uri.fsPath, 'max array fixture'),
    config: stressConfig(compiler.command)
  };
}

async function writeStressResult(name: string, compiler: CompilerInfo, data: Record<string, unknown>): Promise<void> {
  const resultPath = await writeJsonArtifact(`cross-platform-stress-${process.platform}-${name}.json`, {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    compiler: `${compiler.command}: ${compiler.version}`,
    ...data
  });
  console.warn(`Cross-platform stress result JSON: ${resultPath}`);
}

function stressConfig(compilerCommand: string): OITestConfig {
  return {
    version: 1,
    ...compilerConfig({ command: compilerCommand, version: compilerCommand }),
    limits: { timeMs: 3000, memoryMb: 256 },
    samples: []
  };
}

function generatorSource(negativeOnly: boolean): string {
  return `#include <iostream>
int main() {
  ${negativeOnly
    ? "std::cout << \"5\\n-9 -4 -7 -3 -8\\n\";"
    : "std::cout << \"6\\n-2 7 1 9 3 5\\n\";"}
  return 0;
}
`;
}

function maxSolutionSource(wrong: boolean): string {
  return `#include <algorithm>
#include <iostream>
#include <limits>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  cin >> n;
  long long best = ${wrong ? '0' : 'numeric_limits<long long>::min()'};
  for (int i = 0; i < n; ++i) {
    long long x;
    cin >> x;
    best = max(best, x);
  }
  cout << best << '\\n';
  return 0;
}
`;
}

function standaloneStressSource(): string {
  return `#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;
int main() {
  for (int tc = 0; tc < 10; ++tc) {
    vector<int> a = {tc, tc + 1, tc + 2};
    int brute = *max_element(a.begin(), a.end());
    int solve = a[0];
    for (int x : a) solve = max(solve, x);
    if (brute != solve) return 1;
  }
  cout << "OK\\n";
  return 0;
}
`;
}

function infiniteStressSource(): string {
  return `#include <chrono>
#include <iostream>
#include <thread>
int main() {
  while (true) {
    std::cout << "heartbeat" << std::endl;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
}
`;
}
