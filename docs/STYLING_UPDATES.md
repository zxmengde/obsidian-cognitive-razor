# 样式更新文档

## 概述

本文档记录了任务 12 中对 Cognitive Razor 插件样式的更新和改进。

## 更新内容

### 1. Modal 组件样式增强

#### 新增样式
- **基础 Modal 样式**：为所有 Modal 组件添加了统一的样式基础
- **输入框样式**：改进了输入框的焦点状态和过渡效果
- **错误消息样式**：统一的错误消息显示样式
- **按钮容器样式**：响应式的按钮布局

#### 组件覆盖
- `TextInputModal` - 文本输入对话框
- `SelectModal` - 选择对话框
- `ConfirmModal` - 确认对话框
- `ProviderConfigModal` - Provider 配置对话框

### 2. IncrementalImproveModal 样式

新增了完整的增量改进 Modal 样式：

- **文件信息区域** (`.cr-file-info`)
  - 文件名显示
  - 文件路径显示
  - 左侧主色调边框

- **意图输入框** (`.cr-intent-input`)
  - 多行文本输入
  - 焦点状态高亮
  - 占位符样式

- **提示信息** (`.cr-hint`)
  - 浅色背景
  - 左侧边框强调
  - 图标支持

### 3. MigrationWizard 样式

新增了迁移向导的完整样式：

- **迁移描述** (`.migration-description`)
  - 警告色边框
  - 清晰的说明文本

- **迁移选项** (`.migration-option`)
  - 卡片式布局
  - 悬停效果
  - 选项描述和列表

- **迁移详情** (`.migration-details`)
  - 详细信息列表
  - 等宽字体显示

### 4. WorkbenchPanel 创建概念样式

新增了标准化结果显示样式：

- **标准化结果容器** (`.cr-standardized-result`)
  - 成功色左边框
  - 清晰的分隔线

- **结果行** (`.cr-result-row`)
  - 标签和值的对齐
  - 中英文名称样式区分

- **别名列表** (`.cr-aliases-list`)
  - 标签式显示
  - 灵活换行

- **类型置信度** (`.cr-type-confidences`)
  - 进度条显示
  - 百分比数值
  - 平滑动画

### 5. 加载和动画增强

#### 新增加载状态
- **加载指示器** (`.cr-loading`)
  - 小尺寸和大尺寸变体
  - 旋转动画

- **加载容器** (`.cr-loading-container`)
  - 居中布局
  - 加载文本

- **进度条** (`.cr-progress-bar`)
  - 确定进度显示
  - 不确定进度动画

- **骨架屏** (`.cr-skeleton`)
  - 加载占位符
  - 渐变动画

#### 动画改进
- 淡入动画应用到更多组件
- 进度条平滑过渡
- 不确定进度的流动效果

### 6. 实用工具类

新增了大量实用工具类，用于快速样式应用：

#### 间距工具类
- `cr-mt-*`, `cr-mb-*` - 外边距
- `cr-p-*` - 内边距

#### 文本工具类
- `cr-text-center`, `cr-text-right`, `cr-text-left` - 对齐
- `cr-text-bold`, `cr-text-normal` - 字重
- `cr-text-sm`, `cr-text-md`, `cr-text-lg` - 大小
- `cr-text-muted`, `cr-text-error`, `cr-text-success` - 颜色

#### 布局工具类
- `cr-flex`, `cr-flex-col` - Flexbox
- `cr-flex-center`, `cr-flex-between` - 对齐
- `cr-gap-*` - 间隙

#### 显示工具类
- `cr-hidden`, `cr-visible`, `cr-invisible` - 可见性
- `cr-truncate` - 文本截断

#### 其他工具类
- `cr-rounded-*` - 圆角
- `cr-shadow-*` - 阴影
- `cr-border-*` - 边框
- `cr-disabled` - 禁用状态
- `cr-clickable` - 可点击状态

### 7. 可访问性增强

#### 改进内容
- **焦点可见性**：所有交互元素的焦点状态更明显
- **减少动画**：尊重用户的 `prefers-reduced-motion` 设置
- **高对比度模式**：在高对比度模式下增加边框宽度
- **屏幕阅读器**：`.sr-only` 类用于屏幕阅读器专用文本
- **跳过链接**：`.skip-link` 用于键盘导航

### 8. 暗色主题兼容性

#### 全面支持
所有新增组件都包含了暗色主题样式：

- Modal 组件
- IncrementalImproveModal
- MigrationWizard
- 标准化结果显示
- 所有状态徽章和进度条

