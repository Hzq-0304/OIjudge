import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCompileArgs } from '../src/compiler';
import { findCompiler } from '../src/compilerDetection';
import { envPathIncludesDir, withCompilerPathEnv } from '../src/compilerRuntime';
import { OITestConfig } from '../src/types';

const workspaces: string[] = [];

describe('compiler runtime environment', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('prepends an absolute compiler directory to child process PATH', () => {
    const compilerPath = path.join(os.tmpdir(), 'compiler with spaces', 'mingw64', 'bin', 'g++.exe');
    const compilerDir = path.dirname(compilerPath);
    const env = withCompilerPathEnv(compilerPath, { Path: 'C:\\Windows\\System32' });

    expect(env.Path?.startsWith(`${compilerDir}${path.delimiter}`)).toBe(true);
    expect(envPathIncludesDir(env, compilerDir)).toBe(true);
  });

  it('leaves PATH unchanged for unresolved command names', () => {
    const baseEnv = { Path: 'C:\\Windows\\System32' };

    expect(withCompilerPathEnv('g++', baseEnv)).toBe(baseEnv);
  });

  it('falls back to .vscode/settings.json C_Cpp.default.compilerPath when project compiler is unavailable', async () => {
    const workspaceFolder = await createWorkspace();
    const compilerPath = path.join(workspaceFolder.uri.fsPath, 'RedPanda Cpp', 'mingw64', 'bin', 'g++.exe');
    await fs.mkdir(path.dirname(compilerPath), { recursive: true });
    await fs.writeFile(compilerPath, '', 'utf8');
    await fs.mkdir(path.join(workspaceFolder.uri.fsPath, '.vscode'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceFolder.uri.fsPath, '.vscode', 'settings.json'),
      JSON.stringify({ 'C_Cpp.default.compilerPath': compilerPath }, null, 2),
      'utf8'
    );

    const compiler = await findCompiler(workspaceFolder, config('oijudge-missing-g++'));

    expect(compiler).toEqual({
      command: compilerPath,
      source: '.vscode/settings.json C_Cpp.default.compilerPath'
    });
  });
});

describe('compile argument generation', () => {
  it('keeps gcc-like compiler arguments unchanged', async () => {
    const workspaceFolder = await createWorkspace();
    const sourcePath = path.join(workspaceFolder.uri.fsPath, 'main.cpp');
    const outputPath = path.join(workspaceFolder.uri.fsPath, 'main.exe');

    const { args, stack } = buildCompileArgs(workspaceFolder, config('g++', { autoStack: false }), sourcePath, outputPath);

    expect(stack.compilerFamily).toBe('gcc');
    expect(args).toEqual([
      sourcePath,
      '-std=c++17',
      '-O2',
      '-o',
      outputPath
    ]);
  });

  it('uses MSVC arguments for cl.exe', async () => {
    const workspaceFolder = await createWorkspace();
    const sourcePath = path.join(workspaceFolder.uri.fsPath, 'main.cpp');
    const outputPath = path.join(workspaceFolder.uri.fsPath, 'main.exe');

    const { args, stack } = buildCompileArgs(workspaceFolder, config('cl.exe', { autoStack: false }), sourcePath, outputPath);

    expect(stack.compilerFamily).toBe('msvc');
    expect(args).toEqual([
      '/std:c++17',
      '/EHsc',
      '/O2',
      sourcePath,
      `/Fe:${outputPath}`
    ]);
  });

  it('uses MSVC arguments for clang-cl.exe', async () => {
    const workspaceFolder = await createWorkspace();
    const sourcePath = path.join(workspaceFolder.uri.fsPath, 'main.cpp');
    const outputPath = path.join(workspaceFolder.uri.fsPath, 'main.exe');

    const { args, stack } = buildCompileArgs(workspaceFolder, config('clang-cl.exe', { autoStack: false }), sourcePath, outputPath);

    expect(stack.compilerFamily).toBe('msvc');
    expect(args).toContain('/EHsc');
    expect(args).toContain(`/Fe:${outputPath}`);
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-compiler-'));
  workspaces.push(dir);
  return {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
}

function config(command: string, options?: { autoStack?: boolean }): OITestConfig {
  return {
    version: 1,
    compiler: {
      command,
      args: ['${file}', '-std=c++17', '-O2', '-o', '${output}']
    },
    compile: {
      command,
      args: ['${file}', '-std=c++17', '-O2', '-o', '${output}']
    },
    limits: {
      timeMs: 1000,
      memoryMb: 256
    },
    stack: {
      auto: options?.autoStack ?? true
    },
    samples: []
  };
}
