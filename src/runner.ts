import { spawn } from 'child_process';
import * as fs from 'fs';
import { ProcessResult } from './types';

export function runProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
  hardKillLimitMs = timeoutMs,
  outputLimitBytes?: number,
  fileOutputPath?: string
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
    let outputLimitExceeded = false;
    let outputBytes = 0;
    let settled = false;
    let stdinError: string | undefined;
    let stdoutError: string | undefined;
    let stderrError: string | undefined;

    const maxOutputBytes = typeof outputLimitBytes === 'number' && Number.isFinite(outputLimitBytes) && outputLimitBytes > 0
      ? Math.floor(outputLimitBytes)
      : undefined;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      timeoutTimeMs = elapsedMs(startedAt);
      child.kill();
    }, hardKillLimitMs);
    const fileOutputTimer = maxOutputBytes !== undefined && fileOutputPath
      ? setInterval(() => {
        if (settled || outputLimitExceeded) {
          return;
        }
        fs.stat(fileOutputPath, (error, stat) => {
          if (error || settled || outputLimitExceeded) {
            return;
          }
          if (stat.size > maxOutputBytes) {
            outputBytes = stat.size;
            outputLimitExceeded = true;
            child.kill();
          }
        });
      }, 10)
      : undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      if (maxOutputBytes === undefined) {
        stdoutChunks.push(chunk);
        outputBytes += chunk.length;
        return;
      }
      const remaining = maxOutputBytes - outputBytes;
      if (remaining <= 0) {
        outputBytes += chunk.length;
        outputLimitExceeded = true;
        child.kill();
        return;
      }
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        outputBytes += chunk.length;
        outputLimitExceeded = true;
        child.kill();
        return;
      }
      stdoutChunks.push(chunk);
      outputBytes += chunk.length;
    });
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
      if (fileOutputTimer) {
        clearInterval(fileOutputTimer);
      }
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
      if (fileOutputTimer) {
        clearInterval(fileOutputTimer);
      }
      const actualTimeMs = killedByTimeout && timeoutTimeMs !== undefined ? timeoutTimeMs : elapsedMs(startedAt);
      const timedOut = !outputLimitExceeded && (killedByTimeout || actualTimeMs > timeoutMs);
      const timeMs = killedByTimeout ? hardKillLimitMs : actualTimeMs;
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code,
        signal,
        timedOut,
        killedByTimeout,
        hardKillLimitMs,
        outputLimitExceeded,
        outputBytes,
        outputLimitBytes: maxOutputBytes,
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
