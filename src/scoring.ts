import { ProblemConfig, SampleConfig, SampleReport, SubtaskConfig } from './types';

type ScoringProblem = {
  samples: SampleConfig[];
  score?: ProblemConfig['score'];
  subtasks?: SubtaskConfig[];
};

export type EffectiveSampleScore = {
  sampleId: string;
  sampleIndex: number;
  score: number;
  manual: boolean;
};

export type EffectiveScoreResult = {
  totalScore: number;
  sampleScores: Map<string, EffectiveSampleScore>;
  errors: string[];
};

export type JudgeScoreResult = {
  totalScore: number;
  earnedScore: number;
  sampleScores: Map<string, number>;
  subtaskScores: Map<string, { earned: number; total: number }>;
  errors: string[];
};

export function getProblemTotalScore(problem: ScoringProblem): number {
  return isPositiveInteger(problem.score?.total) ? problem.score?.total ?? 100 : 100;
}

export function calculateEffectiveSampleScores(problem: ScoringProblem): EffectiveScoreResult {
  const totalScore = getProblemTotalScore(problem);
  const samples = [...problem.samples].sort((left, right) => left.index - right.index);
  const errors: string[] = [];
  const sampleScores = new Map<string, EffectiveSampleScore>();
  if (samples.length === 0) {
    return { totalScore, sampleScores, errors };
  }

  const manualSamples = samples.filter((sample) => sample.score !== undefined);
  const manualTotal = manualSamples.reduce((sum, sample) => sum + normalizeSampleScore(sample.score, errors), 0);
  const unsetSamples = samples.filter((sample) => sample.score === undefined);
  const remaining = totalScore - manualTotal;

  for (const sample of manualSamples) {
    sampleScores.set(sample.id, {
      sampleId: sample.id,
      sampleIndex: sample.index,
      score: normalizeSampleScore(sample.score, errors),
      manual: true
    });
  }

  if (remaining < 0) {
    errors.push('score.manualTotalExceeded');
    for (const sample of unsetSamples) {
      sampleScores.set(sample.id, {
        sampleId: sample.id,
        sampleIndex: sample.index,
        score: 0,
        manual: false
      });
    }
    return { totalScore, sampleScores, errors };
  }

  const autoScores = distributeIntegerScore(remaining, unsetSamples.map((sample) => sample.id));
  for (const sample of unsetSamples) {
    sampleScores.set(sample.id, {
      sampleId: sample.id,
      sampleIndex: sample.index,
      score: autoScores.get(sample.id) ?? 0,
      manual: false
    });
  }

  return { totalScore, sampleScores, errors };
}

export function calculateJudgeScore(
  problem: ScoringProblem,
  sampleResults: SampleReport[]
): JudgeScoreResult {
  const effective = calculateEffectiveSampleScores(problem);
  const sampleScores = new Map<string, number>();
  const subtaskScores = new Map<string, { earned: number; total: number }>();
  const resultBySampleId = new Map(sampleResults.map((result) => [result.id, result]));
  const assignedSampleIds = new Set<string>();
  let earnedScore = 0;

  for (const subtask of problem.subtasks ?? []) {
    const ids = subtask.sampleIds.filter((sampleId) => effective.sampleScores.has(sampleId));
    const total = ids.reduce((sum, sampleId) => sum + (effective.sampleScores.get(sampleId)?.score ?? 0), 0);
    const allPassed = ids.length > 0 && ids.every((sampleId) => isAccepted(resultBySampleId.get(sampleId)));
    let earned = 0;
    if (subtask.scoringMode === 'bundle') {
      earned = allPassed ? total : 0;
      for (const sampleId of ids) {
        sampleScores.set(sampleId, allPassed ? (effective.sampleScores.get(sampleId)?.score ?? 0) : 0);
      }
    } else {
      for (const sampleId of ids) {
        const sampleScore = effective.sampleScores.get(sampleId)?.score ?? 0;
        const earnedSample = isAccepted(resultBySampleId.get(sampleId)) ? sampleScore : 0;
        earned += earnedSample;
        sampleScores.set(sampleId, earnedSample);
      }
    }
    for (const sampleId of ids) {
      if (assignedSampleIds.has(sampleId)) {
        effective.errors.push(`score.duplicateSubtaskSample:${sampleId}`);
      }
      assignedSampleIds.add(sampleId);
    }
    subtaskScores.set(subtask.id, { earned, total });
    earnedScore += earned;
  }

  for (const sample of problem.samples) {
    if (assignedSampleIds.has(sample.id)) {
      continue;
    }
    const total = effective.sampleScores.get(sample.id)?.score ?? 0;
    const earned = isAccepted(resultBySampleId.get(sample.id)) ? total : 0;
    sampleScores.set(sample.id, earned);
    earnedScore += earned;
  }

  return {
    totalScore: effective.totalScore,
    earnedScore,
    sampleScores,
    subtaskScores,
    errors: effective.errors
  };
}

function normalizeSampleScore(score: number | undefined, errors: string[]): number {
  if (score === undefined) {
    return 0;
  }
  if (!Number.isInteger(score) || score < 0) {
    errors.push('score.invalidSampleScore');
    return Math.max(0, Math.trunc(score));
  }
  return score;
}

function distributeIntegerScore(total: number, sampleIds: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (sampleIds.length === 0) {
    return scores;
  }
  const base = Math.floor(total / sampleIds.length);
  const remainder = total % sampleIds.length;
  for (const [index, sampleId] of sampleIds.entries()) {
    scores.set(sampleId, base + (index >= sampleIds.length - remainder ? 1 : 0));
  }
  return scores;
}

function isAccepted(report: SampleReport | undefined): boolean {
  return report?.status === 'AC';
}

function isPositiveInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && (value ?? 0) > 0;
}
