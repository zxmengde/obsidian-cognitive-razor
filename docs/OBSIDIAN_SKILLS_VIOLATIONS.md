# Obsidian Skills 违规审计
## 审计范围与方法
- Skills 覆盖：`.kiro/skills/` 下全部 26 个 `obsidian*` skill（含 `obsidian` 主规范与 25 个专项 skill）。
- 代码覆盖：扫描 121 个代码/配置文件（`main.ts`、`src/**/*.ts|svelte`、`scripts/*.js`、`manifest.json`、`package.json`、`styles.css` 等；排除 `node_modules`、构建产物、运行时数据目录）。
- 审计方法：先提取每个 skill 的强制项与建议项，再用 `rg` 全仓扫描并逐条复核；仅记录“可定位文件/行号或可直接验证缺失”的违规项。

---

## 全量 Skills 覆盖矩阵

| Skill | 结果 | 说明 |
|---|---|---|
| `obsidian` | 有违规 | 命令 ID、生命周期、A11y、类型安全、DOM/CSS、文案规范等。 |
| `obsidian-ci-integration` | 有违规 | 缺失 `.github/workflows` 与配套脚本能力。 |
| `obsidian-cli` | 无代码违规 | 该 skill 主要约束运行时验证流程。 |
| `obsidian-common-errors` | 未发现硬违规 | 关键必填项和视图注册顺序未见明显问题。 |
| `obsidian-core-workflow-a` | 有违规 | frontmatter 更新未使用 `processFrontMatter()`。 |
| `obsidian-core-workflow-b` | 有违规 | 存在键盘不可达静态交互元素。 |
| `obsidian-cost-tuning` | 未发现硬违规 | 未检出明显与建议冲突的成本热点实现。 |
| `obsidian-data-handling` | 未发现硬违规 | 当前实现未触发该 skill 的强约束项。 |
| `obsidian-debug-bundle` | 无代码违规 | 主要为故障取证流程 skill。 |
| `obsidian-deploy-integration` | 有违规 | 发布元信息仍有占位 URL，发布材料缺失。 |
| `obsidian-enterprise-rbac` | 不适用 | 当前插件非企业 RBAC 场景。 |
| `obsidian-hello-world` | 不适用 | 启动示例 skill。 |
| `obsidian-incident-runbook` | 无代码违规 | 主要为应急流程 skill。 |
| `obsidian-install-auth` | 不适用 | 环境初始化 skill。 |
| `obsidian-local-dev-loop` | 无代码违规 | 开发流程 skill。 |
| `obsidian-migration-deep-dive` | 不适用 | 迁移专用 skill。 |
| `obsidian-multi-env-setup` | 无代码违规 | 多环境流程 skill。 |
| `obsidian-observability` | 有违规 | 仍有大量直接 `console.*` 输出路径。 |
| `obsidian-performance-tuning` | 未发现硬违规 | 队列防抖/批处理路径已实现。 |
| `obsidian-prod-checklist` | 有违规 | README/CHANGELOG/CI/Lint 等准备项缺失。 |
| `obsidian-rate-limits` | 未发现硬违规 | 队列并发控制和防抖写入已实现。 |
| `obsidian-reference-architecture` | 未发现硬违规 | 分层和容器化总体符合方向。 |
| `obsidian-sdk-patterns` | 有违规 | `any`/不安全断言和 Promise 链仍存在。 |
| `obsidian-security-basics` | 有违规 | API Key 明文落盘；URL 安全校验不足。 |
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
- 影响：社区发布校验高风险（ID 命名规范冲突）。

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
- 影响：与“Obsidian 自动命名空间”约定冲突，后续迁移/审查成本上升。

## 3. `onunload()` 主动 `detachLeavesOfType`（生命周期建议）
- 关联 skills：`obsidian`
- 证据：
  - `main.ts:164`
  - `main.ts:165`
- 影响：可能干扰工作区恢复和卸载一致性。

## 4. 可点击静态元素无键盘等价交互（A11y）
- 关联 skills：`obsidian`、`obsidian-core-workflow-b`
- 证据：
  - `src/ui/svelte/workbench/DuplicateItem.svelte:52`
  - `src/ui/svelte/workbench/DuplicateItem.svelte:54`
  - `src/ui/svelte/workbench/QueueSection.svelte:172`
  - `src/ui/svelte/workbench/QueueSection.svelte:174`
- 现象：通过 `svelte-ignore a11y_*` 抑制校验，在 `div` 上直接 `onclick`，未提供 `role/button + tabindex + keydown` 等价键盘交互。

## 5. 类型安全：`any` / `as any` 仍大量存在
- 关联 skills：`obsidian`、`obsidian-sdk-patterns`
- 证据（节选）：
  - `src/core/i18n.ts:82`
  - `src/core/note-repository.ts:108`
  - `src/core/task-queue-store.ts:116`
  - `src/core/task-queue-store.ts:126`
  - `src/core/cruid-cache.ts:288`
  - `src/ui/svelte/workbench/HistorySection.svelte:121`
  - `src/ui/svelte/workbench/DuplicatesSection.svelte:63`
- 影响：削弱静态类型约束，扩大运行时错误面。

## 6. 使用 `document.createElement` 而非 Obsidian/Svelte 辅助路径
- 关联 skills：`obsidian`
- 证据：
  - `src/ui/modal-manager.ts:83`
  - `src/ui/svelte/settings/SystemTab.svelte:72`
  - `src/ui/svelte/settings/SystemTab.svelte:82`
- 影响：绕过框架约定，增加 DOM 生命周期管理风险。

