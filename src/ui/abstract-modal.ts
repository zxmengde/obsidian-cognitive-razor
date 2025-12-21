import { App, Modal } from "obsidian";

export abstract class AbstractModal extends Modal {
  protected constructor(app: App) {
    super(app);
  }

  protected abstract renderContent(contentEl: HTMLElement): void;

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("cr-scope");
    this.renderContent(this.contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
