import * as vscode from 'vscode';
import { ensureConfig, getWorkspaceFolder } from './config';
import { SampleConfig } from './types';

export class SampleTreeProvider implements vscode.TreeDataProvider<SampleItem> {
  private readonly emitter = new vscode.EventEmitter<SampleItem | undefined | null | void>();

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: SampleItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SampleItem[]> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
      return [];
    }

    try {
      const config = await ensureConfig(workspaceFolder);
      return config.samples.map((sample) => new SampleItem(sample));
    } catch {
      return [];
    }
  }
}

class SampleItem extends vscode.TreeItem {
  constructor(sample: SampleConfig) {
    super(sample.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${sample.input} -> ${sample.answer}`;
    this.contextValue = 'oijudgerSample';
  }
}
