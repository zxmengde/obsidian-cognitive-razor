# Obsidian Skills 违规审计（2026-02-17）

> 更新：2026-02-18 全量复审（覆盖全部 `obsidian*` skills 与全仓代码）

## 审计范围与方法
- Skills 覆盖：`.kiro/skills/` 下全部 26 个 `obsidian*` skill（含 `obsidian` 主规范与 25 个专项 skill）。
- 代码覆盖：`main.ts`、`src/**`、`scripts/**`、`manifest.json`、`package.json`、`versions.json`、`eslint.config.js`、发布相关文件。
- 审计方法：仅记录“可定位到文件/行号或可直接验证缺失”的违规项；不记录纯推测项。

---

## 全量 Skills 覆盖矩阵

| Skill | 结果 | 说明 |
|---|---|---|
| `obsidian` | 有违规 | 命令 ID、生命周期、A11y、类型安全、DOM/CSS 实践、文案规范等。 |
| `obsidian-ci-integration` | 有违规 | 缺失 `.github/workflows`。 |
| `obsidian-cli` | 无代码违规 | 该 skill 主要约束运行时验证流程。 |
| `obsidian-common-errors` | 未发现违规 | 关键必填项和视图注册顺序未发现明显问题。 |
| `obsidian-core-workflow-a` | 未发现违规 | Vault/Frontmatter 主流程未发现硬违规。 |
| `obsidian-core-workflow-b` | 有违规 | UI 可访问性存在键盘不可达交互。 |
| `obsidian-cost-tuning` | 未发现硬违规 | 未检出明显与建议冲突的成本热点实现。 |
| `obsidian-data-handling` | 未发现硬违规 | 当前实现未触发该 skill 的强约束项。 |
| `obsidian-debug-bundle` | 无代码违规 | 主要为故障取证流程 skill。 |
| `obsidian-deploy-integration` | 有违规 | 发布元信息存在占位 URL；发布材料缺失。 |
| `obsidian-enterprise-rbac` | 不适用 | 当前插件非企业 RBAC 场景。 |
| `obsidian-hello-world` | 不适用 | 启动示例 skill。 |
| `obsidian-incident-runbook` | 无代码违规 | 主要为应急流程 skill。 |
| `obsidian-install-auth` | 不适用 | 环境初始化 skill。 |
| `obsidian-local-dev-loop` | 无代码违规 | 开发流程 skill。 |
| `obsidian-migration-deep-dive` | 不适用 | 迁移专用 skill。 |
| `obsidian-multi-env-setup` | 无代码违规 | 多环境流程 skill。 |
| `obsidian-observability` | 有违规 | 存在绕过统一日志链路的 `console.*` 输出。 |
| `obsidian-performance-tuning` | 未发现硬违规 | 队列防抖/分页让步机制已实现。 |
| `obsidian-prod-checklist` | 有违规 | README/CHANGELOG/CI/Lint 准备项缺失。 |
| `obsidian-rate-limits` | 未发现硬违规 | 队列并发控制和防抖写入已实现。 |
| `obsidian-reference-architecture` | 未发现硬违规 | 分层和容器化总体符合方向。 |
| `obsidian-sdk-patterns` | 有违规 | `any`/不安全断言仍较多。 |
| `obsidian-security-basics` | 有违规 | API Key 仍以明文落盘。 |
| `obsidian-upgrade-migration` | 未发现硬违规 | 关键清理路径基本具备。 |
| `obsidian-webhooks-events` | 未发现硬违规 | 事件注册/清理未见明显违背。 |

---

## 违规明细（仅保留可复现证据）

## 1. 插件 ID 含 `obsidian`（发布规则）
- 关联 skills：`obsidian`、`obsidian-deploy-integration`、`obsidian-prod-checklist`
- 证据：`manifest.json:2`
- 代码：
```json
"id": "obsidian-cognitive-razor"
```
- 影响：社区发布校验风险高（ID 命名规范冲突）。

## 2. 命令 ID 人工前缀化（命令命名规范）
- 关联 skills：`obsidian`
- 证据：
  - `src/ui/command-utils.ts:11`
  - `src/ui/command-utils.ts:29`
  - `src/ui/command-utils.ts:30`
  - `src/ui/command-utils.ts:45`
- 代码：
```ts
const COMMAND_PREFIX = "cognitive-razor";
CREATE_CONCEPT: `${COMMAND_PREFIX}:create-concept`,
```
- 影响：与 Obsidian 命令命名空间规范冲突，迁移和校验成本上升。

## 3. `onunload()` 主动 `detachLeavesOfType`（生命周期建议）
- 关联 skills：`obsidian`
- 证据：
  - `main.ts:164`
  - `main.ts:165`
- 影响：可能干扰工作区恢复与插件卸载一致性。

