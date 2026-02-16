# Cognitive Razor — UX/UI 设计规范

> 本文档是所有 UX 交互设计和 UI/CSS 改动的唯一基准。
> 任何新增组件、交互流程或样式修改必须遵循此规范。
> 哲学基线 → `docs/PHILOSOPHICAL_FOUNDATIONS.md`
> 审计报告 → `docs/CODE_REVIEW_SOLID_KISS_DRY_YAGNI_UXUI.md`

---

## 第一部分：UX 设计原则

### 1.1 核心 UX 哲学

**"庖丁之刀"原则**：工具应顺应使用者的思维节奏，而非要求使用者适应工具的逻辑。

从 `PHILOSOPHICAL_FOUNDATIONS.md` 推导出的四条 UX 公理：

1. **判断主权在用户** — AI 的每一步输出都是"建议"，接受与拒绝的操作成本必须对称
2. **允许未完成态** — 系统不强迫用户在每一步都做出最终决定，模糊和暂定是合法状态
3. **可逆性即安全感** — 破坏性操作必须可撤销，撤销入口必须显眼且持久
4. **结构是脚手架** — 分类和 Schema 帮助思考，但不应成为思考的障碍

### 1.2 交互设计原则

| 原则 | 含义 | 反模式 |
|------|------|--------|
| 渐进披露 | 信息按需展开，不一次性倾倒 | 首屏堆满所有功能按钮 |
| 即时反馈 | 每个操作在 200ms 内有视觉响应 | 点击后无任何变化 |
| 错误可恢复 | 错误状态提供明确的修复路径 | 只显示"操作失败"无后续指引 |
| 可发现性 | 功能入口在用户需要时可见 | 关键操作藏在三级菜单里 |
| 上下文连续 | 操作流程中保持心智模型连贯 | 弹出 Modal 后丢失之前上下文 |
| 宽容设计 | 容忍用户的"错误"操作，提供回退 | 误点删除后无法恢复 |

### 1.3 反馈系统分级（强制）

所有用户反馈必须经统一出口，禁止在业务代码中散点 `new Notice(...)`。

| 级别 | 通道 | 持续时间 | 适用场景 |
|------|------|----------|----------|
| 成功 | Obsidian Notice（绿色） | 3000ms | 创建完成、修订完成 |
| 信息 | 内联文字更新 | 持久（直到状态变化） | 队列状态变化、进度更新 |
| 警告 | Obsidian Notice（橙色） | 5000ms | 功能未启用、前置条件不满足 |
| 错误 | Obsidian Notice（红色） | 6000ms | API 失败、系统错误 |
| 可撤销 | Undo Toast（底部浮层） | 8000ms（含撤销按钮） | 写入完成后的撤销窗口 |
| 确认 | Modal 对话框 | 用户主动关闭 | 破坏性操作（合并、清空队列） |
| 预览 | Diff Modal | 用户主动关闭 | 写入前的变更预览 |

错误展示规范：仅显示 `[错误码] + 用户可理解信息`，禁止直接暴露 `result.error.message` 等底层技术细节。
同一用户操作链中，禁止连续弹出同级通知；优先内联状态更新，避免通知疲劳。


---

## 第二部分：交互流程规范

### 2.1 创建概念流程（Create）

```
用户输入描述
    │
    ▼
[Define] AI 识别类型 + 标准化命名
    │
    ├─ 成功 → 显示类型置信度表格
    │           │
    │           ▼
    │       用户选择类型（或接受推荐）
    │           │
    │           ▼
    │       [Create Pipeline] Tag → Write → Index → Dedup
    │           │
    │           ▼
    │       完成 → Undo Toast (8s)
    │
    └─ 失败 → 内联错误提示 + 重试入口
```

UX 要点：
- 输入框回车即触发 Define，降低操作摩擦
- Define 期间：输入框显示加载动画，按钮禁用防重复提交
- 类型表格中，最高置信度行视觉突出（Primary 按钮），其余行使用普通按钮
- 选择类型后自动清空输入框和表格，回到初始状态
- 空状态引导：输入框 placeholder 提供示例文字

### 2.2 修订流程（Amend）

