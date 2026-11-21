/**
 * Obsidian API mock（测试用）
 *
 * 只提供测试中实际使用到的 API。原生设置相关的类（Setting、PluginSettingTab、
 * SettingPage、Menu、Modal）保留真实 DOM：设置行的 settingEl/nameEl/descEl/controlEl
 * 可以直接查询，控件组件的 setX 链式调用与宿主一致，因此可以执行定义里的 render 回调。
 * 这里验证的是插件传给宿主的调用与产生的结果，不验证布局、样式或真实宿主行为。
 */

import type { SettingDefinition, SettingDefinitionItem, SettingDefinitionPage, SettingDefinitionGroup, SettingDefinitionList } from "obsidian";

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

export class App {}

export const noticeMessages: Array<{ message: string; timeout?: number }> = [];
export class Notice {
    constructor(message: string, timeout?: number) { noticeMessages.push({ message, timeout }); }
}

export function setIcon(_element: HTMLElement, _icon: string): void {}

interface DomOptions {
    cls?: string;
    text?: string;
    attr?: Record<string, string>;
}

/** Obsidian 给 HTMLElement 扩展的辅助方法；这里只挂到具体元素上，不改动全局原型。 */
export interface ObsidianElement extends HTMLElement {
    empty(): void;
    setText(text: string): void;
    addClass(...classes: string[]): void;
    removeClass(...classes: string[]): void;
    createDiv(options?: DomOptions): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: DomOptions): HTMLElementTagNameMap[K];
}

function applyOptions<T extends HTMLElement>(el: T, options: DomOptions | undefined): T {
    if (options?.cls) el.className = options.cls;
    if (options?.text !== undefined) el.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) el.setAttribute(key, value);
    return el;
}

export function augment<T extends HTMLElement>(el: T): T & ObsidianElement {
    const target = el as T & ObsidianElement;
    target.empty = () => target.replaceChildren();
    target.setText = (text: string) => { target.textContent = text; };
    target.addClass = (...classes: string[]) => target.classList.add(...classes);
    target.removeClass = (...classes: string[]) => target.classList.remove(...classes);
    target.createDiv = (options?: DomOptions) => {
        const child = applyOptions(document.createElement("div"), options);
        target.appendChild(child);
        return augment(child);
    };
    target.createEl = <K extends keyof HTMLElementTagNameMap>(tag: K, options?: DomOptions) => {
        const child = applyOptions(document.createElement(tag), options);
        target.appendChild(child);
        return augment(child) as HTMLElementTagNameMap[K];
    };
    return target;
}

export class Modal {
    app: unknown;
    containerEl: HTMLElement & ObsidianElement;
    modalEl: HTMLElement & ObsidianElement;
    titleEl: HTMLElement & ObsidianElement;
    contentEl: HTMLElement & ObsidianElement;
    private opened = false;

    constructor(app: unknown) {
        this.app = app;
        this.containerEl = augment(document.createElement("div"));
        this.containerEl.className = "modal-container";
        this.modalEl = augment(document.createElement("div"));
        this.modalEl.className = "modal";
        this.titleEl = augment(document.createElement("div"));
        this.titleEl.className = "modal-title";
        this.contentEl = augment(document.createElement("div"));
        this.contentEl.className = "modal-content";
        this.modalEl.append(this.titleEl, this.contentEl);
        this.containerEl.appendChild(this.modalEl);
    }

    open(): void {
        if (this.opened) return;
        this.opened = true;
        document.body.appendChild(this.containerEl);
        this.onOpen();
    }

    close(): void {
        if (!this.opened) return;
        this.opened = false;
        this.onClose();
        this.containerEl.remove();
    }

    onOpen(): void {}
    onClose(): void {}
}

// ---- 原生控件组件：只实现插件用到的方法，返回 this 以保持链式调用 ----

export class ButtonComponent {
    buttonEl: HTMLButtonElement;
    disabled = false;

    constructor(parent: HTMLElement) {
        this.buttonEl = document.createElement("button");
        this.buttonEl.type = "button";
        parent.appendChild(this.buttonEl);
    }
    setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
    setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
    setWarning(): this { this.buttonEl.classList.add("mod-warning"); return this; }
    setDestructive(): this { this.buttonEl.classList.add("mod-warning"); return this; }
    setIcon(icon: string): this { this.buttonEl.dataset.icon = icon; return this; }
    setTooltip(tooltip: string): this { this.buttonEl.setAttribute("aria-label", tooltip); return this; }
    setDisabled(disabled: boolean): this { this.disabled = disabled; this.buttonEl.disabled = disabled; return this; }
    onClick(callback: (evt: MouseEvent) => unknown): this {
        // 禁用按钮的 click() 在 DOM 中不会派发事件，与宿主一致。
        this.buttonEl.addEventListener("click", (evt) => { void callback(evt as MouseEvent); });
        return this;
    }
}

