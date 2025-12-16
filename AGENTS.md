# Repository Guidelines

面向贡献者的快速指南，聚焦 Obsidian Cognitive Razor 插件的目录约定、开发流程与质量基线。

## 项目结构与模块组织
- `main.ts`：插件入口，组装数据层、核心编排器与 UI。
- `src/core`：任务管线、撤销、锁、向量索引、提供商与提示管理等业务编排。
- `src/data`：设置存储、文件读写、日志、校验等基础设施。
- `src/ui`：Workbench 面板、状态徽章、命令分发、设置页与引导向导。
- `src/utils` 与 `src/types.ts`：通用工具与类型定义，使用 `@/` 路径别名。
- `docs/` 技术文档，`prompts/` 内置提示集，`scripts/` 辅助脚本，打包产物输出到根目录 `main.js`。

## 构建、测试与开发命令
- `npm run dev`：esbuild watch，生成调试版 `main.js`。
- `npm run build`：TypeScript 类型检查（不输出）+ 生产模式打包。
- `npm run test` / `test:watch` / `test:ui` / `test:coverage`：Vitest 运行、监听、UI、覆盖率。
- `npm run version`：版本号自增并更新 `manifest.json`、`versions.json`（需要手动提交）。
- `npm run verify-release` / `prepare-release`：发布前校验与全流程打包校验。

## 编码风格与命名约定
- 语言：TypeScript 严格模式，ES2022 目标，`@/` 别名指向 `src/`。
- 格式：LF，UTF-8，文件末尾换行，Tab 宽度 4；保持现有行距与注释语言（中文）。
- Lint：`eslint.config.js` 基于官方/ts 推荐，允许未用参数与 `@ts-ignore`，未用变量报错；保持类型显式，避免 `any`。
- 命名：类/类型用 PascalCase，函数/变量用 camelCase，常量使用 UPPER_SNAKE_CASE，命令 ID/视图类型与 Obsidian 注册名称保持一致。

## 测试指南
- 框架：Vitest + happy-dom，支持 fast-check 性质测试。
- 位置与命名：使用 `*.test.ts` 或 `*.spec.ts`，与源文件同层或位于相邻测试目录；TypeScript 编译排除此类文件，测试编译由 Vitest 负责。
- 运行要求：修改核心流程（管线、索引、提供商、数据存取）需至少跑 `npm run test`，涉及算法或映射逻辑推荐补充性质测试；UI 交互可使用 `test:ui` 便于定位。
- 覆盖率：无硬性阈值，提交前优先跑 `npm run test:coverage` 检查关键路径。

## 提交与 PR 指南
- Commit 风格参考历史记录：支持 `feat|fix|chore|refactor|docs|test: 简要中文/英文动词短语`，保持聚焦单一责任。
- PR 要求：说明动机与范围、列出关键变更与测试结果，链接相关 Issue；UI 变更附截图或 GIF，涉及兼容/数据迁移需在描述中标注手动步骤与风险。

## 安全与配置提示
- 不要提交个人 Vault 数据、密钥或第三方凭证。
- 发布前确认 `manifest.json` 与 `versions.json` 已经通过 `npm run version` 更新且与 `prepare-release` 结果一致。
