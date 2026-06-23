import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildCompileArgs,
  calculateEnvironmentOverallStatus,
  environmentCheckTestHooks,
  ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS,
  ENVIRONMENT_CHECK_RUN_TIMEOUT_MS,
  EnvironmentCheckItem,
  executablePath,
  formatEnvironmentCheckReport,
  getCompilerCandidates,
  runEnvironmentCheck,
  truncateText
} from '../src/environmentCheck';

describe('environment check helpers', () => {
  it('calculates overall status from item severities', () => {
    expect(calculateEnvironmentOverallStatus([
      item('pass'),
      item('info')
    ])).toBe('pass');
    expect(calculateEnvironmentOverallStatus([
      item('pass'),
      item('warn')
    ])).toBe('warn');
    expect(calculateEnvironmentOverallStatus([
      item('warn'),
      item('fail')
    ])).toBe('fail');
  });

  it('formats a plain-text report and truncates long diagnostics', () => {
    const longDetails = Array.from({ length: 25 }, (_, index) => `stderr line ${index + 1}`).join('\n');
    const report = formatEnvironmentCheckReport({
      platform: 'win32',
      arch: 'x64',
      nodeVersion: 'v24.0.0',
      vscodeVersion: '1.100.0',
      extensionVersion: '5.1.0',
      startedAt: '2026-06-18T00:00:00.000Z',
      finishedAt: '2026-06-18T00:00:01.000Z',
      overallStatus: 'warn',
      items: [{
        id: 'compiler',
        title: 'Compiler discovery',
        status: 'warn',
        summary: 'Compiler not found.',
        details: longDetails,
        suggestion: 'Install a compiler.'
      }]
    });

    expect(report).toContain('OI Judge Environment Check');
    expect(report).toContain('Overall: WARN');
    expect(report).toContain('Platform: win32 x64');
    expect(report).toContain('[WARN] Compiler discovery - Compiler not found.');
    expect(report).toContain('Suggestion: Install a compiler.');
    expect(report).toContain('... (5 more lines truncated)');
    expect(report).not.toContain('stderr line 25');
  });

  it('uses platform-specific compiler candidate priority', () => {
    expect(getCompilerCandidates('darwin')).toEqual(['clang++', 'g++']);
    expect(getCompilerCandidates('linux')).toEqual(['g++', 'clang++']);
    expect(getCompilerCandidates('win32', 'C:/mingw/bin/g++.exe')).toEqual([
      'C:/mingw/bin/g++.exe',
      'g++',
      'clang++'
    ]);
  });

  it('builds spawn-friendly compile args and Windows executable paths', () => {
    expect(buildCompileArgs('C:/tmp/with spaces/hello.cpp', 'C:/tmp/with spaces/hello.exe')).toEqual([
      '-std=c++17',
      'C:/tmp/with spaces/hello.cpp',
      '-o',
      'C:/tmp/with spaces/hello.exe'
    ]);
    expect(executablePath('C:/tmp/hello', 'win32')).toBe('C:/tmp/hello.exe');
    expect(executablePath('/tmp/hello', 'linux')).toBe('/tmp/hello');
  });

  it('uses a wider timeout for compiler probes than executable probes', () => {
    expect(ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS).toBeGreaterThan(ENVIRONMENT_CHECK_RUN_TIMEOUT_MS);
    expect(ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS).toBe(60_000);
    expect(ENVIRONMENT_CHECK_RUN_TIMEOUT_MS).toBe(5_000);
  });

  it('truncates by line count and character count', () => {
    expect(truncateText('a\nb\nc', 2)).toContain('... (1 more lines truncated)');
    expect(truncateText('abcdef', 20, 3)).toContain('abc');
    expect(truncateText('abcdef', 20, 3)).toContain('... (truncated)');
  });

  it('waits for an asynchronous stop-process kill helper to close the child', async () => {
    const scriptPath = path.join(process.cwd(), '.tmp', 'environment-check-test', 'sleep-probe.js');
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, [
      'console.log("started");',
      'setInterval(() => undefined, 1000);',
      ''
    ].join('\n'), 'utf8');

    const command = process.execPath;
    const stopped = await environmentCheckTestHooks.runStopProcessProbe(
      command,
      process.cwd(),
      async (child) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        child.kill();
        return {
          ok: true,
          method: 'child-kill'
        };
      },
      {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${scriptPath}`].filter(Boolean).join(' ')
      }
    );

    expect(stopped.closed).toBe(true);
    expect(stopped.timedOut).toBe(false);
    expect(stopped.killResult?.method).toBe('child-kill');
  });

  it('reports compile diagnostics and skips hello executable checks after C++17 compile failure', async () => {
    let runProbeCalled = false;
    const report = await runEnvironmentCheck({
      discoverCompiler: async () => ({
        command: 'mock-g++',
        versionLine: 'mock-g++ 1.0'
      }),
      compileCpp: async () => ({
        stdout: Array.from({ length: 25 }, (_, index) => `stdout line ${index + 1}`).join('\n'),
        stderr: 'compile failed',
        code: 1,
        signal: null,
        timedOut: true,
        timeMs: ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS
      }),
      runCompiledProbe: async () => {
        runProbeCalled = true;
        return {
          stdout: '',
          stderr: '',
          code: 0,
          signal: null,
          timedOut: false,
          timeMs: 1
        };
      }
    });

    const compile = report.items.find((item) => item.id === 'cpp17-compile');
    const runExecutable = report.items.find((item) => item.id === 'run-executable');
    expect(compile?.status).toBe('fail');
    expect(compile?.summary).toBe(`Compiler timed out after ${ENVIRONMENT_CHECK_COMPILE_TIMEOUT_MS}ms.`);
    expect(compile?.details).toContain('compiler: mock-g++');
    expect(compile?.details).toContain('args:');
    expect(compile?.details).toContain('cwd:');
    expect(compile?.details).toContain('source:');
    expect(compile?.details).toContain('output:');
    expect(compile?.details).toContain('exitCode: 1');
    expect(compile?.details).toContain('timedOut: true');
    expect(compile?.details).toContain('stderr: compile failed');
    expect(compile?.details).toContain('... (5 more lines truncated)');
    expect(runExecutable?.status).toBe('warn');
    expect(runExecutable?.summary).toBe('Skipped because C++17 compile failed.');
    expect(runExecutable?.details ?? '').not.toContain('The "file" argument must be of type string');
    expect(runProbeCalled).toBe(false);
  });

  it('keeps closed stdin pipe errors from escaping environment check probe runs', async () => {
    const result = await environmentCheckTestHooks.runProcessWithTimeout(
      process.execPath,
      ['-e', 'process.exit(0);'],
      'x'.repeat(1024 * 1024),
      process.cwd(),
      ENVIRONMENT_CHECK_RUN_TIMEOUT_MS,
      process.env
    );

    expect(result.code).toBe(0);
    if (result.stdinError) {
      expect(result.stdinError).toMatch(/EPIPE|closed|write/i);
    }
  });
});

function item(status: EnvironmentCheckItem['status']): EnvironmentCheckItem {
  return {
    id: status,
    title: status,
    status,
    summary: status
  };
}
