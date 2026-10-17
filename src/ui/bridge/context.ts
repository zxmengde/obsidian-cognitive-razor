import { getContext, setContext } from "svelte";
import type { App } from "obsidian";
import type { I18n } from "../../core/i18n";
import type { SettingsApplication } from "../../app/settings-application";
import type { WorkbenchApplication } from "../../app/workbench-application";

const SETTINGS_CONTEXT = Symbol("cr-settings-context");
const WORKBENCH_CONTEXT = Symbol("cr-workbench-context");

export interface SettingsContext {
  app: App;
  i18n: I18n;
  settingsApplication: SettingsApplication;
}

export interface WorkbenchContext extends SettingsContext {
  application: WorkbenchApplication;
}

export function setSettingsContext(context: SettingsContext): void {
  setContext(SETTINGS_CONTEXT, context);
}

export function getSettingsContext(): SettingsContext {
  return getContext<SettingsContext>(SETTINGS_CONTEXT);
}

export function setWorkbenchContext(context: WorkbenchContext): void {
  setContext(WORKBENCH_CONTEXT, context);
}

export function getWorkbenchContext(): WorkbenchContext {
  return getContext<WorkbenchContext>(WORKBENCH_CONTEXT);
}
