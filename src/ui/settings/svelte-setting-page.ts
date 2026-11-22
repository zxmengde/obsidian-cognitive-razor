import { SettingPage } from "obsidian";
import type { Component } from "svelte";
import { mountSvelteComponent } from "../bridge/mount";

export interface SvelteSettingPageHooks {
  /** 子页面打开期间，设置变化不能触发整页重绘，否则会丢掉未保存的草稿和焦点。 */
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * 用 Svelte 渲染内容的原生设置子页面。宿主负责标题栏、返回导航与滚动，
 * 组件只负责页内交互（位置预览后确认保存这类原生控件表达不了的流程）。
 */
export class SvelteSettingPage<T extends Record<string, unknown>> extends SettingPage {
  private unmountComponent: (() => Promise<void>) | undefined;

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
    this.unmount();
    this.containerEl.empty();
    this.unmountComponent = mountSvelteComponent(this.containerEl, this.component, this.props(), this.context).destroy;
    this.hooks.onOpen?.();
  }

  hide(): void {
    this.unmount();
    super.hide();
    this.hooks.onClose?.();
  }

  private unmount(): void {
    const destroy = this.unmountComponent;
    this.unmountComponent = undefined;
    if (destroy) void destroy().catch((error: unknown) => this.hooks.onError?.(error));
  }
}
