import { spawn } from 'child_process';
import { ProcessResult } from './types';

export function runProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let timeoutTimeMs: number | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutTimeMs = elapsedMs(startedAt);
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const timeMs = timedOut && timeoutTimeMs !== undefined ? timeoutTimeMs : elapsedMs(startedAt);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code,
        signal,
        timedOut,
        timeMs,
        elapsedMs: Math.round(timeMs)
      });
    });

    child.stdin.end(input);
  });
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
