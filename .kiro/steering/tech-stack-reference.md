# 技术栈参考 (2025)

## 核心版本

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 22+ LTS | Node 18 已 EOL |
| TypeScript | 5.7.x | target: ES2022, strict: true |
| esbuild | 0.25.x | 构建工具 |
| ESLint | 9.x | Flat Config (eslint.config.js) |
| Obsidian | 1.5.7+ | minAppVersion |

## AI 模型（推荐）

- **聊天**: `gpt-4o` (默认), `gpt-4o-mini` (轻量)
- **嵌入**: `text-embedding-3-small`
- **避免**: `gpt-3.5-turbo` (已过时)

> 用户可通过 Provider 配置使用其他兼容 OpenAI 格式的服务

## 开发规范

### TypeScript
- `strict: true`, `target: ES2022`, `moduleResolution: bundler`
- 使用 `unknown` 而非 `any`
- 使用 Result Monad 处理错误

### ESLint
- 使用 `eslint.config.js` (Flat Config)
- ❌ 不使用 `.eslintrc` 格式

### Obsidian API (1.5.7+)
- ✅ `onExternalSettingsChange`, `prepareFuzzySearch`, `getAvailablePathForAttachment`
- ❌ `prepareQuery`, `fuzzySearch` (已弃用)

## ❌ 禁止

- Node 18 或更早版本
- `.eslintrc` 配置格式
- `gpt-3.5-turbo` 作为默认模型
- `any` 类型（用 `unknown`）
- 已弃用的 Obsidian API

## 使用方式（给 AI / 开发者）
- **生成前对齐基线**：每次写代码/脚本/配置前，先检查此表的版本与禁止项；输出必须满足 Node22+/TS5.7+/esbuild0.25/ESLint9 Flat Config，且 Obsidian API 仅用支持列表。
- **模型选型提示**：默认聊天 `gpt-4o`、嵌入 `text-embedding-3-small`；若用户要求其他 Provider，需确保 OpenAI 兼容（`provider-manager` 采用 `/chat/completions`、`/embeddings` 标准格式）。
- **命令生成**：构建/开发命令固定用 npm + esbuild；禁止输出 yarn/pnpm 或 rollup/webpack 方案，除非显式迁移且同步更新此文档。
- **API 审核**：提及新 API 时，需与 1.5.7 支持列表比对；若用到未列出的 API，必须在 PR/文档中说明兼容性策略。
- **文档驱动工作流**：生成或修改代码前，先读取 `docs/TECHNICAL_DESIGN_DOCUMENT.md` 的层次/锁/快照/原子写入要求，确保实现与本表一致；若不一致，优先修订设计文档或更新此基线后再编码。
