import type { KillProcessTreeResult } from './processTree';
import type { RuntimeErrorSummary } from './runtimeErrorExplainer';

export type SampleSourceType = 'managed' | 'external';
export type CheckerType = 'none' | 'testlib' | 'plain';
export type JudgeMode = 'strictText' | 'trimTrailingWhitespace' | 'checker';
export type JudgeRunMode = 'standard' | 'function' | 'interactive';
export type IoMode = 'stdio' | 'fileio';
export type TestlibMode = 'auto' | 'managed' | 'custom';
export type PlainCheckerVerdictPosition = 'firstLine' | 'lastLine';

export type ProblemStatementType = 'markdown' | 'pdf' | 'text' | 'unknown';

export type ProblemStatement = {
  path: string;
  type: ProblemStatementType;
  sourceType?: SampleSourceType;
};

export type ProblemSource = {
  path: string;
  name?: string;
  lastUsedAt?: string;
};

export type SampleConfig = {
  id: string;
  index: number;
  name: string;
  input: string;
  answer: string;
  actualOutput?: string;
  expectedOutput?: string;
  sourceType?: SampleSourceType;
  score?: number;
};

export type SubtaskResultStatus = 'passed' | 'failed' | 'notRun';

export type SubtaskRunResult = {
  status: SubtaskResultStatus;
  passed: number;
  total: number;
  updatedAt: string;
};

export type SubtaskConfig = {
  id: string;
  name: string;
  sampleIds: string[];
  scoringMode?: 'sum' | 'bundle';
  generatorId?: string;
  generatorInput?: string;
  lastResult?: SubtaskRunResult;
};

export type ProblemScoreConfig = {
  total?: number;
};

export type CheckerConfig = {
  enabled: boolean;
  type: CheckerType;
  source?: string;
  exe?: string;
  timeLimitMs?: number;
  testlib?: {
    mode: TestlibMode;
    path?: string | null;
  };
  plain?: PlainCheckerConfig;
};

export type PlainCheckerConfig = {
  protocolVersion?: 1;
  verdictPosition?: PlainCheckerVerdictPosition;
  acceptedToken?: string;
  wrongAnswerToken?: string;
};

export type FileIoConfig = {
  inputFileName: string;
  outputFileName: string;
};

export interface SetterConfig {
  stdProgram?: string;
  autoGenerateOutputFromStd?: boolean;
  dataCases?: SetterDataCaseConfig[];
  generator?: SetterGeneratorConfig;
  generatedAnswers?: Record<string, string>;
}

export interface SetterDataCaseConfig {
  id: string;
  name: string;
  sampleId?: string;
  sampleIndex?: number;
  role?: 'sample' | 'test';
  generator?: {
    enabled?: boolean;
    generatorId?: string;
    args?: string[];
    seed?: string;
  };
}

export interface SetterGeneratorConfig {
  enabled?: boolean;
  generators?: SetterGeneratorItem[];
}

export interface SetterGeneratorItem {
  id: string;
  name: string;
  source?: ProblemSource;
  command?: string;
  args?: string[];
}

export interface ProblemGeneratorInputConfig {
  id: string;
  name: string;
  source?: ProblemSource;
}

export type OITestConfig = {
  version: 1;
  mode?: JudgeRunMode;
  functionStyle?: FunctionStyleConfig;
  interactive?: InteractiveConfig;
  compile?: {
    command: string;
    args: string[];
  };
  compiler: {
    command: string;
    args: string[];
  };
  limits: {
    timeMs: number;
    memoryMb: number;
  };
  stack?: StackConfig;
  judgeMode?: JudgeMode;
  ioMode?: IoMode;
  fileIo?: FileIoConfig;
  checker?: CheckerConfig;
  setter?: SetterConfig;
  samples: SampleConfig[];
};

export type FunctionStyleConfig = {
  grader?: string;
  solution?: string;
  sources?: string[];
  headers?: string[];
  compileArgs?: string[];
};

export type FunctionStyleReport = {
  grader: string;
  solution: string;
  sources?: string[];
  headers?: string[];
  compileArgs?: string[];
};

export type InteractiveConfig = {
  solution?: string;
  interactor?: string;
  solutionCompileArgs?: string[];
  interactorCompileArgs?: string[];
  solutionArgs?: string[];
  interactorArgs?: string[];
  transcriptLimitBytes?: number;
};

export type InteractiveReport = {
  solution: string;
  interactor: string;
  solutionCompileArgs?: string[];
  interactorCompileArgs?: string[];
  solutionArgs?: string[];
  interactorArgs?: string[];
  transcriptLimitBytes?: number;
};

export type StackConfig = {
  auto: boolean;
  sizeMb?: number | null;
};

export type ProblemConfig = OITestConfig & {
  id: string;
  name: string;
  source?: string;
  defaultSource?: string;
  statement?: ProblemStatement;
  sources?: ProblemSource[];
  generatorInputs?: ProblemGeneratorInputConfig[];
  subtasks?: SubtaskConfig[];
  score?: ProblemScoreConfig;
  standard: string;
};

