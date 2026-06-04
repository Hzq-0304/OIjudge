import * as path from 'path';

export function getCompilerDir(compilerPath: string | undefined): string | undefined {
  return compilerPath && path.isAbsolute(compilerPath) ? path.dirname(compilerPath) : undefined;
}

export function withCompilerPathEnv(
  compilerPath: string | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const compilerDir = getCompilerDir(compilerPath);
  if (!compilerDir) {
    return baseEnv;
  }

  const pathKey = getPathKey(baseEnv);
  return {
    ...baseEnv,
    [pathKey]: [compilerDir, baseEnv[pathKey]].filter(Boolean).join(path.delimiter)
  };
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
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

function normalizePathForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
