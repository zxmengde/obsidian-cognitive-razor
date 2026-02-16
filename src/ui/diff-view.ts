/**
 * DiffView - 内容差异预览组件
 *
 * 功能：
 * - 双模式差异显示（统一 Diff / Side-by-Side）
 * - 顶部 Tab 栏切换模式
 * - 行号显示
 * - 差异行高亮（cr-diff-add / cr-diff-remove / cr-diff-change）
 * - Side-by-Side 模式滚动同步
 * - 确认接受 / 放弃操作
 */

import { App, Notice } from "obsidian";
import { AbstractModal } from "./abstract-modal";

/**
 * 差异类型
 */
type DiffType = "add" | "remove" | "modify";

/**
 * 差异项
 */
interface DiffItem {
    /** 差异类型 */
    type: DiffType;
    /** 字段路径 */
    path: string;
    /** 旧值 */
    oldValue?: string;
    /** 新值 */
    newValue?: string;
    /** 显示标签 */
    label: string;
}

/**
 * 差异数据
 */
interface DiffData {
    /** 文件路径 */
    filePath: string;
    /** 原始内容 */
    originalContent: string;
    /** 新内容 */
    newContent: string;
    /** 差异项列表 */
    diffs: DiffItem[];
    /** 操作描述 */
    operationDesc: string;
}

interface SimpleDiffLabels {
    accept: string;
    reject: string;
    acceptAria: string;
    rejectAria: string;
    modeLabel: string;
    unifiedView: string;
    unifiedViewAria: string;
    sideBySideView: string;
    sideBySideViewAria: string;
    leftTitle: string;
    rightTitle: string;
}

/** 视图模式 */
type DiffViewMode = "unified" | "side-by-side";

/**
 * @deprecated 旧版 DiffView 模态框，已被 SimpleDiffView 替代。
 * 保留仅供参考，禁止新代码引用。计划在下一个大版本中删除。
 */
class DiffView extends AbstractModal {
    private diffData: DiffData;
    private onAccept: (selectedDiffs: DiffItem[]) => void;
    private onReject: () => void;
    private selectedDiffs: Set<string> = new Set();
    private diffsContainer: HTMLElement | null = null;

    constructor(
        app: App,
        diffData: DiffData,
        onAccept: (selectedDiffs: DiffItem[]) => void,
        onReject: () => void
    ) {
        super(app);
        this.isDestructive = true;
        this.diffData = diffData;
        this.onAccept = onAccept;
        this.onReject = onReject;

        // 默认全选
        diffData.diffs.forEach(diff => {
            this.selectedDiffs.add(diff.path);
        });
    }

    /** 破坏性 Escape：触发放弃操作 */
    protected onEscapeDestructive(): void {
        this.handleReject();
    }

    protected renderContent(contentEl: HTMLElement): void {
        contentEl.addClass("cr-diff-view");
        contentEl.setAttr("aria-live", "polite");

        // 标题
        const header = contentEl.createDiv({ cls: "cr-diff-header" });
        header.createEl("h2", { text: "内容预览" });
        header.createEl("div", {
            text: this.diffData.operationDesc,
            cls: "cr-diff-operation"
        });

        // 文件路径
        contentEl.createEl("div", {
            text: `文件: ${this.diffData.filePath}`,
            cls: "cr-diff-filepath"
        });

        // 全选/全不选控制
        const selectControls = contentEl.createDiv({ cls: "cr-select-controls" });

        const selectAllBtn = selectControls.createEl("button", {
            text: "全选",
            attr: { "aria-label": "全选所有差异项" }
        });
        selectAllBtn.addEventListener("click", () => {
            this.selectAll();
        });

        const deselectAllBtn = selectControls.createEl("button", {
            text: "全不选",
            attr: { "aria-label": "取消选择所有差异项" }
        });
        deselectAllBtn.addEventListener("click", () => {
            this.deselectAll();
        });

        // 差异列表
        this.diffsContainer = contentEl.createDiv({ cls: "cr-diffs-container" });
        this.renderDiffs();

        // 预览区域
        this.renderPreview(contentEl);

        // 操作按钮
        const actions = contentEl.createDiv({ cls: "cr-diff-actions" });

        const acceptBtn = actions.createEl("button", {
            text: "接受更改",
            cls: "cr-btn-primary",
            attr: { "aria-label": "接受选中的更改" }
        });
        acceptBtn.addEventListener("click", () => {
            this.handleAccept();
        });

        const rejectBtn = actions.createEl("button", {
            text: "放弃更改",
            attr: { "aria-label": "放弃所有更改" }
        });
        rejectBtn.addEventListener("click", () => {
            this.handleReject();
        });

        const cancelBtn = actions.createEl("button", {
            text: "取消",
            attr: { "aria-label": "取消操作" }
        });
        cancelBtn.addEventListener("click", () => {
            this.close();
        });
    }

