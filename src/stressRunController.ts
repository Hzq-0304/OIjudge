import type { ChildProcess } from 'child_process';
import { killProcessTree } from './processTree';
import type { KillProcessTreeResult } from './processTree';
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
  cancel(): Promise<KillProcessTreeResult[]>;
  throwIfCancelled(): void;
};

export function createStressRunController(
  stopProcessTree: (child: ChildProcess) => Promise<KillProcessTreeResult> = (child) =>
    killProcessTree(child, { detached: process.platform !== 'win32' })
): StressRunController {
  return new DefaultStressRunController(stopProcessTree);
}

class DefaultStressRunController implements StressRunController {
  private readonly activeProcesses = new Set<ChildProcess>();
  private running = false;
  private cancelled = false;

  constructor(private readonly stopProcessTree: (child: ChildProcess) => Promise<KillProcessTreeResult>) {}

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

  async cancel(): Promise<KillProcessTreeResult[]> {
    if (!this.running && this.activeProcesses.size === 0) {
      return [];
    }
    this.cancelled = true;
    return Promise.all([...this.activeProcesses].map((child) => this.stopProcess(child)));
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new StressRunCancelledError();
    }
  }

  registerProcess(child: ChildProcess): void {
    this.activeProcesses.add(child);
    if (this.cancelled) {
      void this.stopProcess(child);
    }
  }

  unregisterProcess(child: ChildProcess): void {
    this.activeProcesses.delete(child);
  }

  private async stopProcess(child: ChildProcess): Promise<KillProcessTreeResult> {
    try {
      return await this.stopProcessTree(child);
    } catch (error) {
      return {
        ok: false,
        method: 'none',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
