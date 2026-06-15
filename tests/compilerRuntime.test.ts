import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCompileArgs, compileSource } from '../src/compiler';
import { findCompiler } from '../src/compilerDetection';
import { envPathIncludesDir, getCompilerDir, withCompilerPathEnv } from '../src/compilerRuntime';
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

  it('handles quoted compiler commands without mutating the base environment', () => {
    const compilerPath = path.join(os.tmpdir(), 'quoted compiler', 'mingw64', 'bin', 'g++.exe');
    const compilerDir = path.dirname(compilerPath);
    const baseEnv = { Path: 'C:\\Windows\\System32' };
    const env = withCompilerPathEnv(`"${compilerPath}"`, baseEnv);

    expect(getCompilerDir(`"${compilerPath}"`)).toBe(compilerDir);
    expect(env).not.toBe(baseEnv);
    expect(baseEnv.Path).toBe('C:\\Windows\\System32');
    expect(env.Path).toBe(`${compilerDir}${path.delimiter}C:\\Windows\\System32`);
  });

  it('preserves the existing PATH key casing', () => {
    const compilerPath = path.join(os.tmpdir(), 'compiler', 'bin', 'g++.exe');
    const compilerDir = path.dirname(compilerPath);
    const env = withCompilerPathEnv(compilerPath, { PATH: '/usr/bin' });

    expect(env.PATH).toBe(`${compilerDir}${path.delimiter}/usr/bin`);
    expect(env.Path).toBeUndefined();
  });

  it('creates a platform default PATH key when the environment has none', () => {
    const compilerPath = path.join(os.tmpdir(), 'compiler', 'bin', 'g++.exe');
    const compilerDir = path.dirname(compilerPath);
    const env = withCompilerPathEnv(compilerPath, {});
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';

    expect(env[pathKey]).toBe(compilerDir);
  });

  it('does not duplicate a compiler directory that is already in PATH', () => {
    const compilerPath = path.join(os.tmpdir(), 'compiler', 'bin', 'g++.exe');
    const compilerDir = path.dirname(compilerPath);
    const env = withCompilerPathEnv(compilerPath, { Path: `${compilerDir}${path.delimiter}C:\\Windows\\System32` });

    expect(env.Path?.split(path.delimiter).filter((entry) => entry === compilerDir)).toHaveLength(1);
  });

  it('uses semicolons and de-duplicates Windows PATH entries case-insensitively', () => {
    const compilerPath = 'C:\\Program Files\\RedPanda-Cpp\\mingw64\\bin\\g++.exe';
    const compilerDir = 'C:\\Program Files\\RedPanda-Cpp\\mingw64\\bin';
    const existingDir = compilerDir.toUpperCase();
    const env = withCompilerPathEnv(compilerPath, { Path: `${existingDir};C:\\Windows\\System32` }, { platform: 'win32' });

    expect(env.Path).toBe(`${existingDir};C:\\Windows\\System32`);
    const entries = env.Path?.split(';').filter(Boolean) ?? [];
    expect(entries.filter((entry) => entry.toLowerCase() === compilerDir.toLowerCase())).toHaveLength(1);
  });

  it.each(['Path', 'PATH', 'path'] as const)('preserves existing Windows PATH key casing for %s', (pathKey) => {
    const compilerPath = 'C:\\Tools\\mingw64\\bin\\g++.exe';
    const compilerDir = 'C:\\Tools\\mingw64\\bin';
    const env = withCompilerPathEnv(compilerPath, { [pathKey]: 'C:\\Windows\\System32' }, { platform: 'win32' });

    expect(env[pathKey]).toBe(`${compilerDir};C:\\Windows\\System32`);
  });

  it('uses colons for POSIX PATH entries and compares them case-sensitively', () => {
    const compilerPath = '/opt/ToolChain/bin/g++';
    const compilerDir = '/opt/ToolChain/bin';
    const env = withCompilerPathEnv(compilerPath, { PATH: '/opt/toolchain/bin:/usr/bin' }, { platform: 'linux' });

    expect(env.PATH).toBe(`${compilerDir}:/opt/toolchain/bin:/usr/bin`);
    expect(envPathIncludesDir(env, compilerDir, { platform: 'linux' })).toBe(true);
    expect(envPathIncludesDir(env, '/opt/toolchain/bin', { platform: 'linux' })).toBe(true);
    expect(envPathIncludesDir({ PATH: compilerDir }, '/opt/toolchain/bin', { platform: 'linux' })).toBe(false);
  });

  it('leaves PATH unchanged for unresolved command names', () => {
    const baseEnv = { Path: 'C:\\Windows\\System32' };
    const env = withCompilerPathEnv('g++', baseEnv);

    expect(env).not.toBe(baseEnv);
    expect(env).toEqual(baseEnv);
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

  it('uses the compiler bin only in the child process environment during compile', async () => {
    const redPandaGpp = 'C:\\Program Files\\RedPanda-Cpp\\mingw64\\bin\\g++.exe';
    if (process.platform !== 'win32' || !(await exists(redPandaGpp))) {
      return;
    }

    const workspaceFolder = await createWorkspace();
    const sourcePath = path.join(workspaceFolder.uri.fsPath, 'main.cpp');
    await fs.writeFile(sourcePath, 'int main(){return 0;}\n', 'utf8');
    const originalPath = process.env.Path;
    const originalPATH = process.env.PATH;
    const redPandaBin = path.dirname(redPandaGpp);
    const stripRedPanda = (value: string | undefined) =>
      value
        ?.split(path.delimiter)
        .filter((entry) => path.normalize(entry).toLowerCase() !== path.normalize(redPandaBin).toLowerCase())
        .join(path.delimiter);

    try {
      process.env.Path = stripRedPanda(process.env.Path);
      process.env.PATH = stripRedPanda(process.env.PATH);
      const output = createOutputChannel();
      const result = await compileSource(workspaceFolder, sourcePath, config(redPandaGpp), output);

      expect(result?.status).toBe('OK');
      expect(result?.executablePath ? await exists(result.executablePath) : false).toBe(true);
      expect(envPathIncludesDir(process.env, redPandaBin)).toBe(false);
    } finally {
      restoreEnvKey('Path', originalPath);
      restoreEnvKey('PATH', originalPATH);
    }
  }, 120_000);
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createOutputChannel(): vscode.OutputChannel {
  return {
    appendLine: () => undefined,
    clear: () => undefined,
    show: () => undefined
  } as unknown as vscode.OutputChannel;
}

function restoreEnvKey(key: 'Path' | 'PATH', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
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
