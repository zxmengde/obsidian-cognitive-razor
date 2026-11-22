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

`verification-issues.ts` 从标记块解析核查报告（展开与折叠两种呈现），按顶层列表项切分问题，并用引号内原文、再用被提及的标题在报告外定位正文行。`VerifyIssuesPanel` 只读当前文件，修改事件 300 ms 合并一次读取；勾选经 `Vault.process` 重新解析当前内容后写回，行号或标题不符即放弃。

Define 使用独立的 `AbortController`，等待期间按秒显示已用时间。取消时先中止请求再复位状态，回调据此丢弃迟到结果，输入框清空；取消不写任何持久记录。工作台入口的设置跳转通过 `settings-intent.ts` 传递，设置页收到后滚动到服务组并聚焦第一个连接测试按钮（没有服务时聚焦添加按钮）。

## 设置页与工作台

设置页使用 Obsidian 1.13 起的原生声明式设置：`CRSettingTab.getSettingDefinitions()` 调用 `settings-definitions.ts` 的 `buildSettingDefinitions` 返回分组、列表与子页面，宿主负责布局、外观、子页面导航与设置搜索索引。控件读写经 `getControlValue` / `setControlValue` 接到 `SettingsApplication`，超时以秒显示、以毫秒存储，每页数量以字符串显示、以数字存储。顺序为服务（原生列表，增删与连接测试）→ 模型（默认服务、任务模型子页面）→ 笔记与卡片（保存位置子页面）→ 生成与检索 → 显示 → 高级（执行与诊断、维护与备份子页面）。

设置变化只影响控件可见与可用时原位刷新（`refreshDomState`）；服务、默认服务、任务模型或目录变化时整页重绘（`update`），重绘按焦点所在容器中「第几行第几个控件」恢复焦点（声明式子页面不在标签页容器内，宿主的测宽下拉框不计入）。每个任务页是声明式子页面（`task-definitions.ts`），首屏为生效配置、服务、模型与任务探针，参数与能力在下一级「能力与参数」子页面，行名与参数名进入设置搜索。选了「指定」但没有有效值的输入、校验提示和进行中的任务探针存在 `TaskPageState`，跨重绘与导航保留，关闭设置页时清空；不写入占位值。子页面分组带 `cr-scope` 类，插件颜色令牌在宿主页面容器中同样可用。保存位置仍是 Svelte 渲染的子页面（`SvelteSettingPage`），打开期间推迟整页重绘，避免丢掉预览草稿。维护操作的运行状态集中在 `MaintenanceController`，按钮与结果区订阅它；同一时间只运行一项维护，离开设置页取消仍可取消的重建。确认框使用宿主 `Modal`。添加与编辑服务使用宿主 `Modal` 与原生 `Setting` 行（`service-editor-modal.ts`），表单状态、校验与配置组装在纯函数模块 `service-form.ts`；字段按协议显示，只有协议、开关等改变显隐时重绘，文字输入不重绘；高级区添加时展开、编辑时收起；表单变化使已显示的连接测试结果作废；保存中拒绝关闭。

无障碍：宿主为声明式控件渲染的下拉框、滑块与开关没有可读名称，图标按钮没有按钮角色；`ControlLabeler`（`control-labels.ts`）在设置页打开期间监听内容区，把行名补成 `aria-label`，开关标为 `switch` 并同步 `aria-checked`，可聚焦图标标为 `button`，只补缺失项。它在宿主首次读取控件值时启动（不覆写 `display()`，宿主把它当旧式设置页的回退），关闭设置页时停止；服务编辑框打开期间同样运行。连接测试、任务探针等进行中的按钮用 `aria-disabled` 而非 `disabled`，按钮不失焦，重复点击由进行中判断忽略。用作文字的状态色与强调色用 `--cr-text-warning`、`--cr-text-error`、`--cr-text-accent`，向正文色混合后在深浅主题下都不低于 4.5:1；边框与背景仍用原状态色。

