---
description: 技术栈版本参考和最佳实践指南
---

# 技术栈版本参考 (2025年更新)

## 核心依赖版本

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 22+ LTS | Node 18 已 EOL |
| TypeScript | 5.7.x | target: ES2022 |
| esbuild | 0.25.x | 构建工具 |
| ESLint | 9.x | Flat Config |
| Obsidian | 1.5.7+ | minAppVersion |

## AI 模型（推荐默认值）

> 以下为推荐的默认模型配置，非强制要求。设计文档支持通过 Provider 配置系统自定义模型。

- **聊天**: `gpt-4o` (推荐默认), `gpt-4o-mini` (轻量替代)
- **嵌入**: `text-embedding-3-small` (推荐默认)
- **避免使用**: `gpt-3.5-turbo` (已过时，不推荐作为默认)

用户可通过设置中的 Provider 配置使用其他兼容 OpenAI 格式的服务（如 OpenRouter、Azure、本地模型等）。

## 开发规范

### TypeScript
- `strict: true`, `target: ES2022`, `moduleResolution: bundler`
- 优先 `unknown` 而非 `any`

### ESLint
- 使用 `eslint.config.js` (Flat Config)
- 不使用 `.eslintrc` 格式

### Obsidian API (1.5.7+)
- ✅ `onExternalSettingsChange` - 外部设置变更
- ✅ `prepareFuzzySearch` - 模糊搜索
- ✅ `getAvailablePathForAttachment` - 附件路径
- ❌ `prepareQuery`, `fuzzySearch` - 已弃用

## 禁止事项

- 不要使用 Node 18 或更早版本
- 不要使用 `.eslintrc` 配置格式
- 不要使用 `gpt-3.5-turbo` 作为默认模型
- 不要使用 `any` 类型（用 `unknown` 替代）
- 不要使用已弃用的 Obsidian API
