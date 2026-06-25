import { promises as fs } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('interactive examples', () => {
  it('ships a guess-number example without non-portable C++ headers', async () => {
    const root = path.join(process.cwd(), 'examples', 'interactive', 'guess-number');
    const requiredFiles = [
      'README.md',
      'solution.cpp',
      'solution-wa.cpp',
      'solution-timeout.cpp',
      'interactor.cpp',
      'oijudge.config.json',
      path.join('samples', '1.in'),
      path.join('samples', '2.in'),
      path.join('samples', '3.in')
    ];

    for (const file of requiredFiles) {
      await expect(fs.access(path.join(root, file))).resolves.toBeUndefined();
    }

    const config = JSON.parse(await fs.readFile(path.join(root, 'oijudge.config.json'), 'utf8')) as {
      mode?: string;
      interactive?: {
        solution?: string;
        interactor?: string;
        interactorArgs?: string[];
      };
      samples?: unknown[];
    };
    expect(config.mode).toBe('interactive');
    expect(config.interactive?.solution).toBe('solution.cpp');
    expect(config.interactive?.interactor).toBe('interactor.cpp');
    expect(config.interactive?.interactorArgs).toEqual(['{input}']);
    expect(config.samples).toHaveLength(3);

    for (const file of ['solution.cpp', 'solution-wa.cpp', 'solution-timeout.cpp', 'interactor.cpp']) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      expect(content).not.toContain('<bits/stdc++.h>');
    }
  });

  it('ships a testlib-like double example with runnable default config and reference testlib config', async () => {
    const root = path.join(process.cwd(), 'examples', 'interactive', 'testlib-like-double');
    const requiredFiles = [
      'README.md',
      'solution.cpp',
      'solution-wa.cpp',
      'interactor.cpp',
      'interactor-testlib.cpp',
      'oijudge.config.json',
      'oijudge.testlib.config.json',
      path.join('samples', '1.in'),
      path.join('samples', '1.ans'),
      path.join('samples', '2.in'),
      path.join('samples', '2.ans')
    ];

    for (const file of requiredFiles) {
      await expect(fs.access(path.join(root, file))).resolves.toBeUndefined();
    }

    const config = JSON.parse(await fs.readFile(path.join(root, 'oijudge.config.json'), 'utf8')) as {
      mode?: string;
      interactive?: {
        solution?: string;
        interactor?: string;
        interactorPreset?: string;
        interactorArgs?: string[];
        useTestlib?: boolean;
      };
      samples?: unknown[];
    };
    expect(config.mode).toBe('interactive');
    expect(config.interactive?.solution).toBe('solution.cpp');
    expect(config.interactive?.interactor).toBe('interactor.cpp');
    expect(config.interactive?.interactorPreset).toBe('testlib');
    expect(config.interactive?.interactorArgs).toBeUndefined();
    expect(config.interactive?.useTestlib).toBe(false);
    expect(config.samples).toHaveLength(2);

    const testlibConfig = JSON.parse(await fs.readFile(path.join(root, 'oijudge.testlib.config.json'), 'utf8')) as {
      interactive?: {
        interactor?: string;
        interactorPreset?: string;
        useTestlib?: boolean;
        testlibHeader?: string;
      };
    };
    expect(testlibConfig.interactive?.interactor).toBe('interactor-testlib.cpp');
    expect(testlibConfig.interactive?.interactorPreset).toBe('testlib');
    expect(testlibConfig.interactive?.useTestlib).toBe(true);
    expect(testlibConfig.interactive?.testlibHeader).toBe('third_party/testlib.h');

    for (const file of ['solution.cpp', 'solution-wa.cpp', 'interactor.cpp', 'interactor-testlib.cpp']) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      expect(content).not.toContain('<bits/stdc++.h>');
    }

    await expect(fs.access(path.join(root, 'third_party', 'testlib.h'))).rejects.toThrow();
  });
});
