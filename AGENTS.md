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

### Obsidian CLI 集成（Windows）

Kiro 可通过 `obsidian` CLI 直接与运行中的 Obsidian 交互，实现自动化验证。

**关键约束**：Windows 下必须使用 `cmd /c "obsidian ..."` 包装命令以正确捕获输出。

#### 内容引号规则
在 `cmd /c "..."` 内部使用双引号时，需要转义：
- 简单值：`name=test`
- 带空格：`name="My Note"` 或 `content="Hello World"`
- 多行内容：使用 `obsidian append` 分步添加

### 关键约束
- 每次修改后必须 `npm run build` + `npm run test`
- 修改核心模块时必须跑测试
- 代码注释保持中文，与现有风格一致
- 不要创建总结性 markdown 文件
- Obsidian CLI 重载后需等待初始化：使用 `Start-Sleep -Seconds 3`（PowerShell）或 `timeout /t 3 /nobreak >nul`（CMD）
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

## 2. 构建、测试与开发命令

| 命令 | 用途 | 何时使用 |
|------|------|----------|
| `npm run build` | TypeScript 类型检查 + 生产打包 | 每次修改后必须运行 |
| `npm run test` | Vitest 单次运行 | 修改核心模块后必须运行 |
| `npm run test:coverage` | 覆盖率报告 | 大范围重构时推荐 |
| `npm run prepare-release` | 构建 + 发布校验 | 发布前运行 |

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
- `this.app` 不用全局 `app`；`registerEvent/Interval/DomEvent` 管理生命周期
- `requestUrl()` 替代 `fetch()`；`normalizePath()` 处理路径
- `Vault.process()` 原子写入；`FileManager.processFrontMatter()` 改 frontmatter
- `fileManager.trashFile()` 删除文件；`vault.cachedRead()` 优先读取
- 不用 `innerHTML/outerHTML`，用 `createDiv/createSpan/createEl`
- CSS 用 Obsidian 主题变量，类名 `cr-` 前缀，4px 间距网格

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
- 修改核心流程必须跑 `npm run test`

### 正确性属性（Property-Based Testing）
| 属性 | 验证目标 |
|------|----------|
| P1 | ErrorRegistry `formatMessage()` 输出不含未解析占位符 |
| P2 | 有效 PluginSettings 校验返回 `valid: true` |
| P3 | `sanitizeContext()` 输出不含原始敏感值 |
| P4 | TaskRecord 序列化往返一致性 |
| P5 | Frontmatter 序列化往返一致性 |
| P6 | 命名模板输出不含非法文件名字符 |

---

## 5. 关键设计决策（修改前必读）

> 完整架构设计 → `.kiro/specs/cognitive-razor-SSOT/design.md`

### 三层架构
UI → Core → Data，依赖单向流动。`ServiceContainer` 管理注册（Data → Core → UI）和释放（逆序）。

### SSOT 权威索引
| 关注点 | 权威来源 |
|--------|----------|
| 类型/枚举/TaskRecord 联合类型 | `src/types.ts` + `src/data/settings-store.ts` |
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

### 并发模型
- NodeLock：同一 cruid 写入互斥（内存级），启动时清空残留
- 去重检测使用 `type:${CRType}` 锁（最佳努力）

### 数据持久化
| 文件 | 用途 |
|------|------|
| Vault Markdown | SSOT（frontmatter + 正文） |
| `data/queue-state.json` | 队列状态（2 秒防抖写入） |
| `data/vectors/` | 向量嵌入（按类型分目录，按需加载 + TTL） |
| `data/duplicate-pairs.json` | 重复对 |
| `data/snapshots/` | 撤销快照（过期清理） |
| `data/pipeline-state.json` | 管线状态（Diff 确认阶段恢复） |
| `data/app.log` | JSONL 日志（脱敏） |
| `data.json` | 插件设置（含 uiState） |

---

## 6. Skills 激活策略

Skills 安装在 `.kiro/skills/`，按任务类型按需激活：

| 任务类型 | 需激活的 Skills |
|----------|----------------|
| 所有开发任务 | `obsidian` |
| 运行时验证 | `obsidian-cli` |
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

---

## 7. 自动化验证协议

### 7.1 标准验证（每次修改后）
1. `getDiagnostics` 检查修改文件
2. `npm run build`
3. `npm run test`

### 7.2 完整验证（重要修改）
标准验证 + Obsidian CLI 运行时验证：
1. `cmd /c "obsidian command id=app:reload"` → 等待 3 秒
2. `cmd /c "obsidian dev:errors"` → 确认无错误
3. `cmd /c "obsidian plugin id=obsidian-cognitive-razor"` → 确认 enabled
4. `cmd /c "obsidian command id=obsidian-cognitive-razor:cognitive-razor:open-workbench"` → 确认工作台
5. `cmd /c "obsidian dev:errors"` → 确认无新错误

CLI 不可用时降级为编译 + 测试 + getDiagnostics，注明需用户手动验证。

---

## 8. 提交规范

- 格式：`feat|fix|chore|refactor|docs|test: 简要动词短语`
- 聚焦单一责任
- 不提交 Vault 数据、密钥或凭证
- 发布前 `npm run prepare-release`

---

## 9. 常用文件速查

| 需求 | 文件 |
|------|------|
| 类型/字段/TaskRecord | `src/types.ts` |
| 默认设置/校验 | `src/data/settings-store.ts` |
| 服务注册 | `src/core/service-container.ts` |
| 错误码 | `src/data/error-codes.ts` |
| 管线编排 | `src/core/*-orchestrator.ts` |
| 任务执行 | `src/core/task-runner.ts` |
| 任务创建 | `src/core/task-factory.ts` |
| AI 提示词 | `prompts/` |
| 命令注册 | `src/ui/command-dispatcher.ts` + `command-utils.ts` |
| 工作台 UI | `src/ui/workbench-panel.ts` + `src/ui/workbench/*.ts` |
| Modal | `src/ui/modal-manager.ts` + `abstract-modal.ts` |
| 设置页 | `src/ui/settings-tab.ts` |
| 样式 | `styles.css` |
| Schema/渲染 | `src/core/schema-registry.ts` + `content-renderer.ts` |
| 向量索引 | `src/core/vector-index.ts` |
| 去重 | `src/core/duplicate-manager.ts` |
| 国际化 | `src/locales/*.json` + `src/core/i18n.ts` |
| 日志/脱敏 | `src/data/logger.ts` |
| Frontmatter | `src/core/frontmatter-utils.ts` |
| 命名模板 | `src/core/naming-utils.ts` |
| 并发锁 | `src/core/lock-manager.ts` |
| 快照/撤销 | `src/core/undo-manager.ts` |
| 哲学基线 | `docs/PHILOSOPHICAL_FOUNDATIONS.md` |
| 架构 spec | `.kiro/specs/cognitive-razor-SSOT/` |
