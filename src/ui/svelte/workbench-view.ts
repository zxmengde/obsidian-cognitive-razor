import { ItemView, WorkspaceLeaf } from "obsidian";
import type CognitiveRazorPlugin from "../../../main";
import WorkbenchRoot from "./workbench/WorkbenchRoot.svelte";
import { mountSvelteComponent } from "../bridge/mount";
import { toHostErrorFeedback } from "../error-feedback";

export const VIEW_TYPE_CR_WORKBENCH = "cr-workbench";

export class WorkbenchView extends ItemView {
  private cleanup: (() => Promise<void>) | undefined;
  private openGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: CognitiveRazorPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_CR_WORKBENCH; }
  getDisplayText(): string { return "Cognitive Razor"; }
  getIcon(): string { return "brain"; }

  async onOpen(): Promise<void> {
    const generation = ++this.openGeneration;
    const previousCleanup = this.cleanup;
    this.cleanup = undefined;
    if (previousCleanup) {
      await previousCleanup();
      if (generation !== this.openGeneration) {
        return;
      }
    }
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cr-scope");
    container.createEl("div", {
      cls: "cr-loading",
      text: this.plugin.getI18n().messages.workbench.loading,
    });

    try {
      const application = await this.plugin.ensureWorkbenchApplication();
      if (generation !== this.openGeneration) {
        return;
      }
      container.empty();
      const { destroy } = mountSvelteComponent(container, WorkbenchRoot, {
        app: this.plugin.app,
        i18n: this.plugin.getI18n(),
        settingsApplication: this.plugin.getSettingsApplication(),
        application,
        onOpenSettings: () => {
          const settings = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
          settings?.open();
          settings?.openTabById(this.plugin.manifest.id);
        },
      });
      this.cleanup = destroy;
    } catch (error) {
      if (generation !== this.openGeneration) {
        return;
      }
      // A failed runtime start blocks the whole workbench; keep the reason
      // visible instead of collapsing it into a generic "unknown error".
      container.empty();
      container.createEl("div", {
        cls: "cr-error",
        text: toHostErrorFeedback(
          error,
          this.plugin.getI18n().messages.workbench.notifications.unknownFailure,
        ).message,
      });
    }
  }

  async onClose(): Promise<void> {
    this.openGeneration += 1;
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    await cleanup?.();
  }
}