```
用户点击"改进笔记"
    │
    ▼
[SimpleInputModal] 输入修订指令
    │
    ▼
[Amend Pipeline] AI 生成修订内容
    │
    ▼
[Diff Modal] 显示变更对比
    │
    ├─ 接受 → 写入 → Undo Toast (8s)
    └─ 拒绝 → Notice "已取消"
```

UX 要点：
- Modal 标题明确显示目标笔记名称
- Diff 预览支持统一视图/并排视图切换
- 接受/拒绝按钮等大、等显眼（对称性原则）

### 2.3 合并流程（Merge）

```
用户在重复对列表点击合并图标
    │
    ▼
[Diff Modal] 对比两篇笔记内容
    │
    ├─ 确认合并 →
    │       │
    │       ▼
    │   [MergeNameSelectionModal] 选择保留名称
    │       │
    │       ▼
    │   [Merge Pipeline] AI 合并内容
    │       │
    │       ▼
    │   [Diff Modal] 预览合并结果
    │       │
    │       ├─ 接受 → 写入 → Undo Toast (8s)
    │       └─ 拒绝 → Notice "已取消"
    │
    └─ 取消 → 返回列表
```

UX 要点：
- 合并是多步流程，每步都可取消回退
- 名称选择 Modal 预填两个候选名称，用户也可自定义
- 最终写入前必须经过 Diff 预览（判断主权原则）

### 2.4 拓展流程（Expand）

```
用户点击"拓展"
    │
    ▼
[Prepare] AI 分析当前概念，生成候选列表
    │
    ├─ 层级拓展 → [ExpandModal] 勾选要创建的子概念
    │                   │
    │                   ▼
    │               批量 Create Pipeline
    │
    └─ 抽象拓展 → [AbstractExpandModal] 选择关联概念
                        │
                        ▼
                    单个 Create Pipeline
```

UX 要点：
- 候选列表标注已存在/无效项，避免重复创建
- 提供全选/全不选快捷操作
- 统计信息实时显示（总数/可创建/已存在/无效）

### 2.5 事实核查流程（Verify）

一键操作，无需额外输入。核查结果直接追加到笔记末尾。

### 2.6 图片生成流程（Visualize）

- 自动提取光标前后上下文作为参考
- 需要编辑模式（source mode）才能使用
- 功能未启用时按钮隐藏，而非禁用灰显


---

## 第三部分：状态管理与空状态设计

### 3.1 组件状态矩阵

每个 Section 必须处理以下四种状态：

| 状态 | 视觉表现 | 交互行为 |
|------|----------|----------|
| 空状态 | 引导文字 + 操作提示 | 提供"下一步"建议 |
| 加载中 | 骨架屏或加载指示器 | 禁用交互，防止重复操作 |
| 正常 | 数据列表/表格 | 完整交互能力 |
| 错误 | 错误描述 + 重试入口 | 仅允许重试或关闭 |

### 3.2 各 Section 空状态设计

**创建区（CreateSection）**：
- 空状态：输入框 + placeholder 引导文字
- 无活跃笔记时：操作按钮行整体隐藏
- 有活跃笔记时：操作按钮行显示，按钮根据前置条件启用/禁用

**队列区（QueueSection）**：
- 空状态：状态指示器显示"空闲"（绿色圆点），统计区显示"无任务"
- 有任务时：紧凑统计条（待处理/运行中/失败数），可展开查看详情表格

**重复对区（DuplicatesSection）**：
- 空状态：显示"暂无重复概念"
- 有数据时：列表项按相似度降序排列，每项显示相似度进度条

**历史区（RecentOpsSection）**：
- 空状态：显示"暂无操作记录"
- 有数据时：最近 10 条快照，每条显示操作类型 + 文件名 + 相对时间

### 3.3 加载状态规范

| 操作 | 加载指示方式 | 位置 |
|------|-------------|------|
| Define | 按钮添加 `is-loading` 类 + 输入框禁用 | 创建区输入框 |
| Create Pipeline | 队列状态栏更新为"运行中" | 队列区状态指示器 |
| Amend/Merge 预览 | Diff Modal 内部加载 | Modal 内容区 |
| 刷新重复列表 | 无显式加载（后台静默刷新） | — |
| 撤销操作 | 按钮禁用 + Notice 反馈 | 历史区按钮 |