export class ExtraButtonComponent {
    extraSettingsEl: HTMLDivElement;

    constructor(parent: HTMLElement) {
        this.extraSettingsEl = document.createElement("div");
        this.extraSettingsEl.className = "clickable-icon extra-setting-button";
        this.extraSettingsEl.setAttribute("role", "button");
        parent.appendChild(this.extraSettingsEl);
    }
    setIcon(icon: string): this { this.extraSettingsEl.dataset.icon = icon; return this; }
    setTooltip(tooltip: string): this { this.extraSettingsEl.setAttribute("aria-label", tooltip); return this; }
    setDisabled(disabled: boolean): this { this.extraSettingsEl.setAttribute("aria-disabled", String(disabled)); return this; }
    onClick(callback: (evt: MouseEvent) => unknown): this {
        this.extraSettingsEl.addEventListener("click", (evt) => { void callback(evt as MouseEvent); });
        return this;
    }
}

export class TextComponent {
    inputEl: HTMLInputElement;

    constructor(parent: HTMLElement) {
        this.inputEl = document.createElement("input");
        this.inputEl.type = "text";
        parent.appendChild(this.inputEl);
    }
    getValue(): string { return this.inputEl.value; }
    setValue(value: string): this { this.inputEl.value = value; return this; }
    setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
    setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; return this; }
    // Obsidian 的文本框在输入时即回调，与 input 事件对应。
    onChange(callback: (value: string) => unknown): this {
        this.inputEl.addEventListener("input", () => { void callback(this.inputEl.value); });
        return this;
    }
}

export class ToggleComponent {
    toggleEl: HTMLInputElement;

    constructor(parent: HTMLElement) {
        this.toggleEl = document.createElement("input");
        this.toggleEl.type = "checkbox";
        parent.appendChild(this.toggleEl);
    }
    getValue(): boolean { return this.toggleEl.checked; }
    setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
    setDisabled(disabled: boolean): this { this.toggleEl.disabled = disabled; return this; }
    setTooltip(tooltip: string): this { this.toggleEl.setAttribute("aria-label", tooltip); return this; }
    onChange(callback: (value: boolean) => unknown): this {
        this.toggleEl.addEventListener("change", () => { void callback(this.toggleEl.checked); });
        return this;
    }
}

export class DropdownComponent {
    selectEl: HTMLSelectElement;

    constructor(parent: HTMLElement) {
        this.selectEl = document.createElement("select");
        parent.appendChild(this.selectEl);
    }
    getValue(): string { return this.selectEl.value; }
    setValue(value: string): this { this.selectEl.value = value; return this; }
    setDisabled(disabled: boolean): this { this.selectEl.disabled = disabled; return this; }
    addOption(value: string, display: string): this {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = display;
        this.selectEl.appendChild(option);
        return this;
    }
    addOptions(options: Record<string, string>): this {
        for (const [value, display] of Object.entries(options)) this.addOption(value, display);
        return this;
    }
    onChange(callback: (value: string) => unknown): this {
        this.selectEl.addEventListener("change", () => { void callback(this.selectEl.value); });
        return this;
    }
}

export class SliderComponent {
    sliderEl: HTMLInputElement;

    constructor(parent: HTMLElement) {
        this.sliderEl = document.createElement("input");
        this.sliderEl.type = "range";
        parent.appendChild(this.sliderEl);
    }
    getValue(): number { return Number(this.sliderEl.value); }
    setValue(value: number): this { this.sliderEl.value = String(value); return this; }
    setLimits(min: number, max: number, step: number): this {
        this.sliderEl.min = String(min);
        this.sliderEl.max = String(max);
        this.sliderEl.step = String(step);
        return this;
    }
    setDisabled(disabled: boolean): this { this.sliderEl.disabled = disabled; return this; }
    setDynamicTooltip(): this { return this; }
    onChange(callback: (value: number) => unknown): this {
        this.sliderEl.addEventListener("change", () => { void callback(Number(this.sliderEl.value)); });
        return this;
    }
}

