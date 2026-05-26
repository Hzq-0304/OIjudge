import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { exists } from './config';
import { t } from './i18n';
import { ensureProblemsConfig, getProblemReportPath } from './problems';
import { JudgeReport, ProblemConfig, SampleReport, SampleStatus } from './types';

type NodeKind = 'group' | 'problem' | 'info' | 'sample' | 'action';
type NodeGroup = 'problems' | 'workspaceActions' | 'limits' | 'samples' | 'actions';

type TreeNode = {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  command?: vscode.Command;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  group?: NodeGroup;
  problemId?: string;
  sampleId?: number;
};

export class SampleTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.icon;
    item.command = element.command;
    item.contextValue = element.kind === 'sample' ? 'sample' : `oijudger${capitalize(element.kind)}`;
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const config = await ensureProblemsConfig(workspaceFolder);
    if (!element) {
      return createRootNodes();
    }

    if (element.group === 'problems' && !element.problemId) {
      return config.problems.length > 0 ? config.problems.map(createProblemNode) : [createNoProblemsNode()];
    }

    if (element.group === 'workspaceActions') {
      return createWorkspaceActionNodes();
    }

    if (!element.problemId) {
      return [];
    }

    const problem = config.problems.find((entry) => entry.id === element.problemId);
    if (!problem) {
      return [];
    }

    switch (element.group) {
      case undefined:
        return createProblemChildren(problem);
      case 'limits':
        return createLimitNodes(problem);
      case 'samples':
        return createSampleNodes(workspaceFolder, problem);
      case 'actions':
        return createProblemActionNodes(problem);
      default:
        return [];
    }
  }
}

