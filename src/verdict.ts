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