    /**
     * 渲染差异列表
     */
    private renderDiffs(): void {
        if (!this.diffsContainer) return;

        this.diffsContainer.empty();

        if (this.diffData.diffs.length === 0) {
            this.diffsContainer.createEl("div", {
                text: "无差异",
                cls: "cr-no-diffs"
            });
            return;
        }

        this.diffData.diffs.forEach(diff => {
            const item = this.diffsContainer!.createDiv({
                cls: `cr-diff-item cr-diff-${diff.type}`
            });

            // 复选框
            const checkbox = item.createEl("input", {
                type: "checkbox",
                cls: "cr-diff-checkbox",
                attr: {
                    "aria-label": `选择差异项: ${diff.label}`
                }
            });
            checkbox.checked = this.selectedDiffs.has(diff.path);
            checkbox.addEventListener("change", () => {
                this.handleDiffToggle(diff.path, checkbox.checked);
            });

            // 差异信息
            const info = item.createDiv({ cls: "cr-diff-info" });

            // 标签和类型
            const labelRow = info.createDiv({ cls: "cr-diff-label-row" });
            labelRow.createEl("span", {
                text: diff.label,
                cls: "cr-diff-label"
            });
            labelRow.createEl("span", {
                text: this.getDiffTypeLabel(diff.type),
                cls: `cr-diff-type-badge cr-type-${diff.type}`
            });

            // 值变化
            if (diff.type === "modify") {
                const changeRow = info.createDiv({ cls: "cr-diff-change" });
                changeRow.createEl("div", {
                    text: `旧值: ${this.truncateValue(diff.oldValue || "")}`,
                    cls: "cr-old-value"
                });
                changeRow.createEl("div", {
                    text: `新值: ${this.truncateValue(diff.newValue || "")}`,
                    cls: "cr-new-value"
                });
            } else if (diff.type === "add") {
                info.createEl("div", {
                    text: `新值: ${this.truncateValue(diff.newValue || "")}`,
                    cls: "cr-new-value"
                });
            } else if (diff.type === "remove") {
                info.createEl("div", {
                    text: `旧值: ${this.truncateValue(diff.oldValue || "")}`,
                    cls: "cr-old-value"
                });
            }
        });
    }

    /**
     * 渲染预览区域
     */
    private renderPreview(container: HTMLElement): void {
        const previewSection = container.createDiv({ cls: "cr-preview-section" });
        previewSection.createEl("h3", { text: "完整预览" });

        // 标签页切换
        const tabs = previewSection.createDiv({ cls: "cr-preview-tabs" });

        const originalTab = tabs.createEl("button", {
            text: "原始内容",
            cls: "cr-tab-active",
            attr: { "aria-label": "查看原始内容" }
        });

        const newTab = tabs.createEl("button", {
            text: "新内容",
            attr: { "aria-label": "查看新内容" }
        });

        const diffTab = tabs.createEl("button", {
            text: "对比视图",
            attr: { "aria-label": "查看对比视图" }
        });

        // 内容区域
        const contentArea = previewSection.createDiv({ cls: "cr-preview-content" });

        const originalContent = contentArea.createEl("pre", {
            text: this.diffData.originalContent,
            cls: "cr-preview-original"
        });

        const newContent = contentArea.createEl("pre", {
            text: this.diffData.newContent,
            cls: "cr-preview-new"
        });
        newContent.style.display = "none";

        const diffContent = contentArea.createDiv({ cls: "cr-preview-diff" });
        diffContent.style.display = "none";
        this.renderEmbeddedSideBySideDiff(diffContent);

        // 标签页切换逻辑
        originalTab.addEventListener("click", () => {
            this.switchTab(tabs, originalTab);
            originalContent.style.display = "block";
            newContent.style.display = "none";
            diffContent.style.display = "none";
        });

        newTab.addEventListener("click", () => {
            this.switchTab(tabs, newTab);
            originalContent.style.display = "none";
            newContent.style.display = "block";
            diffContent.style.display = "none";
        });

        diffTab.addEventListener("click", () => {
            this.switchTab(tabs, diffTab);
            originalContent.style.display = "none";
            newContent.style.display = "none";
            diffContent.style.display = "block";
        });
    }

