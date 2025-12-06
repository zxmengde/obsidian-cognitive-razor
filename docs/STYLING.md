# Cognitive Razor 样式指南

## 概述

本文档描述了 Cognitive Razor 插件的样式系统和主题支持。

## 样式文件结构

`styles.css` 文件包含以下部分：

1. **全局变量和基础样式** - CSS 自定义属性和基础配置
2. **WorkbenchPanel 样式** - 工作台面板的所有样式
3. **QueueView 样式** - 任务队列视图的样式
4. **DiffView 样式** - 差异预览视图的样式
5. **StatusBadge 样式** - 状态栏徽章的样式
6. **通用组件样式** - 按钮、输入框等通用组件
7. **响应式布局** - 不同屏幕尺寸的适配
8. **暗色主题适配** - 暗色主题的特殊样式
9. **可访问性增强** - 无障碍访问支持
10. **打印样式** - 打印时的样式优化
11. **加载和过渡动画** - 动画效果

## 主题系统

### 自动主题切换

Cognitive Razor 完全支持 Obsidian 的主题系统。插件会自动适配用户选择的主题：

- **亮色主题**：使用 Obsidian 的默认亮色变量
- **暗色主题**：当 Obsidian 应用 `.theme-dark` 类时，自动应用暗色主题样式

### 主题切换方式

用户可以通过以下方式切换主题：

1. **Obsidian 设置**：设置 → 外观 → 主题
2. **快捷键**：使用 Obsidian 的主题切换快捷键
3. **命令面板**：搜索"切换主题"命令

插件会自动响应主题变化，无需手动刷新。

## CSS 变量

### 颜色变量

```css
/* 主色调 */
--cr-primary: #6366f1;
--cr-primary-hover: #4f46e5;
--cr-primary-light: #818cf8;

/* 状态颜色 */
--cr-success: #10b981;
--cr-warning: #f59e0b;
--cr-error: #ef4444;
--cr-info: #3b82f6;
```

### 间距变量

```css
--cr-spacing-xs: 4px;
--cr-spacing-sm: 8px;
--cr-spacing-md: 16px;
--cr-spacing-lg: 24px;
--cr-spacing-xl: 32px;
```

### 圆角变量

```css
--cr-radius-sm: 4px;
--cr-radius-md: 8px;
--cr-radius-lg: 12px;
```

## 暗色主题适配

暗色主题通过 `.theme-dark` 类选择器实现。主要调整包括：

1. **阴影强度**：增加阴影的不透明度以提高对比度
2. **背景色**：使用 Obsidian 的暗色背景变量
3. **状态徽章**：增加背景不透明度以提高可读性
4. **按钮样式**：使用暗色主题的表单字段颜色

### 示例

```css
.theme-dark .cr-concept-input {
  background: var(--background-primary-alt);
}

.theme-dark .cr-state-pending {
  background: rgba(59, 130, 246, 0.15);
}
```

## 响应式设计

插件支持三种屏幕尺寸：

### 小屏幕 (< 768px)

- 减少内边距
- 单列布局
- 垂直堆叠按钮

### 中等屏幕 (768px - 1024px)

- 适中的网格布局
- 2-3 列显示

### 大屏幕 (> 1024px)

- 完整的网格布局
- 5 列统计显示
- 更大的模态框宽度

## 可访问性

### 焦点指示器

所有交互元素都有清晰的焦点指示器：

```css
*:focus-visible {
  outline: 2px solid var(--cr-primary);
  outline-offset: 2px;
}
```

### 减少动画

尊重用户的动画偏好设置：

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 高对比度模式

在高对比度模式下增加边框宽度：

```css
@media (prefers-contrast: high) {
  .cr-section {
    border-width: 2px;
  }
}
```

### ARIA 支持

所有 UI 组件都包含适当的 ARIA 属性：

- `aria-label`：为图标和按钮提供文本描述
- `aria-live`：通知屏幕阅读器状态变化
- `role`：定义元素的语义角色

## 自定义样式

如果需要自定义插件样式，可以在 Obsidian 的 CSS 片段中覆盖：

1. 创建 CSS 片段：`.obsidian/snippets/cognitive-razor-custom.css`
2. 使用更高的特异性覆盖样式：

```css
/* 自定义主色调 */
.cr-workbench-panel {
  --cr-primary: #your-color;
}

/* 自定义按钮样式 */
.cr-workbench-panel button.mod-cta {
  background: #your-color;
}
```

3. 在 Obsidian 设置中启用 CSS 片段

## 性能优化

- 使用 CSS 变量减少重复代码
- 使用 `will-change` 优化动画性能
- 避免复杂的选择器
- 使用硬件加速的 CSS 属性（transform, opacity）

## 浏览器兼容性

插件样式兼容所有 Obsidian 支持的平台：

- Electron (桌面版)
- Chrome/Safari (移动版)

使用的 CSS 特性：

- CSS Grid
- CSS Flexbox
- CSS 自定义属性
- CSS 媒体查询
- CSS 动画

## 维护指南

### 添加新组件样式

1. 在 `styles.css` 中找到合适的部分
2. 使用 `.cr-` 前缀命名类
3. 遵循现有的命名约定
4. 添加暗色主题适配
5. 确保响应式支持

### 修改现有样式

1. 检查是否影响其他组件
2. 测试亮色和暗色主题
3. 测试不同屏幕尺寸
4. 验证可访问性

## 故障排除

### 样式未生效

1. 确保 `styles.css` 在插件根目录
2. 重新加载 Obsidian
3. 检查浏览器控制台是否有 CSS 错误
4. 清除 Obsidian 缓存

### 主题切换不生效

1. 检查是否使用了 Obsidian 的主题变量
2. 确保 `.theme-dark` 选择器正确
3. 验证 CSS 特异性

### 响应式布局问题

1. 检查媒体查询断点
2. 测试不同窗口大小
3. 验证 Flexbox/Grid 布局

## 参考资源

- [Obsidian CSS 变量](https://docs.obsidian.md/Reference/CSS+variables)
- [Obsidian 主题开发](https://docs.obsidian.md/Themes/App+themes)
- [CSS Grid 指南](https://css-tricks.com/snippets/css/complete-guide-grid/)
- [CSS Flexbox 指南](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)
