import { SettingPage } from "obsidian";
import type { Component } from "svelte";
import { mountSvelteComponent } from "../bridge/mount";

export interface SvelteSettingPageHooks {
  /** 子页面打开期间，设置变化不能触发整页重绘，否则会丢掉未保存的草稿和焦点。 */
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
  /**
   * 离开页面时保留组件而不卸载，重新进入时接回原组件。任务页的未保存草稿与校验提示
   * 在同一次设置会话内跨导航保留（旧设置页的行为）；设置页关闭时由宿主调用 destroy()。
   */
  keepAlive?: boolean;
}

/**
 * 用 Svelte 渲染内容的原生设置子页面。宿主负责标题栏、返回导航与滚动，
 * 组件只负责页内交互（任务参数三态、位置预览等原生控件表达不了的流程）。
 */
export class SvelteSettingPage<T extends Record<string, unknown>> extends SettingPage {
  private unmountComponent: (() => Promise<void>) | undefined;
  /** keepAlive 页面离开后，组件 DOM 暂存在这里。 */
  private parked: DocumentFragment | undefined;

  constructor(
    title: string,
    private readonly component: Component<T>,
    private readonly props: () => T,
    private readonly context: Map<unknown, unknown>,
    private readonly hooks: SvelteSettingPageHooks = {},
  ) {
    super();
    this.title = title;
  }

  display(): void {
    this.containerEl.addClass("cr-scope", "cr-setting-page");
    if (this.parked && this.unmountComponent) {
      this.containerEl.empty();
      this.containerEl.appendChild(this.parked);
      this.parked = undefined;
    } else {
      this.unmount();
      this.containerEl.empty();
      this.unmountComponent = mountSvelteComponent(this.containerEl, this.component, this.props(), this.context).destroy;
    }
    this.hooks.onOpen?.();
  }

  hide(): void {
    if (this.hooks.keepAlive && this.unmountComponent) {
      const parked = this.containerEl.ownerDocument.createDocumentFragment();
      parked.append(...Array.from(this.containerEl.childNodes));
      this.parked = parked;
    } else {
      this.unmount();
    }
    super.hide();
    this.hooks.onClose?.();
  }

  /** 彻底卸载（设置页关闭时调用）。 */
  destroy(): void {
    this.parked = undefined;
    this.unmount();
  }

  private unmount(): void {
    const destroy = this.unmountComponent;
    this.unmountComponent = undefined;
    if (destroy) void destroy().catch((error: unknown) => this.hooks.onError?.(error));
  }
}