### 3.4 错误状态规范

所有错误遵循统一模式：`[错误码] + [用户可理解的消息] + [可选的重试入口]`

- 错误消息通过 i18n 翻译，不直接暴露技术细节
- 错误码格式：E1xx（输入）、E2xx（Provider）、E3xx（系统）、E4xx（配置）、E5xx（内部）
- Notice 持续 6s，给用户足够时间阅读
- 关键错误（如 Provider 配置缺失）在 Notice 中提供"打开设置"的引导


---

## 第四部分：信息架构与工作台布局

### 4.1 工作台层级结构

```
┌─ Workbench Panel (.cr-workbench-panel.cr-scope) ──────┐
│                                                        │
│  ┌─ 主操作区（始终可见）─────────────────────────────┐ │
│  │  ┌─ 搜索输入区 (.cr-hero-container) ────────────┐ │ │
│  │  │ [input] [clear] [submit]                      │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  │  ┌─ 操作按钮行 (.cr-improve-section) ───────────┐ │ │
│  │  │ [改进] [拓展] [配图] [核查]                   │ │ │
│  │  │ （仅当有活跃 Markdown 笔记时显示）            │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  │  ┌─ 类型置信度表格 (.cr-type-confidence-table) ─┐ │ │
│  │  │ （仅 Define 成功后显示）                      │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                                                        │
│  ┌─ 队列状态栏 (.cr-queue-wrapper) ──────────────────┐ │
│  │ [●状态] [统计] [暂停/恢复]                        │ │
│  │ ┌─ 详情（可展开）────────────────────────────────┐│ │
│  │ │ 任务表格 + 批量操作按钮                         ││ │
│  │ └────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────┘ │
│                                                        │
│  ┌─ 可折叠区域 (.cr-expandable-sections) ────────────┐ │
│  │  ▶ 重复概念 (N)  ← 默认展开                      │ │
│  │  ▶ 操作历史 (N)  ← 默认折叠                      │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 4.2 布局设计理由

| 决策 | 理由 |
|------|------|
| 主操作区始终可见 | 创建是最高频操作，不应被折叠隐藏 |
| 队列状态栏紧凑 | 队列是后台运行的，不需要占据大量视觉空间 |
| 重复对默认展开 | 重复检测结果需要用户主动处理，展开提高可发现性 |
| 操作历史默认折叠 | 历史是低频查看的参考信息，折叠减少视觉噪音 |
| 操作按钮行条件显示 | 无活跃笔记时隐藏，避免用户点击后收到错误 |
| 折叠状态持久化 | 用户的布局偏好跨会话保持 |

### 4.3 响应式行为

| 宽度范围 | 适配策略 |
|----------|----------|
| < 280px | 操作按钮行换行，表格横向滚动 |
| 280-400px | 标准布局，所有元素单列排列 |
| > 400px | 可选：操作按钮行双列排列 |


---

## 第五部分：无障碍与键盘导航

### 5.1 ARIA 标注规范

| 组件 | 必需 ARIA 属性 |
|------|----------------|
| 可折叠 Section header | `role="button"`, `tabindex="0"`, `aria-expanded`, `aria-controls`, `aria-labelledby` |
| Section 内容区 | `role="region"`, `aria-labelledby` |
| 队列展开指示器 | `role="button"`, `tabindex="0"`, `aria-expanded`, `aria-label` |
| 状态文字 | `aria-live="polite"` |
| 图标按钮 | `aria-label`（描述操作，非图标名称） |
| 装饰性图标 | `aria-hidden="true"` |
| 禁用按钮 | `aria-disabled="true"` + `disabled` 属性 |
| Tooltip | `data-tooltip-position="top"` |

### 5.2 键盘导航流程

```
Tab 顺序（工作台面板内）：
1. 概念输入框
2. 清除按钮（有内容时）
3. 提交按钮（有内容时）
4. 操作按钮行：改进 → 拓展 → 配图 → 核查（有活跃笔记时）
5. 队列状态指示器（可展开）
6. 暂停/恢复按钮
7. 重复概念 Section header
8. 重复对列表项（展开时）
9. 操作历史 Section header
10. 快照列表项（展开时）
```

键盘交互：
- `Enter` / `Space`：触发按钮点击、切换折叠状态
- `Enter`（输入框内）：触发 Define 操作
- `Escape`（Modal 内）：关闭 Modal
- `ArrowLeft/ArrowRight`：tablist 内切换 tab
- `Home/End`：tablist 内跳转首尾 tab

### 5.3 动画与减弱动效

- 折叠/展开使用 `max-height` CSS 过渡
- 当 `prefers-reduced-motion: reduce` 时，禁用所有过渡动画
- 加载动画使用 CSS `@keyframes`，减弱动效时改为静态指示器


---

## 第六部分：微交互规范

### 6.1 按钮交互

| 状态 | 视觉变化 |
|------|----------|
| 默认 | 按变体样式显示 |
| Hover | 背景色加深一级（`--cr-bg-hover`） |
| Focus | 2px `--cr-border-focus` 轮廓 |
| Active | 轻微缩放 `scale(0.98)` |
| Disabled | 透明度 0.5，cursor: not-allowed |
| Loading | 添加 `is-loading` 类，显示旋转指示器，文字保留 |

### 6.2 列表项交互（重复对/快照）

| 状态 | 视觉变化 |
|------|----------|
| 默认 | `--cr-bg-base` 背景，`--cr-border` 边框 |
| Hover | 背景变 `--cr-bg-hover`，边框变 `--cr-border-focus`，操作按钮淡入 |
| Focus | 2px `--cr-border-focus` 轮廓 |

### 6.3 折叠/展开动画

```css
.cr-section-content {
    max-height: 2000px;
    overflow: hidden;
    transition: max-height 0.2s ease-out;
}
.cr-section-content.cr-collapsed {
    max-height: 0;
}
@media (prefers-reduced-motion: reduce) {
    .cr-section-content { transition: none !important; }
}
```

### 6.4 状态指示器动画

```css
.cr-status-dot.is-running {
    animation: cr-pulse 1.5s ease-in-out infinite;
}
@keyframes cr-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
@media (prefers-reduced-motion: reduce) {
    .cr-status-dot.is-running { animation: none !important; opacity: 1; }
}
```

### 6.5 相似度进度条

- 高相似度 (>90%)：`--cr-status-error` 红色填充
- 中相似度 (80-90%)：`--cr-status-warning` 橙色填充
- 低相似度 (<80%)：`--cr-status-info` 蓝色填充
- 进度条宽度 = `similarity * 100%`


---

## 第七部分：UI 视觉规范

### 7.1 设计哲学

**Obsidian 原生增强**：不创造新的视觉语言，而是在 Obsidian 原生风格基础上做克制的增强。

核心原则：
- **一致性** > 美观性：所有组件遵循同一套规则
- **克制**：不加不必要的阴影、动画、圆角
- **信息层级清晰**：主操作突出，辅助信息收敛，空状态有引导

### 7.2 颜色策略

所有组件样式只允许引用 `--cr-*` 变量，禁止直接使用 Obsidian 原生变量。

```css
/* ✅ 正确 */
background: var(--cr-bg-surface);
/* ❌ 禁止 */
background: var(--background-secondary);
```

语义色板：

| 用途 | 变量 | 映射 |
|------|------|------|
| 基础背景 | `--cr-bg-base` | `--background-primary` |
| 表面背景 | `--cr-bg-surface` | `--background-secondary` |
| 悬停背景 | `--cr-bg-hover` | `--background-modifier-hover` |
| 正文 | `--cr-text-normal` | `--text-normal` |
| 次要文字 | `--cr-text-muted` | `--text-muted` |
| 淡化文字 | `--cr-text-faint` | `--text-faint` |
| 强调色 | `--cr-text-accent` | `--interactive-accent` |
| 边框 | `--cr-border` | `--background-modifier-border` |
| 焦点边框 | `--cr-border-focus` | `--interactive-accent` |
| 成功 | `--cr-status-success` | `--color-green` |
| 警告 | `--cr-status-warning` | `--color-orange` |
| 错误 | `--cr-status-error` | `--color-red` |
| 信息 | `--cr-status-info` | `--color-blue` |

半透明叠加色统一使用 `color-mix`：
```css
--cr-overlay-{status}-{opacity}: color-mix(in srgb, var(--cr-status-{status}) {opacity}%, transparent);
```

### 7.3 间距系统

所有间距通过 `--cr-space-*` 引用，禁止直接使用 `--size-4-*` 或硬编码像素值：

| Token | 值 | 用途 |
|-------|-----|------|
| `--cr-space-half` | `2px` | 微间距（badge 内边距） |
| `--cr-space-1` | `4px` | 最小间距（图标与文字间距） |
| `--cr-space-1h` | `6px` | 紧凑按钮内边距 |
| `--cr-space-2` | `8px` | 紧凑间距（列表项内部） |
| `--cr-space-3` | `12px` | 标准间距（卡片内边距） |
| `--cr-space-4` | `16px` | 宽松间距（Section 间距） |
| `--cr-space-6` | `24px` | 大间距（面板内边距） |
| `--cr-space-8` | `32px` | 最大间距（空状态区域） |

间距使用规则：
- 同级元素间距：`gap` 属性，不用 `margin`
- 容器内边距：`padding`
- 嵌套层级越深，间距越小


### 7.4 圆角与阴影

| Token | 值 | 用途 |
|-------|-----|------|
| `--cr-radius-sm` | `var(--radius-s)` | 按钮、badge |
| `--cr-radius-md` | `var(--radius-m)` | 卡片、Section |
| `--cr-radius-lg` | `var(--radius-l)` | 搜索框、大容器 |
| `--cr-radius-pill` | `999px` | 药丸形状 |
| `--cr-shadow-sm` | `var(--shadow-s)` | 卡片悬停 |
| `--cr-shadow-lg` | `var(--shadow-l)` | 浮动面板、Modal |

### 7.5 组件规范

#### 7.5.1 按钮

四种变体，统一类名：

| 变体 | 类名 | 用途 | 样式 |
|------|------|------|------|
| Primary | `cr-btn-primary` | 主操作（创建、确认） | 强调色背景 + 白字 |
| Secondary | `cr-btn-secondary` | 次要操作（改进、拒绝） | 边框 + 透明背景 |
| Ghost | `cr-btn-ghost` | 低优先级操作（清除、取消） | 无边框 + 透明背景 |
| Danger | `cr-btn-danger` | 危险操作（删除、清空） | 红色边框/背景 |

尺寸修饰符：
- 默认：`min-height: 32px`，`padding: 6px 12px`
- `cr-btn--sm`：`min-height: 28px`，`padding: 4px 8px`，`font-size: smaller`
- `cr-btn--icon`：正方形，`width/height: 28px`，仅图标

禁止使用 Obsidian 原生按钮类（`mod-cta`、`mod-warning`）。

#### 7.5.2 输入框宽度

设置页输入框宽度通过 CSS 类控制，禁止 JS 内联 `style.width`：

| 类名 | 宽度 | 用途 |
|------|------|------|
| `cr-input-xs` | 80px | 数字输入（并发数、重试次数） |
| `cr-input-sm` | 120px | 中等数字（超时时间） |
| `cr-input-md` | 200px | 路径输入（目录方案） |
| `cr-input-lg` | 300px | 模板输入（命名模板） |

#### 7.5.3 卡片 / Section

```
┌─ cr-section ──────────────────────────┐
│ ┌─ cr-section-header ───────────────┐ │
│ │ [icon] Title          [badge] [▶] │ │
│ └───────────────────────────────────┘ │
│ ┌─ cr-section-body ─────────────────┐ │
│ │ 内容区域                           │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

