import { describe, expect, it } from 'vitest';
import { runEnvironmentCheck } from '../../src/environmentCheck';
import { findCppCompiler, output, writeJsonArtifact } from './helpers';

describe('environment check cross-platform smoke', () => {
  it('runs the core environment checks in a temporary directory with spaces', async () => {
    const compiler = await findCppCompiler();
    expect(compiler, 'A C++ compiler is required for the cross-platform environment check smoke test.').toBeDefined();

    const report = await runEnvironmentCheck({
      configuredCompiler: compiler?.command,
      output: output()
    });
    await writeJsonArtifact('environment-check-result.json', report);

    expect(report.overallStatus).not.toBe('fail');
    expect(report.items.find((item) => item.id === 'temp-directory')?.status).toBe('pass');
    expect(report.items.find((item) => item.id === 'compiler')?.status).toBe('pass');
    expect(report.items.find((item) => item.id === 'cpp17-compile')?.status).toBe('pass');
    expect(report.items.find((item) => item.id === 'run-executable')?.status).toBe('pass');
    expect(report.items.find((item) => item.id === 'stdin-stdout')?.status).toBe('pass');
    expect(report.items.find((item) => item.id === 'file-io')?.status).toBe('pass');
    expect(report.items.find((item) => item.id === 'stop-process')?.status).toBe('pass');
  }, 30_000);
});
