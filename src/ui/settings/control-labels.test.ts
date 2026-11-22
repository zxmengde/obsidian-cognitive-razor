import { describe, expect, it } from "vitest";
import { ControlLabeler, labelUnnamedControls } from "./control-labels";

function row(name: string, control: string): string {
  return `<div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">${name}</div></div><div class="setting-item-control">${control}</div></div>`;
}

describe("control labels", () => {
  it("names host controls after their row and marks toggles as switches", () => {
    const root = document.createElement("div");
    root.innerHTML = row("日志级别", '<select></select><select aria-hidden="true"></select>')
      + row("自动核查", '<label class="checkbox-container is-enabled" tabindex="0"><input type="checkbox" tabindex="-1"></label>')
      + row("并发", '<input type="range">')
      + row("已有名称", '<select aria-label="自定义"></select>');
    root.insertAdjacentHTML("beforeend", '<div class="clickable-icon" tabindex="0" aria-label="编辑"></div><div class="clickable-icon" aria-hidden="true"></div>');
    labelUnnamedControls(root);
    const [select, measuring] = Array.from(root.querySelectorAll("select"));
    expect(select.getAttribute("aria-label")).toBe("日志级别");
    expect(measuring.hasAttribute("aria-label")).toBe(false);
    const toggle = root.querySelector(".checkbox-container")!;
    expect(toggle.getAttribute("aria-label")).toBe("自动核查");
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector("input[type=range]")!.getAttribute("aria-label")).toBe("并发");
    expect(root.querySelectorAll("select")[2].getAttribute("aria-label")).toBe("自定义");
    const [editIcon, decorative] = Array.from(root.querySelectorAll(".clickable-icon"));
    expect(editIcon.getAttribute("role")).toBe("button");
    expect(decorative.hasAttribute("role")).toBe(false);
  });

  it("follows re-renders and toggle state while running", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const labeler = new ControlLabeler();
    try {
      labeler.start(root);
      root.innerHTML = row("开关", '<label class="checkbox-container" tabindex="0"></label>');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const toggle = root.querySelector(".checkbox-container")!;
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      toggle.classList.add("is-enabled");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    } finally { labeler.stop(); root.remove(); }
  });
});
