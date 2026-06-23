import { promises as fs } from 'fs';
import * as path from 'path';

export interface FailedCaseToSave {
  source: 'judge' | 'stress';
  name?: string;
  round?: number;
  input: string;
  expected?: string;
  actual?: string;
}

export interface SaveFailedCaseOptions {
  samplesDir: string;
  overwrite?: boolean;
  saveActual?: boolean;
}

export interface SavedFailedCaseFiles {
  inputPath: string;
  answerPath?: string;
  actualPath?: string;
  warning?: 'expectedMissing';
}

const MAX_SAMPLE_BASE_NAME_LENGTH = 80;
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
]);

export function sanitizeSampleBaseName(name: string): string {
  const normalized = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/\.+$/u, '')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SAMPLE_BASE_NAME_LENGTH)
    .replace(/^-+|-+$/gu, '')
    .replace(/^\.+|\.+$/gu, '');
  const fallback = normalized || 'failed-case';
  return WINDOWS_RESERVED_NAMES.has(fallback.toLowerCase()) ? `${fallback}-case` : fallback;
}

export function buildFailedCaseBaseName(failedCase: FailedCaseToSave): string {
  if (failedCase.source === 'stress' && typeof failedCase.round === 'number' && Number.isFinite(failedCase.round)) {
    return sanitizeSampleBaseName(`stress-${Math.trunc(failedCase.round)}`);
  }
  return sanitizeSampleBaseName(`failed-${failedCase.name || 'case'}`);
}

export async function pickAvailableSampleBaseName(samplesDir: string, baseName: string): Promise<string> {
  const sanitized = sanitizeSampleBaseName(baseName);
  let candidate = sanitized;
  let suffix = 2;
  while (await failedCaseSampleBaseNameExists(samplesDir, candidate)) {
    candidate = `${sanitized}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function failedCaseSampleBaseNameExists(samplesDir: string, baseName: string): Promise<boolean> {
  return sampleFilesExist(samplesDir, sanitizeSampleBaseName(baseName));
}

export async function saveFailedCaseAsSampleFiles(
  failedCase: FailedCaseToSave,
  options: SaveFailedCaseOptions
): Promise<SavedFailedCaseFiles> {
  await fs.mkdir(options.samplesDir, { recursive: true });
  const baseName = options.overwrite
    ? sanitizeSampleBaseName(buildFailedCaseBaseName(failedCase))
    : await pickAvailableSampleBaseName(options.samplesDir, buildFailedCaseBaseName(failedCase));
  const inputPath = path.join(options.samplesDir, `${baseName}.in`);
  const answerPath = failedCase.expected !== undefined ? path.join(options.samplesDir, `${baseName}.ans`) : undefined;
  const actualPath = options.saveActual !== false && failedCase.actual !== undefined
    ? path.join(options.samplesDir, `${baseName}.actual.txt`)
    : undefined;

  await fs.writeFile(inputPath, failedCase.input, 'utf8');
  if (answerPath) {
    await fs.writeFile(answerPath, failedCase.expected ?? '', 'utf8');
  }
  if (actualPath) {
    await fs.writeFile(actualPath, failedCase.actual ?? '', 'utf8');
  }

  return {
    inputPath,
    answerPath,
    actualPath,
    warning: answerPath ? undefined : 'expectedMissing'
  };
}

async function sampleFilesExist(samplesDir: string, baseName: string): Promise<boolean> {
  const paths = [
    path.join(samplesDir, `${baseName}.in`),
    path.join(samplesDir, `${baseName}.ans`),
    path.join(samplesDir, `${baseName}.actual.txt`)
  ];
  return (await Promise.all(paths.map(exists))).some(Boolean);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
