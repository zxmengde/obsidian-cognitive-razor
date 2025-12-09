/**
 * 创建概念 Modal
 * 
 * 提供极简的单行输入界面，用于创建新概念
 * 
 * 遵循设计文档 A-UCD-01：三步完成核心任务
 * 修改：使用极简单行输入框设计
 */

import { App, Modal, Notice } from "obsidian";
import { CRType } from "../types";

/**
 * 创建概念 Modal 选项
 */
export interface CreateConceptModalOptions {
  /** 默认输入值 */
  defaultValue?: string;
  /** 提交回调 */
  onSubmit: (input: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * 创建概念 Modal（极简版）
 */
export class CreateConceptModal extends Modal {
  private options: CreateConceptModalOptions;
  private inputValue: string;

  constructor(app: App, options: CreateConceptModalOptions) {
    super(app);
    this.options = options;
    this.inputValue = options.defaultValue || "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-scope");
    contentEl.addClass("cr-minimal-modal");

    // 极简输入框 - 占据整行，无标题无提示
    const inputContainer = contentEl.createDiv({ cls: "cr-minimal-input cr-minimal-input-fullwidth" });

    // 单行输入框
    const input = inputContainer.createEl("input", {
      type: "text",
      cls: "cr-minimal-input-field",
      placeholder: "Enter concept name or description...",
      value: this.inputValue
    });

    // 提交按钮（圆形）
    const submitBtn = inputContainer.createEl("button", {
      cls: "cr-minimal-submit-btn",
      attr: {
        "aria-label": "Submit",
        "title": "Enter to submit"
      }
    });
    submitBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

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
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * 提交
   */
  private submit(): void {
    const input = this.inputValue.trim();
    
    if (!input) {
      new Notice("Please enter concept name or description");
      return;
    }

    this.close();
    this.options.onSubmit(input);
  }
}

