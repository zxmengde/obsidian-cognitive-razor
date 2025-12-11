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