## 4. 可点击静态元素无键盘支持（A11y）
- 关联 skills：`obsidian`、`obsidian-core-workflow-b`
- 证据：
  - `src/ui/svelte/workbench/DuplicateItem.svelte:52`
  - `src/ui/svelte/workbench/DuplicateItem.svelte:54`
  - `src/ui/svelte/workbench/QueueSection.svelte:172`
  - `src/ui/svelte/workbench/QueueSection.svelte:174`
- 现象：通过 `svelte-ignore a11y_*` 抑制校验，并在 `div` 上直接 `onclick`，未提供 `role/button + tabindex + keydown` 等等价键盘交互。

## 5. 类型安全：`any` / `as any` 仍大量存在
- 关联 skills：`obsidian`、`obsidian-sdk-patterns`
- 证据（节选）：
  - `src/data/settings-store.ts:1169`
  - `src/core/i18n.ts:82`
  - `src/core/note-repository.ts:108`
  - `src/core/task-queue-store.ts:114`
  - `src/core/cruid-cache.ts:287`
  - `src/ui/svelte/workbench/HistorySection.svelte:121`
  - `src/ui/svelte/workbench/DuplicatesSection.svelte:63`
- 影响：削弱静态类型约束，增加运行时错误面。

## 6. 使用 `document.createElement` 而非 Obsidian/Svelte 辅助路径
- 关联 skills：`obsidian`
- 证据：
  - `src/ui/modal-manager.ts:83`
  - `src/ui/svelte/settings/SystemTab.svelte:72`
  - `src/ui/svelte/settings/SystemTab.svelte:82`
- 影响：绕过框架约定，增加 DOM 生命周期和可维护性风险。

## 7. 通过 JS 直接写样式（而非 class/CSS 驱动）
- 关联 skills：`obsidian`（CSS 实践）
- 证据：
  - `src/ui/feedback.ts:191`
  - `src/ui/feedback.ts:198`
  - `src/ui/feedback.ts:199`
  - `src/ui/undo-notification.ts:118`
  - `src/ui/undo-notification.ts:124`
  - `src/ui/undo-notification.ts:127`
- 影响：样式逻辑分散到脚本，主题适配和维护复杂度上升。

## 8. 英文文案大量使用 Title Case（应为 sentence case）
- 关联 skills：`obsidian`（UI 文案规范）
- 证据：
  - `src/locales/en.json:16` `"Open Workbench"`
  - `src/locales/en.json:17` `"Create Concept"`
  - `src/locales/en.json:357` `"Cognitive Razor Settings"`
- 统计：在 `src/locales/en.json` 中检出 111 处 Title Case 模式。

## 9. API Key 明文持久化到插件数据
- 关联 skills：`obsidian-security-basics`
- 证据：
  - `src/data/settings-store.ts:474`
  - `src/data/settings-store.ts:502`
  - `src/data/settings-store.ts:507`
- 代码：
```ts
await this.plugin.saveData(this.serializeSettings());
apiKey: redactAllApiKeys ? "" : config.apiKey
```
- 影响：本地数据泄露时，敏感凭证直接暴露。

## 10. 仍有直接 `console.*` 输出，绕过统一日志治理
- 关联 skills：`obsidian-observability`、`obsidian-prod-checklist`
- 证据：
  - `src/data/file-storage.ts:186`
  - `src/data/logger.ts:239`
  - `src/data/logger.ts:652`
  - `src/data/logger.ts:655`
  - `src/data/logger.ts:658`
  - `src/data/logger.ts:662`
- 影响：日志出口不统一，生产态噪音与审计一致性下降。

## 11. CI 流水线缺失（build/test/release/validate）
- 关联 skills：`obsidian-ci-integration`
- 证据：仓库缺失 `.github/workflows` 目录（检查结果：`MISSING:.github/workflows`）。
- 影响：无法自动化执行构建、测试和发布前校验。

## 12. 发布检查项缺失（README / CHANGELOG / lint）
- 关联 skills：`obsidian-prod-checklist`、`obsidian-deploy-integration`
- 证据：
  - 根目录缺失 `README.md`（检查结果：`MISSING:README.md`）
  - 根目录缺失 `CHANGELOG.md`（检查结果：`MISSING:CHANGELOG.md`）
  - `package.json` scripts 无 `lint`（`package.json:7-16`）
  - `scripts/verify-release.js:52` 将 `README.md` 作为必需文件
- 影响：发布准备不完整，自动校验/人工审核均有阻塞风险。

## 13. 发布元信息仍含占位地址
- 关联 skills：`obsidian-deploy-integration`、`obsidian-prod-checklist`
- 证据：
  - `manifest.json:8`
  - `manifest.json:9`
- 代码：
```json
"authorUrl": "https://github.com/your-username/obsidian-cognitive-razor",
"fundingUrl": "https://github.com/sponsors/your-username"
```
- 影响：发布可信度与审核质量受影响。

---

## 备注
- 本文件已按“全量 skills + 全仓代码”重建，旧版中已失效的路径引用（例如已删除文件）不再保留。
