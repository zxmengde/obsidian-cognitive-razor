import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18n } from "./../core/i18n";
import { generateFrontmatter, generateMarkdownContent } from "./../core/frontmatter-utils";
import { CommandDispatcher } from "./command-dispatcher";
import { COMMAND_IDS } from "./command-utils";
import {
  clearWorkbenchPanel,
  onWorkbenchPanel,
  requestWorkbenchPanel,
  takeWorkbenchFocus,
  takeWorkbenchPanel,
} from "./workbench-intent";

const conceptNote = generateMarkdownContent(
  generateFrontmatter({ cruid: "synthetic", type: "entity", name: "Synthetic" }),
  "",
);

interface Registered {
  id: string;
  name: string;
  callback: () => unknown;
}

function harness(options: { content?: string; activeFile?: unknown } = {}) {
  const commands: Registered[] = [];
  const ribbon: Array<{ icon: string; title: string }> = [];
  const file = options.activeFile === undefined
    ? { path: "C-知识库/测试.md", extension: "md" }
    : options.activeFile;
  const startCards = vi.fn(async () => ({ ok: true as const, value: "D-习题库/测试-decks.md" }));
  const openWorkbench = vi.fn(async () => undefined);
  const plugin = {
    app: { workspace: { getActiveFile: () => file }, vault: { cachedRead: async () => options.content ?? conceptNote } },
    ensureWorkbenchApplication: async () => ({ cards: { start: startCards } }),
    openWorkbench,
    getI18n: () => new I18n(),
    addCommand: (command: Registered) => {
      commands.push(command);
      return command;
    },
    addRibbonIcon: (icon: string, title: string) => {
      ribbon.push({ icon, title });
      return document.createElement("div");
    },
  };
  new CommandDispatcher(plugin as never).registerAllCommands();
  return { commands, ribbon, startCards, openWorkbench };
}

describe("command registration", () => {
  beforeEach(() => {
    clearWorkbenchPanel();
    takeWorkbenchFocus();
  });

  it("exposes every note action plus the workbench as a command", () => {
    const { commands } = harness();
    expect(commands.map((command) => command.id)).toEqual([
      COMMAND_IDS.OPEN_WORKBENCH,
      COMMAND_IDS.EXPAND_CURRENT_NOTE,
      COMMAND_IDS.VERIFY_CURRENT_NOTE,
      COMMAND_IDS.GENERATE_CARDS,
    ]);
  });

  it("puts the workbench behind one click in the ribbon", () => {
    const { ribbon } = harness();
    expect(ribbon).toEqual([{ icon: "brain", title: new I18n().messages.commands.openWorkbench }]);
  });

  it("opens the workbench command", async () => {
    const { commands, openWorkbench } = harness();
    await commands[0].callback();
    expect(openWorkbench).toHaveBeenCalledOnce();
  });

  it("opens the expand panel for a concept note", async () => {
    const { commands, openWorkbench } = harness();
    await commands[1].callback();
    // The command callback hands work to a promise so Obsidian stays responsive.
    await vi.waitFor(() => expect(openWorkbench).toHaveBeenCalledOnce());
    expect(takeWorkbenchPanel()).toBe("expand");
  });

  it("warns instead of opening an empty panel for a note that is not a concept", async () => {
    const { commands, openWorkbench } = harness({ content: "纯文本笔记" });
    await commands[1].callback();
    await Promise.resolve();
    expect(openWorkbench).not.toHaveBeenCalled();
    expect(takeWorkbenchPanel()).toBeUndefined();
  });

  it("starts card generation from the command without opening the workbench", async () => {
    const { commands, startCards, openWorkbench } = harness();
    await commands[3].callback();
    expect(startCards).toHaveBeenCalledExactlyOnceWith("C-知识库/测试.md");
    expect(openWorkbench).not.toHaveBeenCalled();
  });

  it("delivers a panel request to an already mounted workbench and keeps it for a fresh one", () => {
    const delivered: string[] = [];
    const stop = onWorkbenchPanel((panel) => delivered.push(panel));
    requestWorkbenchPanel("expand");
    stop();
    // Mounted view: delivered immediately, nothing left pending.
    expect(delivered).toEqual(["expand"]);
    expect(takeWorkbenchPanel()).toBeUndefined();

    // No view yet: the request waits for the mount instead of being dropped.
    requestWorkbenchPanel("expand");
    expect(takeWorkbenchPanel()).toBe("expand");
    expect(takeWorkbenchPanel()).toBeUndefined();
  });
});
