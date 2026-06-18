export type CrossPlatformMetricCase = {
  name: string;
  verdict: string;
  timeMs: number | null;
  memoryKb?: number | null;
  memorySupported?: boolean;
};

export type CrossPlatformMetricResult = {
  platform: string;
  arch: string;
  node: string;
  compiler?: string;
  cases: CrossPlatformMetricCase[];
  summary?: {
    totalTimeMs?: number;
    maxMemoryKb?: number | null;
  };
};

export type CrossPlatformMetricCompareOptions = {
  maxCaseTimeMs?: number;
  maxTimeDeltaMs?: number;
  maxTimeRatio?: number;
  smallBaselineTimeMs?: number;
  maxMemoryKb?: number;
  maxMemoryRatio?: number;
};

export type CrossPlatformMetricComparison = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

const DEFAULT_OPTIONS: Required<CrossPlatformMetricCompareOptions> = {
  maxCaseTimeMs: 10_000,
  maxTimeDeltaMs: 2_000,
  maxTimeRatio: 5,
  smallBaselineTimeMs: 30,
  maxMemoryKb: 512 * 1024,
  maxMemoryRatio: 5
};

export function compareCrossPlatformMetrics(
  localBaseline: CrossPlatformMetricResult | undefined,
  ciResult: CrossPlatformMetricResult,
  options: CrossPlatformMetricCompareOptions = {}
): CrossPlatformMetricComparison {
  const thresholds = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const errors: string[] = [];
  const baselineByName = new Map((localBaseline?.cases ?? []).map((entry) => [entry.name, entry]));

  for (const testCase of ciResult.cases) {
    if (testCase.verdict !== 'AC') {
      errors.push(`${testCase.name}: verdict is ${testCase.verdict}, expected AC`);
    }

    if (!isFiniteNumber(testCase.timeMs)) {
      errors.push(`${testCase.name}: timeMs must be a finite number`);
    } else if (testCase.timeMs < 0) {
      errors.push(`${testCase.name}: timeMs must not be negative`);
    } else if (testCase.timeMs > thresholds.maxCaseTimeMs) {
      errors.push(`${testCase.name}: timeMs ${testCase.timeMs} exceeds ${thresholds.maxCaseTimeMs}`);
    }

    validateMemory(testCase, thresholds, errors);

    const baseline = baselineByName.get(testCase.name);
    if (baseline && isFiniteNumber(baseline.timeMs) && isFiniteNumber(testCase.timeMs)) {
      const delta = testCase.timeMs - baseline.timeMs;
      if (baseline.timeMs < thresholds.smallBaselineTimeMs) {
        if (delta > thresholds.maxTimeDeltaMs) {
          warnings.push(`${testCase.name}: time delta ${delta} ms exceeds ${thresholds.maxTimeDeltaMs} ms`);
        }
      } else if (testCase.timeMs > baseline.timeMs * thresholds.maxTimeRatio && delta > thresholds.maxTimeDeltaMs) {
        warnings.push(`${testCase.name}: time ${testCase.timeMs} ms is much slower than baseline ${baseline.timeMs} ms`);
      }
    }

    if (baseline && isMemorySupported(baseline) && isMemorySupported(testCase)) {
      const baselineMemory = baseline.memoryKb ?? 0;
      const currentMemory = testCase.memoryKb ?? 0;
      if (baselineMemory > 0 && currentMemory > baselineMemory * thresholds.maxMemoryRatio && currentMemory > thresholds.maxMemoryKb) {
        warnings.push(`${testCase.name}: memory ${currentMemory} KiB is much higher than baseline ${baselineMemory} KiB`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors
  };
}

function validateMemory(
  testCase: CrossPlatformMetricCase,
  thresholds: Required<CrossPlatformMetricCompareOptions>,
  errors: string[]
): void {
  if (testCase.memorySupported === false) {
    if (testCase.memoryKb !== null && testCase.memoryKb !== undefined && testCase.memoryKb !== 0) {
      errors.push(`${testCase.name}: unsupported memory must be null, undefined, or 0`);
    }
    return;
  }

  if (!isFiniteNumber(testCase.memoryKb)) {
    errors.push(`${testCase.name}: memoryKb must be a finite number when memorySupported is not false`);
    return;
  }
  if (testCase.memoryKb < 0) {
    errors.push(`${testCase.name}: memoryKb must not be negative`);
  }
  if (testCase.memoryKb > thresholds.maxMemoryKb) {
    errors.push(`${testCase.name}: memoryKb ${testCase.memoryKb} exceeds ${thresholds.maxMemoryKb}`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMemorySupported(testCase: CrossPlatformMetricCase): boolean {
  return testCase.memorySupported !== false && isFiniteNumber(testCase.memoryKb);
}
