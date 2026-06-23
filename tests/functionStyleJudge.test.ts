import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFunctionStyleCompileArgs,
  isFunctionStyleMode,
  resolveFunctionStyleConfig
} from '../src/functionStyleJudge';
import { OITestConfig } from '../src/types';

const workspaces: string[] = [];

describe('function-style judge config and compile args', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('resolves grader, solution, extra sources, headers, and compile args', async () => {
    const workspaceFolder = await createWorkspace('function style config');
    await writeFile(workspaceFolder, 'grader.cpp');
    await writeFile(workspaceFolder, 'solution.cpp');
    await writeFile(workspaceFolder, path.join('helpers', 'math helper.cpp'));
    await writeFile(workspaceFolder, 'grader.h');

    const resolved = await resolveFunctionStyleConfig(workspaceFolder, {
      grader: 'grader.cpp',
      solution: 'solution.cpp',
      sources: [path.join('helpers', 'math helper.cpp')],
      headers: ['grader.h'],
      compileArgs: ['-DFUNCTION_STYLE=1']
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.config.grader).toBe(path.join(workspaceFolder.uri.fsPath, 'grader.cpp'));
    expect(resolved.config.solution).toBe(path.join(workspaceFolder.uri.fsPath, 'solution.cpp'));
    expect(resolved.config.sources).toEqual([path.join(workspaceFolder.uri.fsPath, 'helpers', 'math helper.cpp')]);
    expect(resolved.config.headers).toEqual([path.join(workspaceFolder.uri.fsPath, 'grader.h')]);
    expect(resolved.config.compileArgs).toEqual(['-DFUNCTION_STYLE=1']);
    expect(resolved.config.report).toMatchObject({
      grader: 'grader.cpp',
      solution: 'solution.cpp',
      compileArgs: ['-DFUNCTION_STYLE=1']
    });
  });

  it('reports missing grader, solution, and extra source files clearly', async () => {
    const workspaceFolder = await createWorkspace('function style missing');
    await writeFile(workspaceFolder, 'grader.cpp');
    await writeFile(workspaceFolder, 'solution.cpp');

    expect(await resolveFunctionStyleConfig(workspaceFolder, undefined)).toMatchObject({
      ok: false,
      message: expect.stringContaining('functionStyle.grader')
    });
    expect(await resolveFunctionStyleConfig(workspaceFolder, { solution: 'solution.cpp' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('functionStyle.grader')
    });
    expect(await resolveFunctionStyleConfig(workspaceFolder, { grader: 'grader.cpp' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('functionStyle.solution')
    });
    expect(await resolveFunctionStyleConfig(workspaceFolder, {
      grader: 'grader.cpp',
      solution: 'solution.cpp',
      sources: ['missing helper.cpp']
    })).toMatchObject({
      ok: false,
      message: expect.stringContaining('extra source')
    });
  });

  it('builds argv with grader, solution, paths with spaces, extra sources, and compileArgs', async () => {
    const workspaceFolder = await createWorkspace('function style argv spaces');
    const resolved = {
      grader: path.join(workspaceFolder.uri.fsPath, 'grader with space.cpp'),
      solution: path.join(workspaceFolder.uri.fsPath, 'solution with space.cpp'),
      sources: [path.join(workspaceFolder.uri.fsPath, 'helper with space.cpp')],
      headers: [],
      compileArgs: ['-DLOCAL_TEST=1'],
      report: {
        grader: 'grader with space.cpp',
        solution: 'solution with space.cpp',
        sources: ['helper with space.cpp'],
        compileArgs: ['-DLOCAL_TEST=1']
      }
    };
    const { args } = buildFunctionStyleCompileArgs(workspaceFolder, config(), resolved, path.join(workspaceFolder.uri.fsPath, 'function judge.exe'));

    expect(args).toEqual(expect.arrayContaining([
      resolved.grader,
      resolved.solution,
      resolved.sources[0],
      '-DLOCAL_TEST=1'
    ]));
    expect(args.indexOf(resolved.solution)).toBeGreaterThan(args.indexOf(resolved.grader));
    expect(args.indexOf(resolved.sources[0])).toBeGreaterThan(args.indexOf(resolved.solution));
    expect(args).toContain(path.join(workspaceFolder.uri.fsPath, 'function judge.exe'));
  });

  it('keeps normal judge configs out of function-style dispatch', () => {
    expect(isFunctionStyleMode({ mode: 'function' })).toBe(true);
    expect(isFunctionStyleMode({ mode: 'standard' })).toBe(false);
    expect(isFunctionStyleMode({})).toBe(false);
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
    mode: 'function',
    compiler: {
      command: 'g++',
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    },
    limits: { timeMs: 1000, memoryMb: 256 },
    samples: []
  };
}
