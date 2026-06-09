import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
  activationEvents?: string[];
  contributes: {
    commands: Array<{ command: string; icon?: string }>;
    menus: {
      'view/item/context': Array<{ command: string; when: string; group: string }>;
      commandPalette: Array<{ command: string; when: string }>;
    };
  };
};

describe('package tree sample add menu', () => {
  it('contributes a samples group inline add action', () => {
    const command = packageJson.contributes.commands.find((entry) => entry.command === 'oijudger.addSampleFromSamplesGroup');
    const menu = packageJson.contributes.menus['view/item/context'].find(
      (entry) => entry.command === 'oijudger.addSampleFromSamplesGroup'
    );

    expect(packageJson.activationEvents).toContain('onCommand:oijudger.addSampleFromSamplesGroup');
    expect(command?.icon).toBe('$(add)');
    expect(menu).toMatchObject({
      when: 'view == oijudger.samplesView && (viewItem == samplesGroup || viewItem == samplesGroupWithGeneratedOutputs)',
      group: 'inline@1'
    });
  });

  it('does not expose sample add commands on problem nodes through view item context', () => {
    const problemAddEntries = packageJson.contributes.menus['view/item/context'].filter((entry) =>
      ['oijudger.addProblemSample', 'oijudger.addProblemSampleFromFiles', 'oijudger.batchAddSamples'].includes(entry.command)
    );

    expect(problemAddEntries).toEqual([]);
  });

  it('contributes setter STD answer generation and generator menus behind setter mode', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const menuCommands = packageJson.contributes.menus['view/item/context'].filter((entry) =>
      [
        'oijudger.generateSampleAnswerWithStd',
        'oijudger.generateAllSampleAnswersWithStd',
        'oijudger.applyAllGeneratedSampleAnswers',
        'oijudger.addProblemGenerator',
        'oijudger.openProblemGenerator',
        'oijudger.removeProblemGenerator',
        'oijudger.addSetterInputSample',
        'oijudger.generateSampleInput',
        'oijudger.toggleAutoGenerateOutputFromStd'
      ].includes(entry.command)
    );

    expect(commands).toEqual(expect.arrayContaining([
      'oijudger.generateSampleAnswerWithStd',
      'oijudger.generateAllSampleAnswersWithStd',
      'oijudger.viewCurrentSampleAnswer',
      'oijudger.viewGeneratedSampleAnswer',
      'oijudger.diffGeneratedSampleAnswer',
      'oijudger.applyGeneratedSampleAnswer',
      'oijudger.deleteGeneratedSampleAnswer',
      'oijudger.applyAllGeneratedSampleAnswers',
      'oijudger.addProblemGenerator',
      'oijudger.openProblemGenerator',
      'oijudger.removeProblemGenerator',
      'oijudger.addProblemGeneratorInput',
      'oijudger.openProblemGeneratorInput',
      'oijudger.removeProblemGeneratorInput',
      'oijudger.addSetterInputSample',
      'oijudger.generateSampleInput',
      'oijudger.toggleAutoGenerateOutputFromStd'
    ]));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:oijudger.generateSampleAnswerWithStd',
      'onCommand:oijudger.generateAllSampleAnswersWithStd',
      'onCommand:oijudger.viewCurrentSampleAnswer',
      'onCommand:oijudger.viewGeneratedSampleAnswer',
      'onCommand:oijudger.diffGeneratedSampleAnswer',
      'onCommand:oijudger.applyGeneratedSampleAnswer',
      'onCommand:oijudger.deleteGeneratedSampleAnswer',
      'onCommand:oijudger.applyAllGeneratedSampleAnswers',
      'onCommand:oijudger.addProblemGenerator',
      'onCommand:oijudger.openProblemGenerator',
      'onCommand:oijudger.removeProblemGenerator',
      'onCommand:oijudger.addProblemGeneratorInput',
      'onCommand:oijudger.openProblemGeneratorInput',
      'onCommand:oijudger.removeProblemGeneratorInput',
      'onCommand:oijudger.addSetterInputSample',
      'onCommand:oijudger.generateSampleInput',
      'onCommand:oijudger.toggleAutoGenerateOutputFromStd'
    ]));
    expect(menuCommands).toHaveLength(9);
    expect(menuCommands.every((entry) => entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(menuCommands.find((entry) => entry.command === 'oijudger.generateSampleAnswerWithStd')?.when).toContain('viewItem == sample');
    expect(menuCommands.find((entry) => entry.command === 'oijudger.applyAllGeneratedSampleAnswers')?.when).toContain('samplesGroupWithGeneratedOutputs');
    expect(menuCommands.find((entry) => entry.command === 'oijudger.addProblemGenerator')?.when).toContain('viewItem == oijudgerProblemNormal');
    expect(menuCommands.find((entry) => entry.command === 'oijudger.generateSampleInput' && entry.group === 'inline@5')?.when)
      .toContain('samplesGroup');
    expect(menuCommands.find((entry) => entry.command === 'oijudger.toggleAutoGenerateOutputFromStd')?.when)
      .toContain('oijudgerProblemNormal');
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.addSetterInputSample',
      when: 'false'
    });
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.generateSampleInput',
      when: 'false'
    });
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.toggleAutoGenerateOutputFromStd',
      when: 'false'
    });
  });

  it('contributes global generator input menus behind setter mode', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const contextMenus = packageJson.contributes.menus['view/item/context'];

    expect(commands).toEqual(expect.arrayContaining([
      'oijudger.addProblemGeneratorInput',
      'oijudger.openProblemGeneratorInput',
      'oijudger.removeProblemGeneratorInput'
    ]));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:oijudger.addProblemGeneratorInput',
      'onCommand:oijudger.openProblemGeneratorInput',
      'onCommand:oijudger.removeProblemGeneratorInput'
    ]));
    expect(contextMenus.find((entry) => entry.command === 'oijudger.addProblemGeneratorInput' && entry.group === 'inline@4')?.when)
      .toContain('samplesGroup');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.addProblemGeneratorInput' && entry.group === 'inline@1')?.when)
      .toContain('globalGeneratorInputsRoot');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.openProblemGeneratorInput' && entry.group === 'inline@1')?.when)
      .toContain('globalGeneratorInputMissing');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.removeProblemGeneratorInput' && entry.group === 'inline@2')?.when)
      .toContain('globalGeneratorInput');
    for (const command of [
      'oijudger.addProblemGeneratorInput',
      'oijudger.openProblemGeneratorInput',
      'oijudger.removeProblemGeneratorInput'
    ]) {
      expect(contextMenus.filter((entry) => entry.command === command).every((entry) =>
        entry.when.includes('oijudger.setterModeEnabled')
      )).toBe(true);
      expect(packageJson.contributes.menus.commandPalette).toContainEqual({ command, when: 'false' });
    }
  });

  it('contributes custom scoring menus without requiring setter mode', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const scoringCommands = [
      'oijudger.setProblemTotalScore',
      'oijudger.setSampleScore',
      'oijudger.clearSampleScore',
      'oijudger.setSubtaskScoringMode'
    ];

    expect(commands).toEqual(expect.arrayContaining(scoringCommands));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining(
      scoringCommands.map((command) => `onCommand:${command}`)
    ));
    for (const command of scoringCommands) {
      const entries = contextMenus.filter((entry) => entry.command === command);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => !entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
      expect(packageJson.contributes.menus.commandPalette).toContainEqual({ command, when: 'false' });
    }
  });

  it('contributes generated answer review and apply menus for pending samples', () => {
    const generatedCommands = [
      'oijudger.viewCurrentSampleAnswer',
      'oijudger.viewGeneratedSampleAnswer',
      'oijudger.diffGeneratedSampleAnswer',
      'oijudger.applyGeneratedSampleAnswer',
      'oijudger.deleteGeneratedSampleAnswer'
    ];
    const menuCommands = packageJson.contributes.menus['view/item/context'].filter((entry) =>
      generatedCommands.includes(entry.command)
    );

    expect(menuCommands).toHaveLength(generatedCommands.length);
    expect(menuCommands.every((entry) => entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(menuCommands.every((entry) => entry.when.includes('sampleWithGeneratedOutput'))).toBe(true);
    for (const command of generatedCommands) {
      expect(packageJson.contributes.menus.commandPalette).toContainEqual({ command, when: 'false' });
    }
  });

  it('contributes subtask menus only to samples, sample, and subtask nodes', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const contextMenus = packageJson.contributes.menus['view/item/context'];

    expect(commands).toEqual(expect.arrayContaining([
      'oijudger.createSubtask',
      'oijudger.renameSubtask',
      'oijudger.deleteSubtask',
      'oijudger.bindSubtaskGeneratorInput',
      'oijudger.openSubtaskGeneratorInput',
      'oijudger.clearSubtaskGeneratorInput',
      'oijudger.bindSubtaskGenerator',
      'oijudger.openSubtaskGenerator',
      'oijudger.clearSubtaskGenerator',
      'oijudger.runSubtask',
      'oijudger.generateSubtaskSampleInput',
      'oijudger.moveSampleToSubtask'
    ]));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:oijudger.createSubtask',
      'onCommand:oijudger.renameSubtask',
      'onCommand:oijudger.deleteSubtask',
      'onCommand:oijudger.bindSubtaskGeneratorInput',
      'onCommand:oijudger.openSubtaskGeneratorInput',
      'onCommand:oijudger.clearSubtaskGeneratorInput',
      'onCommand:oijudger.bindSubtaskGenerator',
      'onCommand:oijudger.openSubtaskGenerator',
      'onCommand:oijudger.clearSubtaskGenerator',
      'onCommand:oijudger.runSubtask',
      'onCommand:oijudger.generateSubtaskSampleInput',
      'onCommand:oijudger.moveSampleToSubtask'
    ]));

    expect(contextMenus.find((entry) => entry.command === 'oijudger.createSubtask')).toMatchObject({
      when: 'view == oijudger.samplesView && (viewItem == samplesGroup || viewItem == samplesGroupWithGeneratedOutputs)',
      group: 'inline@2'
    });
    expect(contextMenus.find((entry) => entry.command === 'oijudger.runSubtask' && entry.group === 'inline@1')?.when)
      .toContain('viewItem == subtask');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.bindSubtaskGenerator' && entry.group === 'inline@2'))
      .toMatchObject({
        when: 'view == oijudger.samplesView && oijudger.setterModeEnabled && (viewItem == subtask || viewItem == subtaskPassed || viewItem == subtaskFailed)',
        group: 'inline@2'
      });
    expect(contextMenus.find((entry) => entry.command === 'oijudger.bindSubtaskGeneratorInput' && entry.group === 'inline@3'))
      .toMatchObject({
        when: 'view == oijudger.samplesView && oijudger.setterModeEnabled && (viewItem == subtask || viewItem == subtaskPassed || viewItem == subtaskFailed)',
        group: 'inline@3'
      });
    expect(contextMenus.find((entry) => entry.command === 'oijudger.generateSubtaskSampleInput' && entry.group === 'inline@4'))
      .toMatchObject({
        when: 'view == oijudger.samplesView && oijudger.setterModeEnabled && (viewItem == subtask || viewItem == subtaskPassed || viewItem == subtaskFailed)',
        group: 'inline@4'
      });
    expect(contextMenus.find((entry) => entry.command === 'oijudger.renameSubtask')?.when)
      .toContain('viewItem == subtask');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.deleteSubtask')?.when)
      .toContain('viewItem == subtask');
    for (const command of [
      'oijudger.bindSubtaskGeneratorInput',
      'oijudger.openSubtaskGeneratorInput',
      'oijudger.clearSubtaskGeneratorInput',
      'oijudger.bindSubtaskGenerator',
      'oijudger.openSubtaskGenerator',
      'oijudger.clearSubtaskGenerator'
    ]) {
      const menu = contextMenus.find((entry) => entry.command === command);
      expect(menu?.when).toContain('view == oijudger.samplesView');
      expect(menu?.when).toContain('oijudger.setterModeEnabled');
      expect(menu?.when).toContain('viewItem == subtask');
      expect(menu?.when).toContain('viewItem == subtaskPassed');
      expect(menu?.when).toContain('viewItem == subtaskFailed');
    }
    expect(contextMenus.find((entry) => entry.command === 'oijudger.moveSampleToSubtask')?.when)
      .toContain('viewItem == sample');

    for (const command of [
      'oijudger.createSubtask',
      'oijudger.renameSubtask',
      'oijudger.deleteSubtask',
      'oijudger.bindSubtaskGeneratorInput',
      'oijudger.openSubtaskGeneratorInput',
      'oijudger.clearSubtaskGeneratorInput',
      'oijudger.bindSubtaskGenerator',
      'oijudger.openSubtaskGenerator',
      'oijudger.clearSubtaskGenerator',
      'oijudger.runSubtask',
      'oijudger.generateSubtaskSampleInput',
      'oijudger.moveSampleToSubtask'
    ]) {
      expect(packageJson.contributes.menus.commandPalette).toContainEqual({ command, when: 'false' });
    }
  });
});
