import { describe, expect, it } from "vitest";
import { INJECTED_STYLE_ID_PREFIX, removeInjectedStyles } from "./injected-styles";

describe("removeInjectedStyles", () => {
  it("只移除本插件前缀的样式节点，保留其他插件的 Svelte 样式", () => {
    const doc = document.implementation.createHTMLDocument("popout");
    for (const id of [`${INJECTED_STYLE_ID_PREFIX}a1`, `${INJECTED_STYLE_ID_PREFIX}b2`, "svelte-other", "cr-unrelated"]) {
      const style = doc.createElement("style");
      style.id = id;
      doc.head.appendChild(style);
    }
    const main = document.createElement("style");
    main.id = `${INJECTED_STYLE_ID_PREFIX}c3`;
    document.head.appendChild(main);

    expect(removeInjectedStyles(new Set([document, doc]))).toBe(3);
    expect(Array.from(doc.head.querySelectorAll("style")).map((style) => style.id)).toEqual(["svelte-other", "cr-unrelated"]);
    expect(document.getElementById(main.id)).toBeNull();
  });
});
