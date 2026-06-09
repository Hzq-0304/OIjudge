import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
  activationEvents?: string[];
  contributes: {
    commands: Array<{ command: string; icon?: string }>;
    views: Record<string, Array<{ id: string; name: string }>>;
    menus: {
      'view/title': Array<{ command: string; when: string; group: string }>;
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

  it('contributes testcase export menus without requiring setter mode', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const entries = contextMenus.filter((entry) => entry.command === 'oijudger.exportTestcases');

    expect(commands).toContain('oijudger.exportTestcases');
    expect(packageJson.activationEvents).toContain('onCommand:oijudger.exportTestcases');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => !entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(entries.some((entry) => entry.when.includes('samplesGroup'))).toBe(true);
    expect(entries.some((entry) => entry.when.includes('oijudgerProblemNormal'))).toBe(true);
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.exportTestcases',
      when: 'false'
    });
  });

  it('contributes stress test entry without requiring setter mode', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const titleMenus = packageJson.contributes.menus['view/title'].filter((entry) =>
      entry.command === 'oijudger.runStressTest'
    );
    const contextMenus = packageJson.contributes.menus['view/item/context'].filter((entry) =>
      entry.command === 'oijudger.runStressTest'
    );

    expect(commands).toContain('oijudger.runStressTest');
    expect(packageJson.activationEvents).toContain('onCommand:oijudger.runStressTest');
    expect(titleMenus).toContainEqual({
      command: 'oijudger.runStressTest',
      when: 'view == oijudger.samplesView',
      group: 'navigation@4'
    });
    expect(contextMenus.length).toBeGreaterThan(0);
    expect(contextMenus.every((entry) => !entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(contextMenus.some((entry) => entry.when.includes('oijudgerProblemNormal'))).toBe(true);
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.runStressTest',
      when: 'false'
    });
  });

  it('contributes stress records view and management commands', () => {
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const stressView = packageJson.contributes.views.oijudger.find((entry) =>
      entry.id === 'oijudger.stressRecordsView'
    );
    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const managementCommands = [
      'oijudger.refreshStressRecords',
      'oijudger.openStressFile',
      'oijudger.addStressCaseToSamples',
      'oijudger.rerunStressCase',
      'oijudger.revealStressSessionFolder'
    ];

    expect(stressView?.name).toBe('对拍记录/Stress Records');
    expect(commands).toEqual(expect.arrayContaining(managementCommands));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining([
      'onView:oijudger.stressRecordsView',
      ...managementCommands.map((command) => `onCommand:${command}`)
    ]));
    expect(packageJson.contributes.menus['view/title']).toContainEqual({
      command: 'oijudger.refreshStressRecords',
      when: 'view == oijudger.stressRecordsView',
      group: 'navigation@1'
    });
    expect(contextMenus.find((entry) => entry.command === 'oijudger.addStressCaseToSamples')?.when)
      .toBe('view == oijudger.stressRecordsView && viewItem == stressFailedCase');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.rerunStressCase')?.when)
      .toBe('view == oijudger.stressRecordsView && viewItem == stressFailedCase');
    expect(contextMenus.find((entry) => entry.command === 'oijudger.openStressFile')?.when)
      .toContain('stressInputFile');
    for (const command of managementCommands) {
      expect(packageJson.contributes.menus.commandPalette).toContainEqual({ command, when: 'false' });
    }
  });

  it('contributes copy freopen snippet menus for sample nodes without setter mode', () => {
    const command = 'oijudger.copyTestcaseFreopenInput';
    const commands = packageJson.contributes.commands.map((entry) => entry.command);
    const contextMenus = packageJson.contributes.menus['view/item/context'].filter((entry) =>
      entry.command === command
    );

    expect(commands).toContain(command);
    expect(packageJson.activationEvents).toContain(`onCommand:${command}`);
    expect(contextMenus.length).toBeGreaterThan(0);
    expect(contextMenus.every((entry) => !entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(contextMenus.every((entry) => entry.when.includes('viewItem == sample'))).toBe(true);
    expect(contextMenus.some((entry) => entry.group === 'inline@4')).toBe(true);
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command,
      when: 'false'
    });
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
