# Cognitive Razor 功能与流程审计

审计对象：源码仓库 `C:/code/obsidian/.obsidian/plugins/obsidian-cognitive-razor`，版本 1.0.0，HEAD `70be356d6fe032d23f060bb551ad670a9fb40364`。本报告按命令与工作台入口追踪到 service 和实际持久化，不以 README 的功能概述代替行为核验。

## 功能总览

| 功能 | 用户入口与实际行为 | 关键限制与代码路径 | 现有测试、本次实测与未验 |
|---|---|---|---|
| 工作台与命令 | Obsidian 命令面板提供“打开工作台”和“核查当前笔记”；工作台按当前笔记上下文提供创建、拓展、核查、卡片、队列与相似笔记操作。 | 只有两个注册命令：`src/ui/command-dispatcher.ts:10-25`。界面操作经 `src/app/workbench-application.ts:121-152` 委派给业务服务；启动时由 `main.ts:55` 注册。 | 本次覆盖 Svelte 合并交互测试；未实际打开 Obsidian UI，也未逐项验收所有设置页或宿主命令行为。 |
| 定义与创建 | 在工作台输入概念请求五种类型候选；用户选择类型后才启动创建。创建先建立 seed 文件，再排队执行 Tag 与各类型 Write 阶段；配置自动核查时后续进入 Verify。 | Define 是直接模型请求，不进入队列；类型确认才调用 `CreateOrchestrator.confirmCreate`。目标路径冲突时拒绝创建；工作流持久化后用 `ensureCreate` 防止覆盖已有同路径文件。路径：`CreateSection.svelte:184-196`、`create-orchestrator.ts:103-142`、`workflow-coordinator.ts:135-200`。 | 覆盖 `create-orchestrator.test.ts` 与 `workflow-scenarios.test.ts`；本次包含其中 143 项中的相关测试。模拟了并发创建、取消、恢复、阶段提交失败；未验证真实 Vault 创建或模型输出质量。 |
| 拓展 | 对已识别节点打开拓展面板，按节点正文结构提取层级候选，用户确认后进入创建；抽象拓展先出预览再确认。 | 类型/章节约束和路径检查在 `expand-orchestrator.ts`；创建仍走工作流协调器。 | 存在 `expand-orchestrator.test.ts`，本轮未运行；未做真实界面操作。 |
| 核查 | 可由命令或当前节点操作触发，排入 Verify；完成后将报告写进插件标记块并更新状态。 | Verify 用启动时快照；报告由 `NoteRepository.replaceVerificationReport` 更新，标记块外正文保留。路径：`command-dispatcher.ts:20-25`、`CreateSection.svelte:163-181`、`note-repository.ts:86-110`。 | 有 `verify-orchestrator.test.ts`、`verify-task-executor.test.ts` 与多阶段场景测试；本次只运行工作流场景相关用例。未使用真实模型或真实笔记。 |
| 记忆卡片 | 对当前合法知识节点点击“生成卡片”，排入独立 Cards 任务；模型收到去除 frontmatter 与插件核查块后的正文快照，整批完成后追加到路径镜像的 `-decks.md` 文件。既有卡片和手工内容保留，不去重。 | 仅接受配置知识根目录中的 Cognitive Razor 节点；任务开始时固定源正文、目标路径与模型快照。运行中取消、未知结果或重载中断不会自动追加/重发；卡片任务不能用队列重试，需从源笔记重新生成。路径：`CreateSection.svelte:200-212`、`card-generation.ts:14-23`、`card-generation-service.ts:39-55,78-102`、`note-repository.ts:55-67`。 | 覆盖来源校验、镜像路径、正文快照、已有文件追加、保留手工修改、取消后迟到结果、响应不完整、完成收据恢复和中断不重发。9 个定向测试文件中相关卡片文件通过；仅 mock Vault/模型响应，真实 Decks 展示及真实文件写入未验。 |
| 索引与重复候选 | 设置中可启停语义索引/重复检测，重建索引、补齐嵌入或重算重复候选；工作台按相似度展示同类型候选，可忽略。 | 相似度只产生候选；忽略状态写入 `data/duplicate-pairs.json`。候选由向量索引与 `DuplicateManager` 维护。 | 有 `duplicate-manager.test.ts`、`semantic-index-rebuilder.test.ts`；本轮运行重复管理器测试，未跑索引维护测试或发出真实嵌入请求。 |
| 重复合并 | 点击候选后选主笔记，生成队列草稿；可查看/编辑主笔记、别名、标签、父链接和正文，再显式确认。确认后更新主笔记、修复可识别的指向冗余笔记的链接、刷新主笔记索引、将冗余笔记移入 Obsidian 回收站并清理候选。 | 生成草稿阶段不改笔记；快照与草稿先保存在 `data/merge-drafts/`。确认前重读两笔记；提交各阶段写 `data/duplicate-merge-operations.json` 检查点，失败可恢复。链接预览计划捕获时读取 Vault Markdown 文件。关键路径：`DuplicatesSection.svelte:68-79`、`MergeModal.svelte:35-65`、`duplicate-merge-service.ts:280-295,350-369,418-480`。 | 测试覆盖对话框挂载/关闭、提交失败反馈、草稿持久化、无效模型结果拒绝写入、链接与父项修复、并发确认、回收站阶段失败/恢复、冗余笔记编辑保护。本次 `duplicate-merge-service`、草稿、管理器及 UI 合并用例通过。未在真实 Vault 操作或恢复回收站。静态主笔记并发编辑疑点见下文。 |
| 队列与恢复 | 工作台展示活动任务、历史和状态筛选；支持暂停、取消、单项/批量重试、清理终态任务。对服务端结果不确定的请求要求显式重试确认；卡片中断要求重新生成。 | 队列状态写入 `data/queue-state.json`；工作流、卡片、合并草稿另有业务记录。队列账本不是计费证明。 | 有 `task-queue.test.ts`、`queue-interactions.test.ts` 等；本次运行 UI 合并与工作流场景测试，未穷举全部队列 UI。 |
| 设置、服务与运行数据 | 设置页管理服务/模型、任务覆盖、工作流、知识与卡片目录、索引维护及运行数据备份重置。 | 服务协议显式配置；任务空值可继承默认。备份重置覆盖设置及插件 `data/`，不备份笔记或卡片；普通设置导出不带 API Key。 | 有设置与数据维护单测；本次未验证真实账户配置、备份操作或模型连接。 |

