import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const extensionSource = readFileSync(path.resolve(__dirname, '..', 'src', 'extension.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
  name: string;
  displayName?: string;
  description?: string;
  publisher: string;
  activationEvents?: string[];
  contributes: {
    commands: Array<{ command: string; title?: string; icon?: string }>;
    views: Record<string, Array<{ id: string; name: string }>>;
    configuration?: unknown;
    keybindings?: Array<{ command: string; key: string; mac?: string; when?: string }>;
    menus: {
      'view/title': Array<{ command: string; when: string; group: string }>;
      'editor/title'?: Array<{ command: string; when: string; group: string }>;
      'view/item/context': Array<{ command: string; when: string; group: string }>;
      commandPalette: Array<{ command: string; when: string }>;
    };
  };
};
const packageNls = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.nls.json'), 'utf8')) as Record<string, string>;
const packageNlsZhCn = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;

const legacyInternalCommands = [
  'oijudger.openCheckerStderr',
  'oijudger.openSampleStderr'
];
const sampleNodeWhen = 'view == oijudger.samplesView && (viewItem == sample || viewItem == sampleChecker || viewItem == sampleWa || viewItem == sampleWaChecker || viewItem == sampleMissing || viewItem == sampleAnswerPending || viewItem == sampleWithGeneratedOutput)';

function registeredCommands(): string[] {
  return Array.from(extensionSource.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g), (match) => match[1]);
}

function menuCommands(): string[] {
  return Object.values(packageJson.contributes.menus)
    .flat()
    .map((entry) => entry.command);
}

function nlsKey(value: string | undefined): string | undefined {
  const match = /^%([^%]+)%$/.exec(value ?? '');
  return match?.[1];
}

function resolveNls(value: string | undefined, bundle: Record<string, string> = packageNls): string | undefined {
  const key = nlsKey(value);
  return key ? bundle[key] : undefined;
}

function collectPlaceholders(value: unknown, keys = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/%([^%]+)%/g)) {
      keys.add(match[1]);
    }
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlaceholders(item, keys);
    }
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectPlaceholders(item, keys);
    }
  }
  return keys;
}

