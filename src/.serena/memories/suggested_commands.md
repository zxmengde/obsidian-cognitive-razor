# 常用命令
- 安装依赖：`npm install`
- 开发构建（watch）：`npm run dev`
- 生产构建：`npm run build`
- Lint：`npx eslint main.ts` 和 `npx eslint ./src/`
- 自动修复：`npx eslint ./src/ --fix`
- （如需测试）已有部分单测可用 `npm test`（若未配置需补充）

# 开发辅助
- 列目录：`Get-ChildItem`（PowerShell），递归 `Get-ChildItem -Recurse`
- 搜索文本：优先使用 `rg <pattern>`
- 查看文件：`Get-Content -Raw <path>` 或 `Get-Content <path> -TotalCount N`