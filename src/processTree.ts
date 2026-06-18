import { execFile } from 'child_process';
import type { ChildProcess, ExecFileException } from 'child_process';

export type KillProcessTreeMethod = 'taskkill' | 'posix-process-group' | 'posix-process' | 'child-kill' | 'none';

export interface KillProcessTreeResult {
  ok: boolean;
  alreadyExited?: boolean;
  timedOut?: boolean;
  method: KillProcessTreeMethod;
  message?: string;
}

type ExecFile = typeof execFile;
type ProcessKill = typeof process.kill;

export type KillProcessTreeOptions = {
  platform?: NodeJS.Platform;
  detached?: boolean;
  timeoutMs?: number;
  signalGraceMs?: number;
  execFile?: ExecFile;
  processKill?: ProcessKill;
};

const DEFAULT_KILL_TIMEOUT_MS = 5000;
const DEFAULT_POSIX_GRACE_MS = 1500;
const DIAGNOSTIC_LIMIT = 4000;

export async function killProcessTree(
  child: ChildProcess,
  options: KillProcessTreeOptions = {}
): Promise<KillProcessTreeResult> {
  const pid = child.pid;
  if (!pid) {
    return {
      ok: true,
      alreadyExited: true,
      method: 'none',
      message: 'Process has no pid.'
    };
  }
  if (hasExited(child)) {
    return {
      ok: true,
      alreadyExited: true,
      method: 'none',
      message: 'Process already exited.'
    };
  }

  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return killWindowsProcessTree(child, pid, options);
  }
  return killPosixProcessTree(child, pid, options);
}

async function killWindowsProcessTree(
  child: ChildProcess,
  pid: number,
  options: KillProcessTreeOptions
): Promise<KillProcessTreeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
  const runExecFile = options.execFile ?? execFile;
  const taskkill = await runTaskkill(runExecFile, pid, timeoutMs);
  if (taskkill.ok || hasExited(child)) {
    return {
      ok: true,
      alreadyExited: taskkill.alreadyExited,
      timedOut: taskkill.timedOut,
      method: 'taskkill',
      message: taskkill.message
    };
  }

  const fallback = await killChildProcess(child, timeoutMs, `taskkill failed: ${taskkill.message ?? 'unknown error'}`);
  return {
    ...fallback,
    ok: false,
    message: fallback.message
  };
}

function runTaskkill(
  runExecFile: ExecFile,
  pid: number,
  timeoutMs: number
): Promise<KillProcessTreeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: KillProcessTreeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    runExecFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: timeoutMs },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const output = summarize([stdout, stderr].map((value) => value?.toString() ?? '').filter(Boolean).join('\n'));
        if (!error) {
          finish({ ok: true, method: 'taskkill', message: output || 'taskkill completed.' });
          return;
        }
        const message = summarize([error.message, output].filter(Boolean).join('\n'));
        if (isProcessNotFound(message)) {
          finish({ ok: true, alreadyExited: true, method: 'taskkill', message });
          return;
        }
        finish({
          ok: false,
          timedOut: Boolean(error.killed || error.signal),
          method: 'taskkill',
          message
        });
      }
    );
  });
}

async function killPosixProcessTree(
  child: ChildProcess,
  pid: number,
  options: KillProcessTreeOptions
): Promise<KillProcessTreeResult> {
  const useProcessGroup = Boolean(options.detached);
  const method: KillProcessTreeMethod = useProcessGroup ? 'posix-process-group' : 'posix-process';
  const target = useProcessGroup ? -pid : pid;
  const processKill = options.processKill ?? process.kill;
  const graceMs = options.signalGraceMs ?? DEFAULT_POSIX_GRACE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;

  const term = sendSignal(processKill, target, 'SIGTERM');
  if (term.alreadyExited) {
    return { ok: true, alreadyExited: true, method, message: term.message };
  }
  if (!term.ok) {
    return {
      ok: false,
      method,
      message: term.message
    };
  }

  if (await waitForExit(child, graceMs)) {
    return { ok: true, method, message: 'Process exited after SIGTERM.' };
  }

  const kill = sendSignal(processKill, target, 'SIGKILL');
  if (kill.alreadyExited) {
    return { ok: true, alreadyExited: true, method, message: kill.message };
  }
  if (!kill.ok) {
    return {
      ok: false,
      method,
      message: kill.message
    };
  }

  const closed = await waitForExit(child, timeoutMs);
  return {
    ok: closed,
    timedOut: !closed,
    method,
    message: closed ? 'Process exited after SIGKILL.' : `Process did not exit within ${timeoutMs}ms after SIGKILL.`
  };
}

function sendSignal(
  processKill: ProcessKill,
  pid: number,
  signal: NodeJS.Signals
): { ok: boolean; alreadyExited?: boolean; message?: string } {
  try {
    processKill(pid, signal);
    return { ok: true };
  } catch (error) {
    const message = formatError(error);
    if (isNoSuchProcess(error)) {
      return { ok: true, alreadyExited: true, message };
    }
    return { ok: false, message };
  }
}

async function killChildProcess(
  child: ChildProcess,
  timeoutMs: number,
  reason: string
): Promise<KillProcessTreeResult> {
  try {
    child.kill('SIGKILL');
  } catch (error) {
    if (isNoSuchProcess(error)) {
      return { ok: true, alreadyExited: true, method: 'child-kill', message: formatError(error) };
    }
    return { ok: false, method: 'child-kill', message: `${reason}; fallback child.kill failed: ${formatError(error)}` };
  }

  const closed = await waitForExit(child, timeoutMs);
  return {
    ok: closed,
    timedOut: !closed,
    method: 'child-kill',
    message: `${reason}; fallback child.kill ${closed ? 'closed the process' : `timed out after ${timeoutMs}ms`}.`
  };
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(hasExited(child)), timeoutMs);
    child.once('close', onClose);
    child.once('error', onClose);
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ESRCH';
}

function isProcessNotFound(message: string | undefined): boolean {
  return Boolean(message && /not found|no running instance|not running|could not find|不存在|找不到/iu.test(message));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarize(value: string): string {
  const normalized = value.replace(/\r\n/gu, '\n').trim();
  if (normalized.length <= DIAGNOSTIC_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, DIAGNOSTIC_LIMIT)}\n... (truncated)`;
}
