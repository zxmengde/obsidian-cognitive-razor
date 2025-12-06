# 需求文档

## 简介

本规格说明旨在解决 Cognitive Razor 插件中的三个关键问题：
1. 简化 Provider 配置，移除冗余的 OpenRouter，仅保留 OpenAI 和 Gemini
2. 修复设置界面中按钮无效和 `prompt() is not supported` 错误
3. 完整实现所有待实现的功能，包括创建概念、查看队列详情等

## 术语表

- **System（系统）**：Cognitive Razor 插件
- **Provider（提供商）**：AI 服务提供商，简化后仅包括 OpenAI 和 Gemini
- **Custom Endpoint（自定义端点）**：用户可配置的 API 调用端点 URL
- **Settings Tab（设置标签页）**：Obsidian 插件设置界面
- **Workbench Panel（工作台面板）**：插件的主要交互界面
- **Queue View（队列视图）**：任务队列详情视图
- **Modal（模态框）**：Obsidian 的对话框组件

## 需求

### 需求 1：Provider 简化与自定义端点支持

**用户故事**：作为用户，我想要使用简化的 Provider 配置，并能够自定义 API 端点，以便支持不同的 API 提供商（如 OpenRouter、本地模型等）。

#### 验收标准

1. WHEN 系统初始化 Provider 列表 THEN 系统应仅提供 OpenAI 和 Gemini 两种 Provider 类型
2. WHEN 用户配置 OpenAI Provider THEN 系统应提供自定义端点输入框，默认值为 `https://api.openai.com/v1`
3. WHEN 用户配置 Gemini Provider THEN 系统应提供自定义端点输入框，默认值为 `https://generativelanguage.googleapis.com/v1beta`
4. WHEN 用户修改自定义端点 THEN 系统应验证 URL 格式的有效性
5. WHEN 用户保存 Provider 配置 THEN 系统应使用自定义端点进行 API 调用

### 需求 2：设置界面按钮修复

**用户故事**：作为用户，我想要设置界面中的所有按钮都能正常工作，以便顺利配置插件。

#### 验收标准

1. WHEN 用户点击"添加提供商"按钮 THEN 系统应打开 Obsidian Modal 而不是使用 `prompt()`
2. WHEN 用户在 Modal 中选择 Provider 类型 THEN 系统应显示对应的配置表单
3. WHEN 用户点击"测试连接"按钮 THEN 系统应发送测试请求并显示结果
4. WHEN 用户点击"保存"按钮 THEN 系统应保存配置并关闭 Modal
5. WHEN 用户点击"取消"按钮 THEN 系统应关闭 Modal 而不保存更改

### 需求 3：欢迎界面自定义端点支持

**用户故事**：作为新用户，我想要在首次配置时就能设置自定义端点，以便从一开始就使用我偏好的 API 提供商。

#### 验收标准

1. WHEN 用户首次启动插件 THEN 系统应显示欢迎向导
2. WHEN 用户在欢迎向导中选择 Provider THEN 系统应显示自定义端点输入框
3. WHEN 用户输入自定义端点 THEN 系统应验证 URL 格式
4. WHEN 用户完成配置 THEN 系统应保存自定义端点到配置文件
5. WHEN 用户跳过欢迎向导 THEN 系统应使用默认端点值

### 需求 4：创建概念功能完整实现

**用户故事**：作为用户，我想要完整的创建概念功能，以便将想法转化为结构化笔记。

#### 验收标准

1. WHEN 用户在 Workbench 中输入概念描述 THEN 系统应显示"标准化"按钮
2. WHEN 用户点击"标准化"按钮 THEN 系统应调用 AI 进行标准化处理
3. WHEN 标准化完成 THEN 系统应显示中英文名称、别名和类型置信度
4. WHEN 用户点击"创建"按钮 THEN 系统应生成 Stub 笔记并触发内容生成任务
5. WHEN 笔记创建完成 THEN 系统应在编辑器中打开新笔记

