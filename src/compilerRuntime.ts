import * as path from 'path';

type RuntimePlatform = 'win32' | 'linux' | 'darwin' | NodeJS.Platform;

type PathEnvOptions = {
  platform?: RuntimePlatform;
  delimiter?: string;
};

export function getCompilerDir(compilerPath: string | undefined, options: PathEnvOptions = {}): string | undefined {
  const normalized = normalizeCompilerCommand(compilerPath);
  if (!normalized) {
    return undefined;
  }
  const pathApi = getPathApi(options.platform);
  return pathApi.isAbsolute(normalized) ? pathApi.dirname(normalized) : undefined;
}

export function withCompilerPathEnv(
  compilerPath: string | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: PathEnvOptions = {}
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const compilerDir = getCompilerDir(compilerPath, options);
  if (!compilerDir) {
    return env;
  }

  const pathKey = getPathKey(env, options.platform);
  if (envPathIncludesDir(env, compilerDir, options)) {
    return env;
  }

  env[pathKey] = [compilerDir, env[pathKey]].filter(Boolean).join(getPathDelimiter(options));
  return env;
}

export function envPathIncludesDir(
  env: NodeJS.ProcessEnv,
  directory: string | undefined,
  options: PathEnvOptions = {}
): boolean {
  if (!directory) {
    return false;
  }

  const pathKey = getPathKey(env, options.platform);
  const target = normalizePathForCompare(directory, options.platform);
  return (env[pathKey] ?? '')
    .split(getPathDelimiter(options))
    .filter(Boolean)
    .some((entry) => normalizePathForCompare(entry, options.platform) === target);
}

function getPathKey(env: NodeJS.ProcessEnv, platform: RuntimePlatform = process.platform): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? (platform === 'win32' ? 'Path' : 'PATH');
}

function getPathDelimiter(options: PathEnvOptions): string {
  return options.delimiter ?? (options.platform === 'win32' ? ';' : options.platform ? ':' : path.delimiter);
}

function getPathApi(platform: RuntimePlatform = process.platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
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

function normalizePathForCompare(value: string, platform: RuntimePlatform = process.platform): string {
  const pathApi = getPathApi(platform);
  const normalized = pathApi.normalize(value);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}