#### 暗色主题调整
- 背景色使用 Obsidian 的暗色主题变量
- 阴影强度增加
- 状态颜色的透明度调整

### 9. 响应式设计

#### 断点
- 小屏幕：< 768px
- 中等屏幕：768px - 1024px
- 大屏幕：> 1024px

#### 适配内容
- Modal 按钮在小屏幕上垂直堆叠
- 任务列表在小屏幕上单列显示
- 差异视图在小屏幕上单列显示
- 队列统计网格根据屏幕大小调整列数

### 10. 打印样式

新增了打印友好的样式：

- 隐藏所有操作按钮
- 避免在元素内部分页
- 显示链接的 URL
- 简化边框和阴影

## 样式组织

样式文件按以下结构组织：

1. 全局变量和基础样式
2. WorkbenchPanel 样式
3. QueueView 样式
4. DiffView 样式
5. StatusBadge 样式
6. 通用组件样式
7. 响应式布局
8. 暗色主题适配
9. 可访问性增强
10. 实用工具类
11. 加载和过渡动画
12. Modal 组件样式
13. IncrementalImproveModal 样式
14. MigrationWizard 样式
15. 打印样式

## CSS 变量

所有样式使用 CSS 变量以确保一致性和可维护性：

### 颜色变量
- `--cr-primary` - 主色调
- `--cr-success` - 成功色
- `--cr-warning` - 警告色
- `--cr-error` - 错误色
- `--cr-info` - 信息色

### 间距变量
- `--cr-spacing-xs` - 4px
- `--cr-spacing-sm` - 8px
- `--cr-spacing-md` - 16px
- `--cr-spacing-lg` - 24px
- `--cr-spacing-xl` - 32px

### 圆角变量
- `--cr-radius-sm` - 4px
- `--cr-radius-md` - 8px
- `--cr-radius-lg` - 12px

### 阴影变量
- `--cr-shadow-sm` - 小阴影
- `--cr-shadow-md` - 中等阴影
- `--cr-shadow-lg` - 大阴影

## 测试

### 测试文件
创建了 `test-styles.html` 用于独立测试样式：

- Modal 组件样式
- 创建概念区域
- 重复概念管理
- 任务队列视图
- 增量改进 Modal
- 加载状态
- 暗色主题切换

### 测试方法
1. 在浏览器中打开 `test-styles.html`
2. 检查各个组件的样式是否正确
3. 点击"切换暗色主题"按钮测试暗色主题
4. 调整浏览器窗口大小测试响应式布局

## 浏览器兼容性

样式使用现代 CSS 特性，支持：

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

主要使用的现代特性：
- CSS Grid
- Flexbox
- CSS 变量
- CSS 动画
- Media Queries

## 性能考虑

- 使用 CSS 变量减少重复代码
- 动画使用 `transform` 和 `opacity` 以获得更好的性能
- 避免使用昂贵的 CSS 属性（如 `box-shadow` 在动画中）
- 使用 `will-change` 提示浏览器优化动画

## 维护建议

1. **保持一致性**：使用 CSS 变量而不是硬编码值
2. **命名规范**：使用 `cr-` 前缀避免与 Obsidian 样式冲突
3. **组织结构**：按组件组织样式，使用注释分隔
4. **暗色主题**：所有新样式都应包含暗色主题变体
5. **响应式**：考虑不同屏幕尺寸的显示效果
6. **可访问性**：确保足够的对比度和焦点指示

## 未来改进

可能的改进方向：

1. **CSS 模块化**：考虑将样式拆分为多个文件
2. **CSS 预处理器**：使用 SCSS 或 Less 提高可维护性
3. **主题系统**：支持自定义主题颜色
4. **动画库**：创建可复用的动画组件
5. **设计系统**：建立完整的设计系统文档

## 相关文件

- `styles.css` - 主样式文件
- `test-styles.html` - 样式测试文件
- `docs/STYLING.md` - 样式指南（如果存在）
- `docs/UI_PREVIEW.md` - UI 预览文档

## 总结

本次样式更新全面覆盖了所有新增的 Modal 组件和 UI 功能，确保了：

✅ 所有 Modal 组件都有完整的样式支持
✅ WorkbenchPanel 的创建概念功能有完整的样式
✅ QueueView 的任务列表和分组有清晰的样式
✅ DiffView 的差异显示有良好的可读性
✅ 暗色主题完全兼容
✅ 响应式设计适配各种屏幕尺寸
✅ 可访问性增强
✅ 性能优化
✅ 实用工具类方便快速开发

所有样式都遵循了 Obsidian 的设计语言，并与现有样式保持一致。
