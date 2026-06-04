import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig, getConfigPath, getOiJudgeConfigPath, toPosixPath, writeConfig } from '../src/config';
import {
  normalizeCheckerConfig,
  normalizeFileIoConfig,
  normalizeIoMode,
  normalizeJudgeMode
} from '../src/configNormalize';
import {
  createProblem,
  ensureProblemsConfig,
  getLegacyProblemsPath,
  getProblemSourcePath,
  getProblemsPath,
  readProblemsConfig,
  writeProblemsConfig
} from '../src/problems';

const workspaces: string[] = [];

describe('judgeMode and ioMode compatibility defaults', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('defaults old configs without checker to normal judge mode', () => {
    expect(normalizeJudgeMode(undefined, undefined)).toBe('normal');
    expect(normalizeCheckerConfig(undefined)).toEqual({ enabled: false, type: 'none' });
  });

  it('treats old enabled checker configs as checker mode', () => {
    expect(normalizeJudgeMode(undefined, {
      enabled: true,
      type: 'testlib',
      source: 'checker.cpp'
    })).toBe('checker');
  });

  it('keeps explicit normal judge mode even when checker config exists', () => {
    expect(normalizeJudgeMode('normal', {
      enabled: true,
      type: 'plain',
      source: 'checker.cpp'
    })).toBe('normal');
  });

  it('defaults missing ioMode to stdio', () => {
    expect(normalizeIoMode(undefined)).toBe('stdio');
  });

  it('fills default File IO names when fileIo is missing', () => {
    expect(normalizeFileIoConfig(undefined)).toEqual({
      inputFileName: 'input.txt',
      outputFileName: 'output.txt'
    });
  });

  it('fills old Plain Checker protocol defaults', () => {
    expect(normalizeCheckerConfig({
      enabled: true,
      type: 'plain',
      plain: { protocolVersion: 1 }
    }).plain).toEqual({
      protocolVersion: 1,
      verdictPosition: 'lastLine',
      acceptedToken: 'AC',
      wrongAnswerToken: 'WA'
    });
  });

  it('stores the multi-problem workspace config in .vscode/.OIJudge', async () => {
    const workspaceFolder = await createWorkspace();
    const settingsPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, '{"C_Cpp.default.compilerPath":"local-g++.exe"}\n', 'utf8');

    const problem = await createProblem(workspaceFolder, 'A');
    const saved = await readProblemsConfig(workspaceFolder);

    expect(getProblemsPath(workspaceFolder)).toBe(getOiJudgeConfigPath(workspaceFolder));
    expect(getProblemsPath(workspaceFolder)).toBe(path.join(workspaceFolder.uri.fsPath, '.vscode', '.OIJudge'));
    expect(saved.problems[0].id).toBe(problem.id);
    await expect(fs.readFile(settingsPath, 'utf8')).resolves.toBe('{"C_Cpp.default.compilerPath":"local-g++.exe"}\n');
  });

  it('migrates legacy .oitest/problems.json into .vscode/.OIJudge and keeps the old file', async () => {
    const workspaceFolder = await createWorkspace();
    const legacyPath = getLegacyProblemsPath(workspaceFolder);
    const legacyConfig = {
      version: 1,
      problems: [{
        ...createDefaultConfig(),
        id: 'legacy-a',
        name: 'Legacy A',
        source: 'main.cpp',
        defaultSource: 'main.cpp',
        sources: [{ path: 'main.cpp', name: 'main.cpp' }],
        standard: 'c++17',
        samples: []
      }]
    };
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, 'utf8');

    const migrated = await ensureProblemsConfig(workspaceFolder);

    expect(migrated.problems.map((problem) => problem.id)).toEqual(['legacy-a']);
    await expect(fs.access(getProblemsPath(workspaceFolder))).resolves.toBeUndefined();
    await expect(fs.access(legacyPath)).resolves.toBeUndefined();
  });

  it('uses .vscode/.OIJudge when both new and legacy problem configs exist', async () => {
    const workspaceFolder = await createWorkspace();
    const legacyPath = getLegacyProblemsPath(workspaceFolder);
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(
      legacyPath,
      JSON.stringify({ version: 1, problems: [{ ...createDefaultConfig(), id: 'old', name: 'Old', standard: 'c++17' }] }),
      'utf8'
    );
    await writeProblemsConfig(workspaceFolder, {
      version: 1,
      problems: [{ ...createDefaultConfig(), id: 'new', name: 'New', standard: 'c++17', samples: [] }]
    });

    const config = await ensureProblemsConfig(workspaceFolder);

    expect(config.problems.map((problem) => problem.id)).toEqual(['new']);
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toContain('"old"');
  });

  it('migrates legacy per-problem config files when the old problem list is absent', async () => {
    const workspaceFolder = await createWorkspace();
    const problemConfigPath = path.join(workspaceFolder.uri.fsPath, '.oitest', 'problems', 'folder-a', 'config.json');
    await fs.mkdir(path.dirname(problemConfigPath), { recursive: true });
    await fs.writeFile(
      problemConfigPath,
      JSON.stringify({
        ...createDefaultConfig(),
        id: 'folder-a',
        name: 'Folder A',
        standard: 'c++17',
        samples: []
      }),
      'utf8'
    );

    const migrated = await ensureProblemsConfig(workspaceFolder);

    expect(migrated.problems.map((problem) => problem.id)).toEqual(['folder-a']);
    await expect(fs.access(getProblemsPath(workspaceFolder))).resolves.toBeUndefined();
    await expect(fs.access(problemConfigPath)).resolves.toBeUndefined();
  });

  it('migrates legacy single-problem .oitest/config.json without moving runtime files', async () => {
    const workspaceFolder = await createWorkspace();
    const legacy = createDefaultConfig();
    legacy.samples = [{
      id: 'sample-1',
      index: 1,
      name: 'Sample 1',
      input: toPosixPath(path.join('.oitest', 'samples', '1.in')),
      answer: toPosixPath(path.join('.oitest', 'samples', '1.out')),
      actualOutput: toPosixPath(path.join('.oitest', 'outputs', '1.out')),
      sourceType: 'managed'
    }];
    await writeConfig(workspaceFolder, legacy);

    const migrated = await ensureProblemsConfig(workspaceFolder);

    expect(migrated.problems).toHaveLength(1);
    expect(migrated.problems[0].id).toBe('legacy');
    expect(migrated.problems[0].samples[0].input).toBe('.oitest/samples/1.in');
    await expect(fs.access(getConfigPath(workspaceFolder))).resolves.toBeUndefined();
    await expect(fs.access(getProblemsPath(workspaceFolder))).resolves.toBeUndefined();
  });

  it('resolves config relative paths from the workspace root, not from .vscode', async () => {
    const workspaceFolder = await createWorkspace();
    await writeProblemsConfig(workspaceFolder, {
      version: 1,
      problems: [{
        ...createDefaultConfig(),
        id: 'a',
        name: 'A',
        source: 'src/main.cpp',
        defaultSource: 'src/main.cpp',
        sources: [{ path: 'src/main.cpp', name: 'main.cpp' }],
        standard: 'c++17',
        samples: []
      }]
    });

    const [problem] = (await readProblemsConfig(workspaceFolder)).problems;

    expect(getProblemSourcePath(workspaceFolder, problem)).toBe(path.join(workspaceFolder.uri.fsPath, 'src', 'main.cpp'));
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-config-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}