## 7. 通过 JS 直接写样式（而非 class/CSS 驱动）
- 关联 skills：`obsidian`（CSS 实践）
- 证据：
  - `src/ui/undo-notification.ts:118`
  - `src/ui/undo-notification.ts:124`
  - `src/ui/feedback.ts:191`
  - `src/ui/feedback.ts:198`
  - `src/ui/feedback.ts:199`
- 影响：样式逻辑分散，主题适配与维护成本上升。

## 8. 英文 UI 文案大量 Title Case（应为 sentence case）
- 关联 skills：`obsidian`（UI 文案规范）
- 证据：
  - `src/locales/en.json:16` `"Open Workbench"`
  - `src/locales/en.json:17` `"Create Concept"`
  - `src/locales/en.json:183` `"Cognitive Razor Settings"`
- 统计：本轮规则脚本检出 230 处 Title Case 模式。

## 9. API Key 明文持久化到插件数据
- 关联 skills：`obsidian-security-basics`
- 证据：
  - `src/data/settings-store.ts:476`
  - `src/data/settings-store.ts:504`
  - `src/data/settings-store.ts:509`
- 代码：
```ts
await this.plugin.saveData(this.serializeSettings());
apiKey: redactAllApiKeys ? "" : config.apiKey
```
- 影响：本地数据泄露时敏感凭证直接暴露。

## 10. 日志链路仍大量直接 `console.*` 输出
- 关联 skills：`obsidian-observability`、`obsidian-prod-checklist`
- 证据：
  - `src/data/file-storage.ts:188`
  - `src/data/logger.ts:240`
  - `src/data/logger.ts:653`
  - `src/data/logger.ts:656`
  - `src/data/logger.ts:659`
  - `src/data/logger.ts:663`
- 影响：日志出口不统一，生产态噪音与审计一致性下降。

## 11. CI 流水线缺失（build/test/release/validate）
- 关联 skills：`obsidian-ci-integration`
- 证据：仓库缺失 `.github/workflows`（检查结果：`MISSING:.github/workflows`）。
- 影响：无法自动化执行构建、测试、发布前校验。

## 12. 发布检查项缺失（README / CHANGELOG / lint）
- 关联 skills：`obsidian-prod-checklist`、`obsidian-deploy-integration`
- 证据：
  - 根目录缺失 `README.md`（`MISSING:README.md`）
  - 根目录缺失 `CHANGELOG.md`（`MISSING:CHANGELOG.md`）
  - `package.json` scripts 无 `lint`（`package.json:7`、`package.json:9`、`package.json:10`、`package.json:16`）
  - `scripts/verify-release.js` 将 `README.md` 设为必需（`scripts/verify-release.js:52`）
- 影响：发布准备不完整，自动校验与人工审核都有阻塞风险。

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
- 影响：发布可信度和审核质量下降。

## 14. frontmatter 更新未使用 `FileManager.processFrontMatter()`
- 关联 skills：`obsidian`、`obsidian-core-workflow-a`
- 证据：
  - `src/core/task-runner.ts:393`
  - `src/core/task-runner.ts:406`
  - `src/core/task-runner.ts:408`
  - `src/core/task-runner.ts:426`
- 现象：`status/updated` 通过正则字符串替换写回，未使用官方原子 frontmatter API。
- 影响：格式漂移和并发写入冲突风险上升。

## 15. Provider URL 安全校验不足（允许 HTTP/内网地址）
- 关联 skills：`obsidian-security-basics`
- 证据：
  - `src/ui/svelte/modals/ProviderModal.svelte:133`
  - `src/data/settings-store.ts:613`
  - `src/core/provider-manager.ts:139`
  - `src/core/provider-manager.ts:226`
- 现象：仅做 `new URL` 基础校验，且允许 `http:`；未拦截 `localhost/内网`。
- 影响：存在明文传输和 SSRF 类风险面。

## 16. 计时器类型与平台兼容约定不一致（`NodeJS.Timeout`）
- 关联 skills：`obsidian`（平台兼容规则）
- 证据：
  - `src/ui/undo-notification.ts:33`
  - `src/core/task-queue.ts:631`
  - `src/core/task-queue.ts:107`
- 现象：浏览器侧计时器使用 `NodeJS.Timeout`/`ReturnType<typeof setTimeout>`，未统一 `window.setTimeout` + `number`。
- 影响：类型语义混乱，跨平台一致性变差。

## 17. Promise 链式写法替代 `async/await`
- 关联 skills：`obsidian`、`obsidian-sdk-patterns`
- 证据：
  - `src/core/task-queue-store.ts:68`
  - `src/core/task-queue-store.ts:82`
  - `src/core/pipeline-state-store.ts:96`
  - `src/core/pipeline-state-store.ts:105`
- 影响：可读性和错误链路一致性下降（相对 `async/await`）。

## 18. `Object.assign` 使用双参数（未按 skill 约定）
- 关联 skills：`obsidian`（code-quality 规则）
- 证据：
  - `src/core/task-queue.ts:413`
- 代码：
```ts
Object.assign(task, updates);
```
- 影响：与 skill 中 `Object.assign({}, base, patch)` 约定不一致，易引入原地变更副作用。

## 19. `TFile` 强制断言替代 `instanceof` 收窄
- 关联 skills：`obsidian`、`obsidian-sdk-patterns`
- 证据：
  - `src/ui/svelte/workbench/HistorySection.svelte:141`
  - `src/ui/svelte/workbench/HistorySection.svelte:142`
- 代码：
```ts
if (file && 'extension' in file) {
  currentContent = await app.vault.read(file as import('obsidian').TFile);
}
```
- 影响：绕过类型系统，潜在非 `TFile` 路径下出现运行时错误。

---

## 备注
- 本文件已按“全量 skills + 全仓代码”复审更新。
- 仅记录“可复现证据”项；流程类 skill（如 CLI/Runbook）若未触发硬约束，标记为无代码违规或不适用。
