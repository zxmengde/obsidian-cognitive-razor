# 开发环境

## 安装与构建

使用 Node.js 24，具体固定版本见 `.nvmrc`；npm 版本见 `package.json` 的 packageManager。通过 `npm ci` 使用现有 package-lock.json 安装，不用 npm update 替代锁文件安装。

安装阶段需要访问依赖源。单元测试、类型检查和构建不需要模型服务、生产密钥、插件 data.json 或真实笔记。源码和开发文档限定在插件仓库内。

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

本地仓库位于开发库的插件目录，通过构建覆盖 main.js 即可加载。云端构建产物保留在云端；部署到本机前核对源码及产物。真实宿主测试直接使用本机原库的明确测试笔记，保留既有内容；不另建或注册测试库。

发行包包含 main.js、manifest.json、styles.css、完整 prompts/ 以及 LICENSE。程序版本同步 package.json、package-lock.json、manifest.json 与 versions.json；提示词身份由 task-execution-support.ts 定义。外部协议版本和依赖版本遵循各自规范。

修改模板后重新生成完整提示词检查稿。导出必须显式指定无凭据的合成配置，不能以日常库 data.json 作为导出输入。模型测试须使用获准的服务与测试数据，并报告实际模型及接口，不静默替换。

Git 提交描述最终行为，使用英文。日常任务可推送功能分支；master、强推、历史改写及远端删除按项目授权规则确认后执行。
