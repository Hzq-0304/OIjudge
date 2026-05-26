import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { OITestConfig, SampleConfig } from './types';

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder;
    }
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Open a workspace folder before using OIjudger.');
  }
  return folder;
}

export function getOITestDir(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, '.oitest');
}

export function getConfigPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'config.json');
}

export function getOutputsDir(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOITestDir(workspaceFolder), 'outputs');
}

export function getReportPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(getOutputsDir(workspaceFolder), 'report.json');
}

export function resolveWorkspacePath(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): string {
  return path.resolve(workspaceFolder.uri.fsPath, relativePath);
}

export async function initProblem(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  await fs.mkdir(path.join(getOITestDir(workspaceFolder), 'samples'), { recursive: true });
  await fs.mkdir(getOutputsDir(workspaceFolder), { recursive: true });
  await fs.mkdir(path.join(getOITestDir(workspaceFolder), 'build'), { recursive: true });

  const configPath = getConfigPath(workspaceFolder);
  if (await exists(configPath)) {
    return readConfig(workspaceFolder);
  }

  const config = createDefaultConfig();
  await writeConfig(workspaceFolder, config);
  return config;
}

export async function ensureConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  if (!(await exists(getConfigPath(workspaceFolder)))) {
    return initProblem(workspaceFolder);
  }
  return readConfig(workspaceFolder);
}

export async function readConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<OITestConfig> {
  const raw = await fs.readFile(getConfigPath(workspaceFolder), 'utf8');
  const config = JSON.parse(raw) as OITestConfig;

  config.samples = config.samples.map((sample, index) => normalizeSample(sample, index + 1));
  return config;
}

export async function writeConfig(workspaceFolder: vscode.WorkspaceFolder, config: OITestConfig): Promise<void> {
  await fs.mkdir(path.dirname(getConfigPath(workspaceFolder)), { recursive: true });
  await fs.writeFile(getConfigPath(workspaceFolder), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function addSample(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  input: string,
  answer: string
): Promise<SampleConfig> {
  const id = nextSampleId(config);
  const sample: SampleConfig = {
    id,
    name: `Sample ${id}`,
    input: toPosixPath(path.join('.oitest', 'samples', `${id}.in`)),
    answer: toPosixPath(path.join('.oitest', 'samples', `${id}.ans`)),
    actualOutput: toPosixPath(path.join('.oitest', 'outputs', `${id}.out`))
  };

  await fs.mkdir(path.join(getOITestDir(workspaceFolder), 'samples'), { recursive: true });
  await fs.writeFile(resolveWorkspacePath(workspaceFolder, sample.input), decodeEscapes(input), 'utf8');
  await fs.writeFile(resolveWorkspacePath(workspaceFolder, sample.answer), decodeEscapes(answer), 'utf8');

  config.samples.push(sample);
  await writeConfig(workspaceFolder, config);
  return sample;
}

export async function setTimeLimit(workspaceFolder: vscode.WorkspaceFolder, timeMs: number): Promise<void> {
  const config = await ensureConfig(workspaceFolder);
  config.limits.timeMs = timeMs;
  await writeConfig(workspaceFolder, config);
}

export async function setMemoryLimit(workspaceFolder: vscode.WorkspaceFolder, memoryMb: number): Promise<void> {
  const config = await ensureConfig(workspaceFolder);
  config.limits.memoryMb = memoryMb;
  await writeConfig(workspaceFolder, config);
}

export async function clearOutputs(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const outputsDir = getOutputsDir(workspaceFolder);
  await fs.rm(outputsDir, { recursive: true, force: true });
  await fs.mkdir(outputsDir, { recursive: true });
}

export function createDefaultConfig(): OITestConfig {
  return {
    version: 1,
    compiler: {
      command: 'g++',
      args: ['-std=c++17', '-O2', '-pipe', '${file}', '-o', '${output}']
    },
    limits: {
      timeMs: 1000,
      memoryMb: 256
    },
    samples: []
  };
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isCppFile(filePath: string): boolean {
  return ['.cpp', '.cc', '.cxx', '.c++'].includes(path.extname(filePath).toLowerCase());
}

export function validatePositiveInteger(value: string): string | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return 'Enter a positive integer.';
  }
  return undefined;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizeSample(sample: SampleConfig, fallbackId: number): SampleConfig {
  const id = sample.id ?? fallbackId;
  const answer = sample.answer ?? sample.expectedOutput ?? toPosixPath(path.join('.oitest', 'samples', `${id}.ans`));
  return {
    ...sample,
    id,
    name: sample.name ?? `Sample ${id}`,
    answer,
    actualOutput: sample.actualOutput ?? toPosixPath(path.join('.oitest', 'outputs', `${id}.out`))
  };
}

function nextSampleId(config: OITestConfig): number {
  return config.samples.reduce((maxId, sample) => Math.max(maxId, sample.id ?? 0), 0) + 1;
}

function decodeEscapes(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}
