# Cognitive Razor — 开发指南

本文档是 AI 开发助手（Kiro）在本项目中的行为准则与知识基线。
用户是代码小白，只负责提出想法和需求和使用插件；
Kiro 负责代码修改、构建、测试、调试和实际在 Obsidian 中运行实际测试的全部工作。

> **架构与需求详情** → `.kiro/specs/cognitive-razor-SSOT/`（requirements.md + design.md）
> **哲学基线** → `docs/PHILOSOPHICAL_FOUNDATIONS.md`

---

## 0. 协作模式

### 角色分工
- **用户**：提出功能需求 / 描述 Bug / 反馈使用体验 / 使用插件
- **Kiro**：分析需求 → 定位代码 → 实现修改 → 构建 → 测试 → 在 Obsidian 中实际运行、验证和测试 → 交付可用版本

### 关键约束
- 每次修改后必须 `npm run build` + `npm run test`
- 修改核心模块时必须跑测试
- 代码注释保持中文，与现有风格一致
- 不要创建总结性 markdown 文件
- 审计类任务使用 `grepSearch` 工具定位目标代码，不手动逐文件检查
---

## 1. 项目概览

Cognitive Razor 是 Obsidian 桌面端插件，利用 AI 将模糊知识转化为结构化知识节点，构建个人知识图谱。

### 核心操作
| 操作 | 说明 | 调度方式 |
|------|------|----------|
| Define | AI 识别概念类型（5 类）+ 标准化命名 | 直调 |
| Tag | 生成别名、标签 | 入队 |
| Write | 按类型 Schema 生成结构化正文 | 入队 |
| Amend | 增量修订现有概念（Diff 确认） | 入队 |
| Merge | 合并语义重复概念（Diff 确认） | 入队 |
| Expand | 从概念发现相关新概念 | 批量 Create |
| Visualize | 为概念生成配图 | 入队 |
| Verify | 事实核查（报告追加到笔记末尾） | 入队 |
| Index | 向量化（embedding） | 直调 |
| Deduplicate | 同类型向量相似度检测 | 直调 |

### 知识类型
Domain（领域）→ Issue（议题）→ Theory（理论）→ Entity（实体）/ Mechanism（机制）

### 笔记状态
Stub（Tag 后占位）→ Draft（Write 后有正文）→ Evergreen（用户手动标记）

---

## 2. 构建与测试

| 命令 | 用途 | 何时使用 |
|------|------|----------|
| `npm run build` | TypeScript 类型检查 + 生产打包 | 每次修改后必须运行 |
| `npm run test` | Vitest 单次运行 | 修改核心模块后必须运行 |
| `npm run test:coverage` | 覆盖率报告 | 大范围重构时推荐 |
| `npm run prepare-release` | 构建 + 发布校验 | 发布前运行 |

### Obsidian CLI 运行时验证（全自动）

> 激活 `obsidian-cli` skill 获取完整命令参考和 workaround 细节。

每次修改后的标准验证流程：

```powershell
# 1. 构建 + 重载
npm run build
obsidian plugin:reload id=obsidian-cognitive-razor

# 2. 检查加载错误
obsidian dev:errors

# 3. 验证插件状态
obsidian eval code="app.plugins.plugins['obsidian-cognitive-razor'] ? 'loaded' : 'not loaded'" | Out-String
```

**关键规则：**
- 需要读取输出的命令追加 `| Out-String`（解决 PowerShell 输出截断）
- `dev:` 系列命令（`dev:errors`、`dev:console`、`dev:screenshot`）不加 `| Out-String`
- Frontmatter 操作用 `eval + processFrontMatter`，不用 `property:set`（静默失败）
- DOM 查询用 `eval + document.querySelector`，不用 `dev:dom`（输出为空）
- `eval` 不支持 top-level `await`，异步用 `.then()` 链
- 创建带 frontmatter 的笔记用 `eval + app.vault.create`

---

## 3. 编码规范

### TypeScript
- 严格模式，ES2022 目标，`@/` 别名指向 `src/`
- 类型显式，避免 `any`；使用 `Result<T>` 单子处理错误
- TaskRecord 使用 Discriminated Unions（`taskType` 判别式），不用 `Record<string, unknown>`
- 同步路径可抛 `CognitiveRazorError`，异步边界用 `toErr()` 归一化
- 命名：PascalCase（类/类型）、camelCase（函数/变量）、UPPER_SNAKE_CASE（常量）

### 格式
- LF，UTF-8，文件末尾换行，Tab 宽度 4
- 注释语言：中文（与现有代码一致）

### Obsidian API 规范
> 激活 `obsidian` skill 获取完整规则（27 条 ESLint 规则、内存管理、类型安全、无障碍等）

本项目特定约定：CSS 类名 `cr-` 前缀，4px 间距网格