    /**
     * 渲染并排差异视图（带行号和语法高亮）
     */
    private renderEmbeddedSideBySideDiff(container: HTMLElement): void {
        renderSideBySideDiff(
            container,
            this.diffData.originalContent,
            this.diffData.newContent,
            "原始内容",
            "新内容"
        );
    }

    /**
     * 切换标签页
     */
    private switchTab(tabsContainer: HTMLElement, activeTab: HTMLElement): void {
        const tabs = tabsContainer.querySelectorAll("button");
        tabs.forEach(tab => {
            tab.removeClass("cr-tab-active");
        });
        activeTab.addClass("cr-tab-active");
    }

    /**
     * 获取差异类型标签
     */
    private getDiffTypeLabel(type: DiffType): string {
        const labels: Record<DiffType, string> = {
            add: "新增",
            remove: "删除",
            modify: "修改"
        };
        return labels[type];
    }

    /**
     * 截断长值
     */
    private truncateValue(value: string, maxLength: number = 100): string {
        if (value.length <= maxLength) return value;
        return value.substring(0, maxLength) + "...";
    }

    /**
     * 处理差异项切换
     */
    private handleDiffToggle(path: string, checked: boolean): void {
        if (checked) {
            this.selectedDiffs.add(path);
        } else {
            this.selectedDiffs.delete(path);
        }
    }

    /**
     * 全选
     */
    private selectAll(): void {
        this.diffData.diffs.forEach(diff => {
            this.selectedDiffs.add(diff.path);
        });
        this.renderDiffs();
    }

    /**
     * 全不选
     */
    private deselectAll(): void {
        this.selectedDiffs.clear();
        this.renderDiffs();
    }

    /**
     * 处理接受更改
     */
    private handleAccept(): void {
        if (this.selectedDiffs.size === 0) {
            new Notice("请至少选择一项更改");
            return;
        }

        const selectedDiffItems = this.diffData.diffs.filter(diff =>
            this.selectedDiffs.has(diff.path)
        );

        this.onAccept(selectedDiffItems);
        this.close();
    }

    /**
     * 处理放弃更改
     */
    private handleReject(): void {
        this.onReject();
        this.close();
    }

    onClose(): void {
        this.diffsContainer = null;
        this.selectedDiffs.clear();
        super.onClose();
    }
}

type LineDiffType = "add" | "remove" | "context";

interface LineDiff {
    type: LineDiffType;
    text: string;
}

/**
 * 生成简单的行级 diff（基于 LCS）
 */
