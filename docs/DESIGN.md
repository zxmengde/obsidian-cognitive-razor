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

Define 直接请求五类候选，不入队、不写笔记。确认后按类型目录和标准名称生成路径，创建 seed 节点并固定目录方案、父链接和自动核查选项。Tag 更新 aliases 和 tags；最后一个写作阶段提交成功后状态变为 draft。

`stage-catalog.ts` 是阶段顺序、字段、提示词路径与提交策略的统一来源：领域、议题、理论各有核心、叙事、结构三阶段；实体有核心、综合两阶段；机制有核心、过程、综合三阶段，共 14 个写作阶段。

模型结果先校验业务字段，再保存待提交结果；已保存结果可在重载后本地提交。正文快照和提交标识防止恢复时覆盖外部编辑或重复应用阶段。结构链接使用确认时的目录方案，目标路径与名称规范化使用同一规则。

核查单独捕获现有笔记并创建工作流，成功时替换核查标记块并设置 evergreen。卡片单独入队，固定完整正文和目标；整批结果通过追加条件后写入，保留现有卡片字节。

## 配置与请求

服务能力保存在 `capabilities`，模型参数保存在 `parameters`。任务参数的缺省、具体值、null 分别表示继承、覆盖、明确省略。任务快照固定服务、协议、端点、模型、能力及有效参数。

Responses 可传输缓存路由与响应 ID 续接控制；Gemini 使用服务端默认隐式缓存。写作默认重放稳定的累积请求前缀，公共规则、Schema 和工具尽量固定，阶段指令位于后部。真实缓存读取以服务端 usage 为准，见[提示词设计](PROMPTS.md)。

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

重载时可本地提交的阶段继续提交；其余 running 任务变成 interrupted，不自动发起 Provider 请求。请求账本只属于当前进程，不能据此判断重载前的计费结果。重置恢复在普通运行服务及临时文件清理前完成，见[备份恢复](RUNTIME_BACKUP_RECOVERY.md)。

## 验证边界

单测使用 Obsidian mock 与 happy-dom。离线导出走真实任务执行器与 ProviderManager，在传输边界截获请求；它证明组装行为，不能证明服务支持、搜索质量、模型输出或缓存命中。宿主验收按[Obsidian 验收](OBSIDIAN_UI_TESTING.md)执行。
