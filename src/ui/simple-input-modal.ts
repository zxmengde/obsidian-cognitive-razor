/**
 * SimpleInputModal - 极简单行输入框
 * 
 * 设计：
 * - 单行输入框 + Enter 图标按钮
 * - 支持 Enter 键快速提交
 * - 用于创建概念等简单输入场景
 */

import { App, Notice, setIcon } from "obsidian";
import { AbstractModal } from "./abstract-modal";

/**
 * 简单输入 Modal 选项
 */
interface SimpleInputModalOptions {
  /** 标题 */
  title: string;
  /** 占位符 */
  placeholder?: string;
  /** 默认值 */
  defaultValue?: string;
  /** 提交回调 */
  onSubmit: (value: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * 极简单行输入 Modal
 */
export class SimpleInputModal extends AbstractModal {
  private options: SimpleInputModalOptions;
  private inputValue: string;

  constructor(app: App, options: SimpleInputModalOptions) {
    super(app);
    this.options = options;
    this.inputValue = options.defaultValue || "";
  }

  protected renderContent(contentEl: HTMLElement): void {
    contentEl.addClass("cr-simple-input-modal");

    // 标题
    contentEl.createEl("h2", { 
      text: this.options.title,
      cls: "cr-simple-input-title"
    });

    // 输入容器
    const inputContainer = contentEl.createDiv({ cls: "cr-simple-input-container" });

    // 单行输入框
    const input = inputContainer.createEl("input", {
      type: "text",
      cls: "cr-simple-input",
      placeholder: this.options.placeholder || "",
      value: this.inputValue
    });

    // Enter 图标按钮
    const submitBtn = inputContainer.createEl("button", {
      cls: "cr-simple-input-submit",
      attr: {
        "aria-label": "提交",
        "title": "提交 (Enter)"
      }
    });
    setIcon(submitBtn, "corner-down-left");

    // 自动聚焦
    input.focus();

    // 输入变化
    input.addEventListener("input", () => {
      this.inputValue = input.value;
    });

    // Enter 键提交
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        if (this.options.onCancel) {
          this.options.onCancel();
        }
      }
    });

    // 按钮点击提交
    submitBtn.addEventListener("click", () => {
      this.submit();
    });
  }

  onClose(): void {
    super.onClose();
  }

  /**
   * 提交
   */
  private submit(): void {
    const value = this.inputValue.trim();
    
    if (!value) {
      new Notice("请输入内容");
      return;
    }

    this.close();
    this.options.onSubmit(value);
  }
}