export type ProblemsConfig = {
  version: 1;
  problems: ProblemConfig[];
};

export type ProcessResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  killedByTimeout: boolean;
  hardKillLimitMs?: number;
  outputLimitExceeded?: boolean;
  outputBytes?: number;
  outputLimitBytes?: number;
  memoryBytes?: number;
  memoryKiB?: number;
  stdinError?: string;
  stdoutError?: string;
  stderrError?: string;
  cleanup?: KillProcessTreeResult;
  timeMs: number;
  elapsedMs: number;
};

export type CompileReport = {
  status: 'OK' | 'CE';
  timeMs: number;
  stack?: CompileStackReport;
  mode?: JudgeRunMode;
  functionStyle?: FunctionStyleReport;
  interactive?: InteractiveReport;
  stdout?: string;
  stderr?: string;
  message?: string;
  exitCode?: number | null;
  timedOut?: boolean;
};

export type CompileResult = CompileReport & {
  compilerCommand?: string;
  compilerBin?: string;
  executablePath?: string;
};

export type CompileStackReport = {
  enabled: boolean;
  sizeMb?: number;
  sizeBytes?: number;
  flag?: string;
  compilerFamily?: string;
  unsupported?: boolean;
};

export type SampleStatus = 'AC' | 'WA' | 'PE' | 'TLE' | 'OLE' | 'MLE' | 'RE' | 'CE' | 'ERR' | 'Interactor Error' | 'Checker Error' | 'Scored' | 'Skipped' | 'Missing' | 'Output Missing';

export type InteractiveSampleReport = {
  solutionExitCode?: number | null;
  solutionSignal?: NodeJS.Signals | null;
  interactorExitCode?: number | null;
  interactorSignal?: NodeJS.Signals | null;
  solutionStderr?: string;
  interactorStderr?: string;
  transcript?: string;
  transcriptTruncated?: boolean;
  diagnostics?: string[];
};

export type CheckerSampleReport = {
  enabled: boolean;
  type: CheckerType;
  source?: string;
  exe?: string;
  testlibPath?: string;
  exitCode?: number | null;
  exitCodeHex?: string;
  signal?: NodeJS.Signals | null;
  timeMs?: number;
  output?: string;
  stdout?: string;
  stderr?: string;
  finalLine?: string;
  verdictLine?: string;
  verdictPosition?: PlainCheckerVerdictPosition;
  acceptedToken?: string;
  wrongAnswerToken?: string;
  verdict?: 'AC' | 'WA' | 'Score' | 'Invalid' | 'CheckerError';
  errorKind?: RuntimeErrorSummary['kind'] | 'CheckerError';
  errorName?: string;
  score?: number;
  scoreText?: string;
  message?: string;
};

export type SampleReport = {
  id: string;
  index: number;
  name: string;
  status: SampleStatus;
  timeMs: number;
  compareTimeMs?: number;
  elapsedMs: number;
  input: string;
  answer: string;
  actualOutput: string;
  output?: string;
  stderr?: string;
  runResult?: string;
  diff?: string;
  sampleSourceType?: SampleSourceType;
  ioMode?: IoMode;
  fileIo?: FileIoConfig & {
    runDir?: string;
    inputPath?: string;
    outputPath?: string;
    outputCreated?: boolean;
  };
  source?: string;
  exe?: string;
  sourcePath?: string;
  exePath?: string;
  cwd?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  killedByTimeout?: boolean;
  hardKillLimitMs?: number;
  outputLimitExceeded?: boolean;
  outputBytes?: number;
  outputLimitBytes?: number;
  systemMessage?: string;
  stdinError?: string;
  stdoutError?: string;
  stderrError?: string;
  stderrPreview?: string;
  memoryBytes?: number;
  memoryKiB?: number;
  spawnError?: string;
  runnerError?: string;
  compareError?: string;
  runtimeError?: RuntimeErrorSummary;
  score?: number;
  scoreTotal?: number;
  checker?: CheckerSampleReport;
  interactive?: InteractiveSampleReport;
  message?: string;
};

export type JudgeReport = {
  version: 1;
  generatedAt: string;
  source: string;
  sourceName?: string;
  mode?: JudgeRunMode;
  functionStyle?: FunctionStyleReport;
  interactive?: InteractiveReport;
  compile?: CompileReport;
  totalTimeMs?: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  judgeMode?: JudgeMode | 'testlib' | 'plain';
  checkerType?: Exclude<CheckerType, 'none'>;
  ioMode?: IoMode;
  fileIo?: FileIoConfig;
  checker?: CheckerConfig;
  summary: {
    accepted: number;
    total: number;
    wrongAnswer?: number;
    scored?: number;
    checkerError?: number;
  };
  score?: {
    earned: number;
    total: number;
  };
  results?: SampleReport[];
  samples: SampleReport[];
};
