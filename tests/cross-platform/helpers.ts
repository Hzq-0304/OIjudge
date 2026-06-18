import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { OITestConfig } from '../../src/types';

export const CROSS_PLATFORM_OUTPUT_DIR = path.join(process.cwd(), '.tmp', 'oijudge-cross-platform');

export type CompilerInfo = {
  command: string;
  version: string;
};

export function workspace(fsPath: string): vscode.WorkspaceFolder {
  return {
    uri: { fsPath, scheme: 'file' },
    name: path.basename(fsPath),
    index: 0
  } as vscode.WorkspaceFolder;
}

export function output(): vscode.OutputChannel {
  return {
    clear: () => undefined,
    show: () => undefined,
    appendLine: () => undefined
  } as unknown as vscode.OutputChannel;
}

export async function createCrossPlatformWorkspace(name: string): Promise<vscode.WorkspaceFolder> {
  const dir = path.join(CROSS_PLATFORM_OUTPUT_DIR, 'workspaces', name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  return workspace(dir);
}

export async function writeText(filePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export function compilerConfig(compiler: CompilerInfo): Pick<OITestConfig, 'compiler' | 'compile'> {
  return {
    compiler: {
      command: compiler.command,
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    },
    compile: {
      command: compiler.command,
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    }
  };
}

export async function findCppCompiler(): Promise<CompilerInfo | undefined> {
  for (const command of ['g++', 'clang++']) {
    const version = await readCommandVersion(command);
    if (version) {
      return { command, version };
    }
  }
  return undefined;
}

export async function writeJsonArtifact(name: string, data: unknown): Promise<string> {
  const filePath = path.join(CROSS_PLATFORM_OUTPUT_DIR, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function copyArtifact(sourcePath: string, artifactRelativePath: string): Promise<string> {
  const targetPath = path.join(CROSS_PLATFORM_OUTPUT_DIR, artifactRelativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
}

async function readCommandVersion(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8').split(/\r?\n/u)[0]?.trim() || command);
    });
  });
}
