import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { getStressRoot, readStressSession } from '../../src/stressRecords';
import { createStressRunController } from '../../src/stressRunController';
import { runGeneratorStdStressTest, runStandaloneStressTest } from '../../src/stressTest';
import { OITestConfig } from '../../src/types';
import {
  compilerConfig,
  createCrossPlatformWorkspace,
  findCppCompiler,
  output,
  writeJsonArtifact,
  writeText
} from './helpers';

describe('cross-platform stress regression', () => {
  it('runs split-file, current-code-style, standalone, and cancellation stress fixtures', async () => {
    const compiler = await findCppCompiler();
    if (!compiler) {
      const skipped = await writeJsonArtifact(`cross-platform-stress-${process.platform}.json`, {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        skipped: true,
        reason: 'No g++ or clang++ compiler found in PATH.'
      });
      console.warn(`Cross-platform stress regression skipped; result JSON: ${skipped}`);
      return;
    }

    const workspaceFolder = await createCrossPlatformWorkspace('OI Judge Cross Platform Stress');
    const fixtureDir = path.join(workspaceFolder.uri.fsPath, 'max array fixture');
    const config = stressConfig(compiler.command);
    const generatorPath = await writeText(path.join(fixtureDir, 'generator.cpp'), generatorSource(false));
    const negativeGeneratorPath = await writeText(path.join(fixtureDir, 'generator-negative.cpp'), generatorSource(true));
    const stdPath = await writeText(path.join(fixtureDir, 'std.cpp'), maxSolutionSource(false));
    const solutionPath = await writeText(path.join(fixtureDir, 'solution.cpp'), maxSolutionSource(false));
    const wrongSolutionPath = await writeText(path.join(fixtureDir, 'solution-wrong.cpp'), maxSolutionSource(true));
    const standalonePath = await writeText(path.join(fixtureDir, 'stress.cpp'), standaloneStressSource());
    const infinitePath = await writeText(path.join(fixtureDir, 'stress_infinite.cpp'), infiniteStressSource());

    const splitAccepted = await runGeneratorStdStressTest({
      workspaceFolder,
      config,
      generatorPath,
      stdPath,
      solutionPath,
      rounds: 20,
      output: output(),
      source: 'manual'
    });
    expect(splitAccepted?.passed).toBe(20);
    expect(splitAccepted?.failedAt).toBeUndefined();

    const currentCodeStyle = await runGeneratorStdStressTest({
      workspaceFolder,
      config,
      generatorPath,
      stdPath,
      solutionPath,
      rounds: 10,
      output: output(),
      source: 'currentCode'
    });
    expect(currentCodeStyle?.passed).toBe(10);

    const splitWrong = await runGeneratorStdStressTest({
      workspaceFolder,
      config,
      generatorPath: negativeGeneratorPath,
      stdPath,
      solutionPath: wrongSolutionPath,
      rounds: 3,
      output: output(),
      source: 'currentCode'
    });
    expect(splitWrong?.failedAt).toBe(1);
    const failedSummary = JSON.parse(await fs.readFile(path.join(splitWrong!.sessionDir, 'summary.json'), 'utf8')) as Record<string, unknown>;
    expect(failedSummary).toMatchObject({
      mode: 'generator-std',
      source: 'currentCode',
      reason: 'wrong-answer'
    });
    for (const fileName of ['case-0001.in', 'case-0001.std.out', 'case-0001.test.out', 'summary.json']) {
      await expect(fs.access(path.join(splitWrong!.sessionDir, fileName))).resolves.toBeUndefined();
    }
    const failedSession = await readStressSession(splitWrong!.sessionDir);
    expect(failedSession?.failedCase?.input).toBe('case-0001.in');

    const standalone = await runStandaloneStressTest({
      workspaceFolder,
      config,
      programPath: standalonePath,
      output: output()
    });
    expect(standalone?.exitCode).toBe(0);
    await expect(fs.readFile(path.join(standalone!.sessionDir, 'standalone.stdout.txt'), 'utf8')).resolves.toContain('OK');

    const controller = createStressRunController();
    expect(controller.start()).toBe(true);
    const running = runStandaloneStressTest({
      workspaceFolder,
      config,
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
    expect(controller.start()).toBe(true);
    controller.finish();

    const sessions = await fs.readdir(getStressRoot(workspaceFolder));
    const resultPath = await writeJsonArtifact(`cross-platform-stress-${process.platform}.json`, {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      compiler: `${compiler.command}: ${compiler.version}`,
      splitAccepted: { passed: splitAccepted?.passed, rounds: splitAccepted?.rounds },
      splitWrong: { failedAt: splitWrong?.failedAt, reason: failedSummary.reason },
      standalone: { exitCode: standalone?.exitCode },
      cancelled: { cancelled: cancelled?.cancelled },
      stressSessions: sessions.length
    });
    console.warn(`Cross-platform stress result JSON: ${resultPath}`);
  }, 120_000);
});

function stressConfig(compilerCommand: string): OITestConfig {
  return {
    version: 1,
    ...compilerConfig({ command: compilerCommand, version: compilerCommand }),
    limits: { timeMs: 3000, memoryMb: 256 },
    samples: []
  };
}

function generatorSource(negativeOnly: boolean): string {
  return `#include <bits/stdc++.h>
using namespace std;
int main() {
  ${negativeOnly
    ? "cout << \"5\\n-9 -4 -7 -3 -8\\n\";"
    : "cout << \"6\\n-2 7 1 9 3 5\\n\";"}
  return 0;
}
`;
}

function maxSolutionSource(wrong: boolean): string {
  return `#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  cin >> n;
  long long best = ${wrong ? '0' : 'LLONG_MIN'};
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
  return `#include <bits/stdc++.h>
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
