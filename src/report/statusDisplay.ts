import { formatVerdictAcronym } from '../verdict';

export function statusClass(status: string): string {
  return `status-${toStatusToken(status)}`;
}

export function verdictClass(status: string): string {
  return `verdict-${toStatusToken(status)}`;
}

export function scoreClass(earned: number, total: number, status: string): string {
  if (status === 'AC' || (status === 'Scored' && total > 0 && earned >= total)) {
    return 'score-passed';
  }
  if (earned > 0 && earned < total) {
    return `score-partial ${verdictClass(status)}`;
  }
  if (status === 'Not Run') {
    return 'score-muted';
  }
  if (status === 'Skipped') {
    return 'score-muted verdict-skipped';
  }
  return `score-failed ${verdictClass(status)}`;
}

export function statusLabel(status: string): string {
  return formatVerdictAcronym(status);
}

function toStatusToken(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-');
}
