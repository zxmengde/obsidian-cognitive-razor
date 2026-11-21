import { Modal, Setting, type App } from "obsidian";
import type { SettingsApplication } from "../../app/settings-application";
import type { I18n } from "../../core/i18n";
import { mountSvelteComponent } from "../bridge/mount";
import ProviderProbeStatus from "../svelte/settings/ProviderProbeStatus.svelte";
import { probeServiceWithTask, TEMPORARY_PROBE_TASKS, type TemporaryProbeTask } from "./service-probes";

/**
 * 强制使用某个服务、按所选任务参数做一次临时测试。不改变保存的任务配置；
 * 任务实际配置的测试在任务页进行。
 */
export class TaskProbeModal extends Modal {
  private task: TemporaryProbeTask = "write";
  private controller: AbortController | undefined;
  private destroyResult: (() => Promise<void>) | undefined;

  constructor(app: App, private readonly serviceId: string, private readonly settingsApplication: SettingsApplication, private readonly i18n: I18n) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.classList.add("cr-scope");
    const t = (key: string) => this.i18n.t(key);
    this.titleEl.setText(this.i18n.format("settings.native.taskProbeTitle", { id: this.serviceId }));
    const hint = this.contentEl.createEl("p", { cls: "setting-item-description", text: t("settings.product.temporaryProviderHint") });
    hint.setAttribute("role", "note");
    // 结果区建在弹窗自己的文档里：设置页可能位于独立窗口。
    const resultEl = this.contentEl.createDiv({ cls: "cr-scope cr-task-probe-result" });
    let runButton: { setDisabled(disabled: boolean): unknown; setButtonText(text: string): unknown } | undefined;
    const chatDisabled = this.settingsApplication.getSettings().providers[this.serviceId]?.apiFormat === "disabled";
    new Setting(this.contentEl)
      .setName(t("settings.native.taskProbeTask"))
      .addDropdown((dropdown) => {
        for (const task of TEMPORARY_PROBE_TASKS) dropdown.addOption(task, t(`settings.redesign.tasks.${task}`));
        dropdown.setValue(this.task).onChange((value) => { this.task = value as TemporaryProbeTask; });
      })
      .addButton((button) => {
        runButton = button;
        button.setButtonText(t("settings.native.taskProbeRun")).setCta().setDisabled(chatDisabled).onClick(() => void this.run("initial", resultEl, runButton));
      });
    if (chatDisabled) this.contentEl.createEl("p", { cls: "mod-warning", text: t("settings.redesign.chatRequiredForTaskTest") });
    // 结果放在最后：任务选择与说明在上，测试结果在下。
    this.contentEl.appendChild(resultEl);
  }

  private async run(
    reason: "initial" | "manual-retry",
    resultEl: HTMLElement,
    button: { setDisabled(disabled: boolean): unknown; setButtonText(text: string): unknown } | undefined,
  ): Promise<void> {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    button?.setDisabled(true);
    button?.setButtonText(this.i18n.t("settings.native.testing"));
    await this.clearResult(resultEl);
    try {
      const result = await probeServiceWithTask(this.settingsApplication, this.serviceId, this.task, reason, controller.signal);
      if (result && !controller.signal.aborted) {
        this.destroyResult = mountSvelteComponent(resultEl, ProviderProbeStatus, {
          result,
          i18n: this.i18n,
          retrying: false,
          onretry: () => void this.run("manual-retry", resultEl, button),
        }).destroy;
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
      button?.setDisabled(false);
      button?.setButtonText(this.i18n.t("settings.native.taskProbeRun"));
    }
  }

  private async clearResult(resultEl: HTMLElement): Promise<void> {
    const destroy = this.destroyResult;
    this.destroyResult = undefined;
    if (destroy) await destroy();
    resultEl.replaceChildren();
  }

  onClose(): void {
    this.controller?.abort("task probe closed");
    void this.destroyResult?.();
    this.contentEl.empty();
  }
}
