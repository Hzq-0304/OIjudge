import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { addEmptyProblemSample, createProblem } from '../src/problems';
import { SampleTreeProvider } from '../src/sampleTreeProvider';

const workspaces: string[] = [];
const vscodeMock = vscode as unknown as {
  __resetConfiguration: () => void;
  __setConfiguration: (key: string, value: unknown) => void;
};

describe('sample tree add entry', () => {
  afterEach(async () => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    vscodeMock.__resetConfiguration();
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

  it('shows setter STD answer and generator actions when setter mode is enabled', async () => {
    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    await addEmptyProblemSample(workspaceFolder, problem.id);
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const problemChildren = await provider.getChildren(problemNode);
    const setterGroup = problemChildren.find((node) => node.group === 'setter');
    const samplesGroup = problemChildren.find((node) => node.group === 'samples');
    const sampleNode = (await provider.getChildren(samplesGroup))[0];

    const setterCommands = (await provider.getChildren(setterGroup)).map((node) => node.command?.command);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(setterCommands).toContain('oijudger.generateAllSampleAnswersWithStd');
    expect(setterCommands).toContain('oijudger.selectGeneratorProgram');
    expect(setterCommands).toContain('oijudger.openGeneratorProgram');
    expect(setterCommands).toContain('oijudger.clearGeneratorProgram');
    expect(sampleCommands).toContain('oijudger.generateSampleAnswerWithStd');
    expect(sampleCommands).toContain('oijudger.setSampleName');
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