工作台依次为新建概念、当前笔记、任务、相似笔记。当前笔记区显示节点名称、类型与状态，拓展、核查、卡片和核查问题都在这一区；当前文件不是知识节点时只显示一行说明。核查与卡片按对应任务的模型配置判断可用性，与识别概念同一规则。

## 语义索引维护

`SemanticIndexRebuilder` 以 `cachedRead` 读取 CRUID 缓存中的笔记并解析 frontmatter，只保留 draft 与 evergreen。嵌入文本和它的 SHA-256 哈希（`sourceHash`）只在需要比对或嵌入时计算：扫描缺失只核对索引登记与向量文件，补齐只为缺向量的笔记拼装文本。重建和单篇刷新先调用 `VectorIndex.findReusableEmbeddings`：登记与向量文件的类型、`sourceHash` 都等于本次文本哈希，且文件与当前模型和维度兼容，才沿用已存向量而不发嵌入请求。嵌入配置变化时索引已整体重置，所以同一索引内哈希相同即请求输入相同。登记不符的条目不读文件；文件读取失败的条目改为重新嵌入。`replaceAll` 对逐值未变的向量不重写文件并保留时间戳。补齐结果附带剩余缺失列表，设置页据此刷新而不再扫描；单篇成功只在本地移除该项。笔记编辑不触发重新嵌入，向量保留到显式单篇刷新或重建。

## 合并提交与内容保护

草稿请求包含类型、两篇笔记的元数据和移除插件核查块后的内容。`sectionOrder` 从 Schema 字段描述取得，理论的 `axioms` 使用与正文渲染一致的“前提”标题，避免另维护五套模板。原始全文和哈希仍保存在输入快照中，用于预览与提交保护；送模投影不携带内容哈希。合并影响预览与草稿共用 `captureMergeInput`，因此预览列出的保留项、回收站项和链接改写范围与随后提交的范围一致；预览不写任何文件，生成草稿按钮在预览到达前保持禁用。Merge 专用提示词要求固定章节、完整整合、去重及正文内保留分歧；响应校验仍只保证结构合法，语义质量须检查草稿，不能把标题或信息完整性当作代码已保证。

`MergeModal` 提交草稿后订阅任务队列，按 `workflowId` 跟随任务：完成时读取草稿进入审阅，失败、中断或取消时报告并允许重新生成；打开时若同一重复对已有进行中的合并任务，直接接上它。`merge-review.ts` 给审阅提供对照：模型会改写句子，逐行差异没有意义，因此按字符二元组覆盖率判断原文每行是否在合并稿中保留（阈值 0.6），并单独检查公式、网址、双链目标和两位以上数值是否原样出现。这一对照只提示，不参与提交校验。

`captureMergeInput` 只读取可能指向冗余笔记的文件：按元数据缓存中的链接、嵌入、属性链接与 `parents` 原文，用改写同一解析规则筛出目标为冗余笔记路径、文件名或别名的文件，没有缓存的文件照旧读取。改写仍以全文快照为准，提交时再核对全文。重复列表从任务队列取每个重复对最近的合并任务，显示“生成中”或“待审阅”；打开已完成的任务时按 `workflowId` 直接读稿，队列已无记录时才扫描草稿目录。

约束：Obsidian 提供逐文件的 `Vault.process` 原子读改写；合并日志记录阶段，不能把多文件操作变为一个事务。草稿已有两篇源笔记的内容哈希，确认日志已有主笔记全文快照和目标正文，沿用现有持久化格式。

确认时重新读取两篇源笔记并比较草稿哈希，变化则返回 `E321_MERGE_CONTENT_CHANGED`，不启动写入。写入前还用 `SemanticIndexRebuilder.checkPrerequisites` 预检单篇向量刷新条件；嵌入服务不可用时直接返回错误，避免主笔记和链接已改写而冗余笔记停在恢复列表中。`NoteRepository.replaceIfUnchanged` 在 `Vault.process` 同步回调内比较当前全文与预期快照，匹配才替换；当前全文已等于目标结果时允许恢复确认。主笔记和引用笔记均经此入口写入，冲突后的记录由原有检查点机制保存。

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
