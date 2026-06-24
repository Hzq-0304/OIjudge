import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendTranscriptChunk,
  buildInteractiveArgs,
  buildInteractiveCompileArgs,
  buildIncludeArgs,
  DEFAULT_INTERACTIVE_TRANSCRIPT_LIMIT_BYTES,
  isInteractiveMode,
  mapInteractorExitCode,
  prepareInteractiveRuntimeFiles,
  resolveInteractorArgs,
  resolveInteractiveConfig
} from '../src/interactiveJudge';
import { OITestConfig } from '../src/types';

const workspaces: string[] = [];

describe('I/O interactive judge config and helpers', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('resolves solution, interactor, args, compile args, and transcript limit', async () => {
    const workspaceFolder = await createWorkspace('interactive config');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, 'interactor.cpp');

    const resolved = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      solutionCompileArgs: ['-DSOLUTION_SIDE=1'],
      interactorCompileArgs: ['-DINTERACTOR_SIDE=1'],
      solutionArgs: ['--local'],
      interactorArgs: ['{input}', '{answer}'],
      transcriptLimitBytes: 1024
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.config.solution).toBe(path.join(workspaceFolder.uri.fsPath, 'solution.cpp'));
    expect(resolved.config.interactor).toBe(path.join(workspaceFolder.uri.fsPath, 'interactor.cpp'));
    expect(resolved.config.solutionCompileArgs).toEqual(['-DSOLUTION_SIDE=1']);
    expect(resolved.config.interactorCompileArgs).toEqual(['-DINTERACTOR_SIDE=1']);
    expect(resolved.config.solutionArgs).toEqual(['--local']);
    expect(resolved.config.interactorArgs).toEqual(['{input}', '{answer}']);
    expect(resolved.config.transcriptLimitBytes).toBe(1024);
    expect(resolved.config.report).toMatchObject({
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      transcriptLimitBytes: 1024
    });
  });

  it('reports missing solution and interactor files clearly', async () => {
    const workspaceFolder = await createWorkspace('interactive missing');
    await writeFile(workspaceFolder, 'solution.cpp');

    expect(await resolveInteractiveConfig(workspaceFolder, undefined)).toMatchObject({
      ok: false,
      message: expect.stringContaining('interactive.solution')
    });
    expect(await resolveInteractiveConfig(workspaceFolder, { interactor: 'interactor.cpp' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('interactive.solution')
    });
    expect(await resolveInteractiveConfig(workspaceFolder, { solution: 'solution.cpp' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('interactive.interactor')
    });
    expect(await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'missing interactor.cpp'
    })).toMatchObject({
      ok: false,
      message: expect.stringContaining('interactor')
    });
  });

  it('builds argv without shell quoting and replaces testcase placeholders', () => {
    const inputPath = path.join('C:', 'workspace with spaces', 'samples', '1.in');
    const answerPath = path.join('C:', 'workspace with spaces', 'samples', '1.out');
    const outputPath = path.join('C:', 'workspace with spaces', 'outputs', 'interactor output.txt');

    expect(buildInteractiveArgs(['--input', '{input}', '--answer', '{answer}', '--output', '{output}'], inputPath, answerPath, outputPath)).toEqual([
      '--input',
      inputPath,
      '--answer',
      answerPath,
      '--output',
      outputPath
    ]);
    expect(buildInteractiveArgs(['{input}', '{answer}'], inputPath)).toEqual([inputPath]);
    expect(buildInteractiveArgs(['${input}', '${output}', '${answer}'], inputPath, answerPath, outputPath)).toEqual([
      inputPath,
      outputPath,
      answerPath
    ]);
  });

  it('chooses interactor args from preset while keeping explicit args first', () => {
    expect(resolveInteractorArgs(undefined, 'simple')).toEqual(['{input}', '{answer}']);
    expect(resolveInteractorArgs(undefined, 'testlib')).toEqual(['{input}', '{output}', '{answer}']);
    expect(resolveInteractorArgs(undefined, 'custom')).toEqual([]);
    expect(resolveInteractorArgs(['--case', '{input}'], 'testlib')).toEqual(['--case', '{input}']);
  });

  it('builds compile argv with role-specific compile args and paths with spaces', async () => {
    const workspaceFolder = await createWorkspace('interactive compile args spaces');
    const sourcePath = path.join(workspaceFolder.uri.fsPath, 'solution with space.cpp');
    const executablePath = path.join(workspaceFolder.uri.fsPath, 'interactive solution.exe');
    const { args } = buildInteractiveCompileArgs(workspaceFolder, config(), sourcePath, executablePath, [
      '-DROLE=solution',
      '-I',
      '${workspaceFolder}'
    ]);

    expect(args).toEqual(expect.arrayContaining([
      sourcePath,
      executablePath,
      '-DROLE=solution',
      '-I',
      workspaceFolder.uri.fsPath
    ]));
    expect(args.indexOf('-DROLE=solution')).toBeGreaterThan(args.indexOf(sourcePath));
  });

  it('uses testlib preset defaults and records them in report metadata', async () => {
    const workspaceFolder = await createWorkspace('interactive testlib preset');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, 'interactor.cpp');

    const resolved = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      interactorPreset: 'testlib'
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.config.interactorArgs).toEqual(['{input}', '{output}', '{answer}']);
    expect(resolved.config.report).toMatchObject({
      interactorPreset: 'testlib',
      interactorArgs: ['{input}', '{output}', '{answer}']
    });
  });

  it('keeps simple preset compatible with the previous default args', async () => {
    const workspaceFolder = await createWorkspace('interactive simple preset');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, 'interactor.cpp');

    const resolved = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      interactorPreset: 'simple'
    });

    expect(resolved.ok && resolved.config.interactorArgs).toEqual(['{input}', '{answer}']);
  });

  it('prepares per-sample output paths and an empty answer file when needed', async () => {
    const workspaceFolder = await createWorkspace('interactive runtime files');
    const runDir = path.join(workspaceFolder.uri.fsPath, 'run dir with spaces');

    const first = await prepareInteractiveRuntimeFiles(runDir, 1, undefined, ['{input}', '{output}', '{answer}']);
    expect(await fs.readFile(first.answerPath!, 'utf8')).toBe('');
    const second = await prepareInteractiveRuntimeFiles(path.join(workspaceFolder.uri.fsPath, 'run dir two'), 2, path.join(workspaceFolder.uri.fsPath, 'answer.out'), ['{input}', '{output}', '{answer}']);

    expect(first.outputPath).not.toBe(second.outputPath);
    expect(first.outputPath.startsWith(runDir)).toBe(true);
    expect(first.emptyAnswerFile).toBe(true);
    expect(first.answerPath).toBeTruthy();
    expect(second.emptyAnswerFile).toBe(false);
    expect(second.answerPath).toContain('answer.out');

    await fs.rm(first.tempDir, { recursive: true, force: true });
    await fs.rm(second.tempDir, { recursive: true, force: true });
  });

  it('does not check testlib.h when useTestlib is false', async () => {
    const workspaceFolder = await createWorkspace('interactive testlib disabled');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, 'interactor.cpp');

    const resolved = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      interactorPreset: 'testlib',
      useTestlib: false,
      testlibHeader: 'missing/testlib.h'
    });

    expect(resolved.ok).toBe(true);
  });

  it('adds include dirs when testlib.h exists and reports a clear error when missing', async () => {
    const workspaceFolder = await createWorkspace('interactive testlib include');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, 'interactor.cpp');
    await writeFile(workspaceFolder, path.join('third party', 'testlib.h'));

    const resolved = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      useTestlib: true,
      testlibHeader: path.join('third party', 'testlib.h'),
      testlibIncludeDirs: ['include dir with spaces']
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    const headerDir = path.join(workspaceFolder.uri.fsPath, 'third party');
    const explicitDir = path.join(workspaceFolder.uri.fsPath, 'include dir with spaces');
    expect(resolved.config.interactorIncludeArgs).toEqual(expect.arrayContaining(['-I', headerDir, explicitDir]));
    expect(buildIncludeArgs([explicitDir])).toEqual(['-I', explicitDir]);

    const missing = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp',
      useTestlib: true,
      testlibHeader: 'missing-testlib.h'
    });
    expect(missing).toMatchObject({
      ok: false,
      message: expect.stringContaining('useTestlib is enabled, but testlib.h was not found')
    });
  });

  it('maps interactor exit codes to interactive verdicts', () => {
    expect(mapInteractorExitCode(0)).toEqual({ status: 'AC', message: 'Accepted by interactor.' });
    expect(mapInteractorExitCode(1).status).toBe('WA');
    expect(mapInteractorExitCode(2).status).toBe('PE');
    expect(mapInteractorExitCode(3).status).toBe('Interactor Error');
    expect(mapInteractorExitCode(null).status).toBe('Interactor Error');
  });

  it('caps transcript text and marks truncation', () => {
    const transcript = { text: '', bytes: 0, truncated: false };
    appendTranscriptChunk(transcript, 'solution -> interactor', Buffer.from('1234567890'), 20);
    appendTranscriptChunk(transcript, 'interactor -> solution', Buffer.from('abcdef'), 20);

    expect(transcript.truncated).toBe(true);
    expect(Buffer.byteLength(transcript.text)).toBeLessThanOrEqual(20);
  });

  it('keeps normal and function-style configs out of interactive dispatch', () => {
    expect(isInteractiveMode({ mode: 'interactive' })).toBe(true);
    expect(isInteractiveMode({ mode: 'function' })).toBe(false);
    expect(isInteractiveMode({ mode: 'standard' })).toBe(false);
    expect(isInteractiveMode({})).toBe(false);
  });

  it('uses a bounded default transcript limit', async () => {
    const workspaceFolder = await createWorkspace('interactive transcript default');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, 'interactor.cpp');
    const resolved = await resolveInteractiveConfig(workspaceFolder, {
      solution: 'solution.cpp',
      interactor: 'interactor.cpp'
    });

    expect(resolved.ok && resolved.config.transcriptLimitBytes).toBe(DEFAULT_INTERACTIVE_TRANSCRIPT_LIMIT_BYTES);
  });
});

async function createWorkspace(prefix: string): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix.replace(/\s+/gu, '-')}-`));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir, scheme: 'file' },
    name: path.basename(dir),
    index: 0
  } as vscode.WorkspaceFolder;
}

async function writeFile(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): Promise<void> {
  const filePath = path.join(workspaceFolder.uri.fsPath, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '', 'utf8');
}

function config(): OITestConfig {
  return {
    version: 1,
    mode: 'interactive',
    compiler: {
      command: 'g++',
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    },
    limits: { timeMs: 1000, memoryMb: 256 },
    samples: []
  };
}
