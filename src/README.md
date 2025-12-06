# Cognitive Razor 源代码结构

## 目录结构

```
src/
├── ui/          # UI 层组件
│   ├── WorkbenchPanel.ts
│   ├── QueueView.ts
│   ├── DiffView.ts
│   ├── StatusBadge.ts
│   └── CommandDispatcher.ts
│
├── core/        # 应用层组件
│   ├── TaskQueue.ts
│   ├── TaskRunner.ts
│   ├── LockManager.ts
│   ├── DuplicateManager.ts
│   ├── UndoManager.ts
│   ├── ProviderManager.ts
│   ├── PromptManager.ts
│   └── Validator.ts
│
├── data/        # 数据层组件
│   ├── VectorIndex.ts
│   ├── QueueState.ts
│   ├── DuplicatePairs.ts
│   ├── Snapshots.ts
│   ├── Settings.ts
│   ├── Prompts.ts
│   └── Logger.ts
│
├── types.ts         # 核心类型定义
├── test-utils.ts    # 测试工具和生成器
└── README.md        # 本文件
```

## 架构原则

### 分层架构

系统采用三层架构，依赖关系单向：

```
UI 层 → 应用层 → 数据层
```

- **UI 层**：负责用户交互和界面展示
- **应用层**：负责业务逻辑和流程控制
- **数据层**：负责数据持久化和存储

### 类型系统

所有核心类型定义在 `types.ts` 中，包括：

- 知识类型和状态
- Frontmatter 数据模型
- 任务系统类型
- 重复检测类型
- 向量索引类型
- Provider 系统类型
- 配置系统类型
- Result 类型（用于错误处理）

### 测试策略

#### 单元测试

- 测试文件命名：`*.test.ts`
- 位置：与源文件同目录
- 运行：`npm test`

#### 属性测试

使用 fast-check 进行属性测试：

- 每个测试运行 100 次迭代
- 测试文件中使用注释标记属性编号
- 格式：`// **Feature: cognitive-razor, Property N: 属性名称**`

#### 测试工具

`test-utils.ts` 提供：

- Fast-check 生成器（Arbitraries）
- 验证函数
- Mock 数据生成器

## 开发工作流

### 安装依赖

```bash
npm install
```

### 开发模式（监听文件变化）

```bash
npm run dev
```

### 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # 监听模式
npm run test:coverage # 生成覆盖率报告
```

### 构建生产版本

```bash
npm run build
```

### TypeScript 类型检查

```bash
npx tsc --noEmit
```

## 代码规范

### TypeScript

- 启用 `strict` 模式
- 使用明确的类型注解
- 避免使用 `any`（除非必要）
- 使用 Result 类型处理错误

### 命名约定

- 接口：`I` 前缀（如 `ITaskQueue`）
- 类型：PascalCase（如 `CRType`）
- 函数：camelCase（如 `createTask`）
- 常量：UPPER_SNAKE_CASE（如 `MAX_RETRIES`）

### 导入路径

使用 `@/` 别名导入 src 目录下的模块：

```typescript
import { CRType } from '@/types';
import { TaskQueue } from '@/core/TaskQueue';
```

## 下一步

根据实现计划（tasks.md），接下来的任务是：

1. 实现数据模型和存储层（任务 2）
2. 实现向量索引和去重检测（任务 3）
3. 实现快照和撤销机制（任务 4）
4. ...

每个任务都应该：

1. 实现核心功能
2. 编写单元测试
3. 编写属性测试（如果适用）
4. 确保所有测试通过
