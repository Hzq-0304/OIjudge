import { describe, expect, it } from 'vitest';
import {
  buildCompileArgs,
  calculateEnvironmentOverallStatus,
  EnvironmentCheckItem,
  executablePath,
  formatEnvironmentCheckReport,
  getCompilerCandidates,
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

  it('truncates by line count and character count', () => {
    expect(truncateText('a\nb\nc', 2)).toContain('... (1 more lines truncated)');
    expect(truncateText('abcdef', 20, 3)).toContain('abc');
    expect(truncateText('abcdef', 20, 3)).toContain('... (truncated)');
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
