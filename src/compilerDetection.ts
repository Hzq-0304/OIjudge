import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { getConfigPath, resolveWorkspacePath, setCompilerCommand, writeConfig } from './config';
import { t } from './i18n';
import { OITestConfig } from './types';

type CompilerCandidate = {
  command: string;
  source: string;
};

type CppProperties = {
  configurations?: Array<{
    name?: string;
    compilerPath?: string;
  }>;
};

export async function ensureCompilerConfigured(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig
): Promise<OITestConfig | undefined> {
  const candidate = await findCompiler(workspaceFolder, config);
  if (candidate) {
    await saveCompiler(workspaceFolder, config, candidate.command);
    return config;
  }

  const selected = await askUserForCompiler();
  if (!selected) {
    vscode.window.showWarningMessage(t('compilerMissing'));
    vscode.window.showWarningMessage(t('compilerNeeded'));
    return undefined;
  }

  await saveCompiler(workspaceFolder, config, selected);
  vscode.window.showInformationMessage(t('compilerSaved'));
  return config;
}

export async function selectCompiler(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig
): Promise<OITestConfig | undefined> {
  const selected = await askUserForCompiler();
  if (!selected) {
    return undefined;
  }

  await saveCompiler(workspaceFolder, config, selected);
  vscode.window.showInformationMessage(t('compilerSaved'));
  return config;
}

export async function pickCompilerPath(): Promise<string | undefined> {
  return askUserForCompiler();
}

export async function findCompiler(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig
): Promise<CompilerCandidate | undefined> {
  const candidates: CompilerCandidate[] = [
    ...(await readCppPropertiesCandidates(workspaceFolder)),
    ...readCppSettingCandidates(workspaceFolder),
    ...readOIJudgerConfigCandidates(config),
    ...(await readPathCandidates()),
    ...(await readWindowsMingwCandidates())
  ];

  for (const candidate of candidates) {
    const command = normalizeCommand(candidate.command);
    if (!command) {
      continue;
    }

    const resolved = await resolveCompilerCommand(command);
    if (resolved) {
      return {
        command: resolved,
        source: candidate.source
      };
    }
  }

  return undefined;
}

async function saveCompiler(
  workspaceFolder: vscode.WorkspaceFolder,
  config: OITestConfig,
  command: string
): Promise<void> {
  setCompilerCommand(config, command);
  await writeConfig(workspaceFolder, config);
}

async function readCppPropertiesCandidates(workspaceFolder: vscode.WorkspaceFolder): Promise<CompilerCandidate[]> {
  const filePath = resolveWorkspacePath(workspaceFolder, path.join('.vscode', 'c_cpp_properties.json'));
  if (!(await exists(filePath))) {
    return [];
  }

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(stripJson(raw)) as CppProperties;
    const configurations = sortCppConfigurationsByCurrentSetting(
      parsed.configurations ?? [],
      readCurrentCppConfigurationName(workspaceFolder)
    );
    return configurations
      .map((configuration) => configuration.compilerPath)
      .filter((compilerPath): compilerPath is string => Boolean(compilerPath?.trim()))
      .map((compilerPath, index) => ({
        command: compilerPath,
        source: index === 0 ? '.vscode/c_cpp_properties.json current configuration' : '.vscode/c_cpp_properties.json'
      }));
  } catch {
    return [];
  }
}

function readCurrentCppConfigurationName(workspaceFolder: vscode.WorkspaceFolder): string | undefined {
  const configuration = vscode.workspace.getConfiguration('C_Cpp', workspaceFolder.uri);
  return configuration.get<string>('default.configuration');
}

function sortCppConfigurationsByCurrentSetting(
  configurations: NonNullable<CppProperties['configurations']>,
  currentName: string | undefined
): NonNullable<CppProperties['configurations']> {
  if (!currentName) {
    return configurations;
  }

  return [...configurations].sort((left, right) => {
    if (left.name === currentName) {
      return -1;
    }
    if (right.name === currentName) {
      return 1;
    }
    return 0;
  });
}

function readCppSettingCandidates(workspaceFolder: vscode.WorkspaceFolder): CompilerCandidate[] {
  const configuration = vscode.workspace.getConfiguration('C_Cpp', workspaceFolder.uri);
  const inspected = configuration.inspect<string>('default.compilerPath');
  const candidates: CompilerCandidate[] = [];

  if (inspected?.workspaceFolderValue) {
    candidates.push({
      command: inspected.workspaceFolderValue,
      source: 'workspace folder setting C_Cpp.default.compilerPath'
    });
  }

  if (inspected?.workspaceValue) {
    candidates.push({
      command: inspected.workspaceValue,
      source: 'workspace setting C_Cpp.default.compilerPath'
    });
  }

  if (inspected?.globalValue) {
    candidates.push({
      command: inspected.globalValue,
      source: 'user setting C_Cpp.default.compilerPath'
    });
  }

  return candidates;
}

function readOIJudgerConfigCandidates(config: OITestConfig): CompilerCandidate[] {
  const commands = [config.compile?.command, config.compiler.command].filter(
    (command): command is string => Boolean(command?.trim())
  );
  return commands.map((command) => ({
    command,
    source: '.oitest/config.json'
  }));
}

async function readPathCandidates(): Promise<CompilerCandidate[]> {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = await exec(command, ['g++']);
  if (!result) {
    return [];
  }

  return result
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((compilerPath) => ({
      command: compilerPath,
      source: process.platform === 'win32' ? 'where g++' : 'which g++'
    }));
}

async function readWindowsMingwCandidates(): Promise<CompilerCandidate[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  return [
    'C:\\msys64\\ucrt64\\bin\\g++.exe',
    'C:\\msys64\\mingw64\\bin\\g++.exe',
    'C:\\mingw64\\bin\\g++.exe',
    'C:\\MinGW\\bin\\g++.exe'
  ].map((command) => ({
    command,
    source: 'common MinGW path'
  }));
}

async function askUserForCompiler(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: t('selectCompilerTitle'),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: t('selectCompilerOpenLabel'),
    filters: process.platform === 'win32' ? { 'C++ Compiler': ['exe'] } : undefined
  });

  return uris?.[0]?.fsPath;
}

async function resolveCompilerCommand(command: string): Promise<string | undefined> {
  if (path.isAbsolute(command)) {
    return (await exists(command)) ? command : undefined;
  }

  const resolved = await findCommandInPath(command);
  return resolved ?? undefined;
}

async function findCommandInPath(command: string): Promise<string | undefined> {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = await exec(lookup, [command]);
  return result?.split(/\r?\n/u).find((line) => line.trim())?.trim();
}

function exec(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/^"(.+)"$/u, '$1');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripJson(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
    .replace(/,\s*([}\]])/gu, '$1');
}
