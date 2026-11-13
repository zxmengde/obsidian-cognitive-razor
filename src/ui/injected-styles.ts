// esbuild.config.mjs 也从这里导入前缀作为 Svelte cssHash，所以本文件只能用可擦除的 TS 语法、不能有依赖。
// 加前缀是为了卸载时只认出本插件注入的 <style>，不动其他插件的 svelte-* 样式。
export const INJECTED_STYLE_ID_PREFIX = "cr-svelte-";

/** 移除本插件 Svelte 组件注入的样式节点，返回移除数量。 */
export function removeInjectedStyles(documents: Iterable<Document>): number {
  let removed = 0;
  for (const doc of documents) {
    for (const style of Array.from(doc.querySelectorAll(`style[id^="${INJECTED_STYLE_ID_PREFIX}"]`))) {
      style.remove();
      removed += 1;
    }
  }
  return removed;
}
