<!--
  SettingsRoot — 设置页根组件

  职责：
  - 管理当前激活的 Tab 状态
  - 渲染 SettingsNav 导航栏
  - 根据 activeTab 条件渲染对应 Tab 内容
  - 通过 plugin 引用获取 i18n 服务

  @see 需求 10.1, 10.10
-->
<script lang="ts">
    import { untrack } from 'svelte';
    import type CognitiveRazorPlugin from '../../../../main';
    import { setCRContext } from '../../bridge/context';
    import SettingsNav from './SettingsNav.svelte';
    import GeneralTab from './GeneralTab.svelte';
    import ProvidersTab from './ProvidersTab.svelte';
    import AdvancedTab from './AdvancedTab.svelte';
    import SystemTab from './SystemTab.svelte';

    /** Tab 类型定义 */
    type SettingsTab = 'general' | 'providers' | 'advanced' | 'system';

    let { plugin }: { plugin: CognitiveRazorPlugin } = $props();

    // untrack：plugin 是挂载时单次传入的稳定引用，不需要响应式追踪
    const components = untrack(() => plugin.getComponents());
    const i18n = components.i18n;

    /** 设置 Context，供子组件通过 getCRContext() 获取 */
    setCRContext({
        container: components.container,
        i18n: components.i18n,
        app: untrack(() => plugin.app),
    });

    /** 当前激活的 Tab */
    let activeTab = $state<SettingsTab>('general');

    /** 切换 Tab */
    function handleTabChange(tab: SettingsTab) {
        activeTab = tab;
    }
</script>

<div class="cr-settings-root">
    <SettingsNav {activeTab} onTabChange={handleTabChange} {i18n} />

    <div
        class="cr-settings-content"
        role="tabpanel"
        aria-label={i18n.t(`settings.tabs.${activeTab}`)}
    >
        {#if activeTab === 'general'}
            <GeneralTab />
        {:else if activeTab === 'providers'}
            <ProvidersTab />
        {:else if activeTab === 'advanced'}
            <AdvancedTab />
        {:else if activeTab === 'system'}
            <SystemTab />
        {/if}
    </div>
</div>

<style>
    .cr-settings-root {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .cr-settings-content {
        padding: var(--cr-space-4) var(--cr-space-3);
        flex: 1;
    }

</style>
