/**
 * SimpleInputModal - 极简单行输入框
 */

import { App, Notice, setIcon } from "obsidian";
import { AbstractModal } from "./abstract-modal";

interface SimpleInputModalOptions {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  t?: (path: string) => string;
}

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

    contentEl.createEl("h2", {
      text: this.options.title,
      cls: "cr-simple-input-title"
    });

    const inputContainer = contentEl.createDiv({ cls: "cr-simple-input-container" });

    const input = inputContainer.createEl("input", {
      type: "text",
      cls: "cr-simple-input",
      placeholder: this.options.placeholder || "",
      value: this.inputValue
    });

    const submitBtn = inputContainer.createEl("button", {
      cls: "cr-simple-input-submit",
      attr: {
        "aria-label": this.text("modals.simpleInput.submit", "Submit"),
        "title": this.text("modals.simpleInput.submitHint", "Submit (Enter)")
      }
    });
    setIcon(submitBtn, "corner-down-left");

    input.focus();

    input.addEventListener("input", () => {
      this.inputValue = input.value;
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        this.options.onCancel?.();
      }
    });

    submitBtn.addEventListener("click", () => {
      this.submit();
    });
  }

  onClose(): void {
    super.onClose();
  }

  private submit(): void {
    const value = this.inputValue.trim();

    if (!value) {
      new Notice(this.text("modals.simpleInput.emptyValue", "Please enter content"));
      return;
    }

    this.close();
    this.options.onSubmit(value);
  }

  private text(path: string, fallback: string): string {
    if (!this.options.t) {
      return fallback;
    }
    const value = this.options.t(path);
    return value === path ? fallback : value;
  }
}
