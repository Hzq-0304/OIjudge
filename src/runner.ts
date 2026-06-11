import { spawn } from 'child_process';
import { ProcessResult } from './types';

export function runProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
  hardKillLimitMs = timeoutMs
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
    let killedByTimeout = false;
    let timeoutTimeMs: number | undefined;
    let settled = false;
    let stdinError: string | undefined;
    let stdoutError: string | undefined;
    let stderrError: string | undefined;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      timeoutTimeMs = elapsedMs(startedAt);
      child.kill();
    }, hardKillLimitMs);

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
      const actualTimeMs = killedByTimeout && timeoutTimeMs !== undefined ? timeoutTimeMs : elapsedMs(startedAt);
      const timedOut = killedByTimeout || actualTimeMs > timeoutMs;
      const timeMs = killedByTimeout ? hardKillLimitMs : actualTimeMs;
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code,
        signal,
        timedOut,
        killedByTimeout,
        hardKillLimitMs,
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
  });
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