### 需求 5：队列详情视图完整实现

**用户故事**：作为用户，我想要查看任务队列的详细信息，以便了解系统的工作状态。

#### 验收标准

1. WHEN 用户打开队列视图 THEN 系统应显示所有任务的列表
2. WHEN 任务列表显示 THEN 系统应包含任务类型、状态、进度和创建时间
3. WHEN 用户点击任务项 THEN 系统应展开显示任务详情（payload、错误信息等）
4. WHEN 用户点击"取消"按钮 THEN 系统应取消对应任务并更新状态
5. WHEN 用户点击"重试"按钮 THEN 系统应重新入队失败的任务

### 需求 6：重复概念管理功能完整实现

**用户故事**：作为用户，我想要完整的重复概念管理功能，以便处理语义相似的笔记。

#### 验收标准

1. WHEN 系统检测到重复概念 THEN 系统应在 Workbench 的重复面板中显示
2. WHEN 用户点击重复对 THEN 系统应显示两个笔记的预览
3. WHEN 用户点击"合并"按钮 THEN 系统应生成合并任务
4. WHEN 用户点击"忽略"按钮 THEN 系统应将重复对标记为已忽略
5. WHEN 合并完成 THEN 系统应从列表中移除该重复对

### 需求 7：增量改进功能完整实现

**用户故事**：作为用户，我想要完整的增量改进功能，以便逐步完善现有笔记。

#### 验收标准

1. WHEN 用户在笔记中右键点击 THEN 系统应显示"增量改进"菜单项
2. WHEN 用户点击"增量改进" THEN 系统应打开意图输入 Modal
3. WHEN 用户输入改进意图并确认 THEN 系统应生成改进任务
4. WHEN 改进内容生成完成 THEN 系统应打开 DiffView 显示差异
5. WHEN 用户确认改进 THEN 系统应创建快照并写入新内容

### 需求 8：撤销功能完整实现

**用户故事**：作为用户，我想要完整的撤销功能，以便恢复错误的操作。

#### 验收标准

1. WHEN 系统写入内容 THEN 系统应在通知中显示"撤销"按钮
2. WHEN 用户点击"撤销"按钮 THEN 系统应恢复文件到快照状态
3. WHEN 用户打开操作历史 THEN 系统应显示所有可撤销的操作
4. WHEN 用户在历史中选择操作 THEN 系统应显示操作详情
5. WHEN 用户确认撤销 THEN 系统应恢复对应的快照

### 需求 9：设置界面其他按钮功能实现

**用户故事**：作为用户，我想要设置界面中的所有功能都能正常工作，以便完整配置插件。

#### 验收标准

1. WHEN 用户点击"编辑提供商"按钮 THEN 系统应打开编辑 Modal 显示当前配置
2. WHEN 用户点击"设为默认"按钮 THEN 系统应将选中的 Provider 设为默认
3. WHEN 用户点击"清除日志"按钮 THEN 系统应清空日志文件
4. WHEN 用户点击"重置设置"按钮 THEN 系统应显示确认对话框
5. WHEN 用户确认重置 THEN 系统应恢复所有设置到默认值

### 需求 10：Modal 替代 prompt() 的通用实现

**用户故事**：作为开发者，我想要使用 Obsidian Modal 替代所有 `prompt()` 调用，以便在 Electron 环境中正常工作。

#### 验收标准

1. WHEN 系统需要用户输入文本 THEN 系统应使用自定义 TextInputModal
2. WHEN 系统需要用户选择选项 THEN 系统应使用自定义 SelectModal
3. WHEN 系统需要用户确认操作 THEN 系统应使用自定义 ConfirmModal
4. WHEN Modal 打开 THEN 系统应正确设置焦点到输入元素
5. WHEN 用户按 Escape 键 THEN 系统应关闭 Modal 并取消操作
