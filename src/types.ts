export type SampleSourceType = 'managed' | 'external';

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
  id: number;
  name: string;
  input: string;
  answer: string;
  actualOutput?: string;
  expectedOutput?: string;
  sourceType?: SampleSourceType;
};

export type OITestConfig = {
  version: 1;
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
  samples: SampleConfig[];
};

export type ProblemConfig = OITestConfig & {
  id: string;
  name: string;
  source?: string;
  defaultSource?: string;
  statement?: ProblemStatement;
  sources?: ProblemSource[];
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
  timeMs: number;
  elapsedMs: number;
};

export type CompileReport = {
  status: 'OK';
  timeMs: number;
};

export type CompileResult = CompileReport & {
  executablePath: string;
};

export type SampleStatus = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'ERR' | 'Skipped' | 'Missing';

export type SampleReport = {
  id: number;
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
  diff?: string;
  sampleSourceType?: SampleSourceType;
  message?: string;
};

export type JudgeReport = {
  version: 1;
  generatedAt: string;
  source: string;
  sourceName?: string;
  compile?: CompileReport;
  totalTimeMs?: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  summary: {
    accepted: number;
    total: number;
  };
  results?: SampleReport[];
  samples: SampleReport[];
};