describe('package tree sample add menu', () => {
  it('localizes extension manifest display text through package.nls bundles', () => {
    expect(packageJson.name).toBe('oijudge');
    expect(packageJson.publisher).toBe('Hzq');
    expect(packageJson.displayName).toBe('%extension.displayName%');
    expect(packageJson.description).toBe('%extension.description%');
    expect(packageNls['extension.displayName']).toBe('OI Judge');
    expect(packageNls['extension.description']).toBe(
      'Local OI sample judge for VS Code, with custom checkers, generators, subtasks, and reports.'
    );
    expect(packageNlsZhCn['extension.displayName']).toBe('OI Judge');
    expect(packageNlsZhCn['extension.description']).toContain('OI');
    expect(packageNlsZhCn['extension.description']).toContain('本地样例评测');
    expect(packageNls['commands.setIoMode.title']).toBe('OI Judge: Set I/O Mode');
    expect(packageNls['commands.setFileIoNames.title']).toBe('OI Judge: Set File I/O Names');
    expect(packageNlsZhCn['configuration.oijudger.language.description']).toBe('控制 OI Judge 界面语言。');
    expect(packageNlsZhCn['configuration.oijudger.setterMode.enabled.markdownDescription']).toContain('出题人工具');

    const placeholders = [...collectPlaceholders(packageJson)].sort();
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.filter((key) => !(key in packageNls))).toEqual([]);
    expect(placeholders.filter((key) => !(key in packageNlsZhCn))).toEqual([]);
  });

  it('keeps package commands, menu references, and registered commands consistent', () => {
    const contributed = new Set(packageJson.contributes.commands.map((entry) => entry.command));
    const registered = new Set(registeredCommands());
    const menus = new Set(menuCommands());

    expect([...contributed].filter((command) => !registered.has(command))).toEqual([]);
    expect([...menus].filter((command) => !contributed.has(command))).toEqual([]);
    expect([...menus].filter((command) => !registered.has(command))).toEqual([]);
    expect([...registered].filter((command) => !contributed.has(command)).sort()).toEqual(legacyInternalCommands);
  });

  it('keeps user-visible command titles present and consistently prefixed', () => {
    for (const command of packageJson.contributes.commands) {
      expect(command.title).toBeTruthy();
      expect(command.title).toMatch(/^%commands\.[A-Za-z0-9.]+\.title%$/);
      expect(resolveNls(command.title)?.startsWith('OI Judge: ')).toBe(true);
      expect(resolveNls(command.title, packageNlsZhCn)?.startsWith('OI Judge: ')).toBe(true);
      expect(resolveNls(command.title)).not.toContain('????');
      expect(resolveNls(command.title, packageNlsZhCn)).not.toContain('????');
    }
  });

  it('keeps legacy stderr commands internal while exposing consolidated output entries', () => {
    const contributed = packageJson.contributes.commands.map((entry) => entry.command);
    const menus = menuCommands();
    const registered = registeredCommands();

    expect(registered).toEqual(expect.arrayContaining(legacyInternalCommands));
    for (const command of legacyInternalCommands) {
      expect(contributed).not.toContain(command);
      expect(menus).not.toContain(command);
    }
    expect(contributed).toEqual(expect.arrayContaining([
      'oijudger.openSampleOutput',
      'oijudger.openSampleUserOutput',
      'oijudger.openCheckerOutput'
    ]));
    expect(menus).toEqual(expect.arrayContaining([
      'oijudger.openSampleUserOutput',
      'oijudger.openCheckerOutput'
    ]));
  });

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

  it('contributes an inline run action only for sample nodes', () => {
    const command = packageJson.contributes.commands.find((entry) => entry.command === 'oijudger.runProblemSample');
    const menu = packageJson.contributes.menus['view/item/context'].find((entry) =>
      entry.command === 'oijudger.runProblemSample' && entry.group === 'inline@1'
    );

    expect(packageJson.activationEvents).toContain('onCommand:oijudger.runProblemSample');
    expect(command).toMatchObject({
      icon: '$(play)',
      title: '%commands.runProblemSample.title%'
    });
    expect(resolveNls(command?.title)).toBe('OI Judge: Run Sample');
    expect(resolveNls(command?.title, packageNlsZhCn)).toBe('OI Judge: 运行该测试点');
    expect(menu).toMatchObject({
      when: sampleNodeWhen,
      group: 'inline@1'
    });
    expect(menu?.when).not.toContain('oijudgerProblem');
    expect(menu?.when).not.toContain('subtask');
    expect(menu?.when).not.toContain('generator');
    expect(menu?.when).not.toContain('setter');
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

  it('keeps the samples view toolbar focused on high-frequency actions', () => {
    const titleMenus = packageJson.contributes.menus['view/title'].filter((entry) =>
      entry.when === 'view == oijudger.samplesView'
    );

    expect(titleMenus).toEqual([
      {
        command: 'oijudger.runProblemSamples',
        when: 'view == oijudger.samplesView',
        group: 'navigation@0'
      },
      {
        command: 'oijudger.testCurrentCode',
        when: 'view == oijudger.samplesView',
        group: 'navigation@1'
      },
      {
        command: 'oijudger.runSamplesWithProgram',
        when: 'view == oijudger.samplesView',
        group: 'navigation@2'
      },
      {
        command: 'oijudger.addSampleFromSamplesGroup',
        when: 'view == oijudger.samplesView',
        group: 'navigation@3'
      },
      {
        command: 'oijudger.refreshView',
        when: 'view == oijudger.samplesView',
        group: 'navigation@4'
      }
    ]);
  });

  it('contributes Test Current Code to editor, samples view, keybinding, and command palette', () => {
    const command = packageJson.contributes.commands.find((entry) => entry.command === 'oijudger.testCurrentCode');
    const titleMenus = packageJson.contributes.menus['view/title'].filter((entry) =>
      entry.command === 'oijudger.testCurrentCode'
    );
    const editorTitleMenus = packageJson.contributes.menus['editor/title']?.filter((entry) =>
      entry.command === 'oijudger.testCurrentCode'
    ) ?? [];
    const contextMenus = packageJson.contributes.menus['view/item/context'].filter((entry) =>
      entry.command === 'oijudger.testCurrentCode'
    );
    const keybindings = packageJson.contributes.keybindings?.filter((entry) =>
      entry.command === 'oijudger.testCurrentCode'
    ) ?? [];

    expect(packageJson.activationEvents).toContain('onCommand:oijudger.testCurrentCode');
    expect(command).toMatchObject({
      icon: '$(play-circle)',
      title: '%commands.testCurrentCode.title%'
    });
    expect(resolveNls(command?.title)).toBe('OI Judge: Test Current Code');
    expect(resolveNls(command?.title, packageNlsZhCn)).toBe('OI Judge: 测试当前代码');
    expect(registeredCommands()).toContain('oijudger.testCurrentCode');
    expect(packageJson.contributes.menus.commandPalette).not.toContainEqual({
      command: 'oijudger.testCurrentCode',
      when: 'false'
    });
    expect(titleMenus).toEqual([
      {
        command: 'oijudger.testCurrentCode',
        when: 'view == oijudger.samplesView',
        group: 'navigation@1'
      }
    ]);
    expect(editorTitleMenus).toEqual([
      {
        command: 'oijudger.testCurrentCode',
        when: 'resourceExtname == .cpp',
        group: 'navigation'
      }
    ]);
    expect(contextMenus).toEqual([
      {
        command: 'oijudger.testCurrentCode',
        when: 'view == oijudger.samplesView && (viewItem == oijudgerProblemNormal || viewItem == oijudgerProblemChecker)',
        group: '3_run@1'
      }
    ]);
    expect(contextMenus.every((entry) => !entry.when.includes('sample ||'))).toBe(true);
    expect(contextMenus.every((entry) => !entry.when.includes('subtask ||'))).toBe(true);
    expect(keybindings).toEqual([
      {
        command: 'oijudger.testCurrentCode',
        key: 'ctrl+alt+shift+j',
        mac: 'cmd+alt+shift+j',
        when: 'editorTextFocus'
      }
    ]);
  });

  it('contributes a workspace management command for consolidated workspace actions', () => {
    const command = packageJson.contributes.commands.find((entry) => entry.command === 'oijudger.manageWorkspace');

    expect(packageJson.activationEvents).toContain('onCommand:oijudger.manageWorkspace');
    expect(command).toMatchObject({
      icon: '$(tools)',
      title: '%commands.manageWorkspace.title%'
    });
    expect(resolveNls(command?.title)).toBe('OI Judge: Manage Workspace');
    expect(resolveNls(command?.title, packageNlsZhCn)).toBe('OI Judge: 管理工作区');
    expect(registeredCommands()).toContain('oijudger.manageWorkspace');
  });

  it('contributes problem package export to command palette and problem nodes only', () => {
    const command = packageJson.contributes.commands.find((entry) => entry.command === 'oijudger.exportProblemPackage');
    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const entries = contextMenus.filter((entry) => entry.command === 'oijudger.exportProblemPackage');

    expect(command?.title).toBe('%commands.exportProblemPackage.title%');
    expect(resolveNls(command?.title)).toContain('Export Problem Package');
    expect(resolveNls(command?.title, packageNlsZhCn)).toContain('导出完整题目包');
    expect(packageJson.activationEvents).toContain('onCommand:oijudger.exportProblemPackage');
    expect(entries.length).toBe(2);
    expect(entries.every((entry) => !entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(entries.some((entry) => entry.when.includes('samplesGroup'))).toBe(true);
    expect(entries.some((entry) => entry.when.includes('oijudgerProblemNormal'))).toBe(true);
    const sampleNodeValues = ['sample ||', 'sampleChecker', 'sampleWa', 'sampleMissing', 'sampleAnswerPending', 'sampleWithGeneratedOutput'];
    const subtaskNodeValues = ['subtask ||', 'subtaskPassed', 'subtaskFailed'];
    expect(entries.every((entry) => sampleNodeValues.every((value) => !entry.when.includes(value)))).toBe(true);
    expect(entries.every((entry) => subtaskNodeValues.every((value) => !entry.when.includes(value)))).toBe(true);
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.exportProblemPackage',
      when: 'false'
    });
    expect(registeredCommands()).toContain('oijudger.exportProblemPackage');
  });

  it('contributes problem package import to command palette and top-level problem list actions only', () => {
    const command = packageJson.contributes.commands.find((entry) => entry.command === 'oijudger.importProblemPackage');
    const titleMenus = packageJson.contributes.menus['view/title'].filter((entry) =>
      entry.command === 'oijudger.importProblemPackage'
    );
    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const entries = contextMenus.filter((entry) => entry.command === 'oijudger.importProblemPackage');

    expect(command?.title).toBe('%commands.importProblemPackage.title%');
    expect(resolveNls(command?.title)).toContain('Import Problem Package');
    expect(resolveNls(command?.title, packageNlsZhCn)).toContain('导入完整题目包');
    expect(command?.icon).toBe('$(cloud-download)');
    expect(packageJson.activationEvents).toContain('onCommand:oijudger.importProblemPackage');
    expect(titleMenus).toEqual([]);
    expect(entries).toEqual([
      {
        command: 'oijudger.importProblemPackage',
        when: 'view == oijudger.samplesView && (viewItem == samplesGroup || viewItem == samplesGroupWithGeneratedOutputs)',
        group: '7_export@3'
      }
    ]);
    expect(entries.every((entry) => !entry.when.includes('sample ||'))).toBe(true);
    expect(entries.every((entry) => !entry.when.includes('subtask ||'))).toBe(true);
    expect(entries.every((entry) => !entry.when.includes('stress'))).toBe(true);
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.importProblemPackage'
    });
    expect(registeredCommands()).toContain('oijudger.importProblemPackage');
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
    expect(titleMenus).toEqual([]);
    expect(contextMenus.length).toBeGreaterThan(0);
    expect(contextMenus.every((entry) => !entry.when.includes('oijudger.setterModeEnabled'))).toBe(true);
    expect(contextMenus.some((entry) => entry.when.includes('oijudgerProblemNormal'))).toBe(true);
    expect(packageJson.contributes.menus.commandPalette).toContainEqual({
      command: 'oijudger.runStressTest',
      when: 'false'
    });
  });

  it('contributes current-code stress test and stop stress commands', () => {
    const commands = packageJson.contributes.commands;
    const commandIds = commands.map((entry) => entry.command);
    const currentCodeCommand = commands.find((entry) => entry.command === 'oijudger.stressTestCurrentCode');
    const stopCommand = commands.find((entry) => entry.command === 'oijudger.stopStressTest');
    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const currentCodeMenus = contextMenus.filter((entry) => entry.command === 'oijudger.stressTestCurrentCode');
    const stopMenus = contextMenus.filter((entry) => entry.command === 'oijudger.stopStressTest');

    expect(commandIds).toEqual(expect.arrayContaining([
      'oijudger.runStressTest',
      'oijudger.stressTestCurrentCode',
      'oijudger.stopStressTest'
    ]));
    expect(packageJson.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:oijudger.stressTestCurrentCode',
      'onCommand:oijudger.stopStressTest'
    ]));
    expect(currentCodeCommand).toMatchObject({
      title: '%commands.stressTestCurrentCode.title%',
      icon: '$(beaker)'
    });
    expect(stopCommand).toMatchObject({
      title: '%commands.stopStressTest.title%',
      icon: '$(debug-stop)'
    });
    expect(resolveNls(currentCodeCommand?.title)).toBe('OI Judge: Stress Test Current Code');
    expect(resolveNls(stopCommand?.title)).toBe('OI Judge: Stop Stress Test');
    expect(resolveNls(currentCodeCommand?.title, packageNlsZhCn)).toBe('OI Judge: 对拍当前代码');
    expect(resolveNls(stopCommand?.title, packageNlsZhCn)).toBe('OI Judge: 停止对拍');
    expect(registeredCommands()).toEqual(expect.arrayContaining([
      'oijudger.stressTestCurrentCode',
      'oijudger.stopStressTest'
    ]));
    expect(packageJson.contributes.menus.commandPalette).not.toContainEqual({
      command: 'oijudger.stressTestCurrentCode',
      when: 'false'
    });
    expect(packageJson.contributes.menus.commandPalette).not.toContainEqual({
      command: 'oijudger.stopStressTest',
      when: 'false'
    });
    expect(currentCodeMenus).toEqual([
      {
        command: 'oijudger.stressTestCurrentCode',
        when: 'view == oijudger.samplesView && (viewItem == oijudgerProblemNormal || viewItem == oijudgerProblemChecker || viewItem == oijudgerProblemPlainChecker)',
        group: '3_run@2.5'
      }
    ]);
    expect(stopMenus).toEqual([
      {
        command: 'oijudger.stopStressTest',
        when: 'view == oijudger.samplesView && (viewItem == oijudgerProblemNormal || viewItem == oijudgerProblemChecker || viewItem == oijudgerProblemPlainChecker) && oijudger.stressRunning',
        group: '3_run@3.5'
      }
    ]);
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

    expect(stressView?.name).toBe('%views.stressRecordsView.name%');
    expect(resolveNls(stressView?.name)).toBe('Stress Records');
    expect(resolveNls(stressView?.name, packageNlsZhCn)).toBe('对拍记录');
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
    expect(contextMenus.some((entry) => entry.group === 'inline@5')).toBe(true);
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