- 背景：`--cr-bg-surface`，边框：`1px solid --cr-border`
- 圆角：`--cr-radius-md`
- 内边距：header `--cr-space-3 --cr-space-4`，body `--cr-space-4`

#### 7.5.4 Modal

三种尺寸：

| 尺寸 | 类名 | max-width | 用途 |
|------|------|-----------|------|
| Small | `cr-modal--sm` | `480px` | 确认对话框、简单输入 |
| Medium | `cr-modal--md` | `640px` | 表单、选择列表 |
| Large | `cr-modal--lg` | `900px` | Diff 视图、复杂操作 |

Modal UX 规范：
- 标题明确描述操作对象（如"修订: 笔记名称"而非"修订"）
- 关闭方式：右上角 X + Escape 键 + 点击遮罩层
- 破坏性操作的确认按钮使用 `cr-btn-danger`
- 接受/拒绝按钮大小相同（对称性原则）
- 按钮位置：始终右对齐，主操作在右侧，取消在左侧


---

## 第八部分：Diff 预览规范（强制）

### 8.1 标签完整性要求

`SimpleDiffView` 的 labels 参数为必填（非 Partial），调用方必须提供全部 11 个键：

| 键 | 说明 |
|----|------|
| `accept` | 接受按钮文字 |
| `reject` | 拒绝按钮文字 |
| `acceptAria` | 接受按钮无障碍标签 |
| `rejectAria` | 拒绝按钮无障碍标签 |
| `modeLabel` | 视图模式切换区域标签 |
| `unifiedView` | 统一视图按钮文字 |
| `unifiedViewAria` | 统一视图无障碍标签 |
| `sideBySideView` | 并排视图按钮文字 |
| `sideBySideViewAria` | 并排视图无障碍标签 |
| `leftTitle` | 左侧面板标题 |
| `rightTitle` | 右侧面板标题 |

