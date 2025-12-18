import type { App, EventRef } from "obsidian";
import type CognitiveRazorPlugin from "../../../main";

export interface WorkbenchSectionDeps {
  app: App;
  getPlugin: () => CognitiveRazorPlugin | null;
  t: (path: string) => string;
  showErrorNotice: (message: string) => void;
  logError: (context: string, error: unknown, extra?: Record<string, unknown>) => void;
  logWarn: (context: string, extra?: Record<string, unknown>) => void;
  resolveNoteName: (nodeId: string) => string;
  resolveNotePath: (nodeId: string) => string | null;
  registerEvent: (eventRef: EventRef) => void;
  getContainerEl: () => HTMLElement;
}

