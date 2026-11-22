/**
 * 宿主为声明式设置渲染的下拉框、滑块与开关没有可读名称，读屏只会念「组合框」「复选框」。
 * 这里把所在行的名称补成 aria-label，并把开关标成 switch、同步 aria-checked。
 * 只补缺失的名称，不覆盖插件或宿主已给出的标注。
 */
const CONTROLS = "select, input:not([type=checkbox]):not([type=hidden]), textarea, .checkbox-container";

export function labelUnnamedControls(root: ParentNode): void {
  // 宿主的图标按钮（编辑、更多、删除、添加）是可聚焦的 div，没有按钮角色，读屏不会当作按钮朗读。
  for (const icon of Array.from(root.querySelectorAll<HTMLElement>(".clickable-icon, .extra-setting-button"))) {
    if (!icon.hasAttribute("role") && icon.tabIndex >= 0) icon.setAttribute("role", "button");
  }
  for (const row of Array.from(root.querySelectorAll<HTMLElement>(".setting-item"))) {
    const name = row.querySelector(":scope > .setting-item-info > .setting-item-name")?.textContent?.trim();
    for (const control of Array.from(row.querySelectorAll<HTMLElement>(`:scope > .setting-item-control ${CONTROLS}`))) {
      // 宿主给下拉框配的隐藏测宽副本不参与无障碍树。
      if (control.getAttribute("aria-hidden") === "true") continue;
      if (name && !control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) control.setAttribute("aria-label", name);
      if (control.classList.contains("checkbox-container")) {
        control.setAttribute("role", "switch");
        control.setAttribute("aria-checked", String(control.classList.contains("is-enabled")));
      }
    }
  }
}

/** 监听容器内的重绘与开关状态变化，每批变化后补一次标注。 */
export class ControlLabeler {
  private observer: MutationObserver | undefined;
  private scheduled = false;

  start(root: HTMLElement): void {
    this.stop();
    const view = root.ownerDocument.defaultView ?? window;
    labelUnnamedControls(root);
    this.observer = new view.MutationObserver(() => {
      if (this.scheduled) return;
      this.scheduled = true;
      view.queueMicrotask(() => {
        this.scheduled = false;
        labelUnnamedControls(root);
      });
    });
    // 只听结构变化与 class（开关的 is-enabled），自己写入的 aria-* 不会再次触发。
    this.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.scheduled = false;
  }
}
