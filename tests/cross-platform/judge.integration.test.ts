import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { compareCrossPlatformMetrics, CrossPlatformMetricCase, CrossPlatformMetricResult } from '../../src/crossPlatformMetrics';
import { getReportPath, getOiJudgeDataRelPath } from '../../src/config';
import { runAllSamples } from '../../src/judge';
import { renderPage, renderReportBody } from '../../src/reportView';
import { ProblemConfig } from '../../src/types';
import {
  compilerConfig,
  copyArtifact,
  createCrossPlatformWorkspace,
  findCppCompiler,
  output,
  writeJsonArtifact,
  writeText
} from './helpers';

describe('cross-platform judge regression', () => {
  it('runs a multi-subtask sum-array fixture and records portable metrics', async () => {
    const compiler = await findCppCompiler();
    if (!compiler) {
      const skipped = await writeJsonArtifact(`cross-platform-result-${process.platform}.json`, {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        skipped: true,
        reason: 'No g++ or clang++ compiler found in PATH.'
      });
      console.warn(`Cross-platform judge regression skipped; result JSON: ${skipped}`);
      return;
    }

    const workspaceFolder = await createCrossPlatformWorkspace('OI Judge Cross Platform Fixtures');
    const fixtureDir = path.join(workspaceFolder.uri.fsPath, 'sum array fixture');
    const solutionPath = await writeText(path.join(fixtureDir, 'sum-array.cpp'), sumArraySolution());
    const wrongSolutionPath = await writeText(path.join(fixtureDir, 'sum-array-wrong.cpp'), wrongSumArraySolution());
    const problem = await createSumArrayProblem(workspaceFolder.uri.fsPath, compiler.command);

    const acceptedReport = await runAllSamples(workspaceFolder, solutionPath, problem, output());
    expect(acceptedReport?.summary).toMatchObject({ accepted: 5, total: 5 });
    expect(acceptedReport?.summary.wrongAnswer ?? 0).toBe(0);
    expect(acceptedReport?.summary.checkerError ?? 0).toBe(0);
    expect(acceptedReport?.summary.runtimeError ?? 0).toBe(0);
    expect(acceptedReport?.summary.timeLimitExceeded ?? 0).toBe(0);
    expect(acceptedReport?.summary.memoryLimitExceeded ?? 0).toBe(0);
    for (const value of Object.values(acceptedReport?.summary ?? {})) {
      if (typeof value === 'number') {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    expect(acceptedReport?.score).toEqual({ earned: 100, total: 100 });
    for (const sample of acceptedReport?.samples ?? []) {
      expect(sample.status).toBe('AC');
      expect(Number.isFinite(sample.timeMs)).toBe(true);
      expect(sample.timeMs).toBeGreaterThanOrEqual(0);
      expect(sample.memoryKiB ?? 0).toBeGreaterThanOrEqual(0);
      expect(sample.actualOutput).not.toContain('\\');
    }

    const acceptedHtml = renderPage('Cross Platform Report', renderReportBody(workspaceFolder, acceptedReport!, problem.id, problem));
    const reportPath = await copyArtifact(getReportPath(workspaceFolder), 'report-html/sum-array-report.json');
    const htmlPath = await writeText(path.join(process.cwd(), '.tmp', 'oijudge-cross-platform', 'report-html', 'sum-array-report.html'), acceptedHtml);
    expect(reportPath).toContain('sum-array-report.json');
    expect(htmlPath).toContain('sum-array-report.html');

    const wrongReport = await runAllSamples(workspaceFolder, wrongSolutionPath, problem, output());
    expect(wrongReport?.summary).toMatchObject({ total: 5 });
    expect(wrongReport?.summary.wrongAnswer ?? 0).toBeGreaterThanOrEqual(1);
    expect(wrongReport?.summary.accepted).toBeLessThan(wrongReport?.summary.total ?? 0);
    expect(wrongReport?.score?.earned).toBeLessThan(100);
    const wrongHtml = renderReportBody(workspaceFolder, wrongReport!, problem.id, problem);
    expect(subtaskCaseOrder(wrongHtml, 'Subtask 1')).toEqual([2, 1]);
    expect(subtaskCaseOrder(wrongHtml, 'Subtask 2')).toEqual([4, 3]);
    expect(subtaskCaseOrder(wrongHtml, 'Subtask 3')).toEqual([5]);

    const cases: CrossPlatformMetricCase[] = (acceptedReport?.samples ?? []).map((sample) => ({
      name: sample.name,
      verdict: sample.status,
      timeMs: sample.timeMs,
      memoryKb: sample.memoryKiB ?? 0,
      memorySupported: sample.memoryKiB !== undefined
    }));
    const result: CrossPlatformMetricResult = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      compiler: `${compiler.command}: ${compiler.version}`,
      cases,
      summary: {
        totalTimeMs: acceptedReport?.totalTimeMs ?? 0,
        maxMemoryKb: Math.max(...cases.map((entry) => entry.memoryKb ?? 0))
      }
    };
    const comparison = compareCrossPlatformMetrics(undefined, result);
    expect(comparison.errors).toEqual([]);
    const resultPath = await writeJsonArtifact(`cross-platform-result-${process.platform}.json`, {
      ...result,
      comparison
    });
    await writeJsonArtifact('cross-platform-baseline/local-baseline.json', result);
    console.warn(`Cross-platform judge result JSON: ${resultPath}`);
  }, 120_000);
});

async function createSumArrayProblem(root: string, compilerCommand: string): Promise<ProblemConfig> {
  const sampleDir = path.join(root, 'sum array fixture', 'samples');
  const samples = [
    { id: 'sample-1', index: 1, name: 'sum-array-small-1', values: [1, 2, 3], score: 10 },
    { id: 'sample-2', index: 2, name: 'sum-array-small-negative', values: [-5, 1, 2], score: 10 },
    { id: 'sample-3', index: 3, name: 'sum-array-medium-1', values: sequence(1000), score: 20 },
    { id: 'sample-4', index: 4, name: 'sum-array-medium-negative', values: sequence(1500, -10), score: 20 },
    { id: 'sample-5', index: 5, name: 'sum-array-large', values: sequence(20_000), score: 40 }
  ];
  for (const sample of samples) {
    await writeCase(sampleDir, sample.index, sample.values);
  }

  return {
    version: 1,
    id: 'sum-array',
    name: 'sum-array',
    standard: 'c++17',
    ...compilerConfig({ command: compilerCommand, version: compilerCommand }),
    limits: { timeMs: 3000, memoryMb: 256 },
    judgeMode: 'trimTrailingWhitespace',
    samples: samples.map((sample) => ({
      id: sample.id,
      index: sample.index,
      name: sample.name,
      input: path.join('sum array fixture', 'samples', `sample-${sample.index}.in`),
      answer: path.join('sum array fixture', 'samples', `sample-${sample.index}.out`),
      actualOutput: getOiJudgeDataRelPath('problems', 'sum-array', 'outputs', `sample-${sample.index}.out`),
      score: sample.score
    })),
    subtasks: [
      { id: 'subtask-1', name: 'Subtask 1', sampleIds: ['sample-1', 'sample-2'], scoringMode: 'sum' },
      { id: 'subtask-2', name: 'Subtask 2', sampleIds: ['sample-3', 'sample-4'], scoringMode: 'bundle' },
      { id: 'subtask-3', name: 'Subtask 3', sampleIds: ['sample-5'], scoringMode: 'bundle' }
    ],
    score: { total: 100 }
  };
}

async function writeCase(sampleDir: string, index: number, values: number[]): Promise<void> {
  const input = `${values.length}\n${values.join(' ')}\n`;
  const answer = `${values.reduce((sum, value) => sum + value, 0)}\n`;
  await writeText(path.join(sampleDir, `sample-${index}.in`), input);
  await writeText(path.join(sampleDir, `sample-${index}.out`), answer);
}

function sequence(size: number, offset = 1): number[] {
  return Array.from({ length: size }, (_, index) => index + offset);
}

function sumArraySolution(): string {
  return `#include <iostream>
#include <vector>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  if (!(cin >> n)) return 0;
  vector<long long> a(n);
  long long sum = 0;
  for (int i = 0; i < n; ++i) {
    cin >> a[i];
    sum += a[i];
  }
  vector<int> memory_probe(4096, 7);
  cout << sum << '\\n';
  return memory_probe[0] == 7 ? 0 : 1;
}
`;
}

function wrongSumArraySolution(): string {
  return `#include <iostream>
using namespace std;
int main() {
  int n;
  if (!(cin >> n)) return 0;
  long long sum = 0;
  for (int i = 0; i < n; ++i) {
    long long x;
    cin >> x;
    sum += x;
  }
  if (sum < 0 || n == 1500) {
    ++sum;
  }
  cout << sum << '\\n';
  return 0;
}
`;
}

function subtaskCaseOrder(html: string, subtaskName: string): number[] {
  const start = html.indexOf(subtaskName);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('class="testcaseGroup subtask-row"', start + subtaskName.length);
  return [...(next >= 0 ? html.slice(start, next) : html.slice(start)).matchAll(/Testcase #(\d+)/g)].map((match) => Number(match[1]));
}
