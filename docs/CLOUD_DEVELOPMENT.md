# 开发环境

## 安装与构建

使用 Node.js 24，具体固定版本见 `.nvmrc`；npm 版本见 `package.json` 的 packageManager。通过 `npm ci` 使用现有 package-lock.json 安装，不用 npm update 替代锁文件安装。

安装阶段需要访问依赖源。开发范围与模型验收约束见[开发约定](../AGENTS.md)。

## 检查

```sh
npm run check
npm run check:test
npm run lint
npm test
node --test scripts/*.node-test.mjs
npm run build
```

按变更运行相关测试。check 检查 TypeScript 和 Svelte，check:test 检查测试类型。build 包含 check 并生成 main.js。源码沿用仓库现有命名，注释说明原因。

## 运行与发行

本地构建加载与云端产物边界见[开发约定](../AGENTS.md)，真实宿主操作见[Obsidian 验收](OBSIDIAN_UI_TESTING.md)。

发行包安装内容见[安装说明](../README.md#安装)，另附 LICENSE。程序版本同步 package.json、package-lock.json、manifest.json 与 versions.json；提示词身份由 task-execution-support.ts 定义。外部协议版本和依赖版本遵循各自规范。

修改模板后的离线导出方式见[提示词检查](PROMPTS.md#离线检查)，模型测试按[开发约定](../AGENTS.md)执行。

Git 提交描述最终行为，使用英文。推送与发布按[开发约定](../AGENTS.md)执行。
