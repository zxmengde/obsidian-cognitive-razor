# Obsidian 插件开发规范

本文件包含 Obsidian 社区插件开发的通用规范。项目特定的架构约束请参考 `project-context.md`，技术栈版本要求请参考 `tech-stack-reference.md`。

---

## 构建与运行

```bash
npm install      # 安装依赖
npm run dev      # 开发模式（watch）
npm run build    # 生产构建
```

## 测试插件

将 `main.js`、`manifest.json`、`styles.css`（如有）复制到：
```
<Vault>/.obsidian/plugins/<plugin-id>/
```
重启 Obsidian 并在 **Settings → Community plugins** 中启用。

---

## Manifest 规则

`manifest.json` 必须包含：
- `id`：插件 ID（发布后不可更改）
- `name`、`version`（SemVer）、`minAppVersion`
- `description`、`isDesktopOnly`

---

## 安全与隐私

- 默认本地/离线操作，网络请求需有明确理由
- 禁止隐藏遥测，第三方服务需用户明确同意
- 禁止执行远程代码或自动更新插件代码
- 仅读写 Vault 内必要的文件
- 使用 `register*` 辅助方法注册监听器，确保卸载时清理

---

## 性能

- 保持启动轻量，延迟加载重型操作
- 避免 `onload` 中执行长时间任务
- 批量磁盘访问，避免频繁扫描 Vault
- 对文件系统事件使用防抖/节流

---

## 移动端

- 尽可能在 iOS 和 Android 上测试
- 避免使用桌面专用 API（除非 `isDesktopOnly: true`）
- 注意内存和存储限制

---

## 版本发布

1. 更新 `manifest.json` 的 `version`
2. 更新 `versions.json` 映射版本到最低 App 版本
3. 创建 GitHub Release，tag 与版本号完全一致（无 `v` 前缀）
4. 附加 `manifest.json`、`main.js`、`styles.css`（如有）

---

## 参考链接

- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [API 文档](https://docs.obsidian.md)
- [开发者政策](https://docs.obsidian.md/Developer+policies)
- [插件指南](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
