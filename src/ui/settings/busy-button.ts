import type { ButtonComponent } from "obsidian";

/**
 * 进行中的按钮不用 disabled：被禁用的按钮会立即失去焦点，键盘用户落回页首。
 * 改用 aria-disabled 告诉读屏「暂不可用」，重复点击由调用方的进行中判断忽略。
 */
export function setBusy(button: ButtonComponent, busy: boolean, label: string): void {
  button.setButtonText(label);
  if (busy) {
    button.buttonEl.setAttribute("aria-disabled", "true");
    button.buttonEl.setAttribute("aria-busy", "true");
  } else {
    button.buttonEl.removeAttribute("aria-disabled");
    button.buttonEl.removeAttribute("aria-busy");
  }
}
