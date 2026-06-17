import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  addEmptyProblemSample,
  addProblemSample,
  addProblemGeneratorInputs,
  addProblemInputSample,
  createProblem,
  createProblemSubtask,
  moveProblemSampleToSubtask,
  saveProblemReport,
  setProblemSubtaskResult,
  writeGeneratedAnswerForSample
} from '../src/problems';
import { formatVerdictText, SampleTreeProvider, withSamplesRunning } from '../src/sampleTreeProvider';
import { SampleConfig, SampleStatus } from '../src/types';
import { formatVerdictAcronym } from '../src/verdict';

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

  it('groups problem children into focused sections', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const problemChildren = await provider.getChildren(problemNode);

    expect(problemChildren.map((node) => node.group)).toEqual([
      'statement',
      'programs',
      'configuration',
      'limits',
      'samples',
      'actions'
    ]);
    expect(problemChildren.every((node) => node.kind === 'group')).toBe(true);
  });

  it('consolidates workspace operations behind a single management entry', async () => {
    await createWorkspace();
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const workspaceGroup = rootNodes.find((node) => node.group === 'workspaceActions');
    const workspaceActions = await provider.getChildren(workspaceGroup);

    expect(workspaceActions.map((node) => node.command?.command)).toEqual(['oijudger.manageWorkspace']);
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

  it('moves statement actions under the statement group', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const problemChildren = await provider.getChildren(problemNode);
    const statementGroup = problemChildren.find((node) => node.group === 'statement');
    const actionsGroup = problemChildren.find((node) => node.group === 'actions');
    const statementCommands = (await provider.getChildren(statementGroup)).map((node) => node.command?.command);
    const actionCommands = (await provider.getChildren(actionsGroup)).map((node) => node.command?.command);

    expect(statementCommands).toContain('oijudger.bindStatement');
    expect(actionCommands).not.toContain('oijudger.bindStatement');
    expect(actionCommands).not.toContain('oijudger.openStatement');
    expect(actionCommands).not.toContain('oijudger.unbindStatement');
  });

  it('moves program setup under the programs group', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const programsGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'programs');
    const programCommands = (await provider.getChildren(programsGroup)).map((node) => node.command?.command);

    expect(programCommands).toEqual(expect.arrayContaining([
      'oijudger.setDefaultProgram',
      'oijudger.selectProblemCompiler',
      'oijudger.addProgramToProblem'
    ]));
  });

  it('moves judge and IO setup under the configuration group', async () => {
    const workspaceFolder = await createWorkspace();
    await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const configurationGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'configuration');
    const configurationCommands = (await provider.getChildren(configurationGroup)).map((node) => node.command?.command);

    expect(configurationCommands).toEqual(expect.arrayContaining([
      'oijudger.setProblemStandard',
      'oijudger.setJudgeMode',
      'oijudger.setIoMode'
    ]));
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
    const sampleNode = (await provider.getChildren(samplesGroup)).find((node) => node.kind === 'sample');

    const setterSections = await provider.getChildren(setterGroup);
    const stdGroup = setterSections.find((node) => node.group === 'setterStd');
    const generatorGroup = setterSections.find((node) => node.group === 'setterGenerator');
    const testcasesGroup = setterSections.find((node) => node.group === 'setterTestcases');
    const stdCommands = (await provider.getChildren(stdGroup)).map((node) => node.command?.command);
    const generatorCommands = (await provider.getChildren(generatorGroup)).map((node) => node.command?.command);
    const testcaseCommands = (await provider.getChildren(testcasesGroup)).map((node) => node.command?.command);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(setterSections.map((node) => node.group)).toEqual([
      'setterStd',
      'setterGenerator',
      'setterTestcases'
    ]);
    expect(stdCommands).toContain('oijudger.generateAllSampleAnswersWithStd');
    expect(generatorCommands).toContain('oijudger.toggleAutoGenerateOutputFromStd');
    expect(generatorCommands).toContain('oijudger.addProblemGenerator');
    expect(generatorCommands).toContain('oijudger.openProblemGenerator');
    expect(generatorCommands).toContain('oijudger.removeProblemGenerator');
    expect(testcaseCommands).toContain('oijudger.addSetterInputSample');
    expect(testcaseCommands).toContain('oijudger.exportTestcases');
    expect(sampleCommands).toContain('oijudger.generateSampleAnswerWithStd');
    expect(sampleCommands).toContain('oijudger.setSampleName');
  });

  it('shows the auto STD output state in configuration and generator groups', async () => {
    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const problemChildren = await provider.getChildren(problemNode);
    const configurationGroup = problemChildren.find((node) => node.group === 'configuration');
    const setterGroup = problemChildren.find((node) => node.group === 'setter');
    const generatorGroup = (await provider.getChildren(setterGroup)).find((node) => node.group === 'setterGenerator');
    const configurationAutoOutputNode = (await provider.getChildren(configurationGroup)).find((node) =>
      node.command?.command === 'oijudger.toggleAutoGenerateOutputFromStd'
    );
    const autoOutputNode = (await provider.getChildren(generatorGroup)).find((node) =>
      node.command?.command === 'oijudger.toggleAutoGenerateOutputFromStd'
    );

    expect(configurationAutoOutputNode?.label).toBe('Auto STD Output: On');
    expect(autoOutputNode?.label).toBe('Auto STD Output: On');
    expect(autoOutputNode?.command?.arguments).toEqual([problem.id]);
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

  it('shows sample scoring actions when setter mode is disabled', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    await addEmptyProblemSample(workspaceFolder, problem.id);
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const sampleNode = (await provider.getChildren(samplesGroup)).find((node) => node.kind === 'sample');
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(sampleCommands).toContain('oijudger.runProblemSample');
    expect(sampleCommands).toContain('oijudger.setSampleScore');
    expect(sampleCommands).toContain('oijudger.clearSampleScore');
  });

  it('shows global generator inputs only in setter mode', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'inputs', 'small.txt');
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, 'small\n', 'utf8');
    await addProblemGeneratorInputs(workspaceFolder, problem.id, [inputPath]);
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    expect((await provider.getChildren(samplesGroup)).find((node) => node.group === 'generatorInputs')).toBeUndefined();

    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const setterNodes = await provider.getChildren(samplesGroup);
    const inputsRoot = setterNodes.find((node) => node.group === 'generatorInputs');
    const inputNodes = await provider.getChildren(inputsRoot);

    expect(provider.getTreeItem(inputsRoot).contextValue).toBe('globalGeneratorInputsRoot');
    expect(inputNodes[0].label).toBe('small.txt');
    expect(provider.getTreeItem(inputNodes[0]).contextValue).toBe('globalGeneratorInput');
    expect(inputNodes[0].command?.command).toBe('oijudger.openProblemGeneratorInput');
  });

  it('marks missing global generator inputs in the sample tree', async () => {
    vscodeMock.__setConfiguration('setterMode.enabled', true);
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const inputPath = path.join(workspaceFolder.uri.fsPath, 'inputs', 'missing.txt');
    await fs.mkdir(path.dirname(inputPath), { recursive: true });
    await fs.writeFile(inputPath, 'missing soon\n', 'utf8');
    await addProblemGeneratorInputs(workspaceFolder, problem.id, [inputPath]);
    await fs.rm(inputPath);
    const provider = new SampleTreeProvider();

    const rootNodes = await provider.getChildren();
    const problemsRoot = rootNodes.find((node) => node.group === 'problems');
    const problemNode = (await provider.getChildren(problemsRoot))[0];
    const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
    const inputsRoot = (await provider.getChildren(samplesGroup)).find((node) => node.group === 'generatorInputs');
    const inputNode = (await provider.getChildren(inputsRoot))[0];

    expect(inputNode.description).toBe('Missing');
    expect(provider.getTreeItem(inputNode).contextValue).toBe('globalGeneratorInputMissing');
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
    const sampleNode = (await provider.getChildren(samplesGroup)).find((node) => node.kind === 'sample');
    const treeItem = provider.getTreeItem(sampleNode);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(sampleNode.description).toBe('Answer not generated  100 Auto');
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
    const sampleNode = (await provider.getChildren(samplesGroup)).find((node) => node.kind === 'sample');
    const treeItem = provider.getTreeItem(sampleNode);
    const sampleCommands = (await provider.getChildren(sampleNode)).map((node) => node.command?.command);

    expect(provider.getTreeItem(samplesGroup).contextValue).toBe('samplesGroupWithGeneratedOutputs');
    expect(sampleNode.description).toBe('Generated output pending  100 Auto');
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

  it('shows and clears a spinner icon for a single running sample', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addEmptyProblemSample(workspaceFolder, problem.id);
    const provider = new SampleTreeProvider();

    const initialNode = (await getSampleNodes(provider))[0];
    const initialItem = provider.getTreeItem(initialNode);
    provider.markSamplesRunning(problem.id, [sample?.id ?? '']);
    const runningNode = (await getSampleNodes(provider))[0];
    const runningItem = provider.getTreeItem(runningNode);
    provider.clearSamplesRunning(problem.id, [sample?.id ?? '']);
    const clearedNode = (await getSampleNodes(provider))[0];
    const clearedItem = provider.getTreeItem(clearedNode);

    expect(provider.isSampleRunning(problem.id, sample?.id ?? '')).toBe(false);
    expect(iconId(initialItem)).toBe('circle-outline');
    expect(runningItem.label).toBe(`RUN ${sample?.name}`);
    expect(iconId(runningItem)).toBe('sync~spin');
    expect(iconId(clearedItem)).toBe('circle-outline');
    expect(clearedItem.contextValue).toBe(initialItem.contextValue);
    expect(clearedItem.command).toEqual(initialItem.command);
    expect(clearedItem.tooltip).toEqual(initialItem.tooltip);
  });

  it('shows spinner icons for multiple running samples', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const first = await addEmptyProblemSample(workspaceFolder, problem.id);
    const second = await addEmptyProblemSample(workspaceFolder, problem.id);
    const provider = new SampleTreeProvider();

    provider.markSamplesRunning(problem.id, [first?.id ?? '', second?.id ?? '']);
    const sampleItems = await Promise.all((await getSampleNodes(provider)).map((node) => provider.getTreeItem(node)));

    expect(sampleItems.map(iconId)).toEqual(['sync~spin', 'sync~spin']);
  });

  it('keeps running keys scoped by problem id', async () => {
    const workspaceFolder = await createWorkspace();
    const firstProblem = await createProblem(workspaceFolder, 'A');
    const secondProblem = await createProblem(workspaceFolder, 'B');
    const firstSample = await addEmptyProblemSample(workspaceFolder, firstProblem.id);
    await addEmptyProblemSample(workspaceFolder, secondProblem.id);
    const provider = new SampleTreeProvider();

    provider.markSamplesRunning(firstProblem.id, [firstSample?.id ?? '']);
    const firstItem = provider.getTreeItem((await getSampleNodes(provider, 0))[0]);
    const secondItem = provider.getTreeItem((await getSampleNodes(provider, 1))[0]);

    expect(iconId(firstItem)).toBe('sync~spin');
    expect(iconId(secondItem)).toBe('circle-outline');
  });

  it('shows running text and spinner before restoring the AC check icon afterward', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    await saveProblemReport(workspaceFolder, problem.id, {
      source: 'main.cpp',
      generatedAt: '2026-06-16T00:00:00.000Z',
      limits: { timeMs: 1000, memoryMb: 256 },
      summary: { accepted: 1, total: 1 },
      samples: [{
        id: sample?.id,
        index: sample?.index ?? 1,
        name: sample?.name ?? 'Sample 1',
        input: sample?.input ?? 'sample-1.in',
        answer: sample?.answer ?? 'sample-1.out',
        actualOutput: sample?.actualOutput ?? 'useroutput.txt',
        status: 'AC',
        timeMs: 1,
        elapsedMs: 1
      }],
      results: []
    });
    const provider = new SampleTreeProvider();

    const passedItem = provider.getTreeItem((await getSampleNodes(provider))[0]);
    provider.markSamplesRunning(problem.id, [sample?.id ?? '']);
    const runningItem = provider.getTreeItem((await getSampleNodes(provider))[0]);
    provider.clearSamplesRunning(problem.id, [sample?.id ?? '']);
    const restoredItem = provider.getTreeItem((await getSampleNodes(provider))[0]);

    expect(passedItem.label).toBe(sample?.name);
    expect(iconId(passedItem)).toBe('check');
    expect(iconColorId(passedItem)).toBe('testing.iconPassed');
    expect(runningItem.label).toBe(`RUN ${sample?.name}`);
    expect(iconId(runningItem)).toBe('sync~spin');
    expect(restoredItem.label).toBe(sample?.name);
    expect(iconId(restoredItem)).toBe('check');
  });

  it('shows an AC check icon and non-AC verdict acronyms without status icons', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const first = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    const second = await addProblemSample(workspaceFolder, problem.id, '2\n', '2\n', { decodeEscapes: false });
    const third = await addProblemSample(workspaceFolder, problem.id, '3\n', '3\n', { decodeEscapes: false });
    const fourth = await addProblemSample(workspaceFolder, problem.id, '4\n', '4\n', { decodeEscapes: false });
    await saveProblemReport(workspaceFolder, problem.id, {
      source: 'main.cpp',
      generatedAt: '2026-06-16T00:00:00.000Z',
      limits: { timeMs: 1000, memoryMb: 256 },
      summary: { accepted: 1, total: 4 },
      samples: [
        reportSample(first, 'AC'),
        reportSample(second, 'WA'),
        reportSample(third, 'MLE'),
        reportSample(fourth, 'TLE')
      ],
      results: []
    });
    const provider = new SampleTreeProvider();

    const items = (await getSampleNodes(provider)).map((node) => provider.getTreeItem(node));

    expect(items.map((item) => item.label)).toEqual([
      first?.name,
      `WA ${second?.name}`,
      `MLE ${third?.name}`,
      `TLE ${fourth?.name}`
    ]);
    expect(items.map(iconId)).toEqual(['check', undefined, undefined, undefined]);
    expect(iconColorId(items[0])).toBe('testing.iconPassed');
    expect(items.map((item) => item.description)).toEqual(['1ms  25/25', '1ms  0/25', '1ms  0/25', '1ms  0/25']);
  });

  it('keeps the spinner ahead of verdict text and restores verdict text afterward', async () => {
    const workspaceFolder = await createWorkspace();
    const problem = await createProblem(workspaceFolder, 'A');
    const sample = await addProblemSample(workspaceFolder, problem.id, '1\n', '1\n', { decodeEscapes: false });
    await saveProblemReport(workspaceFolder, problem.id, {
      source: 'main.cpp',
      generatedAt: '2026-06-16T00:00:00.000Z',
      limits: { timeMs: 1000, memoryMb: 256 },
      summary: { accepted: 0, total: 1 },
      samples: [reportSample(sample, 'WA')],
      results: []
    });
    const provider = new SampleTreeProvider();

    provider.markSamplesRunning(problem.id, [sample?.id ?? '']);
    const runningItem = provider.getTreeItem((await getSampleNodes(provider))[0]);
    provider.clearSamplesRunning(problem.id, [sample?.id ?? '']);
    const restoredItem = provider.getTreeItem((await getSampleNodes(provider))[0]);

    expect(runningItem.label).toBe(`RUN ${sample?.name}`);
    expect(runningItem.description).toBe('0/100');
    expect(iconId(runningItem)).toBe('sync~spin');
    expect(restoredItem.label).toBe(`WA ${sample?.name}`);
    expect(restoredItem.description).toBe('1ms  0/100');
  });

  it('maps all sample statuses to explicit verdict acronyms', () => {
    expect([
      'AC',
      'WA',
      'TLE',
      'OLE',
      'MLE',
      'RE',
      'CE',
      'ERR',
      'Checker Error',
      'Scored',
      'Skipped',
      'Missing',
      'Output Missing',
      'Not Run'
    ].map((status) => formatVerdictAcronym(status))).toEqual([
      'AC',
      'WA',
      'TLE',
      'OLE',
      'MLE',
      'RE',
      'CE',
      'UNKNOWN',
      'CHECKER',
      'SCORED',
      'SKIP',
      'MISSING',
      'OUTPUT',
      ''
    ]);
    expect(formatVerdictText('MLE')).toBe('MLE');
  });

  it('withSamplesRunning marks all samples during a run and clears them afterward', async () => {
    const provider = new SampleTreeProvider();
    const seen: boolean[] = [];

    await withSamplesRunning(provider, 'A', ['sample-1', 'sample-2'], async () => {
      seen.push(provider.isSampleRunning('A', 'sample-1'));
      seen.push(provider.isSampleRunning('A', 'sample-2'));
    });

    expect(seen).toEqual([true, true]);
    expect(provider.isSampleRunning('A', 'sample-1')).toBe(false);
    expect(provider.isSampleRunning('A', 'sample-2')).toBe(false);
  });

  it('withSamplesRunning clears running samples when a run throws', async () => {
    const provider = new SampleTreeProvider();

    await expect(withSamplesRunning(provider, 'A', ['sample-1'], async () => {
      expect(provider.isSampleRunning('A', 'sample-1')).toBe(true);
      throw new Error('compile failed');
    })).rejects.toThrow('compile failed');

    expect(provider.isSampleRunning('A', 'sample-1')).toBe(false);
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

async function getSampleNodes(provider: SampleTreeProvider, problemIndex = 0): Promise<any[]> {
  const rootNodes = await provider.getChildren();
  const problemsRoot = rootNodes.find((node) => node.group === 'problems');
  const problemNode = (await provider.getChildren(problemsRoot))[problemIndex];
  const samplesGroup = (await provider.getChildren(problemNode)).find((node) => node.group === 'samples');
  return (await provider.getChildren(samplesGroup)).filter((node) => node.kind === 'sample');
}

function iconId(item: vscode.TreeItem): string | undefined {
  return (item.iconPath as { id?: string } | undefined)?.id;
}

function iconColorId(item: vscode.TreeItem): string | undefined {
  return (item.iconPath as { color?: { id?: string } } | undefined)?.color?.id;
}

function reportSample(sample: SampleConfig | undefined, status: SampleStatus) {
  return {
    id: sample?.id ?? '',
    index: sample?.index ?? 1,
    name: sample?.name ?? 'Sample',
    input: sample?.input ?? 'sample.in',
    answer: sample?.answer ?? 'sample.out',
    actualOutput: sample?.actualOutput ?? 'useroutput.txt',
    status,
    timeMs: 1,
    elapsedMs: 1
  };
}
