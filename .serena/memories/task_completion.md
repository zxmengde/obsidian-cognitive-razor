# 任务完成检查
- 代码与 docs/公理化设计文档.md 保持一致（架构、流程、数据结构、公理约束）。
- TypeScript 编译通过：`npm run build`（含 tsc 检查 + esbuild bundle）。
- 必要测试通过：`npm test` 或覆盖率 `npm run test:coverage`。
- ESLint 无错误：`npx eslint ./src/`。
- main.js、manifest.json、styles.css（如有）在插件根目录，未提交 node_modules/ 生成物。
- 新/变更功能有清晰的命令/视图注册，ID 稳定。
- 快照/队列/向量索引等本地数据路径遵循 data/ 结构；写入前有快照，可撤销。
- 日志级别可配置且不泄露敏感信息；外部 API 调用需要显式配置的 Provider。
- 文档/设置默认值与实际实现一致；版本号与 versions.json 同步。