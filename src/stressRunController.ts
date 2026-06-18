import { ChildProcess, spawn } from 'child_process';
import { ProcessTracker } from './runner';

export class StressRunCancelledError extends Error {
  constructor(message = 'Stress test stopped.') {
    super(message);
    this.name = 'StressRunCancelledError';
  }
}

export type StressRunController = ProcessTracker & {
  readonly isRunning: boolean;
  readonly cancellationRequested: boolean;
  start(): boolean;
  finish(): void;
  cancel(): void;
  throwIfCancelled(): void;
};

export function createStressRunController(): StressRunController {
  return new DefaultStressRunController();
}

class DefaultStressRunController implements StressRunController {
  private readonly activeProcesses = new Set<ChildProcess>();
  private running = false;
  private cancelled = false;

  get isRunning(): boolean {
    return this.running;
  }

  get cancellationRequested(): boolean {
    return this.cancelled;
  }

  start(): boolean {
    if (this.running) {
      return false;
    }
    this.running = true;
    this.cancelled = false;
    this.activeProcesses.clear();
    return true;
  }

  finish(): void {
    this.running = false;
    this.cancelled = false;
    this.activeProcesses.clear();
  }

  cancel(): void {
    if (!this.running && this.activeProcesses.size === 0) {
      return;
    }
    this.cancelled = true;
    for (const child of [...this.activeProcesses]) {
      killProcessTree(child);
    }
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new StressRunCancelledError();
    }
  }

  registerProcess(child: ChildProcess): void {
    this.activeProcesses.add(child);
    if (this.cancelled) {
      killProcessTree(child);
    }
  }

  unregisterProcess(child: ChildProcess): void {
    this.activeProcesses.delete(child);
  }
}

export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.on('error', () => undefined);
      return;
    }
    child.kill('SIGTERM');
  } catch {
    // Stopping stress tests should be best-effort; cleanup continues even if the OS reports ESRCH/EPERM.
  }
}
