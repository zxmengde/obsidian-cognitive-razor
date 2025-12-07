/**
 * 创建概念 Modal
 * 
 * 提供简单的文本输入界面，用于创建新概念
 * 
 * 遵循设计文档 A-UCD-01：三步完成核心任务
 */

import { App, Modal, Setting, Notice } from "obsidian";
import { PipelineOrchestrator } from "../core/pipeline-orchestrator";
import { CRType } from "../types";

/**
 * 创建概念 Modal 选项
 */
export interface CreateConceptModalOptions {
  /** 默认输入值 */
  defaultValue?: string;
  /** 默认类型 */
  defaultType?: CRType;
  /** 提交回调 */
  onSubmit: (input: string, type?: CRType) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * 创建概念 Modal
 */
export class CreateConceptModal extends Modal {
  private options: CreateConceptModalOptions;
  private inputValue: string;
  private selectedType?: CRType;

  constructor(app: App, options: CreateConceptModalOptions) {
    super(app);
    this.options = options;
    this.inputValue = options.defaultValue || "";
    this.selectedType = options.defaultType;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl("h2", { text: "创建概念" });

    // 输入框
    new Setting(contentEl)
      .setName("概念名称或描述")
      .setDesc("输入概念的名称或简短描述，AI 将帮助你标准化和分类")
      .addTextArea((text) => {
        text
          .setPlaceholder("例如：认知负荷、工作记忆、注意力分配机制...")
          .setValue(this.inputValue)
          .onChange((value) => {
            this.inputValue = value;
          });
        
        // 自动聚焦
        text.inputEl.focus();
        
        // 设置样式
        text.inputEl.style.width = "100%";
        text.inputEl.style.minHeight = "100px";
        
        // 支持 Ctrl/Cmd + Enter 提交
        text.inputEl.addEventListener("keydown", (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            this.submit();
          }
        });
      });

    // 类型选择（可选，高级选项）
    new Setting(contentEl)
      .setName("指定类型（可选）")
      .setDesc("如果不指定，AI 将自动判断类型")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("", "自动判断")
          .addOption("Domain", "Domain（领域）")
          .addOption("Issue", "Issue（议题）")
          .addOption("Theory", "Theory（理论）")
          .addOption("Entity", "Entity（实体）")
          .addOption("Mechanism", "Mechanism（机制）")
          .setValue(this.selectedType || "")
          .onChange((value) => {
            this.selectedType = value as CRType || undefined;
          });
      });

    // 按钮
    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText("取消")
          .onClick(() => {
            this.close();
            if (this.options.onCancel) {
              this.options.onCancel();
            }
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("创建")
          .setCta()
          .onClick(() => {
            this.submit();
          });
      });

    // 提示
    contentEl.createEl("p", {
      text: "提示：按 Ctrl/Cmd + Enter 快速提交",
      cls: "mod-muted"
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
      new Notice("请输入概念名称或描述");
      return;
    }

    this.close();
    this.options.onSubmit(input, this.selectedType);
  }
}

