import { App, PluginSettingTab } from "obsidian";
import type CognitiveRazorPlugin from "../../../main";
import SettingsRoot from "./settings/SettingsRoot.svelte";
import { mountSvelteComponent } from "../bridge/mount";

export class CRSettingTab extends PluginSettingTab {
  private cleanup: (() => Promise<void>) | undefined;

  constructor(app: App, private readonly plugin: CognitiveRazorPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.cleanupMountedComponent();
    this.containerEl.empty();
    this.containerEl.addClass("cr-scope");
    this.cleanup = mountSvelteComponent(this.containerEl, SettingsRoot, {
      app: this.app,
      i18n: this.plugin.getI18n(),
      settingsApplication: this.plugin.getSettingsApplication(),
      onTabNavigate: () => { this.containerEl.scrollTop = 0; },
    }).destroy;
  }

  hide(): void {
    this.cleanupMountedComponent();
  }

  private cleanupMountedComponent(): void {
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    if (cleanup) {
      void cleanup().catch((error: unknown) => {
        this.plugin.reportHostError("SettingsTab", "设置页面收尾失败", error);
      });
    }
  }
}
