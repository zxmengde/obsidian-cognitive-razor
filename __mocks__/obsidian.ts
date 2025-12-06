/**
 * Obsidian API Mock
 * 用于测试环境
 */

export class App {
  vault: any;
  workspace: any;
  
  constructor() {
    this.vault = {
      getAbstractFileByPath: jest.fn(),
      read: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    };
    this.workspace = {
      on: jest.fn(),
      off: jest.fn(),
    };
  }
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  
  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    this.name = parts[parts.length - 1];
    const nameParts = this.name.split('.');
    this.extension = nameParts.pop() || '';
    this.basename = nameParts.join('.');
  }
}

export class Notice {
  noticeEl: any;
  
  constructor(message: string | DocumentFragment, timeout?: number) {
    // Mock noticeEl without using document
    this.noticeEl = {
      empty: jest.fn(),
      createDiv: jest.fn().mockReturnThis(),
      createSpan: jest.fn().mockReturnThis(),
      createEl: jest.fn().mockReturnValue({
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    };
  }
  
  hide(): void {}
}

export class ItemView {
  containerEl: any;
  
  constructor(leaf: WorkspaceLeaf) {
    // Mock containerEl without using document
    this.containerEl = {
      empty: jest.fn(),
      createDiv: jest.fn().mockReturnThis(),
      createEl: jest.fn().mockReturnThis(),
      children: [{}],
    };
  }
  
  getViewType(): string {
    return 'mock-view';
  }
  
  getDisplayText(): string {
    return 'Mock View';
  }
  
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class WorkspaceLeaf {
  view: any;
  
  constructor() {
    this.view = null;
  }
}

export class Modal {
  app: App;
  containerEl: any;
  
  constructor(app: App) {
    this.app = app;
    // Mock containerEl without using document
    this.containerEl = {
      empty: jest.fn(),
      createDiv: jest.fn().mockReturnThis(),
      createEl: jest.fn().mockReturnThis(),
    };
  }
  
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Plugin {
  app: App;
  manifest: any;
  
  constructor() {
    this.app = new App();
    this.manifest = {};
  }
  
  async loadData(): Promise<any> {
    return {};
  }
  
  async saveData(data: any): Promise<void> {}
  
  addCommand(command: any): void {}
  addRibbonIcon(icon: string, title: string, callback: () => void): any {
    return {
      empty: jest.fn(),
      createDiv: jest.fn().mockReturnThis(),
      createEl: jest.fn().mockReturnThis(),
    };
  }
  
  registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => ItemView): void {}
  
  async onload(): Promise<void> {}
  async onunload(): Promise<void> {}
}
