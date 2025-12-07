# 代码风格与约定
- 语言/类型：TypeScript 严格模式，target ES2022，module ESNext；模块解析 bundler；使用路径别名 `@/*` → `src/*`。
- 结构：保持分层与单向依赖（UI→core→data），main.ts 只负责生命周期、依赖注入和注册；大文件要拆分模块。
- 存储：遵循本地优先，配置存 data.json，运行时数据在 data/ 下，只有 snapshots 使用子目录；写入需快照，可撤销。
- 命令/ID：`cognitive-razor:<action>-<target>`，稳定且唯一；注册视图/状态栏使用 Obsidian API 并通过 register* 清理。
- 提示词：使用 prompts 目录模板，任务管线顺序 standardizeClassify→enrich→embedding→确认→reason:new→确认写入→去重；缺模板/Provider 时要失败并给出可诊断错误。
- 日志：循环日志 data/app.log，级别从设置，避免记录敏感信息；可逆写入前记录快照。
- UI/UX：渐进披露与注意力尊重，输入时静默非关键通知；三步完成核心任务；重复处理放在面板异步。
- 禁忌：不要引入未必要的网络调用或外部存储；不要修改非插件管理文件；不要提交生成产物/ node_modules。