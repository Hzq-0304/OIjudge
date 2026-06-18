import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { readStressSession } from '../src/stressRecords';

const workspaces: string[] = [];
const vscodeMock = vscode as unknown as {
  __resetConfiguration: () => void;
  __setConfiguration: (key: string, value: unknown) => void;
};

describe('stress records', () => {
  afterEach(async () => {
    vscodeMock.__resetConfiguration();
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('shows old generator + STD records with the clearer split-file label', async () => {
    const sessionDir = await createStressSession({
      mode: 'generator-std',
      rounds: 100,
      passed: 37,
      failedAt: 38,
      failedCase: {
        input: 'case-0038.in',
        stdOutput: 'case-0038.std.out',
        testOutput: 'case-0038.test.out'
      }
    });

    const session = await readStressSession(sessionDir);

    expect(session?.mode).toBe('generator-std');
    expect(session?.description).toContain('Generator + STD + Solution');
    expect(session?.description).toContain('Wrong Answer at #38');
    expect(session?.failedCase?.input).toBe('case-0038.in');
  });

  it('shows old standalone records as single-file stress tests and keeps output links', async () => {
    const sessionDir = await createStressSession({
      mode: 'standalone',
      program: 'stress.cpp',
      exitCode: 0,
      stdout: 'standalone.stdout.txt',
      stderr: 'standalone.stderr.txt'
    });

    const session = await readStressSession(sessionDir);

    expect(session?.mode).toBe('standalone');
    expect(session?.description).toContain('Single-file stress test');
    expect(session?.description).toContain('exit code 0');
    expect(session?.standalone).toEqual({
      stdout: 'standalone.stdout.txt',
      stderr: 'standalone.stderr.txt'
    });
  });

  it('localizes standalone stress record mode labels in Chinese', async () => {
    vscodeMock.__setConfiguration('language', 'zh');
    const sessionDir = await createStressSession({
      mode: 'standalone',
      exitCode: 1,
      stdout: 'standalone.stdout.txt',
      stderr: 'standalone.stderr.txt'
    });

    const session = await readStressSession(sessionDir);

    expect(session?.description).toContain('单文件对拍（考场式）');
  });
});

async function createStressSession(summary: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-stress-record-'));
  workspaces.push(dir);
  await fs.writeFile(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return dir;
}
