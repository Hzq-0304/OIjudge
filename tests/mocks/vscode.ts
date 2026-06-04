export const env = {
  language: 'en'
};

const configurationValues = new Map<string, unknown>();

export function __setConfiguration(key: string, value: unknown): void {
  configurationValues.set(key, value);
}

export function __resetConfiguration(): void {
  configurationValues.clear();
}

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration: () => ({
    get: <T>(key: string, defaultValue: T): T =>
      configurationValues.has(key) ? configurationValues.get(key) as T : defaultValue
  }),
  saveAll: async () => true,
  openTextDocument: async (uri: unknown) => ({ uri })
};

export const window = {
  createOutputChannel: () => ({
    appendLine: () => undefined,
    show: () => undefined,
    dispose: () => undefined
  }),
  createStatusBarItem: () => ({
    command: undefined,
    text: '',
    tooltip: '',
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined
  }),
  showTextDocument: async (document: unknown, options?: unknown) => ({ document, options }),
  showInformationMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => items[0],
  showWarningMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => items[0],
  showErrorMessage: async <T extends string>(message: string, ...items: T[]): Promise<T | undefined> => items[0],
  showQuickPick: async <T>(items: readonly T[]): Promise<T | undefined> => items[0],
  showInputBox: async (): Promise<string | undefined> => undefined,
  showOpenDialog: async (): Promise<unknown[] | undefined> => undefined,
  registerTreeDataProvider: () => ({ dispose: () => undefined })
};

export class EventEmitter<T> {
  event = () => ({ dispose: () => undefined });
  fire(_value?: T): void {
    return undefined;
  }
  dispose(): void {
    return undefined;
  }
}

export class TreeItem {
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  command?: unknown;
  contextValue?: string;

  constructor(
    public label: string,
    public collapsibleState?: TreeItemCollapsibleState
  ) {}
}

export class ThemeIcon {
  constructor(
    public id: string,
    public color?: ThemeColor
  ) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2
}

export enum ViewColumn {
  One = 1,
  Beside = -2
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, scheme: 'file' })
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: async () => undefined
};
