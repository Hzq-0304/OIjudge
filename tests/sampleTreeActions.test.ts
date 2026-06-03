import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { createProblem } from '../src/problems';
import { SampleTreeProvider } from '../src/sampleTreeProvider';

const workspaces: string[] = [];

describe('sample tree add entry', () => {
  afterEach(async () => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    await Promise.all(workspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('marks the samples group for the inline add action without binding a command to the group', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot)).find((node) => node.problemId === problem.id);
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const treeItem = provider.getTreeItem(samplesGroup);

    expect(treeItem.contextValue).toBe('samplesGroup');
    expect(samplesGroup?.problemId).toBe(problem.id);
    expect(samplesGroup?.command).toBeUndefined();
  });

  it('shows a passive empty sample hint without an add command', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const emptyNodes = await provider.getChildren(samplesGroup);

    expect(emptyNodes).toHaveLength(1);
    expect(emptyNodes[0].command).toBeUndefined();
  });

  it('does not include add sample entries in the problem actions group', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const actionsGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'actions');
    const actionCommands = (await provider.getChildren(actionsGroup)).map((node) => node.command?.command);

    expect(actionCommands).not.toContain('oijudger.addProblemSample');
    expect(actionCommands).not.toContain('oijudger.addProblemSampleFromFiles');
    expect(actionCommands).not.toContain('oijudger.batchAddSamples');
  });
});

async function createWorkspace(): Promise<vscode.WorkspaceFolder> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oijudge-tree-'));
  workspaces.push(dir);
  const workspaceFolder = {
    uri: { fsPath: dir }
  } as vscode.WorkspaceFolder;
  (vscode.workspace as { workspaceFolders?: vscode.WorkspaceFolder[] }).workspaceFolders = [workspaceFolder];
  return workspaceFolder;
}
