import { ButtonComponent, Modal, type App } from "obsidian";

export interface NativeConfirmOptions {
  title: string;
  message: string | DocumentFragment;
  confirmLabel: string;
  cancelLabel: string;
  /** 破坏性操作用警告色按钮，普通确认用强调色按钮。 */
  danger?: boolean;
}

/**
 * Obsidian 原生确认框。设置页迁移到原生声明式设置后，确认交给宿主 Modal，
 * 焦点、Esc 与窗口归属都由 Obsidian 处理，不再自绘遮罩。
 */
class ConfirmModal extends Modal {
  private settled = false;

  constructor(app: App, private readonly options: NativeConfirmOptions, private readonly resolve: (value: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.classList.add("cr-scope");
    this.titleEl.setText(this.options.title);
    const message = this.contentEl.createDiv({ cls: "cr-confirm-message" });
    if (typeof this.options.message === "string") message.setText(this.options.message);
    else message.appendChild(this.options.message);
    // 与宿主确认框一致：按钮放在 modal-button-container，取消在前、确认在后。
    const buttons = this.modalEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText(this.options.cancelLabel).onClick(() => this.finish(false));
    const confirm = new ButtonComponent(buttons).setButtonText(this.options.confirmLabel).onClick(() => this.finish(true));
    if (this.options.danger) confirm.setDestructive();
    confirm.setCta();
  }

  onClose(): void {
    this.contentEl.empty();
    // Esc 与点遮罩关闭都按取消处理。
    this.finish(false);
  }

  private finish(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }
}

export function confirmNative(app: App, options: NativeConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}