### 错误处理
- 错误码：E1xx（输入）、E2xx（Provider）、E3xx（系统）、E4xx（配置）、E5xx（内部）
- `ErrorRegistry` 集中注册，`{param}` 模板插值
- 异步用 `Result<T>` 单子，破坏性操作先快照（UndoManager）
- Logger 统一日志，`sanitizeContext` 脱敏，通知仅显示错误码 + i18n 消息

---

## 4. 测试指南

- 框架：Vitest + happy-dom + fast-check（v4.3.0）
- 文件命名：`*.test.ts`，与源文件同层
- TypeScript 编译排除测试文件，Vitest 自行编译
- 正确性属性（P1-P6）定义 → `requirements.md` 末尾

### 端到端测试（E2E）

> 激活 `obsidian-cli` skill 获取完整的 E2E 测试命令参考。

通过 `obsidian eval` 直接调用 Orchestrator API，绕过 Modal UI，实现全自动端到端测试。

**核心入口：**
```powershell
# 获取所有组件
obsidian eval code="const c = app.plugins.plugins['obsidian-cognitive-razor'].getComponents(); Object.keys(c).join(', ')" | Out-String
```

**可测试的操作：**

| 操作 | 方法链 | 需要确认 |
|------|--------|---------|
| Create（自动） | `defineDirect()` → `startCreatePipelineWithStandardized()` | 自动完成 |
| Create（手动） | `defineDirect()` → `startCreatePipeline()` → `confirmCreate()` → `confirmWrite()` | 两步确认 |
| Amend | `startAmendPipeline(path, instruction)` → `confirmWrite()` | 一步确认 |
| Merge | `startMergePipeline(pair, keepId, name)` → `confirmWrite()` | 一步确认 |
| Verify | `startVerifyPipeline(path)` | 自动完成 |
| Expand | `prepare(file)` → `createFromHierarchical/Abstract()` | 委托 Create |
| Image | `startImagePipeline(options)` | 自动完成 |

**测试规范：**
- 测试笔记使用 `__test_` 前缀，便于批量清理
- 异步管线用轮询模式等待（500ms 间隔，120 秒超时）
- 每步操作后 `obsidian dev:errors` 检查异常
- 流程：Setup → Execute → Wait → Verify → Cleanup

---

## 5. 关键设计决策（修改前必读）

> 完整架构设计 → `.kiro/specs/cognitive-razor-SSOT/design.md`

### SSOT 权威索引
| 关注点 | 权威来源 |
|--------|----------|
| 类型/枚举/TaskRecord | `src/types.ts` + `src/data/settings-store.ts` |
| 服务注册与生命周期 | `src/core/service-container.ts` |
| 错误码与消息模板 | `src/data/error-codes.ts` |
| Prompt 槽位与模板 | `src/core/prompt-manager.ts` + `prompts/` |
| Schema 与渲染 | `src/core/schema-registry.ts` + `src/core/content-renderer.ts` |
| 数据文件格式 | `src/data/file-storage.ts` + 各 `*-store.ts` |
| 管线编排 | `src/core/*-orchestrator.ts` |
| 队列/锁 | `src/core/task-queue.ts` + `src/core/lock-manager.ts` |
| 国际化 | `src/locales/*.json` + `src/core/i18n.ts` |
| Modal 生命周期 | `src/ui/modal-manager.ts` + `src/ui/abstract-modal.ts` |
| 命令 ID | `src/ui/command-utils.ts` |
| 命令注册 | `src/ui/command-dispatcher.ts` |
| 工作台 UI | `src/ui/workbench-panel.ts` + `src/ui/workbench/*.ts` |
| 设置页 | `src/ui/settings-tab.ts` |
| 样式 | `styles.css` |
| 向量索引 | `src/core/vector-index.ts` |
| 去重 | `src/core/duplicate-manager.ts` |
| 日志/脱敏 | `src/data/logger.ts` |
| Frontmatter | `src/core/frontmatter-utils.ts` |
| 命名模板 | `src/core/naming-utils.ts` |
| 快照/撤销 | `src/core/undo-manager.ts` |
| 哲学基线 | `docs/PHILOSOPHICAL_FOUNDATIONS.md` |

---

## 6. Skills 激活策略

Skills 安装在 `.kiro/skills/`，按任务类型按需激活：

| 任务类型 | 需激活的 Skills |
|----------|----------------|
| 所有开发任务 | `obsidian` |
| 运行时验证 | `obsidian-cli`（含 PowerShell workaround 和 eval 替代方案） |
| Data/Core 层 | `obsidian-sdk-patterns` |
| 文件/笔记操作 | `obsidian-core-workflow-a` |
| UI 组件 | `obsidian-core-workflow-b` |
| 性能优化 | `obsidian-performance-tuning` |
| 安全相关 | `obsidian-security-basics` |
| 运行时错误 | `obsidian-common-errors` |
| 事件处理 | `obsidian-webhooks-events` |
| 大范围重构 | `obsidian-reference-architecture` |
| 发布准备 | `obsidian-prod-checklist` + `obsidian-deploy-integration` |
| CI/CD | `obsidian-ci-integration` |