禁止依赖内部英文默认值。中文环境中不允许出现英文 fallback。

### 8.2 决策对称性

- 接受按钮使用 `cr-btn-primary`，拒绝按钮使用 `cr-btn-secondary`
- 两个按钮视觉权重对称，尺寸相同
- 仅在明确的破坏性操作中使用 `cr-btn-danger`

### 8.3 旧组件清理

旧 `DiffView` 类（硬编码中文、未被引用）已标记 `@deprecated`，禁止新代码引用。
计划在下一个大版本中删除。


---

## 第九部分：禁止清单

### 9.1 CSS 禁止

- ❌ 直接使用 `var(--background-*)`, `var(--text-*)` 等 Obsidian 原生变量
- ❌ 使用 `mod-cta`, `mod-warning` 等 Obsidian 原生按钮类
- ❌ 直接使用 `var(--size-4-*)` 间距变量
- ❌ 硬编码颜色值（`#xxx`, `rgb()`, `rgba()`）
- ❌ 硬编码间距值（`12px`, `1.5em`）
- ❌ 在组件内定义新的 CSS 变量（所有变量集中在 `.cr-scope`）
- ❌ 使用 `!important`（除 `prefers-reduced-motion` 媒体查询外）

### 9.2 JS/TS 禁止

- ❌ 通过 JS 设置固定布局样式（如 `style.width = "80px"`）
- ❌ 仅允许状态切换类样式（如 `display`、`expanded`、`selected`）在运行时变更
- ❌ 结构/尺寸/间距必须通过 CSS 类 + `--cr-*` token 管理
- ❌ 使用全局 DOM 查询（`document.getElementsByName`、`document.querySelector`），必须限制在组件容器作用域内

### 9.3 UX 禁止

- ❌ 接受/拒绝按钮大小不对称（违反判断主权原则）
- ❌ AI 建议自动执行无需确认（违反主体性原则）
- ❌ 破坏性操作无撤销入口（违反可逆性原则）
- ❌ 错误消息仅显示技术细节无用户指引（违反错误可恢复原则）
- ❌ 功能入口在用户需要时不可见（违反可发现性原则）
- ❌ 操作后无任何视觉反馈（违反即时反馈原则）
- ❌ 强制用户在每一步都做最终决定（违反允许未完成态原则）
- ❌ Diff labels 依赖英文默认值（违反 i18n 完整性要求）
- ❌ 在业务代码中散点 `new Notice(...)`（必须经统一反馈服务）
- ❌ 直接暴露 `result.error.message` 给用户

### 9.4 架构禁止

- ❌ Orchestrator 共性逻辑在多个类中复制（任务订阅、预检校验、事件发布）
- ❌ "大一统 deps"接口扩散（按场景拆分最小依赖）
- ❌ 预留状态但无完整交互链路的功能（YAGNI 债务）