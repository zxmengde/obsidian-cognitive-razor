import type { TFile } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import { toHostErrorFeedback } from "./error-feedback";
import { COMMAND_IDS } from "./command-utils";
import { showError, showWarning } from "./feedback";

export class CommandDispatcher {
  constructor(private readonly plugin: CognitiveRazorPlugin) {}

  registerAllCommands(): void {
    const t = this.plugin.getI18n().messages;

    this.plugin.addCommand({
      id: COMMAND_IDS.OPEN_WORKBENCH,
      name: t.commands.openWorkbench,
      icon: "brain",
      callback: () => void this.run(() => this.plugin.openWorkbench()),
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
