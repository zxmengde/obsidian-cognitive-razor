# Codex 云端开发与无 API 测试

使用仓库 `zxmengde/obsidian-cognitive-razor` 的独立开发分支。不要把旧 review/local-settings-20261001、0864da2 或7f包称为本轮最新修复；以最终恢复包 PROVENANCE.json 的新提交/tree为准。

## 环境

- Node.js 24.19.0，仓库 .nvmrc 固定该版本
- npm 11.9.0，package.json 的 packageManager 固定版本；严格使用仓库 package-lock.json 与 npm ci，不运行 npm update 或替换锁文件
- 基础安装不需要生产API密钥、真实Obsidian库、用户data.json或模型账户
- 安装阶段需访问npm官方registry下载lockfile依赖。开发/单测/构建阶段不需要模型网络服务

建议云环境setup命令：

```sh
node --version
npm --version
npm ci
```

## 标准验证

```sh
npm run lint
npm run check
npm run check:test
npm test
npm run build
```

- check覆盖TypeScript与Svelte；check:test检查测试类型
- test使用vitest/happy-dom和Obsidian mocks，不发真实模型请求
- build包含check并生成main.js。云端构建产物留在云端，不自动部署日常插件
- 需要针对测试时，用 `npm test -- src/data/runtime-data-maintenance.test.ts` 等明确文件

## 导入恢复成果

最终包包含完整source、精确源码patch和Git bundle。恢复提交的历史ID与遗失的1665/bf7不同，不能按旧hash假定恢复成功。核对包SHA256、PROVENANCE中的source tree及patch基线后，在独立分支导入；若基线或用户修改不符，先比较，不覆盖未提交更改。

Git bundle用于保全本轮新提交与完整可恢复历史；推送前仍需单独明确授权。对已有远端历史，也可从已核对的原始tree应用累计patch再提交，验证最终tree一致。这里不执行推送、PR、合并或部署。

## 宿主验收界限

单元测试不等于真实Obsidian验收。只在专用空白测试库验证长通知、设置折叠区、确认框、主题/窄屏和DataAdapter行为。不要复制真实笔记、生产密钥或日常插件data.json。真实测试连接、生成、向量补建会收费，不包含在无API测试中。
