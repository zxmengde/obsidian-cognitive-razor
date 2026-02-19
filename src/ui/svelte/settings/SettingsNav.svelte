<!--
  SettingsNav — 设置页顶部水平 Tab 导航

  职责：
  - 渲染 4 个 Tab 按钮（通用、AI 服务、高级、系统）
  - sticky 定位，当前 tab 下划线高亮
  - ArrowLeft/Right 键盘快捷键切换 Tab
  - 正确的 ARIA 属性（role="tablist", role="tab"）

  @see 需求 10.1, 10.10
-->
<script lang="ts">
    import type { I18n } from '@/core/i18n';

    /** Tab 类型定义 */
    type SettingsTab = 'general' | 'providers' | 'advanced' | 'system';

    /** Tab 顺序（用于键盘导航） */
    const TAB_ORDER: SettingsTab[] = ['general', 'providers', 'advanced', 'system'];

    let { activeTab, onTabChange, i18n }: {
        activeTab: SettingsTab;
        onTabChange: (tab: SettingsTab) => void;
        i18n: I18n;
    } = $props();

    /** 获取 Tab 标签文本 */
    function tabLabel(tab: SettingsTab): string {
        return i18n.t(`settings.tabs.${tab}`);
    }

    /** 键盘导航处理 */
    function handleKeydown(e: KeyboardEvent) {
        const currentIndex = TAB_ORDER.indexOf(activeTab);
        if (currentIndex === -1) return;

        let nextIndex = -1;
        if (e.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % TAB_ORDER.length;
        } else if (e.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        }

        if (nextIndex !== -1) {
            e.preventDefault();
            const nextTab = TAB_ORDER[nextIndex];
            onTabChange(nextTab);
            // 聚焦到新激活的 tab 按钮
            const btn = e.currentTarget instanceof HTMLElement
                ? e.currentTarget.querySelector<HTMLElement>(`[data-tab="${nextTab}"]`)
                : null;
            btn?.focus();
        }
    }
</script>

<div
    class="cr-settings-nav"
    role="tablist"
    aria-label={i18n.t('settings.title')}
    tabindex="0"
    onkeydown={handleKeydown}
>
    {#each TAB_ORDER as tab (tab)}
        <button
            class="cr-settings-nav-tab"
            class:is-active={activeTab === tab}
            role="tab"
            aria-selected={activeTab === tab}
            tabindex={activeTab === tab ? 0 : -1}
            data-tab={tab}
            onclick={() => onTabChange(tab)}
        >
            {tabLabel(tab)}
        </button>
    {/each}
</div>

<style>
    .cr-settings-nav {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        gap: var(--cr-space-1);
        border-bottom: 1px solid var(--cr-border);
        background: var(--cr-bg-primary);
        padding: 0 var(--cr-space-2);
    }

    .cr-settings-nav-tab {
        position: relative;
        padding: var(--cr-space-2) var(--cr-space-3);
        border: none;
        background: none;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        cursor: pointer;
        transition: color 0.15s ease;
        white-space: nowrap;
    }

    .cr-settings-nav-tab:hover {
        color: var(--cr-text-primary);
    }

    .cr-settings-nav-tab:focus-visible {
        outline: 2px solid var(--cr-accent);
        outline-offset: -2px;
        border-radius: var(--cr-radius-sm);
    }

    /* 当前 tab 下划线高亮 */
    .cr-settings-nav-tab.is-active {
        color: var(--cr-accent);
        font-weight: 500;
    }

    .cr-settings-nav-tab.is-active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: var(--cr-space-2);
        right: var(--cr-space-2);
        height: 2px;
        background: var(--cr-accent);
        border-radius: 1px 1px 0 0;
    }
</style>
