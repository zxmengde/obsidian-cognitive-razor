# 界面优化

Obsidian Cognitive Razor 插件界面设计遵循以下核心设计原则：

*   **Obsidian Native (原生融合)**：
    *   严格遵循 Obsidian 的设计规范，使用原生的 CSS 变量（如 `--background-primary`, `--text-normal`, `--interactive-accent`），确保插件在不同主题（亮色/暗色模式）下均能完美融入。
    *   保持界面简洁，避免突兀的自定义样式，减少用户的认知负担。

*   **Cognitive Clarity (认知清晰)**：
    *   利用视觉层级（Visual Hierarchy）引导用户视线。
    *   通过清晰的状态指示（Loading, Success, Error）让用户时刻感知系统状态。
    *   信息展示采用“渐进式披露”（Progressive Disclosure），常用功能直接展示，高级功能按需展开。

*   **Responsive & Fluid (响应流畅)**：
    *   交互操作应有即时反馈（如按钮点击态、Hover 效果）。
    *   对于耗时操作（如 AI 推理），必须提供明确的视觉进度反馈。