## 三项重点结论

### 创建：当前未发现“三项都没优化好”的证据

入口是输入定义并展示类型候选；在选定类型之前没有创建节点。确认后创建带 frontmatter 的 seed，并按节点类型排入阶段工作流。现有测试覆盖并发路径冲突、阶段写入/恢复、取消和创建链路；本次相关检查通过。没有真实 Obsidian 创建验收，模型候选与知识质量也未评价。

### 去重：候选筛选与合并提交分层，主要危险副作用有检查点保护

相似度阈值产生同类型候选，用户可以忽略；选合并后不会立刻把其中一篇删除，而是先生成并确认可编辑草稿。确认后冗余笔记进入 Obsidian 回收站（非永久删除），操作可从日志恢复。现有测试覆盖链接替换、主笔记字段、并发确认、回收站阶段失败和冗余笔记编辑保护；本次相关检查通过。未证明真实宿主 Vault 与真实回收站行为。

**静态疑点（未复现）：确认到主笔记覆盖之间有并发编辑窗口。** `duplicate-merge-service.ts:350-367` 在确认时读取主笔记、据此构造整篇目标文本，然后等待操作日志保存；`418-424` 随后无内容一致性检查地整篇替换主笔记。若用户在确认后、日志保存期间编辑了主笔记，该编辑可能被覆盖。最小触发步骤：确认合并；让首个操作日志写入延迟；延迟期间编辑主笔记；放行写入并观察该编辑是否消失。建议在替换前核对主笔记仍等于确认时快照；不符则暂停到可恢复冲突状态，不覆盖。现有测试保护了“冗余笔记在索引期间编辑”，没有覆盖“主笔记在确认与首次写入间编辑”。

### 制卡：快照、整批追加和取消边界有明确实现及测试

源正文在排队时固定；目标路径镜像知识目录相对路径并追加 `-decks.md`。追加时保留已有文件内容与手工编辑；新文件创建时添加 decks 标签。已测迟到结果不追加、响应不完整不追加、完成状态恢复不重复追加、运行中断不自动重发。本次相关检查通过。真实 Obsidian 文件并发与 Decks 插件渲染、生成内容可用性未验。

## 测试与审计证据

- 实际运行：`npm exec vitest -- --run src/core/create-orchestrator.test.ts src/core/duplicate-manager.test.ts src/core/merge-draft-generation-service.test.ts src/core/duplicate-merge-service.test.ts src/core/card-generation.test.ts src/core/cards-task-executor.test.ts src/core/card-generation-service.test.ts src/core/workflow-scenarios.test.ts src/ui/svelte/merge-links.test.ts`
- 结果：9 个测试文件通过，143 项通过，0 失败。没有另跑全量检查、lint、构建或模型/网络推理；这次只审计与重点业务相关的既有用例。
- 测试基于仓库 `__mocks__/obsidian.ts` 与测试内存 Vault/mock，不代表真实 Obsidian UI、文件系统/回收站行为或模型结果质量。
- 源仓库 HEAD 与委派给本任务的基线一致，开始时工作区 clean；报告之外没有源码改动。

## 两个安装目录的包差异

分别核对了自研源码插件目录和已打开 OneDrive 笔记库插件目录中的 `main.js`、manifest、样式；没有读取 `data.json`、凭据或笔记。manifest 的 SHA-256 均为 `3558f1139505758e559bedb2621e3b785b56345a9fdac000a59e56f351991efb`，`styles.css` 的 SHA-256 均为 `8fb716f74beee5c0ebcd3481915676d78d61a9b9cc9891f358b59a49f1241353`；两个 `main.js` 存在内容差异：源码目录 908,591 字节，SHA-256 `5363878a2c7ae2216de490746d82ac501609cbc28426ce5d10cffad1d3d852b1`；OneDrive 目录 907,593 字节，SHA-256 `0165ff08ae8c971d1b1838293e9b04397807412dee10ce6fe123804c811839d0`。OneDrive bundle 中可找到卡片与重复合并相关标识，但 minified bundle 差异不足以证明任一业务行为是否等价，也无法证明 OneDrive 包是旧包或当前实际运行包。未部署、覆盖或重载任何包。

## 真实验收仍缺少

1. 在开发库确认工作台入口、类型选择、队列交互与设置界面实际行为。
2. 使用获准测试材料验证创建、合并链接与回收站、卡片追加/Decks 展示及取消行为；避免把 mock 测试当作数据操作证明。
3. 对静态主笔记并发编辑疑点做定向复现，再决定是否修复。
4. 若要确定日常库实际加载的插件包，需单独核验运行中的 Obsidian 实例及已加载代码；本次仅比较非敏感 bundle 文件。
