# 项目概览
- 名称：Cognitive Razor（Obsidian 社区插件），目标是以公理化方式帮助用户创建、增量改进和去重知识节点，强调可逆写入、本地优先、AI 辅助。
- 技术栈：TypeScript + Obsidian 插件 API，npm + esbuild 打包；模块化目录 core/（业务逻辑与 AI）、data/（持久化）、ui/（视图组件），types.ts 定义核心类型。
- 核心流程：TaskQueue 调度 → TaskRunner 调用 Provider/Prompt/Validator → PipelineOrchestrator 管理创建、增量、合并、ground 流程 → UndoManager 快照 → VectorIndex/ DuplicateManager 去重。
- 数据存储：data/ 下 queue-state.json、vector-index.json、duplicate-pairs.json、snapshots/、app.log；全部本地 JSON/备份文件。
- 主要依赖：Obsidian API，OpenAI 兼容接口（ProviderManager 封装 chat/embed），内部 SchemaRegistry/Validator/PromptManager 实现 PDD 校验与 JSON Schema 校验。
- UI 组件：WorkbenchPanel（工作台，整合队列/去重/操作）、DiffView、StatusBadge、各类 Modal（输入/选择/确认/Provider 配置），QueueView 已标记废弃。