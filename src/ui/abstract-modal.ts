import { App, Modal } from "obsidian";

/**
 * AbstractModal 基类
 *
 * 提供焦点捕获（focus trap）、ARIA 无障碍属性、Escape 键行为分层处理。
 * 所有插件 Modal 均继承此基类，通过 renderContent() 渲染内容。
 *
 * 焦点策略：
 * - 打开时记录触发元素，关闭时恢复焦点
 * - Tab / Shift+Tab 在 Modal 内可聚焦元素间循环
 * - 打开后自动聚焦第一个交互元素
 *
 * Escape 键策略：
 * - 非破坏性 Modal（默认）：直接关闭
 * - 破坏性 Modal（子类设置 isDestructive = true）：触发 onEscapeDestructive() 钩子
 */

/** 可聚焦元素选择器 */
const FOCUSABLE_SELECTOR =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export abstract class AbstractModal extends Modal {
    /** 打开 Modal 前的活跃元素，关闭时恢复焦点 */
    private previousActiveElement: HTMLElement | null = null;

    /** 焦点捕获键盘事件处理器引用（用于移除） */
    private focusTrapHandler: ((e: KeyboardEvent) => void) | null = null;

    /**
     * 子类可设置为 true 以启用破坏性 Escape 行为。
     * 破坏性 Modal（如 Merge 确认、Amend 确认）按 Escape 时
     * 不直接关闭，而是调用 onEscapeDestructive()。
     */
    protected isDestructive = false;

    /** Modal 标题元素 ID，用于 aria-labelledby */
    private titleElId: string | null = null;

    protected constructor(app: App) {
        super(app);
    }

    protected abstract renderContent(contentEl: HTMLElement): void;

    onOpen(): void {
        // 记录触发元素
        this.previousActiveElement = document.activeElement as HTMLElement;

        // 设置 ARIA 属性
        this.setupAriaAttributes();

        // 清空并渲染内容
        this.contentEl.empty();
        this.contentEl.addClass("cr-scope");
        this.renderContent(this.contentEl);

        // 尝试关联 aria-labelledby 到第一个 h2 标题
        this.bindAriaLabelledBy();

        // 设置焦点捕获
        this.setupFocusTrap();

        // 聚焦第一个交互元素
        this.focusFirstInteractive();
    }

    onClose(): void {
        // 移除焦点捕获
        this.removeFocusTrap();

        // 清空内容
        this.contentEl.empty();

        // 恢复焦点到触发元素
        this.previousActiveElement?.focus();
        this.previousActiveElement = null;
    }

    // ========================================================================
    // ARIA 无障碍
    // ========================================================================

    /** 设置 role="dialog" 和 aria-modal="true" */
    private setupAriaAttributes(): void {
        this.modalEl.setAttr("role", "dialog");
        this.modalEl.setAttr("aria-modal", "true");
    }

    /**
     * 查找 contentEl 内第一个 h2 元素，为其分配 ID 并关联 aria-labelledby。
     * 子类如需自定义标题关联，可在 renderContent() 中手动设置 aria-labelledby。
     */
    private bindAriaLabelledBy(): void {
        const heading = this.contentEl.querySelector("h2");
        if (heading) {
            if (!heading.id) {
                this.titleElId = `cr-modal-title-${Date.now()}`;
                heading.id = this.titleElId;
            } else {
                this.titleElId = heading.id;
            }
            this.modalEl.setAttr("aria-labelledby", this.titleElId);
        }
    }

    // ========================================================================
    // 焦点捕获（Focus Trap）
    // ========================================================================

    /**
     * 设置焦点捕获：
     * - Tab / Shift+Tab 在 Modal 内可聚焦元素间循环
     * - Escape 键根据 isDestructive 决定行为
     */
    private setupFocusTrap(): void {
        this.focusTrapHandler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                this.handleEscape(e);
                return;
            }

            if (e.key !== "Tab") return;

            const focusable = this.getFocusableElements();
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                // Shift+Tab 从第一个元素 → 跳到最后一个
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                // Tab 从最后一个元素 → 跳到第一个
                e.preventDefault();
                first.focus();
            }
        };

        this.modalEl.addEventListener("keydown", this.focusTrapHandler);
    }

    /** 移除焦点捕获事件监听 */
    private removeFocusTrap(): void {
        if (this.focusTrapHandler) {
            this.modalEl.removeEventListener("keydown", this.focusTrapHandler);
            this.focusTrapHandler = null;
        }
    }

    /** 获取 Modal 内所有可聚焦元素 */
    private getFocusableElements(): HTMLElement[] {
        return Array.from(
            this.modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
    }

    /** 聚焦第一个交互元素 */
    private focusFirstInteractive(): void {
        // 延迟一帧确保 DOM 已渲染
        requestAnimationFrame(() => {
            const focusable = this.getFocusableElements();
            if (focusable.length > 0) {
                focusable[0].focus();
            }
        });
    }

    // ========================================================================
    // Escape 键处理
    // ========================================================================

    /**
     * Escape 键处理：
     * - 非破坏性 Modal：Obsidian Modal 基类已处理 Escape 关闭，此处不额外干预
     * - 破坏性 Modal：阻止默认关闭，调用 onEscapeDestructive() 钩子
     */
    private handleEscape(e: KeyboardEvent): void {
        if (this.isDestructive) {
            // 阻止 Obsidian Modal 基类的默认 Escape 关闭行为
            e.preventDefault();
            e.stopPropagation();
            this.onEscapeDestructive();
        }
        // 非破坏性：不拦截，让 Obsidian Modal 基类处理关闭
    }

    /**
     * 破坏性 Modal 的 Escape 键钩子。
     * 子类应覆盖此方法实现放弃确认逻辑（如触发 onReject 回调）。
     * 默认行为：直接关闭（兜底）。
     */
    protected onEscapeDestructive(): void {
        this.close();
    }
}
