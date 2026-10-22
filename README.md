# Cognitive Razor

Cognitive Razor 是面向 Obsidian 桌面端的结构化知识插件，帮助使用者组织材料。

功能和行为约束见[产品需求](docs/REQUIREMENTS.md)，组件与持久化实现见[运行设计](docs/DESIGN.md)。

## 安装

将发行包解压到库内 `.obsidian/plugins/obsidian-cognitive-razor/`。插件目录须包含 `main.js`、`manifest.json`、`styles.css` 和完整 `prompts/`，然后在 Obsidian 社区插件中启用 Cognitive Razor。插件 ID 和最低 Obsidian 版本见 `manifest.json`。

在设置的 AI 服务页填写服务地址、协议和模型，选择默认服务。服务继承和配置约束见[服务与执行](docs/REQUIREMENTS.md#服务与执行)。

## 使用

打开 Cognitive Razor 工作台，输入概念并请求定义，确认类型后开始创建。打开已有节点后，可拓展、核查或生成卡片。自动核查在工作流设置中配置。

知识与卡片目录可以在设置中调整，默认值与卡片路径规则见[记忆卡片](docs/REQUIREMENTS.md#记忆卡片)。

判断与核查状态见[产品需求](docs/REQUIREMENTS.md#核查)，缓存统计见[提示词与缓存](docs/PROMPTS.md#默认隐式缓存)。

## 开发

安装依赖、检查和构建见[开发环境](docs/CLOUD_DEVELOPMENT.md)；开发边界与授权见[开发约定](AGENTS.md)。

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