export class Setting {
    settingEl: HTMLDivElement & ObsidianElement;
    infoEl: HTMLDivElement & ObsidianElement;
    nameEl: HTMLDivElement & ObsidianElement;
    descEl: HTMLDivElement & ObsidianElement;
    controlEl: HTMLDivElement & ObsidianElement;

    constructor(containerEl: HTMLElement) {
        this.settingEl = augment(document.createElement("div"));
        this.settingEl.className = "setting-item";
        this.infoEl = augment(document.createElement("div"));
        this.infoEl.className = "setting-item-info";
        this.nameEl = augment(document.createElement("div"));
        this.nameEl.className = "setting-item-name";
        this.descEl = augment(document.createElement("div"));
        this.descEl.className = "setting-item-description";
        this.controlEl = augment(document.createElement("div"));
        this.controlEl.className = "setting-item-control";
        this.infoEl.append(this.nameEl, this.descEl);
        this.settingEl.append(this.infoEl, this.controlEl);
        containerEl.appendChild(this.settingEl);
    }

    setName(name: string | DocumentFragment): this {
        if (typeof name === "string") this.nameEl.textContent = name;
        else this.nameEl.replaceChildren(name);
        return this;
    }
    setDesc(desc: string | DocumentFragment): this {
        if (typeof desc === "string") this.descEl.textContent = desc;
        else this.descEl.replaceChildren(desc);
        return this;
    }
    setClass(cls: string): this { this.settingEl.classList.add(cls); return this; }
    setTooltip(_tooltip: string): this { return this; }
    setHeading(): this { this.settingEl.classList.add("setting-item-heading"); return this; }

    addButton(callback: (component: ButtonComponent) => unknown): this {
        callback(new ButtonComponent(this.controlEl));
        return this;
    }
    addExtraButton(callback: (component: ExtraButtonComponent) => unknown): this {
        callback(new ExtraButtonComponent(this.controlEl));
        return this;
    }
    addText(callback: (component: TextComponent) => unknown): this {
        callback(new TextComponent(this.controlEl));
        return this;
    }
    addToggle(callback: (component: ToggleComponent) => unknown): this {
        callback(new ToggleComponent(this.controlEl));
        return this;
    }
    addDropdown(callback: (component: DropdownComponent) => unknown): this {
        callback(new DropdownComponent(this.controlEl));
        return this;
    }
    addSlider(callback: (component: SliderComponent) => unknown): this {
        callback(new SliderComponent(this.controlEl));
        return this;
    }
}

// ---- 菜单：记录最近一次弹出的菜单，测试可直接触发菜单项 ----

export class MenuItem {
    title = "";
    icon = "";
    disabled = false;
    private handler: ((evt: MouseEvent) => unknown) | undefined;

    setTitle(title: string): this { this.title = title; return this; }
    setIcon(icon: string): this { this.icon = icon; return this; }
    setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
    onClick(callback: (evt: MouseEvent) => unknown): this { this.handler = callback; return this; }
    /** 模拟用户点击；禁用项不触发，与宿主一致。 */
    trigger(): void {
        if (!this.disabled) void this.handler?.(new MouseEvent("click"));
    }
}

export class Menu {
    items: MenuItem[] = [];
    position: { x: number; y: number } | undefined;

    addItem(callback: (item: MenuItem) => unknown): this {
        const item = new MenuItem();
        callback(item);
        this.items.push(item);
        return this;
    }
    addSeparator(): this { return this; }
    showAtPosition(position: { x: number; y: number }, _doc?: Document): this {
        this.position = position;
        shownMenus.push(this);
        return this;
    }
    showAtMouseEvent(_evt: MouseEvent): this { return this; }
    hide(): void {}
}

/** 测试用：按弹出顺序记录菜单。 */
export const shownMenus: Menu[] = [];

// ---- 设置页 ----

export abstract class SettingPage {
    rootEl: HTMLElement = document.createElement("div");
    titlebarEl: HTMLElement = document.createElement("div");
    containerEl: HTMLElement & ObsidianElement = augment(document.createElement("div"));
    title = "";

    abstract display(): void;
    hide(): void {}
}

/** 打开中的设置子页：有 page 工厂时是 Svelte/自定义页面，否则是页内子项（itemsOf 为定义名）。 */
export interface OpenedSettingsPage {
    title: string;
    containerEl: HTMLElement & ObsidianElement;
    page?: SettingPage;
    itemsOf?: string;
}

