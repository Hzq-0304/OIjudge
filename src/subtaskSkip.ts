import { OITestConfig, SampleConfig, SampleReport, SubtaskConfig, SubtaskSkipReason } from './types';

export type SubtaskSkipDecision = {
  reason: SubtaskSkipReason;
  message: string;
  subtask?: SubtaskConfig;
  dependency?: SubtaskConfig;
};

export type SubtaskSkipValidationResult = {
  errors: string[];
};

type SubtaskState = 'passed' | 'failed';

export class SubtaskSkipScheduler {
  private readonly sampleToSubtask = new Map<string, SubtaskConfig>();
  private readonly subtaskById = new Map<string, SubtaskConfig>();
  private readonly stateBySubtaskId = new Map<string, SubtaskState>();

  constructor(private readonly config: OITestConfig) {
    for (const subtask of config.subtasks ?? []) {
      this.subtaskById.set(subtask.id, subtask);
      for (const sampleId of subtask.sampleIds) {
        this.sampleToSubtask.set(sampleId, subtask);
      }
    }
  }

  getSchedule(): SampleConfig[] {
    if (!isSubtaskSkipEnabled(this.config) || !isDependencySkipEnabled(this.config)) {
      return this.config.samples;
    }

    const sampleById = new Map(this.config.samples.map((sample) => [sample.id, sample]));
    const scheduled = new Set<string>();
    const samples: SampleConfig[] = [];

    for (const sample of this.config.samples) {
      if (!this.sampleToSubtask.has(sample.id)) {
        samples.push(sample);
        scheduled.add(sample.id);
      }
    }

    for (const subtask of this.config.subtasks ?? []) {
      const subtaskSamples = subtask.sampleIds
        .map((sampleId) => sampleById.get(sampleId))
        .filter((sample): sample is SampleConfig => Boolean(sample))
        .sort((left, right) => left.index - right.index);
      for (const sample of subtaskSamples) {
        if (!scheduled.has(sample.id)) {
          samples.push(sample);
          scheduled.add(sample.id);
        }
      }
    }

    for (const sample of this.config.samples) {
      if (!scheduled.has(sample.id)) {
        samples.push(sample);
      }
    }

    return samples;
  }

  decide(sample: SampleConfig): SubtaskSkipDecision | undefined {
    const subtask = this.sampleToSubtask.get(sample.id);
    if (!subtask || !isSubtaskSkipEnabled(this.config)) {
      return undefined;
    }

    if (isDependencySkipEnabled(this.config)) {
      const dependency = findFailedDependency(subtask, this.subtaskById, this.stateBySubtaskId);
      if (dependency) {
        this.stateBySubtaskId.set(subtask.id, 'failed');
        return {
          reason: 'dependency_failed',
          subtask,
          dependency,
          message: `Skipped because dependency ${dependency.name || dependency.id} did not pass.`
        };
      }
    }

    if (isSkipRemainingCasesEnabled(this.config, subtask) && this.stateBySubtaskId.get(subtask.id) === 'failed') {
      return {
        reason: 'previous_case_failed',
        subtask,
        message: 'Skipped because a previous case in this subtask failed.'
      };
    }

    return undefined;
  }

  record(sample: SampleConfig, report: SampleReport): void {
    const subtask = this.sampleToSubtask.get(sample.id);
    if (!subtask || !isSubtaskSkipEnabled(this.config)) {
      return;
    }
    if (isAcceptedForSubtask(report)) {
      if (isLastSubtaskSample(this.config, subtask, sample)) {
        const subtaskReports = (this.config.samples)
          .filter((entry) => subtask.sampleIds.includes(entry.id))
          .filter((entry) => entry.index <= sample.index);
        if (subtaskReports.length >= subtask.sampleIds.length && this.stateBySubtaskId.get(subtask.id) !== 'failed') {
          this.stateBySubtaskId.set(subtask.id, 'passed');
        }
      }
      return;
    }
    this.stateBySubtaskId.set(subtask.id, 'failed');
  }
}

function findFailedDependency(
  subtask: SubtaskConfig,
  subtaskById: Map<string, SubtaskConfig>,
  stateBySubtaskId: Map<string, SubtaskState>
): SubtaskConfig | undefined {
  for (const dependencyId of subtask.dependsOn ?? []) {
    const dependency = subtaskById.get(dependencyId);
    if (dependency && stateBySubtaskId.get(dependency.id) !== 'passed') {
      return dependency;
    }
  }
  return undefined;
}

export function validateSubtaskSkipConfig(config: OITestConfig): SubtaskSkipValidationResult {
  const subtasks = config.subtasks ?? [];
  const errors: string[] = [];
  const subtaskById = new Map<string, SubtaskConfig>();
  for (const subtask of subtasks) {
    if (subtaskById.has(subtask.id)) {
      errors.push(`Duplicate subtask id: ${subtask.id}`);
    }
    subtaskById.set(subtask.id, subtask);
  }

  const indexById = new Map(subtasks.map((subtask, index) => [subtask.id, index]));
  for (const subtask of subtasks) {
    for (const dependencyId of subtask.dependsOn ?? []) {
      if (!subtaskById.has(dependencyId)) {
        errors.push(`Subtask ${subtask.id} depends on missing subtask ${dependencyId}.`);
        continue;
      }
      if (dependencyId === subtask.id) {
        errors.push(`Subtask ${subtask.id} cannot depend on itself.`);
        continue;
      }
      if ((indexById.get(dependencyId) ?? -1) > (indexById.get(subtask.id) ?? -1)) {
        errors.push(`Subtask dependency order error: ${subtask.id} depends on later subtask ${dependencyId}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (subtask: SubtaskConfig, path: string[]): void => {
    if (visited.has(subtask.id)) {
      return;
    }
    if (visiting.has(subtask.id)) {
      errors.push(`Subtask dependency cycle detected: ${[...path, subtask.id].join(' -> ')}.`);
      return;
    }
    visiting.add(subtask.id);
    for (const dependencyId of subtask.dependsOn ?? []) {
      const dependency = subtaskById.get(dependencyId);
      if (dependency) {
        visit(dependency, [...path, subtask.id]);
      }
    }
    visiting.delete(subtask.id);
    visited.add(subtask.id);
  };
  for (const subtask of subtasks) {
    visit(subtask, []);
  }

  return { errors };
}

export function isSubtaskSkipEnabled(config: OITestConfig): boolean {
  return config.subtaskSkip?.enabled === true;
}

function isDependencySkipEnabled(config: OITestConfig): boolean {
  return isSubtaskSkipEnabled(config) && config.subtaskSkip?.skipDependentSubtasks === true;
}

function isSkipRemainingCasesEnabled(config: OITestConfig, subtask: SubtaskConfig): boolean {
  if (!isSubtaskSkipEnabled(config)) {
    return false;
  }
  return (subtask.skipRemainingCasesOnFailure ?? config.subtaskSkip?.skipRemainingCasesOnFailure) === true
    && subtask.scoringMode === 'bundle';
}

function isAcceptedForSubtask(report: SampleReport): boolean {
  return report.status === 'AC';
}

function isLastSubtaskSample(config: OITestConfig, subtask: SubtaskConfig, sample: SampleConfig): boolean {
  const sampleById = new Map(config.samples.map((entry) => [entry.id, entry]));
  const ordered = subtask.sampleIds
    .map((sampleId) => sampleById.get(sampleId))
    .filter((entry): entry is SampleConfig => Boolean(entry))
    .sort((left, right) => left.index - right.index);
  return ordered.length > 0 && ordered[ordered.length - 1]?.id === sample.id;
}
