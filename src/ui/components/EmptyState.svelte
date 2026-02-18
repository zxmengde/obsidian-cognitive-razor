<!--
  EmptyState.svelte — 空状态引导文字组件

  居中显示淡色引导文字，用于列表为空时的占位提示。

  @see 需求 19.4, 19.5, 19.6
-->
<script lang="ts">
    let { message }: { message: string } = $props();
</script>

<p class="cr-empty-state">{message}</p>

<style>
    .cr-empty-state {
        text-align: center;
        color: var(--cr-text-faint);
        font-size: var(--font-ui-small);
        padding: var(--cr-space-6) var(--cr-space-4);
        margin: 0;
    }
</style>