function createRootNodes(): TreeNode[] {
  return [
    {
      kind: 'group',
      label: t('problems'),
      icon: new vscode.ThemeIcon('book'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'problems'
    },
    {
      kind: 'group',
      label: t('workspaceActions'),
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'workspaceActions'
    }
  ];
}

function createProblemNode(problem: ProblemConfig): TreeNode {
  return {
    kind: 'problem',
    label: problem.name,
    description: path.basename(problem.source),
    tooltip: problem.source,
    icon: new vscode.ThemeIcon('symbol-file'),
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    problemId: problem.id
  };
}

function createNoProblemsNode(): TreeNode {
  return {
    kind: 'info',
    label: t('noProblems'),
    description: t('addProblemFromCurrentFile'),
    icon: new vscode.ThemeIcon('circle-slash'),
    command: {
      command: 'oijudger.addProblemFromCurrentFile',
      title: t('addProblemFromCurrentFile')
    }
  };
}

function createProblemChildren(problem: ProblemConfig): TreeNode[] {
  return [
    infoNode(t('sourceLine', { source: problem.source || '-' }), 'file-code'),
    infoNode(t('compilerLine', { compiler: path.basename(problem.compiler.command || 'g++') }), 'terminal'),
    infoNode(t('standardLine', { standard: problem.standard }), 'settings'),
    {
      kind: 'group',
      label: t('limits'),
      icon: new vscode.ThemeIcon('dashboard'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'limits',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('samples'),
      icon: new vscode.ThemeIcon('list-tree'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'samples',
      problemId: problem.id
    },
    {
      kind: 'group',
      label: t('actions'),
      icon: new vscode.ThemeIcon('tools'),
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      group: 'actions',
      problemId: problem.id
    }
  ];
}

function createLimitNodes(problem: ProblemConfig): TreeNode[] {
  return [
    actionNode(`${t('time')}: ${problem.limits.timeMs} ms`, 'oijudger.setProblemTimeLimit', 'watch', problem.id),
    actionNode(`${t('memory')}: ${problem.limits.memoryMb} MB`, 'oijudger.setProblemMemoryLimit', 'server', problem.id)
  ];
}

async function createSampleNodes(
  workspaceFolder: vscode.WorkspaceFolder,
  problem: ProblemConfig
): Promise<TreeNode[]> {
  if (problem.samples.length === 0) {
    return [
      {
        kind: 'info',
        label: t('noSamplesTree'),
        description: t('addSample'),
        icon: new vscode.ThemeIcon('beaker-stop'),
        command: {
          command: 'oijudger.addProblemSample',
          title: t('addSample'),
          arguments: [problem.id]
        }
      }
    ];
  }

  const report = await readReport(workspaceFolder, problem.id);
  return problem.samples.map((sample) => {
    const sampleReport = report?.samples.find((entry) => entry.id === sample.id);
    const status = sampleReport?.status ?? 'Not Run';
    const elapsed = sampleReport ? formatElapsed(sampleReport) : '';
    return {
      kind: 'sample',
      label: sample.name,
      description: elapsed ? `${statusLabel(status)}  ${elapsed}` : statusLabel(status),
      tooltip: `${sample.input} -> ${sample.answer}`,
      icon: new vscode.ThemeIcon(statusIcon(status)),
      command: {
        command: 'oijudger.openProblemSampleDetail',
        title: t('sampleDetail', { sample: sample.name }),
        arguments: [problem.id, sample.id]
      },
      problemId: problem.id,
      sampleId: sample.id
    };
  });
}

function createProblemActionNodes(problem: ProblemConfig): TreeNode[] {
  return [
    actionNode(t('addSample'), 'oijudger.addProblemSample', 'add', problem.id),
    actionNode(t('addSampleFromFiles'), 'oijudger.addProblemSampleFromFiles', 'file-add', problem.id),
    actionNode(t('runSamples'), 'oijudger.runProblemSamples', 'run-all', problem.id),
    actionNode(t('setTimeLimit'), 'oijudger.setProblemTimeLimit', 'watch', problem.id),
    actionNode(t('setMemoryLimit'), 'oijudger.setProblemMemoryLimit', 'server', problem.id),
    actionNode(t('setCppStandard'), 'oijudger.setProblemStandard', 'settings', problem.id),
    actionNode(t('selectCompiler'), 'oijudger.selectProblemCompiler', 'settings-gear', problem.id),
    actionNode(t('openResultPanel'), 'oijudger.openProblemResultPanel', 'layout-panel', problem.id)
  ];
}

function createWorkspaceActionNodes(): TreeNode[] {
  return [
    actionNode(t('addProblemFromCurrentFile'), 'oijudger.addProblemFromCurrentFile', 'file-code'),
    actionNode(t('addProblemFromFile'), 'oijudger.addProblemFromFile', 'file-add'),
    actionNode(t('refreshView'), 'oijudger.refreshView', 'refresh'),
    actionNode(t('importLegacyProblem'), 'oijudger.importLegacyProblem', 'repo-pull')
  ];
}

function infoNode(label: string, icon: string): TreeNode {
  return {
    kind: 'info',
    label,
    icon: new vscode.ThemeIcon(icon)
  };
}

function actionNode(label: string, command: string, icon: string, problemId?: string): TreeNode {
  return {
    kind: 'action',
    label,
    icon: new vscode.ThemeIcon(icon),
    problemId,
    command: {
      command,
      title: label,
      arguments: problemId ? [problemId] : []
    }
  };
}

async function readReport(
  workspaceFolder: vscode.WorkspaceFolder,
  problemId: string
): Promise<JudgeReport | undefined> {
  const reportPath = getProblemReportPath(workspaceFolder, problemId);
  if (!(await exists(reportPath))) {
    return undefined;
  }

  try {
    return JSON.parse(await fs.readFile(reportPath, 'utf8')) as JudgeReport;
  } catch {
    return undefined;
  }
}

function formatElapsed(report: SampleReport): string {
  const timeMs = report.timeMs ?? report.elapsedMs;
  if (report.status === 'TLE') {
    return `>${formatMs(timeMs)}ms`;
  }
  return `${formatMs(timeMs)}ms`;
}

function formatMs(value: number): number {
  return Math.round(value);
}

function statusIcon(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return 'pass-filled';
    case 'WA':
      return 'error';
    case 'TLE':
      return 'watch';
    case 'RE':
    case 'ERR':
      return 'warning';
    case 'Not Run':
      return 'circle-outline';
  }
}

function statusLabel(status: SampleStatus | 'Not Run'): string {
  switch (status) {
    case 'AC':
      return t('statusAC');
    case 'WA':
      return t('statusWA');
    case 'TLE':
      return t('statusTLE');
    case 'RE':
      return t('statusRE');
    case 'ERR':
      return t('statusERR');
    case 'Not Run':
      return t('notRun');
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
