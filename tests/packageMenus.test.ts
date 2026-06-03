import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
  activationEvents?: string[];
  contributes: {
    commands: Array<{ command: string; icon?: string }>;
    menus: {
      'view/item/context': Array<{ command: string; when: string; group: string }>;
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
});
