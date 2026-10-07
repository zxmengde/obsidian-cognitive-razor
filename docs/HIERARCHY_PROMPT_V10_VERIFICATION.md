# 层级提示词 v10 验证记录

固定云端 Obsidian 测试库的独立验收已完成插件实际安装、重载及 API0；真实结构阶段调用全局串行，两笔分别为科学 Domain 与合成交通拥堵 Issue，均通过 v10 提示词、Schema 和 Provider 路径。测试仅覆盖结构阶段，未执行完整写作链路。

科学样本依照输入的广义 `core_definition` 采用 Frascati 六类。该观察不证明其分类符合用户期望的四类，也不证明任一父项已在数学意义上完整覆盖。该样本只用于验收记录，不进入生产提示词。

本仓库云端检查：`npm test -- --maxWorkers=2`（1252 项通过）、`npm run check`、`npm run check:test`、`npm run lint`、`npm run build`、默认模板迁移脚本测试（8 项通过）及 `npm run prompts:generate`（18 项生成成功）。未知自定义模板仍由迁移脚本整批拒绝；新任务需在插件重载后读取更新的磁盘模板。
