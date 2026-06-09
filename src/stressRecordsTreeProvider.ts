import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceFolder } from './config';
import { t } from './i18n';
import {
  StressFailedCase,
  StressSession,
  listStressSessions,
  resolveStressFile
} from './stressRecords';

export type StressTreeNodeType =
  | 'stressSession'
  | 'stressFailedCase'
  | 'stressFile'
  | 'stressStandaloneOutput'
  | 'stressInvalidSession'
  | 'stressEmpty';

export type StressTreeNode = {
  type: StressTreeNodeType;
  label: string;
  description?: string;
  contextValue?: string;
  icon?: vscode.ThemeIcon;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  session?: StressSession;
  failedCase?: StressFailedCase;
  filePath?: string;
};

export class StressRecordsTreeProvider implements vscode.TreeDataProvider<StressTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<StressTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private sessions: StressSession[] = [];
  private loaded = false;

  refresh(): void {
    this.loaded = false;
    this.changeEmitter.fire();
  }

  getTreeItem(element: StressTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    item.tooltip = element.filePath ?? element.description;
    item.contextValue = element.contextValue;
    item.iconPath = element.icon;
    if (element.filePath) {
      item.command = {
        command: 'oijudger.openStressFile',
        title: t('stress.openFile'),
        arguments: [element]
      };
    }
    return item;
  }

  async getChildren(element?: StressTreeNode): Promise<StressTreeNode[]> {
    if (!element) {
      await this.ensureLoaded();
      if (this.sessions.length === 0) {
        return [{
          type: 'stressEmpty',
          label: t('stress.records.empty'),
          icon: new vscode.ThemeIcon('info')
        }];
      }
      return this.sessions.map((session) => ({
        type: session.invalid ? 'stressInvalidSession' : 'stressSession',
        label: session.label,
        description: session.description,
        contextValue: session.invalid ? 'stressInvalidSession' : 'stressSession',
        icon: new vscode.ThemeIcon(session.invalid ? 'warning' : session.failedCase ? 'error' : 'beaker'),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        session
      }));
    }

    if (!element.session || element.type === 'stressInvalidSession') {
      return [];
    }
    if (element.type === 'stressFailedCase' && element.failedCase) {
      return getStressFailedCaseChildren(element.session, element.failedCase);
    }
    if (element.session.mode === 'generator-std') {
      return this.getGeneratorStdChildren(element.session);
    }
    if (element.session.mode === 'standalone') {
      return this.getStandaloneChildren(element.session);
    }
    return [];
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const workspaceFolder = getWorkspaceFolder();
    this.sessions = workspaceFolder ? await listStressSessions(workspaceFolder) : [];
    this.loaded = true;
  }

  private getGeneratorStdChildren(session: StressSession): StressTreeNode[] {
    if (!session.failedCase) {
      return [this.createFileNode(session, t('stress.file.summary'), session.summaryPath, 'stressSummaryFile')];
    }
    const failedCase: StressTreeNode = {
      type: 'stressFailedCase',
      label: t('stress.case.failed', { round: session.failedCase.round ?? '?' }),
      description: session.failedCase.name,
      contextValue: 'stressFailedCase',
      icon: new vscode.ThemeIcon('error'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      session,
      failedCase: session.failedCase
    };
    return [failedCase];
  }

  private getStandaloneChildren(session: StressSession): StressTreeNode[] {
    return [
      this.createFileNode(session, t('stress.file.stdout'), resolveStressFile(session, session.standalone?.stdout), 'stressStandaloneStdout'),
      this.createFileNode(session, t('stress.file.stderr'), resolveStressFile(session, session.standalone?.stderr), 'stressStandaloneStderr'),
      this.createFileNode(session, t('stress.file.summary'), session.summaryPath, 'stressSummaryFile')
    ];
  }

  private createFileNode(
    session: StressSession,
    label: string,
    filePath: string | undefined,
    contextValue: string
  ): StressTreeNode {
    return {
      type: contextValue.startsWith('stressStandalone') ? 'stressStandaloneOutput' : 'stressFile',
      label,
      description: filePath ? path.basename(filePath) : t('fileNotFound'),
      contextValue,
      icon: new vscode.ThemeIcon(filePath ? 'file' : 'warning'),
      session,
      filePath
    };
  }
}

export function getStressFailedCaseChildren(session: StressSession, failedCase: StressFailedCase): StressTreeNode[] {
  return [
    createFailedCaseFileNode(session, failedCase, t('stress.file.input'), failedCase.input, 'stressInputFile'),
    createFailedCaseFileNode(session, failedCase, t('stress.file.stdOutput'), failedCase.stdOutput, 'stressStdOutputFile'),
    createFailedCaseFileNode(session, failedCase, t('stress.file.testOutput'), failedCase.testOutput, 'stressTestOutputFile'),
    createFailedCaseFileNode(session, failedCase, t('stress.file.summary'), session.summaryPath, 'stressSummaryFile', true),
    createFailedCaseFileNode(session, failedCase, t('stress.file.stderr'), failedCase.generatorErr, 'stressGeneratorErrFile'),
    createFailedCaseFileNode(session, failedCase, 'STD stderr', failedCase.stdErr, 'stressStdErrFile'),
    createFailedCaseFileNode(session, failedCase, 'Test stderr', failedCase.testErr, 'stressTestErrFile')
  ];
}

function createFailedCaseFileNode(
  session: StressSession,
  failedCase: StressFailedCase,
  label: string,
  fileNameOrPath: string | undefined,
  contextValue: string,
  absolute = false
): StressTreeNode {
  const filePath = absolute ? fileNameOrPath : resolveStressFile(session, fileNameOrPath);
  return {
    type: 'stressFile',
    label,
    description: filePath ? path.basename(filePath) : t('fileNotFound'),
    contextValue,
    icon: new vscode.ThemeIcon(filePath ? 'file' : 'warning'),
    session,
    failedCase,
    filePath
  };
}