/** 按名称在定义树中找到子页定义（子项页在设置变化后据此重绘）。 */
export function findPageDefinition(items: SettingDefinitionItem[], name: string): SettingDefinitionPage | undefined {
    for (const item of items) {
        if ((item as { type?: string }).type === "page" && (item as SettingDefinitionPage).name === name) return item as SettingDefinitionPage;
        const children = (item as { items?: SettingDefinitionItem[] }).items;
        const found = children ? findPageDefinition(children, name) : undefined;
        if (found) return found;
    }
    return undefined;
}

/**
 * 设置标签页基类。宿主按 getSettingDefinitions() 渲染；这里用同一套规则渲染，
 * 让测试可以像用户一样找到行、点击按钮、切换开关，而不必自己拼 DOM。
 */
export abstract class SettingTab {
    app: unknown;
    icon = "";
    containerEl: HTMLElement & ObsidianElement = augment(document.createElement("div"));
    /** 最近一次渲染产生的 render 回调清理函数；重绘前统一执行，与宿主卸载行一致。 */
    private cleanups: Array<() => void> = [];
    /** 当前打开的子页面。 */
    openedPage: OpenedSettingsPage | undefined;

    constructor(app: unknown) { this.app = app; }

    getSettingDefinitions(): SettingDefinitionItem[] { return []; }
    getControlValue(_key: string): unknown { return undefined; }
    setControlValue(_key: string, _value: unknown): void | Promise<void> {}

    display(): void { this.update(); }
    hide(): void {
        this.runCleanups();
    }

    update(): void {
        this.runCleanups();
        this.containerEl.replaceChildren();
        this.renderItems(this.containerEl, this.getSettingDefinitions());
        this.renderOpenedItems();
    }

    refreshDomState(): void { this.update(); }

    /**
     * 模拟用户点击一行的页面入口：有 page 工厂时每次都新建页面（与宿主一致），
     * 否则把页内子项渲染到一个新容器中。
     */
    openPage(definition: SettingDefinitionPage): OpenedSettingsPage {
        this.closePage();
        const containerEl = augment(document.createElement("div"));
        if (definition.page) {
            const page = definition.page();
            page.display();
            this.openedPage = { title: definition.name, containerEl: page.containerEl, page };
        } else {
            this.openedPage = { title: definition.name, containerEl, itemsOf: definition.name };
            this.renderOpenedItems();
        }
        return this.openedPage!;
    }

    closePage(): void {
        const opened = this.openedPage;
        if (!opened) return;
        this.openedPage = undefined;
        opened.page?.hide();
        // 返回主页面时宿主会刷新，但没有打开子页时不应重绘（重绘会中止进行中的探针）。
        this.update();
    }

    /** 设置变化后，打开中的子项页也要按最新定义重绘，与宿主刷新当前页一致。 */
    private renderOpenedItems(): void {
        const opened = this.openedPage;
        if (!opened?.itemsOf) return;
        const definition = findPageDefinition(this.getSettingDefinitions(), opened.itemsOf);
        opened.containerEl.replaceChildren();
        this.renderItems(opened.containerEl, definition?.items ?? []);
    }

    private runCleanups(): void {
        const cleanups = this.cleanups;
        this.cleanups = [];
        for (const cleanup of cleanups) cleanup();
    }

    private renderItems(parent: HTMLElement, items: SettingDefinitionItem[]): void {
        for (const item of items) this.renderItem(parent, item);
    }

    private renderItem(parent: HTMLElement, item: SettingDefinitionItem): void {
        if (!isVisible(item)) return;
        const kind = (item as { type?: string }).type;
        if (kind === "page") this.renderPageRow(parent, item as SettingDefinitionPage);
        else if (kind === "group" || kind === "list") this.renderGroup(parent, item as SettingDefinitionGroup);
        else this.renderSetting(parent, item as SettingDefinition);
    }

