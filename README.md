# Cognitive Razor

Cognitive Razor 是面向 Obsidian 桌面端的结构化知识插件。1.0.0 将领域、议题、理论、实体、机制组织为可编辑的知识节点；默认提示词版本为 v1。

## 功能

- 定义概念并选择知识类型，按类型分阶段生成结构化笔记。
- 生成中英文名称、简繁体别名及标签，按配置目录建立内部链接。
- 根据正文拓展下位概念或抽象概念，提交前确认创建对象。
- 对现有节点进行事实核查，将报告写入独立标记块。
- 从正文生成 Obsidian Decks 记忆卡片，追加到镜像卡片文件。
- 维护语义向量、发现重复节点，预览并确认合并。
- 持久化任务与阶段结果，支持暂停、取消和有明确边界的恢复。

聊天支持 OpenAI Chat Completions、OpenAI Responses 和 Gemini Generate Content。嵌入使用 OpenAI Embeddings。搜索、思考参数、缓存与续接按服务协议及配置启用。

## 安装

将发行包解压到库内 `.obsidian/plugins/obsidian-cognitive-razor/`。插件目录须包含 `main.js`、`manifest.json`、`styles.css` 和完整 `prompts/`，然后在 Obsidian 社区插件中启用 Cognitive Razor。插件 ID 为 `cognitive-razor`，最低 Obsidian 版本见 `manifest.json`。

在设置的 AI 服务页填写服务地址、协议和模型，选择默认服务。任务留空的服务与模型继承默认配置；嵌入任务继承嵌入模型。仅声明服务实际支持的能力。

## 使用

打开 Cognitive Razor 工作台，输入概念并请求定义，确认类型后开始创建。打开已有节点后，可拓展、核查或生成卡片。自动事实核查默认关闭；可在工作流设置中开启。

默认知识目录为 `C-知识库/1-领域` 至 `C-知识库/5-机制`；卡片目录默认为 `D-习题库`，镜像知识库相对路径并追加 `-decks` 文件名后缀。目录均可配置。

模型输出需要人工判断。事实核查成功表示任务已完成；`evergreen` 是笔记工作流状态，不证明全部论断正确。服务端缓存命中以实际响应统计为准。

## 开发

使用 Node.js 24 和仓库锁文件安装依赖：`npm ci`。运行 `npm run check`、`npm run check:test`、`npm run lint`、`npm test` 及 `node --test scripts/*.node-test.mjs`；`npm run build` 生成插件主程序。

单元测试和离线提示词导出不调用模型。真实 Obsidian 与模型验收范围分别记录；运行方式见开发与验收文档。

## 文档

- [产品需求](docs/REQUIREMENTS.md)
- [运行设计](docs/DESIGN.md)
- [提示词与缓存](docs/PROMPTS.md)
- [完整提示词检查稿](prompt-examples.md)
- [开发环境](docs/CLOUD_DEVELOPMENT.md)
- [Obsidian 验收](docs/OBSIDIAN_UI_TESTING.md)
- [传输诊断](docs/TRANSPORT.md)
- [运行数据备份与恢复](docs/RUNTIME_BACKUP_RECOVERY.md)

## 许可

[MIT](LICENSE)。
