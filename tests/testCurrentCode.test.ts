import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import {
  createRecentEditorFileFromDocument,
  isStrictCppFilePath,
  resolveProblemGeneratorPathForStress,
  resolveProblemStdPathForStress,
  resolveCurrentCodeDocument
} from '../src/extension';
import { ProblemConfig } from '../src/types';

function document(fsPath: string, scheme = 'file'): vscode.TextDocument {
  return {
    uri: { scheme, fsPath } as vscode.Uri,
    isDirty: false,
    save: async () => true
  } as vscode.TextDocument;
}

function editor(document: vscode.TextDocument): Pick<vscode.TextEditor, 'document'> {
  return { document };
}

describe('Test Current Code editor resolution', () => {
  it('accepts only exact .cpp file extensions', () => {
    expect(isStrictCppFilePath('E:/work/main.cpp')).toBe(true);
    expect(isStrictCppFilePath('E:/work/main.CPP')).toBe(true);
    expect(isStrictCppFilePath('E:/work/main.cc')).toBe(false);
    expect(isStrictCppFilePath('E:/work/main.cxx')).toBe(false);
    expect(isStrictCppFilePath('E:/work/main.cpp.txt')).toBe(false);
  });

  it('uses the active editor before the recent editor file', () => {
    const active = document('E:/work/notes.txt');
    const recentCpp = createRecentEditorFileFromDocument(document('E:/work/main.cpp'), 1);
    const result = resolveCurrentCodeDocument(editor(active), recentCpp, [active, document('E:/work/main.cpp')]);

    expect(result).toEqual({ ok: false, reason: 'notCpp' });
  });

  it('uses the recent focused file when there is no active editor', () => {
    const recentDocument = document('E:/work/main.cpp');
    const recent = createRecentEditorFileFromDocument(recentDocument, 1);
    const result = resolveCurrentCodeDocument(undefined, recent, [recentDocument]);

    expect(result).toMatchObject({ ok: true, document: recentDocument });
  });

  it('does not fall back to an older cpp when the recent file is non-cpp', () => {
    const recentDocument = document('E:/work/notes.md');
    const recent = createRecentEditorFileFromDocument(recentDocument, 2);
    const olderCpp = document('E:/work/main.cpp');
    const result = resolveCurrentCodeDocument(undefined, recent, [olderCpp, recentDocument]);

    expect(result).toEqual({ ok: false, reason: 'notCpp' });
  });

  it('rejects virtual or untitled active editors instead of falling back', () => {
    const active = document('Untitled-1', 'untitled');
    const recentCpp = createRecentEditorFileFromDocument(document('E:/work/main.cpp'), 1);
    const result = resolveCurrentCodeDocument(editor(active), recentCpp, [document('E:/work/main.cpp')]);

    expect(result).toEqual({ ok: false, reason: 'notLocal' });
  });

  it('requires the recent file to still be open', () => {
    const recent = createRecentEditorFileFromDocument(document('E:/work/main.cpp'), 1);
    const result = resolveCurrentCodeDocument(undefined, recent, []);

    expect(result).toEqual({ ok: false, reason: 'notOpen' });
  });

  it('records local non-cpp files and ignores non-file documents', () => {
    const markdown = document('E:/work/readme.md');
    const untitled = document('Untitled-1', 'untitled');

    expect(createRecentEditorFileFromDocument(markdown, 7)).toMatchObject({
      fsPath: 'E:/work/readme.md',
      timestamp: 7
    });
    expect(createRecentEditorFileFromDocument(untitled, 7)).toBeUndefined();
  });

  it('reports configured generator and STD files as missing when paths do not exist', () => {
    const workspaceFolder = workspace('E:/work');
    const problem = problemConfig({
      setter: {
        stdProgram: 'std.cpp',
        generator: {
          enabled: true,
          generators: [{
            id: 'generator',
            name: 'gen.cpp',
            source: { path: 'gen.cpp' }
          }]
        }
      }
    });

    expect(resolveProblemGeneratorPathForStress(workspaceFolder, problem)).toEqual({
      ok: false,
      reason: 'notFound'
    });
    expect(resolveProblemStdPathForStress(workspaceFolder, problem)).toEqual({
      ok: false,
      reason: 'notFound'
    });
  });

  it('reports missing generator and STD configuration without guessing files', () => {
    const workspaceFolder = workspace('E:/work');
    const problem = problemConfig();

    expect(resolveProblemGeneratorPathForStress(workspaceFolder, problem)).toEqual({
      ok: false,
      reason: 'missing'
    });
    expect(resolveProblemStdPathForStress(workspaceFolder, problem)).toEqual({
      ok: false,
      reason: 'missing'
    });
  });
});

function workspace(fsPath: string): vscode.WorkspaceFolder {
  return {
    uri: { fsPath, scheme: 'file' } as vscode.Uri,
    name: 'work',
    index: 0
  };
}

function problemConfig(overrides: Partial<ProblemConfig> = {}): ProblemConfig {
  return {
    version: 1,
    id: 'a',
    name: 'A',
    standard: 'c++17',
    compiler: {
      command: 'g++',
      args: ['${file}', '-o', '${output}']
    },
    limits: {
      timeMs: 1000,
      memoryMb: 256
    },
    samples: [],
    ...overrides
  };
}
