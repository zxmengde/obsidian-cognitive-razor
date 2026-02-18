// Svelte 5 模块类型声明
// 使 TypeScript 能够识别 .svelte 文件的导入
declare module '*.svelte' {
    import type { Component } from 'svelte';
    const component: Component<any, any>;
    export default component;
}
