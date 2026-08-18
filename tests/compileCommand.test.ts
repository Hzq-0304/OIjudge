import { describe, expect, it } from 'vitest';
import {
  createDefaultConfig,
  formatCompileCommandTemplate,
  parseCompileCommandTemplate,
  setCompileCommand
} from '../src/config';

describe('compile command templates', () => {
  it('round-trips a compiler path with spaces and preserves source/output order', () => {
    const template = JSON.stringify([
      'C:\\Program Files\\LLVM\\bin\\clang++.exe',
      '-o',
      '${output}',
      '${file}',
      '-std=c++20'
    ]);

    const parsed = parseCompileCommandTemplate(template);

    expect(parsed).toEqual({
      ok: true,
      command: 'C:\\Program Files\\LLVM\\bin\\clang++.exe',
      args: ['-o', '${output}', '${file}', '-std=c++20']
    });
  });

  it('requires explicit source and output placeholders', () => {
    expect(parseCompileCommandTemplate('["g++","-O2","${file}"]')).toEqual({
      ok: false,
      error: 'missingOutputPlaceholder'
    });
    expect(parseCompileCommandTemplate('["g++","-O2","${output}"]')).toEqual({
      ok: false,
      error: 'missingSourcePlaceholder'
    });
  });

  it('updates both current and compatibility compile configuration', () => {
    const config = createDefaultConfig();
    setCompileCommand(config, 'clang++', ['${file}', '-o', '${output}']);

    expect(config.compiler).toEqual({
      command: 'clang++',
      args: ['${file}', '-o', '${output}']
    });
    expect(config.compile).toEqual(config.compiler);
    expect(formatCompileCommandTemplate(config)).toBe('["clang++","${file}","-o","${output}"]');
  });
});
