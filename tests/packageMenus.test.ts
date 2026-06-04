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
      when: 'view == oijudger.samplesView && viewItem == samplesGroup',
      group: 'inline'
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
        'oijudger.selectGeneratorProgram',
        'oijudger.openGeneratorProgram',
        'oijudger.clearGeneratorProgram',
        'oijudger.addSetterInputSample'
      ].includes(entry.command)
    );

    expect(commands).toEqual(expect.arrayContaining([
      'oijudger.generateSampleAnswerWithStd',
      'oijudger.generateAllSampleAnswersWithStd',
      'oijudger.selectGeneratorProgram',
      'oijudger.openGeneratorProgram',
      'oijudger.clearGeneratorProgram',
      'oijudger.addSetterInputSample'
    ]));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:oijudger.generateSampleAnswerWithStd',
      'onCommand:oijudger.generateAllSampleAnswersWithStd',
      'onCommand:oijudger.selectGeneratorProgram',
      'onCommand:oijudger.openGeneratorProgram',
      'onCommand:oijudger.clearGeneratorProgram',
      'onCommand:oijudger.addSetterInputSample'
    ]));
    expect(menuCommands).toHaveLength(5);
    expect(menuCommands.every((entry) => entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(menuCommands.find((entry) => entry.command === 'oijudger.generateSampleAnswerWithStd')?.when).toContain('viewItem == sample');
    expect(menuCommands.find((entry) => entry.command === 'oijudger.selectGeneratorProgram')?.when).toContain('viewItem == oijudgerProblemNormal');
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.addSetterInputSample',
      when: 'false'
    });
  });
});
