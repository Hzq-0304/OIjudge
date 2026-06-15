import * as path from 'path';

export function getCompilerDir(compilerPath: string | undefined): string | undefined {
  const normalized = normalizeCompilerCommand(compilerPath);
  return normalized && path.isAbsolute(normalized) ? path.dirname(normalized) : undefined;
}

export function withCompilerPathEnv(
  compilerPath: string | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const compilerDir = getCompilerDir(compilerPath);
  if (!compilerDir) {
    return env;
  }

  const pathKey = getPathKey(env);
  if (envPathIncludesDir(env, compilerDir)) {
    return env;
  }

  env[pathKey] = [compilerDir, env[pathKey]].filter(Boolean).join(path.delimiter);
  return env;
}

export function envPathIncludesDir(
  env: NodeJS.ProcessEnv,
  directory: string | undefined
): boolean {
  if (!directory) {
    return false;
  }

  const pathKey = getPathKey(env);
  const target = normalizePathForCompare(directory);
  return (env[pathKey] ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => normalizePathForCompare(entry) === target);
}

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? (process.platform === 'win32' ? 'Path' : 'PATH');
}

function normalizeCompilerCommand(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizePathForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