export function buildLineDiff(oldContent: string, newContent: string): LineDiff[] {
    const a = oldContent.split(/\r?\n/);
    const b = newContent.split(/\r?\n/);
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (a[i] === b[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const result: LineDiff[] = [];
    let i = 0;
    let j = 0;

    while (i < m && j < n) {
        if (a[i] === b[j]) {
            result.push({ type: "context", text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            result.push({ type: "remove", text: a[i] });
            i++;
        } else {
            result.push({ type: "add", text: b[j] });
            j++;
        }
    }

    while (i < m) {
        result.push({ type: "remove", text: a[i] });
        i++;
    }
    while (j < n) {
        result.push({ type: "add", text: b[j] });
        j++;
    }

    return result;
}

/**
 * 简化的差异视图（双模式：统一 Diff / Side-by-Side）
 *
 * 需求 10.1: 默认显示统一行级 Diff 视图
 * 需求 10.2: 提供视图切换功能（统一 Diff ↔ Side-by-Side）
 * 需求 10.3: Side-by-Side 模式左右并排显示，差异行高亮
 * 需求 10.4: 差异区域提供行号显示
 * 需求 10.5: 确认接受触发写入流程，放弃时丢弃修改并关闭
 */
export class SimpleDiffView extends AbstractModal {
    private originalContent: string;
    private newContent: string;
    private title: string;
    private onAccept: () => void;
    private onReject: () => void;
    private labels: SimpleDiffLabels;
    /** 当前视图模式 */
    private currentMode: DiffViewMode = "unified";
    /** 差异内容容器引用（用于模式切换时重新渲染） */
    private diffContentContainer: HTMLElement | null = null;

    constructor(
        app: App,
        title: string,
        originalContent: string,
        newContent: string,
        onAccept: () => void,
        onReject: () => void,
        labels: SimpleDiffLabels
    ) {
        super(app);
        this.isDestructive = true;
        this.title = title;
        this.originalContent = originalContent;
        this.newContent = newContent;
        this.onAccept = onAccept;
        this.onReject = onReject;
        this.labels = labels;
    }

    /** 破坏性 Escape：触发放弃操作 */
    protected onEscapeDestructive(): void {
        this.onReject();
        this.close();
    }

    protected renderContent(contentEl: HTMLElement): void {
        contentEl.addClass("cr-simple-diff-view");

        // 标题
        contentEl.createEl("h2", { text: this.title });

        // 模式切换 Tab 栏
        const tabBar = contentEl.createDiv({
            cls: "cr-diff-mode-tabs",
            attr: { role: "tablist", "aria-label": this.labels.modeLabel }
        });

        const unifiedTab = tabBar.createEl("button", {
            text: this.labels.unifiedView,
            cls: "cr-diff-mode-tab cr-diff-mode-tab-active",
            attr: {
                role: "tab",
                "aria-selected": "true",
                "aria-controls": "cr-diff-content",
                "aria-label": this.labels.unifiedViewAria,
            }
        });

        const sideBySideTab = tabBar.createEl("button", {
            text: this.labels.sideBySideView,
            cls: "cr-diff-mode-tab",
            attr: {
                role: "tab",
                "aria-selected": "false",
                "aria-controls": "cr-diff-content",
                "aria-label": this.labels.sideBySideViewAria,
            }
        });

        // 差异内容容器
        this.diffContentContainer = contentEl.createDiv({
            cls: "cr-diff-content-container",
            attr: { id: "cr-diff-content", role: "tabpanel" }
        });

        // 默认渲染统一视图
        this.renderUnifiedDiff();

        // Tab 切换逻辑
        unifiedTab.addEventListener("click", () => {
            if (this.currentMode === "unified") return;
            this.currentMode = "unified";
            this.updateTabState(unifiedTab, sideBySideTab);
            this.renderUnifiedDiff();
        });

        sideBySideTab.addEventListener("click", () => {
            if (this.currentMode === "side-by-side") return;
            this.currentMode = "side-by-side";
            this.updateTabState(sideBySideTab, unifiedTab);
            this.renderSideBySideDiff();
        });

        // 操作按钮
        const actions = contentEl.createDiv({ cls: "cr-diff-actions" });

        const acceptBtn = actions.createEl("button", {
            text: this.labels.accept,
            cls: "cr-btn-primary",
            attr: { "aria-label": this.labels.acceptAria }
        });
        acceptBtn.addEventListener("click", () => {
            this.onAccept();
            this.close();
        });

        const rejectBtn = actions.createEl("button", {
            text: this.labels.reject,
            cls: "cr-btn-secondary",
            attr: { "aria-label": this.labels.rejectAria }
        });
        rejectBtn.addEventListener("click", () => {
            this.onReject();
            this.close();
        });
    }

    /**
     * 更新 Tab 激活状态
     */
    private updateTabState(activeTab: HTMLElement, inactiveTab: HTMLElement): void {
        activeTab.addClass("cr-diff-mode-tab-active");
        activeTab.setAttr("aria-selected", "true");
        inactiveTab.removeClass("cr-diff-mode-tab-active");
        inactiveTab.setAttr("aria-selected", "false");
    }

    /**
     * 渲染统一 Diff 视图（带行号）
     */
    private renderUnifiedDiff(): void {
        if (!this.diffContentContainer) return;
        this.diffContentContainer.empty();

        const diffLines = buildLineDiff(this.originalContent, this.newContent);
        const diffContainer = this.diffContentContainer.createDiv({ cls: "cr-unified-diff" });

        // 计算原始行号和新行号
        let oldLineNum = 1;
        let newLineNum = 1;

        diffLines.forEach(line => {
            const row = diffContainer.createDiv({ cls: `cr-diff-row cr-diff-${line.type}` });

            // 旧文件行号
            const oldNum = row.createSpan({ cls: "cr-diff-line-num" });
            if (line.type === "remove" || line.type === "context") {
                oldNum.textContent = String(oldLineNum);
            }

            // 新文件行号
            const newNum = row.createSpan({ cls: "cr-diff-line-num" });
            if (line.type === "add" || line.type === "context") {
                newNum.textContent = String(newLineNum);
            }

            // 前缀符号
            row.createSpan({
                text: line.type === "add" ? "+" : line.type === "remove" ? "-" : " ",
                cls: "cr-diff-prefix"
            });

            // 行内容
            row.createSpan({
                text: line.text || " ",
                cls: "cr-diff-text"
            });

            // 更新行号
            if (line.type === "remove") {
                oldLineNum++;
            } else if (line.type === "add") {
                newLineNum++;
            } else {
                oldLineNum++;
                newLineNum++;
            }
        });
    }

    /**
     * 渲染 Side-by-Side 差异视图
     */
    private renderSideBySideDiff(): void {
        if (!this.diffContentContainer) return;
        this.diffContentContainer.empty();

        renderSideBySideDiffWithHighlight(
            this.diffContentContainer,
            this.originalContent,
            this.newContent,
            this.labels.leftTitle,
            this.labels.rightTitle
        );
    }

    onClose(): void {
        this.diffContentContainer = null;
        super.onClose();
    }
}

/**
 * Side-by-Side 对齐行
 * 将 LCS diff 结果转换为左右对齐的行对
 */
interface AlignedLine {
    /** 左侧行（null 表示空行占位） */
    left: { text: string; type: "context" | "remove" } | null;
    /** 右侧行（null 表示空行占位） */
    right: { text: string; type: "context" | "add" } | null;
}

/**
 * 将 LineDiff 数组转换为左右对齐的行对
 * 连续的 remove + add 配对为 change 行，单独的 remove/add 用空行占位
 */
function alignDiffLines(diffLines: LineDiff[]): AlignedLine[] {
    const aligned: AlignedLine[] = [];
    let i = 0;

    while (i < diffLines.length) {
        const line = diffLines[i];

        if (line.type === "context") {
            aligned.push({
                left: { text: line.text, type: "context" },
                right: { text: line.text, type: "context" }
            });
            i++;
        } else if (line.type === "remove") {
            // 收集连续的 remove 行
            const removes: LineDiff[] = [];
            while (i < diffLines.length && diffLines[i].type === "remove") {
                removes.push(diffLines[i]);
                i++;
            }
            // 收集紧随其后的 add 行
            const adds: LineDiff[] = [];
            while (i < diffLines.length && diffLines[i].type === "add") {
                adds.push(diffLines[i]);
                i++;
            }
            // 配对：remove ↔ add 形成 change 行，多余的用空行占位
            const maxLen = Math.max(removes.length, adds.length);
            for (let j = 0; j < maxLen; j++) {
                aligned.push({
                    left: j < removes.length
                        ? { text: removes[j].text, type: "remove" }
                        : null,
                    right: j < adds.length
                        ? { text: adds[j].text, type: "add" }
                        : null
                });
            }
        } else {
            // 单独的 add 行（左侧空行占位）
            aligned.push({
                left: null,
                right: { text: line.text, type: "add" }
            });
            i++;
        }
    }

    return aligned;
}

/**
 * 渲染带差异高亮的 Side-by-Side 视图
 * 使用 CSS Grid 两列布局，左侧原文、右侧修改后内容，滚动同步
 */
function renderSideBySideDiffWithHighlight(
    container: HTMLElement,
    oldContent: string,
    newContent: string,
    leftTitle: string = "原始内容",
    rightTitle: string = "修改后内容"
): void {
    const diffLines = buildLineDiff(oldContent, newContent);
    const aligned = alignDiffLines(diffLines);

    const grid = container.createDiv({ cls: "cr-sbs-diff" });

    // 左侧面板
    const leftPanel = grid.createDiv({ cls: "cr-sbs-panel cr-sbs-left" });
    leftPanel.createDiv({ text: leftTitle, cls: "cr-sbs-title" });
    const leftScroll = leftPanel.createDiv({ cls: "cr-sbs-scroll" });

    // 右侧面板
    const rightPanel = grid.createDiv({ cls: "cr-sbs-panel cr-sbs-right" });
    rightPanel.createDiv({ text: rightTitle, cls: "cr-sbs-title" });
    const rightScroll = rightPanel.createDiv({ cls: "cr-sbs-scroll" });

    // 渲染对齐行
    let leftLineNum = 1;
    let rightLineNum = 1;

    aligned.forEach(pair => {
        // 左侧行
        const leftRow = leftScroll.createDiv({ cls: "cr-sbs-row" });
        if (pair.left) {
            const cls = pair.left.type === "remove"
                ? (pair.right ? "cr-diff-change" : "cr-diff-remove")
                : "";
            if (cls) leftRow.addClass(cls);
            leftRow.createSpan({ text: String(leftLineNum), cls: "cr-sbs-line-num" });
            leftRow.createSpan({ text: pair.left.text || " ", cls: "cr-sbs-text" });
            leftLineNum++;
        } else {
            leftRow.addClass("cr-diff-empty");
            leftRow.createSpan({ text: "", cls: "cr-sbs-line-num" });
            leftRow.createSpan({ text: " ", cls: "cr-sbs-text" });
        }

        // 右侧行
        const rightRow = rightScroll.createDiv({ cls: "cr-sbs-row" });
        if (pair.right) {
            const cls = pair.right.type === "add"
                ? (pair.left ? "cr-diff-change" : "cr-diff-add")
                : "";
            if (cls) rightRow.addClass(cls);
            rightRow.createSpan({ text: String(rightLineNum), cls: "cr-sbs-line-num" });
            rightRow.createSpan({ text: pair.right.text || " ", cls: "cr-sbs-text" });
            rightLineNum++;
        } else {
            rightRow.addClass("cr-diff-empty");
            rightRow.createSpan({ text: "", cls: "cr-sbs-line-num" });
            rightRow.createSpan({ text: " ", cls: "cr-sbs-text" });
        }
    });

    // 滚动同步
    bindSyncedScroll(leftScroll, rightScroll);
}

function renderContentWithLineNumbers(container: HTMLElement, content: string): void {
    const lines = content.split("\n");
    const lineNumbersDiv = container.createDiv({ cls: "cr-line-numbers" });
    const contentDiv = container.createDiv({ cls: "cr-content-lines" });

    lines.forEach((line, index) => {
        lineNumbersDiv.createDiv({
            text: String(index + 1),
            cls: "cr-line-number"
        });

        const lineDiv = contentDiv.createDiv({ cls: "cr-content-line" });
        renderLineWithHighlight(lineDiv, line);
    });
}

function renderLineWithHighlight(container: HTMLElement, line: string): void {
    if (/^#{1,6}\s/.test(line)) {
        container.addClass("cr-syntax-heading");
        container.textContent = line;
        return;
    }

    if (/^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)) {
        container.addClass("cr-syntax-list");
        container.textContent = line;
        return;
    }

    if (/^```/.test(line)) {
        container.addClass("cr-syntax-code-fence");
        container.textContent = line;
        return;
    }

    if (/^>\s/.test(line)) {
        container.addClass("cr-syntax-quote");
        container.textContent = line;
        return;
    }

    if (/\[.*\]\(.*\)/.test(line)) {
        container.addClass("cr-syntax-link");
        container.textContent = line;
        return;
    }

    container.textContent = line || " ";
}

export function renderSideBySideDiff(
    container: HTMLElement,
    oldContent: string,
    newContent: string,
    leftHeaderTitle: string = "旧版本",
    rightHeaderTitle: string = "新版本"
): void {
    const diffGrid = container.createDiv({ cls: "cr-diff-grid" });

    const leftPanel = diffGrid.createDiv({ cls: "cr-diff-panel cr-diff-left" });
    leftPanel.createEl("div", {
        text: leftHeaderTitle,
        cls: "cr-panel-title"
    });
    const leftContent = leftPanel.createDiv({ cls: "cr-panel-content-wrapper" });
    renderContentWithLineNumbers(leftContent, oldContent);

    const rightPanel = diffGrid.createDiv({ cls: "cr-diff-panel cr-diff-right" });
    rightPanel.createEl("div", {
        text: rightHeaderTitle,
        cls: "cr-panel-title"
    });
    const rightContent = rightPanel.createDiv({ cls: "cr-panel-content-wrapper" });
    renderContentWithLineNumbers(rightContent, newContent);

    bindSyncedScroll(leftContent, rightContent);
}

/**
 * 同步两个滚动容器的滚动位置（Side-by-Side Diff）
 * 使用 requestAnimationFrame 防止循环触发
 */
function bindSyncedScroll(a: HTMLElement, b: HTMLElement): void {
    let syncing = false;
    let raf: number | null = null;

    const sync = (from: HTMLElement, to: HTMLElement) => {
        if (syncing) return;
        syncing = true;
        if (raf !== null) {
            cancelAnimationFrame(raf);
        }
        raf = requestAnimationFrame(() => {
            to.scrollTop = from.scrollTop;
            to.scrollLeft = from.scrollLeft;
            syncing = false;
            raf = null;
        });
    };

    a.addEventListener("scroll", () => sync(a, b), { passive: true });
    b.addEventListener("scroll", () => sync(b, a), { passive: true });
}
