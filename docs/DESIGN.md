# 运行设计

## 组件与启动

`main.ts` 注册设置、命令与工作台视图。`PluginRuntime` 在首次打开工作台或执行操作时初始化业务服务；初始化和卸载以同一运行时实例协调，初始化失败会释放已创建的资源。

| 边界 | 组件 | 责任 |
| --- | --- | --- |
| 设置 | SettingsStore、settings-codec、SettingsApplication | 默认值、校验、串行保存、界面操作 |
| 模型 | TaskRunner、ProviderManager、ProviderRequestExecutor | 模型快照、协议选择、一次请求及尝试记录 |
| 传输 | ProviderTransport、provider-stream-codec、provider-errors | Node HTTP / renderer fetch、流解析、错误分类 |
| 提示词 | PromptManager、prompts、schema-registry | 规则拼装、阶段任务、结构化输出契约 |
| 工作流 | Create / Verify / ExpandOrchestrator、WorkflowCoordinator | 确认、入队、阶段结果提交和恢复 |
| 调度 | TaskQueue、QueueStateStore | 顺序、并发、暂停、取消和调度元数据 |
| 笔记 | NoteRepository、CruidCache、ContentRenderer | frontmatter、正文、语义链接与节点身份 |
| 索引与重复 | VectorIndex、SemanticIndexRebuilder、DuplicateManager、DuplicateMergeService | 嵌入、候选、合并预览与提交 |
| 卡片 | CardGenerationService、CardsTaskExecutor | 正文快照、完整结果追加与终态保存 |
| 界面 | WorkbenchApplication、Svelte 组件 | 发出操作、投影状态与用户确认 |

## 创建与阶段提交

Define 请求不经过 TaskQueue。确认后按类型目录和标准名称生成路径，创建 seed 节点并固定目录方案、父链接和自动核查选项。Tag 更新 aliases 和 tags；最后一个写作阶段提交成功后状态变为 draft。

`stage-catalog.ts` 是阶段顺序、字段、提示词路径与提交策略的统一来源：领域、议题、理论各有核心、叙事、结构三阶段；实体有核心、综合两阶段；机制有核心、过程、综合三阶段，共 14 个写作阶段。

模型结果先校验业务字段，再保存待提交结果；已保存结果可在重载后本地提交。正文快照和提交标识防止恢复时覆盖外部编辑或重复应用阶段。结构链接使用确认时的目录方案，目标路径与名称规范化使用同一规则。

核查由 VerifyOrchestrator 捕获现有笔记并创建工作流；卡片由 CardGenerationService 独立入队。内容提交约束见[核查](REQUIREMENTS.md#核查)与[记忆卡片](REQUIREMENTS.md#记忆卡片)。

## 合并提交与内容保护

草稿请求包含类型、两篇笔记的元数据和移除插件核查块后的内容。`sectionOrder` 从 Schema 字段描述取得，理论的 `axioms` 使用与正文渲染一致的“前提”标题，避免另维护五套模板。原始全文和哈希仍保存在输入快照中，用于预览与提交保护；送模投影不携带内容哈希。Merge 专用提示词要求固定章节、完整整合、去重及正文内保留分歧；响应校验仍只保证结构合法，语义质量须检查草稿，不能把标题或信息完整性当作代码已保证。

约束：Obsidian 提供逐文件的 `Vault.process` 原子读改写；合并日志记录阶段，不能把多文件操作变为一个事务。草稿已有两篇源笔记的内容哈希，确认日志已有主笔记全文快照和目标正文，沿用现有持久化格式。

确认时重新读取两篇源笔记并比较草稿哈希，变化则返回 `E321_MERGE_CONTENT_CHANGED`，不启动写入。`NoteRepository.replaceIfUnchanged` 在 `Vault.process` 同步回调内比较当前全文与预期快照，匹配才替换；当前全文已等于目标结果时允许恢复确认。主笔记和引用笔记均经此入口写入，冲突后的记录由原有检查点机制保存。

恢复从已保存阶段继续。准备阶段先检查保存的确认快照与草稿哈希是否一致，阻止旧版本记录携带过期草稿继续写入；主笔记尚未提交时仍比较确认快照，已完成的主笔记写入不重做。引用笔记在恢复前被编辑时，按其当前正文重算链接替换，原子回调再次核对该正文，保留新编辑。界面通过专用错误码提示重新检查草稿，保留编辑框内容。验证覆盖旧草稿、异步窗口、原子回调入口、检查点失败与重载恢复；真实宿主证据见[功能实测](FEATURE_VALIDATION.md)。

## 配置与请求

服务能力保存在 `capabilities`，模型参数保存在 `parameters`。参数语义见[服务与执行](REQUIREMENTS.md#服务与执行)。任务快照固定服务、协议、端点、模型、能力及有效参数。

提示词身份、请求前缀和缓存控制见[提示词设计](PROMPTS.md)。

结构化任务通过 JSON Schema 定义响应。写作按类型使用固定 Schema 外壳，依据阶段标识取回并校验当前字段；通行单一分类列表与带 classification_basis 的多标准列表都是有效业务形式。

## 持久化

| 数据 | 路径 | 格式 |
| --- | --- | --- |
| 设置 | data.json | 设置对象 |
| 队列 | data/queue-state.json | 1.0.0，调度元数据 |
| 工作流 | data/workflows/*.json | 1.0.0，输入、已应用阶段、待提交结果与对话 |
| 向量索引 | data/vectors/index.json | 1.0.0，嵌入配置身份与概念元数据 |
| 重复对 | data/duplicate-pairs.json | 1.0.0，候选及忽略状态 |
| 卡片记录 | data/cards/*.json | 格式 1，正文快照与提交状态 |
| 合并记录 | data/merge-drafts/、data/duplicate-merge-operations.json | 合并预览与提交检查点 |
| 重置快照 | data/backups/ | 设置、运行文件清单与副本 |

文件写入通过 FileStorage 的原子操作完成。格式校验发生在外部响应、磁盘数据、用户输入与生命周期边界。无效队列进入隔离，保留原文件并停止写入；无效工作流单独报告。无法识别的阶段保留其记录，不派发，并阻止所属工作流自动补发。

重载时先检查已保存的待提交阶段结果；请求恢复约束见[服务与执行](REQUIREMENTS.md#服务与执行)。重置恢复时序见[备份恢复](RUNTIME_BACKUP_RECOVERY.md#中断恢复)。

## 验证边界

验证方法和证据边界分别见[开发约定](../AGENTS.md)、[离线检查](PROMPTS.md#离线检查)与[Obsidian 验收](OBSIDIAN_UI_TESTING.md)。
