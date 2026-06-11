import { spawn } from 'child_process';
import { ProcessResult } from './types';

export function runProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let timeoutTimeMs: number | undefined;
    let settled = false;
    let stdinError: string | undefined;
    let stdoutError: string | undefined;
    let stderrError: string | undefined;
    let memoryKiB: number | undefined;
    let memorySampleTimer: NodeJS.Timeout | undefined;
    let memorySampleEnabled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutTimeMs = elapsedMs(startedAt);
      child.kill();
    }, timeoutMs);

    if (process.platform === 'win32') {
      memorySampleEnabled = true;
      memorySampleTimer = startWindowsMemorySampling(child.pid, (sample) => {
        memoryKiB = sample;
      });
    }

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdout.on('error', (error) => {
      stdoutError = formatError(error);
    });
    child.stderr.on('error', (error) => {
      stderrError = formatError(error);
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.on('error', (error) => {
      stdinError = formatError(error);
    });
    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (memorySampleTimer) {
        clearInterval(memorySampleTimer);
      }
      const timeMs = timedOut && timeoutTimeMs !== undefined ? timeoutTimeMs : elapsedMs(startedAt);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code,
        signal,
        timedOut,
        killedByTimeout: timedOut,
        memoryKiB,
        stdinError,
        stdoutError,
        stderrError,
        timeMs,
        elapsedMs: Math.round(timeMs)
      });
    });

    try {
      child.stdin.end(input);
    } catch (error) {
      stdinError = formatError(error);
    }

    if (memorySampleEnabled && child.pid !== undefined) {
      sampleWindowsMemory(child.pid, (sample) => {
        memoryKiB = sample;
      });
    }
  });
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startWindowsMemorySampling(
  pid: number | undefined,
  onSample: (memoryKiB: number) => void
): NodeJS.Timeout | undefined {
  if (pid === undefined) {
    return undefined;
  }

  let lastErrorAt: number | undefined;
  const sample = () => {
    void sampleWindowsMemory(pid, onSample, (error) => {
      const now = Date.now();
      if (!lastErrorAt || now - lastErrorAt > 1000) {
        lastErrorAt = now;
        console.warn(`Memory sampling failed for pid ${pid}: ${error}`);
      }
    });
  };

  sample();
  return setInterval(sample, 25);
}

async function sampleWindowsMemory(
  pid: number,
  onSample: (memoryKiB: number) => void,
  onError?: (error: string) => void
): Promise<void> {
  try {
    const script = `try { $p = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Write($p.WorkingSet64) } catch { exit 1 }`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      shell: false,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    await new Promise<void>((resolve) => {
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
    const raw = stdout.trim() || stderr.trim();
    const bytes = Number(raw);
    if (Number.isFinite(bytes) && bytes > 0) {
      onSample(Math.ceil(bytes / 1024));
    }
  } catch (error) {
    onError?.(formatError(error));
  }
}
