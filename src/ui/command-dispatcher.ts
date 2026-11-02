import type { TFile } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import { extractFrontmatter } from "../core/frontmatter-utils";
import { toHostErrorFeedback } from "./error-feedback";
import { COMMAND_IDS } from "./command-utils";
import { showActionFeedback, showError, showWarning } from "./feedback";
import { requestWorkbenchPanel } from "./workbench-intent";

export class CommandDispatcher {
  constructor(private readonly plugin: CognitiveRazorPlugin) {}

  registerAllCommands(): void {
    const t = this.plugin.getI18n().messages;

    // Every entry point is also reachable with one click: the ribbon icon opens
    // the same workbench the command does.
    this.plugin.addRibbonIcon("brain", t.commands.openWorkbench, () => {
      void this.run(() => this.plugin.openWorkbench());
    });

    this.plugin.addCommand({
      id: COMMAND_IDS.OPEN_WORKBENCH,
      name: t.commands.openWorkbench,
      icon: "brain",
      callback: () => void this.run(() => this.plugin.openWorkbench()),
    });

    this.plugin.addCommand({
      id: COMMAND_IDS.EXPAND_CURRENT_NOTE,
      name: t.commands.expandCurrentNote,
      icon: "git-branch-plus",
      callback: () => {
        const file = this.getActiveMarkdownFile();
        if (file) {
          void this.run(() => this.expand(file));
        }
      },
    });

    this.plugin.addCommand({
      id: COMMAND_IDS.VERIFY_CURRENT_NOTE,
      name: t.workbench.buttons.verify,
      icon: "check",
      callback: () => {
        const file = this.getActiveMarkdownFile();
        if (file) {
          void this.run(() => this.verify(file));
        }
      },
    });

    this.plugin.addCommand({
      id: COMMAND_IDS.GENERATE_CARDS,
      name: t.cards.generate,
      icon: "layers",
      callback: () => {
        const file = this.getActiveMarkdownFile();
        if (file) {
          void this.run(() => this.generateCards(file));
        }
      },
    });
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      showWarning(this.plugin.getI18n().messages.workbench.notifications.openMarkdownFirst);
      return null;
    }
    return file;
  }

  private async verify(file: TFile): Promise<void> {
    const application = await this.plugin.ensureWorkbenchApplication();
    const result = await application.verify.start(file.path);
    if (!result.ok) {
      throw result;
    }
    await this.plugin.openWorkbench();
  }

  /**
   * Expansion needs the note's own frontmatter and a user-confirmed candidate
   * list, so the command only opens the panel instead of running it headless.
   */
  private async expand(file: TFile): Promise<void> {
    if (!extractFrontmatter(await this.plugin.app.vault.cachedRead(file))) {
      showWarning(this.plugin.getI18n().messages.workbench.product.nonConcept);
      return;
    }
    await this.plugin.openWorkbench();
    requestWorkbenchPanel("expand");
  }

  private async generateCards(file: TFile): Promise<void> {
    const application = await this.plugin.ensureWorkbenchApplication();
    const i18n = this.plugin.getI18n();
    const result = await application.cards.start(file.path);
    if (!result.ok) {
      throw result;
    }
    showActionFeedback({ level: "success", message: i18n.format("cards.queued", { path: result.value }) });
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      const i18n = this.plugin.getI18n();
      showError(i18n.format(
        "workbench.notifications.commandFailed",
        { message: toHostErrorFeedback(error, i18n.messages.workbench.notifications.unknownFailure).message },
      ), i18n.messages.workbench.notifications.unknownFailure);
    }
  }
}
