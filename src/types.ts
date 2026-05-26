export type SampleConfig = {
  id: number;
  name: string;
  input: string;
  answer: string;
  actualOutput?: string;
  expectedOutput?: string;
};

export type OITestConfig = {
  version: 1;
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

export type ProcessResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  elapsedMs: number;
};

export type SampleStatus = 'AC' | 'WA' | 'TLE' | 'RE' | 'ERR';

export type SampleReport = {
  id: number;
  name: string;
  status: SampleStatus;
  elapsedMs: number;
  input: string;
  answer: string;
  actualOutput: string;
  message?: string;
};

export type JudgeReport = {
  version: 1;
  generatedAt: string;
  source: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  summary: {
    accepted: number;
    total: number;
  };
  samples: SampleReport[];
};
