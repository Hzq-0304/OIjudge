import { describe, expect, it } from 'vitest';
import { createWorkspaceManagementItems } from '../src/extension';

describe('workspace management actions', () => {
  it('offers the existing workspace commands through the management picker', () => {
    expect(createWorkspaceManagementItems().map((item) => item.command)).toEqual([
      'oijudger.createProblem',
      'oijudger.addProblemFromCurrentFile',
      'oijudger.addProblemFromFile',
      'oijudger.refreshView',
      'oijudger.importLegacyProblem',
      'oijudger.checkEnvironment'
    ]);
  });
});
