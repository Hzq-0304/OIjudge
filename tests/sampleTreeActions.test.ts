import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  addEmptyProblemSample,
  addProblemInputSample,
  createProblem,
  createProblemSubtask,
  moveProblemSampleToSubtask,
  setProblemSubtaskResult,
  writeGeneratedAnswerForSample
} from '../src/problems';
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

    expect(setterCommands).toContain('oijudger.addSetterInputSample');
    expect(setterCommands).toContain('oijudger.generateAllSampleAnswersWithStd');
    expect(setterCommands).toContain('oijudger.addProblemGenerator');
    expect(setterCommands).toContain('oijudger.openProblemGenerator');
    expect(setterCommands).toContain('oijudger.removeProblemGenerator');
    expect(sampleCommands).toContain('oijudger.generateSampleAnswerWithStd');
    expect(sampleCommands).toContain('oijudger.setSampleName');
  });

  it('does not show setter input sample actions when setter mode is disabled', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const problemChildren = await provider.getChildren(problemNode);

    expect(problemChildren.find((node) => node.group === 'setter')).toBeUndefined();
  });

  it('marks setter input-only samples as answer not generated without an error context', async () => {
    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    await addProblemInputSample(workspaceFolder, problem.id);
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const sampleNode = (await provider.getChildren(samplesGroup))[0];
    const treeItem = provider.getTreeItem(sampleNode);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(sampleNode.description).toBe('Answer not generated');
    expect(treeItem.contextValue).toBe('sampleAnswerPending');
    expect(sampleCommands).toContain('oijudger.generateSampleAnswerWithStd');
    expect(sampleCommands).not.toContain('oijudger.openSampleAnswer');
    expect(sampleCommands).not.toContain('oijudger.openSampleUserOutput');
  });

  it('shows generated output pending actions for samples and the samples group', async () => {
    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);
    await fs.writeFile(path.join(workspaceFolder.uri.fsPath, sample?.answer ?? ''), 'old answer\n', 'utf8');
    await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'new answer\n');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const sampleNode = (await provider.getChildren(samplesGroup))[0];
    const treeItem = provider.getTreeItem(sampleNode);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(provider.getTreeItem(samplesGroup).contextValue).toBe('samplesGroupWithGeneratedOutputs');
    expect(sampleNode.description).toBe('Generated output pending');
    expect(treeItem.contextValue).toBe('sampleWithGeneratedOutput');
    expect(sampleCommands).toEqual(expect.arrayContaining([
      'oijudger.viewCurrentSampleAnswer',
      'oijudger.viewGeneratedSampleAnswer',
      'oijudger.diffGeneratedSampleAnswer',
      'oijudger.applyGeneratedSampleAnswer',
      'oijudger.deleteGeneratedSampleAnswer',
      'oijudger.generateSampleAnswerWithStd'
    ]));
  });

  it('does not show generated output actions after direct answer writes', async () => {
    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);
    await writeGeneratedAnswerForSample(workspaceFolder, problem.id, sample?.index ?? 0, 'answer\n');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const sampleNode = (await provider.getChildren(samplesGroup))[0];
    const treeItem = provider.getTreeItem(sampleNode);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(provider.getTreeItem(samplesGroup).contextValue).toBe('samplesGroup');
    expect(sampleNode.description).not.toBe('Generated output pending');
    expect(treeItem.contextValue).not.toBe('sampleWithGeneratedOutput');
    expect(sampleCommands).not.toContain('oijudger.applyGeneratedSampleAnswer');
    expect(sampleCommands).not.toContain('oijudger.deleteGeneratedSampleAnswer');
  });

  it('shows unassigned samples directly before subtask folders with status context values', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const first = await addEmptyProblemSample(workspaceFolder, problem.id);
    const second = await addEmptyProblemSample(workspaceFolder, problem.id);
    const subtask = await createProblemSubtask(workspaceFolder, problem.id, 'Subtask 1');
    await moveProblemSampleToSubtask(workspaceFolder, problem.id, second?.id ?? '', subtask?.id);
    await setProblemSubtaskResult(workspaceFolder, problem.id, subtask?.id ?? '', {
      status: 'failed',
      passed: 1,
      total: 2
    });
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const sampleNodes = await provider.getChildren(samplesGroup);
    const unassignedSample = sampleNodes.find((node) => node.kind === 'sample');
    const subtaskNode = sampleNodes.find((node) => node.group === 'subtask');
    const subtaskSamples = await provider.getChildren(subtaskNode);

    expect(sampleNodes.map((node) => node.kind)).toEqual(['sample', 'subtask']);
    expect(provider.getTreeItem(subtaskNode).contextValue).toBe('subtaskFailed');
    expect(subtaskNode?.description).toBe('✗ 1/2');
    expect(unassignedSample?.sampleId).toBe(first?.index);
    expect(subtaskSamples.map((node) => node.sampleId)).toEqual([second?.index]);
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