    private renderGroup(parent: HTMLElement, group: SettingDefinitionGroup): void {
        const container = augment(document.createElement("div"));
        container.className = "setting-group";
        if (group.cls) container.classList.add(...group.cls.split(" "));
        if (group.heading) container.createDiv({ cls: "setting-item-heading", text: group.heading });
        parent.appendChild(container);
        if ((group as { type?: string }).type !== "list") {
            this.renderItems(container, group.items ?? []);
            return;
        }
        const list = augment(document.createElement("div"));
        list.className = "setting-items";
        container.appendChild(list);
        const items = group.items ?? [];
        const listGroup = group as SettingDefinitionList;
        if (items.length === 0 && listGroup.emptyState) list.createDiv({ text: String(listGroup.emptyState) });
        const onDelete = listGroup.onDelete;
        items.forEach((row, index) => {
            if (!isVisible(row)) return;
            const rowEl = augment(document.createElement("div"));
            rowEl.className = "setting-list-row";
            list.appendChild(rowEl);
            const setting = new Setting(rowEl);
            setting.setName(row.name);
            if ("render" in row && typeof row.render === "function") {
                // 宿主把行内的 Setting 交给 render；mock 的 Setting 与真实类型结构不同，这里只做类型放宽。
                const render = row.render as unknown as (setting: unknown, index: number) => unknown;
                const cleanup = render(setting, index);
                if (typeof cleanup === "function") this.cleanups.push(cleanup as () => void);
            }
            if (onDelete) {
                setting.addExtraButton((button) => button
                    .setIcon("trash")
                    .setTooltip("delete")
                    .onClick(() => onDelete(index)));
            }
        });
        const addItem = listGroup.addItem;
        if (addItem) {
            const add = augment(document.createElement("button"));
            add.type = "button";
            add.textContent = addItem.name;
            add.addEventListener("click", () => addItem.action(container));
            container.appendChild(add);
        }
    }

    private renderPageRow(parent: HTMLElement, page: SettingDefinitionPage): void {
        const setting = new Setting(parent);
        setting.setName(page.name);
        if (page.desc !== undefined) setting.setDesc(page.desc);
        const displayValue = typeof page.displayValue === "function" ? page.displayValue() : page.displayValue;
        if (displayValue) setting.controlEl.createDiv({ cls: "cr-mock-display-value", text: displayValue });
        const status = typeof page.status === "function" ? page.status() : page.status;
        if (status === "warning") setting.settingEl.dataset.status = "warning";
        setting.addExtraButton((button) => button.setIcon("chevron-right").setTooltip(page.name).onClick(() => { this.openPage(page); }));
    }

    private renderSetting(parent: HTMLElement, definition: SettingDefinition): void {
        const setting = new Setting(parent);
        setting.setName(definition.name);
        if (definition.desc !== undefined) setting.setDesc(definition.desc);
        const def = definition as { render?: (setting: Setting) => unknown; control?: MockControl };
        if (def.render) {
            const cleanup = def.render(setting);
            if (typeof cleanup === "function") this.cleanups.push(cleanup as () => void);
        } else if (def.control) {
            this.renderControl(setting, def.control);
        }
    }

    private renderControl(setting: Setting, control: MockControl): void {
        const disabled = typeof control.disabled === "function" ? control.disabled() : control.disabled === true;
        const value = this.getControlValue(control.key);
        const write = (next: unknown) => { void this.setControlValue(control.key, next); };
        if (control.type === "toggle") {
            setting.addToggle((toggle) => toggle.setValue(value === true).setDisabled(disabled).onChange((next) => write(next)));
        } else if (control.type === "dropdown") {
            setting.addDropdown((dropdown) => dropdown.addOptions(control.options ?? {}).setValue(String(value ?? "")).setDisabled(disabled).onChange((next) => write(next)));
        } else if (control.type === "slider") {
            setting.addSlider((slider) => slider.setLimits(control.min ?? 0, control.max ?? 100, control.step ?? 1).setValue(Number(value)).setDisabled(disabled).onChange((next) => write(next)));
        } else {
            setting.addText((text) => text.setValue(String(value ?? "")).setDisabled(disabled).onChange((next) => write(next)));
        }
    }
}

interface MockControl {
    type: "toggle" | "dropdown" | "slider" | "text";
    key: string;
    disabled?: boolean | (() => boolean);
    options?: Record<string, string>;
    min?: number;
    max?: number;
    step?: number;
}

function isVisible(item: { visible?: boolean | (() => boolean) }): boolean {
    const visible = item.visible;
    if (visible === undefined) return true;
    return typeof visible === "function" ? visible() : visible;
}

export class PluginSettingTab extends SettingTab {
    plugin: unknown;

    constructor(app: unknown, plugin: unknown) {
        super(app);
        this.plugin = plugin;
    }
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
