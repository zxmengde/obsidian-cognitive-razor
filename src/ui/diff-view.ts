/**
 * DiffView - 内容差异预览组件
 * 
 * 功能：
 * - 差异显示
 * - 逐项确认
 * - 接受/放弃操作
 */

import { Modal, App, Notice } from "obsidian";

/**
 * 差异类型
 */
export type DiffType = "add" | "remove" | "modify";

/**
 * 差异项
 */
export interface DiffItem {
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
export interface DiffData {
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

/**
 * DiffView 模态框
 */
export class DiffView extends Modal {
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
    this.diffData = diffData;
    this.onAccept = onAccept;
    this.onReject = onReject;

    // 默认全选
    diffData.diffs.forEach(diff => {
      this.selectedDiffs.add(diff.path);
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-diff-view");
    contentEl.addClass("cr-scope");
    contentEl.setAttr("role", "dialog");
    contentEl.setAttr("aria-modal", "true");
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
      cls: "mod-cta",
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
    this.renderSideBySideDiff(diffContent);

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
  private renderSideBySideDiff(container: HTMLElement): void {
    const diffGrid = container.createDiv({ cls: "cr-diff-grid" });

    // 左侧：原始内容
    const leftPanel = diffGrid.createDiv({ cls: "cr-diff-panel" });
    leftPanel.createEl("div", { text: "原始内容", cls: "cr-panel-title" });
    const leftContent = leftPanel.createDiv({ cls: "cr-panel-content-wrapper" });
    this.renderContentWithLineNumbers(leftContent, this.diffData.originalContent, "original");

    // 右侧：新内容
    const rightPanel = diffGrid.createDiv({ cls: "cr-diff-panel" });
    rightPanel.createEl("div", { text: "新内容", cls: "cr-panel-title" });
    const rightContent = rightPanel.createDiv({ cls: "cr-panel-content-wrapper" });
    this.renderContentWithLineNumbers(rightContent, this.diffData.newContent, "new");
  }

  /**
   * 渲染带行号的内容
   */
  private renderContentWithLineNumbers(
    container: HTMLElement,
    content: string,
    type: "original" | "new"
  ): void {
    const lines = content.split("\n");
    const lineNumbersDiv = container.createDiv({ cls: "cr-line-numbers" });
    const contentDiv = container.createDiv({ cls: "cr-content-lines" });

    lines.forEach((line, index) => {
      // 行号
      lineNumbersDiv.createDiv({
        text: String(index + 1),
        cls: "cr-line-number"
      });

      // 内容行
      const lineDiv = contentDiv.createDiv({ cls: "cr-content-line" });
      
      // 简单的语法高亮（针对 Markdown）
      this.renderLineWithHighlight(lineDiv, line);
    });
  }

  /**
   * 简单的 Markdown 语法高亮
   */
  private renderLineWithHighlight(container: HTMLElement, line: string): void {
    // 标题
    if (/^#{1,6}\s/.test(line)) {
      container.addClass("cr-syntax-heading");
      container.textContent = line;
      return;
    }

    // 列表
    if (/^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)) {
      container.addClass("cr-syntax-list");
      container.textContent = line;
      return;
    }

    // 代码块
    if (/^```/.test(line)) {
      container.addClass("cr-syntax-code-fence");
      container.textContent = line;
      return;
    }

    // 引用
    if (/^>\s/.test(line)) {
      container.addClass("cr-syntax-quote");
      container.textContent = line;
      return;
    }

    // 链接
    if (/\[.*\]\(.*\)/.test(line)) {
      container.addClass("cr-syntax-link");
      container.textContent = line;
      return;
    }

    // 普通文本
    container.textContent = line || " "; // 空行显示空格以保持布局
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
    const { contentEl } = this;
    contentEl.empty();
    this.diffsContainer = null;
    this.selectedDiffs.clear();
  }
}

export type LineDiffType = "add" | "remove" | "context";

export interface LineDiff {
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
 * 简化的差异视图（用于快速预览）
 */
export class SimpleDiffView extends Modal {
  private originalContent: string;
  private newContent: string;
  private title: string;
  private onAccept: () => void;
  private onReject: () => void;

  constructor(
    app: App,
    title: string,
    originalContent: string,
    newContent: string,
    onAccept: () => void,
    onReject: () => void
  ) {
    super(app);
    this.title = title;
    this.originalContent = originalContent;
    this.newContent = newContent;
    this.onAccept = onAccept;
    this.onReject = onReject;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-simple-diff-view");
    contentEl.addClass("cr-scope");

    // 标题
    contentEl.createEl("h2", { text: this.title });

    // 行级高亮视图
    const diffLines = buildLineDiff(this.originalContent, this.newContent);
    const diffContainer = contentEl.createDiv({ cls: "cr-unified-diff" });

    diffLines.forEach((line, index) => {
      const row = diffContainer.createDiv({ cls: `cr-diff-row cr-${line.type}` });
      row.createSpan({
        text: line.type === "add" ? "+" : line.type === "remove" ? "-" : " ",
        cls: "cr-diff-prefix"
      });
      row.createSpan({
        text: line.text || " ",
        cls: "cr-diff-text",
        attr: { "data-line": `${index + 1}` }
      });
    });

    // 操作按钮
    const actions = contentEl.createDiv({ cls: "cr-diff-actions" });

    const acceptBtn = actions.createEl("button", {
      text: "接受",
      cls: "mod-cta",
      attr: { "aria-label": "接受更改" }
    });
    acceptBtn.addEventListener("click", () => {
      this.onAccept();
      this.close();
    });

    const rejectBtn = actions.createEl("button", {
      text: "放弃",
      attr: { "aria-label": "放弃更改" }
    });
    rejectBtn.addEventListener("click", () => {
      this.onReject();
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
