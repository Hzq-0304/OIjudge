import { SampleStatus } from './types';

export type VerdictLike =
  | SampleStatus
  | 'Not Run'
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Memory Limit Exceeded'
  | 'Runtime Error'
  | 'Compilation Error'
  | 'Output Limit Exceeded'
  | 'Skipped'
  | 'Unknown'
  | 'UNKNOWN'
  | 'Running'
  | 'Judging'
  | 'Pending'
  | 'System Error'
  | 'PARTIAL'
  | string;

export function formatVerdictAcronym(verdict: VerdictLike | undefined): string {
  switch (verdict) {
    case undefined:
    case 'Not Run':
      return '';
    case 'Accepted':
    case 'AC':
      return 'AC';
    case 'Wrong Answer':
    case 'WA':
      return 'WA';
    case 'PE':
    case 'Presentation Error':
      return 'PE';
    case 'Time Limit Exceeded':
    case 'TLE':
      return 'TLE';
    case 'Memory Limit Exceeded':
    case 'MLE':
      return 'MLE';
    case 'Runtime Error':
    case 'RE':
      return 'RE';
    case 'Compilation Error':
    case 'CE':
      return 'CE';
    case 'Output Limit Exceeded':
    case 'OLE':
      return 'OLE';
    case 'Skipped':
    case 'SKIP':
      return 'SKIP';
    case 'Running':
    case 'Judging':
      return 'RUN';
    case 'Pending':
      return 'PENDING';
    case 'System Error':
      return 'SE';
    case 'Checker Error':
      return 'CHECKER';
    case 'Interactor Error':
      return 'INTERACTOR';
    case 'Scored':
      return 'SCORED';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'Missing':
      return 'MISSING';
    case 'Output Missing':
      return 'OUTPUT';
    case 'ERR':
    case 'Unknown':
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return verdict.trim() ? verdict : 'UNKNOWN';
  }
}

export function formatVerdictFullName(verdict: VerdictLike | undefined): string {
  switch (verdict) {
    case undefined:
    case 'Not Run':
      return '';
    case 'Accepted':
    case 'AC':
      return 'Accepted';
    case 'Wrong Answer':
    case 'WA':
      return 'Wrong Answer';
    case 'PE':
    case 'Presentation Error':
      return 'Presentation Error';
    case 'Time Limit Exceeded':
    case 'TLE':
      return 'Time Limit Exceeded';
    case 'Memory Limit Exceeded':
    case 'MLE':
      return 'Memory Limit Exceeded';
    case 'Runtime Error':
    case 'RE':
      return 'Runtime Error';
    case 'Compilation Error':
    case 'CE':
      return 'Compilation Error';
    case 'Output Limit Exceeded':
    case 'OLE':
      return 'Output Limit Exceeded';
    case 'Skipped':
    case 'SKIP':
      return 'Skipped';
    case 'Running':
    case 'Judging':
      return 'Running';
    case 'Pending':
      return 'Pending';
    case 'System Error':
      return 'System Error';
    case 'Checker Error':
      return 'Checker Error';
    case 'Interactor Error':
      return 'Interactor Error';
    case 'Scored':
      return 'Scored';
    case 'PARTIAL':
      return 'Partial Score';
    case 'Missing':
      return 'Missing';
    case 'Output Missing':
      return 'Output Missing';
    case 'ERR':
    case 'Unknown':
    case 'UNKNOWN':
      return 'Unknown';
    default:
      return verdict.trim() ? verdict : 'Unknown';
  }
}
