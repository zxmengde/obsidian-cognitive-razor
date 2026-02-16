/**
 * Obsidian API mock（测试用）
 *
 * 仅提供测试中实际使用到的 API 的最小 mock 实现。
 */

export function normalizePath(path: string): string {
    // 简化实现：替换反斜杠为正斜杠，移除多余斜杠
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export class Plugin {
    app: unknown = {};
    manifest: unknown = {};
    async loadData(): Promise<unknown> { return null; }
    async saveData(_data: unknown): Promise<void> {}
    addCommand(_command: unknown): unknown { return {}; }
    registerEvent(_event: unknown): void {}
    registerInterval(_interval: unknown): void {}
    registerDomEvent(_el: unknown, _type: string, _callback: unknown): void {}
}

export class Notice {
    constructor(_message: string, _timeout?: number) {}
}

export class Modal {
    app: unknown;
    constructor(app: unknown) { this.app = app; }
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
}

export class Setting {
    settingEl: HTMLElement = document.createElement("div");
    constructor(_containerEl: HTMLElement) {}
    setName(_name: string): this { return this; }
    setDesc(_desc: string): this { return this; }
    addText(_cb: unknown): this { return this; }
    addToggle(_cb: unknown): this { return this; }
    addDropdown(_cb: unknown): this { return this; }
    addButton(_cb: unknown): this { return this; }
    setHeading(): this { return this; }
}

export const Platform = {
    isDesktop: true,
    isMobile: false,
    isDesktopApp: true,
    isMacOS: false,
    isWin: true,
};

export class TFile {
    path = "";
    name = "";
    basename = "";
    extension = "md";
}

export class TFolder {
    path = "";
    name = "";
    children: unknown[] = [];
}

export function requestUrl(_request: unknown): Promise<unknown> {
    return Promise.resolve({ json: {}, text: "", status: 200 });
}
