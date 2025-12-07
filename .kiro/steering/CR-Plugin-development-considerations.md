# Cognitive Razor 插件开发指导原则

## 日志系统设计

### 开发阶段日志要求

1. **详细的调试日志**:
   - 所有关键操作必须记录日志,包括但不限于:
     - 任务状态变更 (TASK_STATE_CHANGE)
     - 锁的获取和释放 (LOCK_ACQUIRED / LOCK_RELEASED)
     - 文件的读写操作 (FILE_READ / FILE_WRITE / FILE_RESTORE)
     - API 调用和响应 (API_REQUEST / API_RESPONSE)
     - 错误和异常 (ERROR / EXCEPTION)
     - 版本检查和兼容性 (VERSION_CHECK / VERSION_MISMATCH)
   
2. **结构化日志格式**:
   ```typescript
   // 日志级别（与设计文档 PluginSettings.logLevel 一致）
   type LogLevel = "debug" | "info" | "warn" | "error";
   
   interface LogEntry {
     timestamp: string;      // ISO 8601 格式
     level: LogLevel;        // 日志级别
     module: string;         // 模块名称
     event: string;          // 事件类型
     message: string;        // 人类可读消息
     context?: Record<string, unknown>;  // 上下文数据
     error?: {
       name: string;
       message: string;
       stack?: string;
     };
   }
   ```

3. **日志存储位置**:
   - 日志文件路径: `data/app.log`（与设计文档 7.6 节一致）
   - 日志文件大小限制: 1MB (循环覆盖)
   - 日志级别: 开发阶段默认 DEBUG，生产阶段默认 INFO
   - 日志级别枚举: `"debug" | "info" | "warn" | "error"`（与设计文档 PluginSettings.logLevel 一致）

4. **便于调试的日志内容**:
   - 记录函数入口和出口
   - 记录关键变量的值
   - 记录条件分支的选择
   - 记录异步操作的开始和结束
   - 记录所有错误和异常的完整堆栈

### 自主调试流程

1. **测试步骤提供**:
   - 在实现功能后,提供明确的测试步骤
   - 测试步骤应该可以在 Obsidian 中直接执行
   - 测试步骤应该覆盖主要功能和边界情况

2. **日志读取和分析**:
   - 实现后自行读取 `data/app.log` 检查执行情况
   - 分析日志中的错误和警告信息
   - 根据日志信息判断功能是否正常工作
   - 如果发现问题,直接修复并重新测试

3. **问题修复流程**:
   - 发现问题 → 分析日志 → 定位原因 → 修复代码 → 重新测试
   - 只有在无法通过日志定位问题或遇到阻断性问题时才通知用户
   - 修复后更新日志记录,确保下次能更快定位类似问题
