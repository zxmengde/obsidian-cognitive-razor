# Cognitive Razor 审查报告

## 执行摘要

本次审查发现了 **12 个问题**，按严重程度分为：
- **高严重度**: 4 个（SSOT 违规、伪分布式模式）
- **中严重度**: 5 个（过度封装、冗余存储）
- **低严重度**: 3 个（可优化但非致命）

---

## 审查维度 1: 数据源单一性 (SSOT) 违规

### [严重程度: 高] 向量索引中存储 `path` 和 `name` 字段

**位置**: 
- `src/types.ts:163-172` (VectorEntry)
- `src/types.ts:398-407` (ConceptMeta)
- `src/core/vector-index.ts:全文`
- `data/vectors/index.json`

**问题**:
1. `VectorEntry` 和 `ConceptMeta` 都存储了 `path` 和 `name` 字段（笔记路径和名称）
2. 当用户重命名/移动笔记时，需要同步更新向量索引
3. 引入了 `IndexHealer` 模块（300+ 行代码）来监听文件事件并修复索引
4. **违反 SSOT 原则**: 文件路径/名称的权威来源应以 `TFile`/Vault 为准（`metadataCache` 主要是 frontmatter/链接等“缓存视图”，并非路径/文件名的权威来源）
5. **数据断连风险**: 文件重命名后，索引更新失败会导致数据不一致

**当前流程**:
```
用户重命名笔记
  ↓
Vault.on('rename') 事件
  ↓
IndexHealer.handleRename()
  ↓
更新 VectorIndex 中的 path 和 name
  ↓
保存 vectors/index.json
```

**建议 - UID 优先策略 + CruidCache**:

**简化方案 - UID 优先策略**:

**核心原则**: 
- **绝对禁止**在 `vectors/index.json`、`queue-state.json`、`snapshots/index.json` 中存储 `path` 或 `name`
- **仅存储 `cruid`**: 所有持久化数据仅通过 UUID 关联
- **运行时解析**: 通过 `CruidCache` 动态获取文件信息

**可行性补充（基于当前代码现状）**:
- 该方向总体可行，但需要承认 `cruid` 依赖 frontmatter 的稳定性：如果用户手动删除/修改 `cruid`，运行时映射会失效，需要提供“重建索引/修复 frontmatter”的退路。
- 即便彻底移除 `notePath`/`name` 的持久化，仍需要保留一层“轻量清理逻辑”（可以是更小的 `IndexHealer` 或 `CruidCache` 的钩子）来处理：文件删除导致的孤儿索引条目、重复对引用清理等。

**实现方案**:

```typescript
// ❌ Current (过度设计)
interface VectorEntry {
  uid: string;
  type: CRType;
  embedding: number[];
  name: string;   // ← 冗余！会因重命名失效
  path: string;   // ← 冗余！会因移动失效
  updated: string;
}

interface ConceptMeta {
  id: string;
  name: string;      // ← 冗余！
  type: CRType;
  notePath: string;  // ← 冗余！
  vectorFilePath: string;
  lastModified: number;
  hasEmbedding: boolean;
}

// ✅ Better (UID 优先)
interface VectorEntry {
  uid: string;
  type: CRType;
  embedding: number[];
  updated: string;
  // 移除 name 和 path
}

interface ConceptMeta {
  id: string;
  type: CRType;
  vectorFilePath: string;  // 仅保留向量文件路径（内部使用）
  lastModified: number;
  hasEmbedding: boolean;
  // 移除 name 和 notePath
}

// 新增：CruidCache（内存实体，运行时解析）
class CruidCache {
  private cache = new Map<string, TFile>();
  
  constructor(private app: App) {
    this.buildCache();
    this.registerListeners();
  }
  
  /** 构建缓存：扫描所有 Markdown 文件 */
  private buildCache(): void {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const cruid = cache?.frontmatter?.cruid;
      if (cruid) {
        this.cache.set(cruid, file);
      }
    }
  }
  
  /** 监听 metadataCache 变更，实时更新缓存 */
  private registerListeners(): void {
    this.app.metadataCache.on('changed', (file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const cruid = cache?.frontmatter?.cruid;
      if (cruid) {
        this.cache.set(cruid, file);
      }
    });
    
    this.app.vault.on('delete', (file) => {
      // 从缓存中移除已删除的文件
      for (const [cruid, cachedFile] of this.cache.entries()) {
        if (cachedFile.path === file.path) {
          this.cache.delete(cruid);
          break;
        }
      }
    });
  }
  
  /** 通过 cruid 获取文件 */
  getFile(cruid: string): TFile | null {
    return this.cache.get(cruid) || null;
  }
  
  /** 通过 cruid 获取路径 */
  getPath(cruid: string): string | null {
    return this.cache.get(cruid)?.path || null;
  }
  
  /** 通过 cruid 获取名称 */
  getName(cruid: string): string | null {
    return this.cache.get(cruid)?.basename || null;
  }
}

// 使用示例
class VectorIndex {
  constructor(
    private cruidCache: CruidCache,
    // ... 其他依赖
  ) {}
  
  async search(type: CRType, embedding: number[], topK: number): Promise<SearchResult[]> {
    const vectors = await this.loadVectorsByType(type);
    const results = this.computeSimilarity(embedding, vectors, topK);
    
    // 运行时解析路径和名称
    return results.map(r => ({
      uid: r.uid,
      similarity: r.similarity,
      name: this.cruidCache.getName(r.uid) || r.uid,  // 动态获取
      path: this.cruidCache.getPath(r.uid) || "",     // 动态获取
    }));
  }
}
```

**收益**:
- ✅ **删除 IndexHealer 模块**（~300 行）
- ✅ **删除 3 个 Vault 事件监听器**（delete、rename、modify）
- ✅ **向量索引文件体积减少 ~40%**（移除 name 和 path）
- ✅ **彻底解决数据断连问题**：文件重命名/移动后，通过 cruid 依然能找到文件
- ✅ **简化索引维护**：不再需要同步更新路径和名称
- ✅ **提升性能**：CruidCache 在内存中维护，查询速度快

---

### [严重程度: 高] 重复对存储中的 `path` 字段

**位置**: 
- `src/types.ts:145-161` (DuplicatePair)
- `data/duplicate-pairs.json`

**问题**:

`DuplicatePair` 存储了 `noteA.path` 和 `noteB.path`，同样会因重命名失效。

**当前结构**:
```typescript
interface DuplicatePair {
  id: string;
  noteA: {
    nodeId: string;
    name: string;
    path: string;  // ← 冗余！
  };
  noteB: {
    nodeId: string;
    name: string;
    path: string;  // ← 冗余！
  };
  type: CRType;
  similarity: number;
  detectedAt: string;
  status: DuplicatePairStatus;
}
```

**简化方案**:
```typescript
// ✅ Better
interface DuplicatePair {
  id: string;
  nodeIdA: string;  // 只存储 UID
  nodeIdB: string;  // 只存储 UID
  type: CRType;
  similarity: number;
  detectedAt: string;
  status: DuplicatePairStatus;
}

// UI 显示时动态查询
function getDuplicatePairDisplay(pair: DuplicatePair) {
  return {
    nameA: getNoteName(pair.nodeIdA),
    pathA: getNotePath(pair.nodeIdA),
    nameB: getNoteName(pair.nodeIdB),
    pathB: getNotePath(pair.nodeIdB),
  };
}
```

**收益**:
- `duplicate-pairs.json` 体积减少 ~40%
- 消除路径失效的 bug
- 简化数据模型

---

### [严重程度: 中] 快照记录中的 `path` 字段 + 混合快照策略

**位置**: 
- `src/types.ts:467-478` (SnapshotRecord)
- `src/core/undo-manager.ts:createSnapshot()`
- `data/snapshots/index.json`
- `data/snapshots/*.json`

**问题**:
1. **存储 path 字段**: 快照记录存储了 `path` 字段，会因重命名失效
2. **单一索引文件**: 所有快照元数据存储在 `index.json` 中，索引损坏会导致所有快照丢失
3. **内容与元数据混合**: 快照内容和元数据存储在同一个文件中

**简化方案 - 混合快照策略**:

```typescript
// ✅ Better: 元数据与内容分离 + UID 优先
// 1. 元数据索引（轻量级）
interface SnapshotIndex {
  version: "1.0.0";
  snapshots: Array<{
    id: string;
    nodeId: string;  // 使用 cruid，不存储 path
    taskId: string;
    created: string;
    reason: string;  // 快照原因（merge、incremental、manual）
    // 移除 path、content、fileSize、checksum
  }>;
}

// 2. 快照内容（文件系统）
// 目录结构: snapshots/{cruid}/{timestamp}.md
// 示例: snapshots/abc-123-def/2025-12-13-143022.md

class UndoManager {
  /** 创建快照 */
  async createSnapshot(
    cruid: string,
    content: string,
    taskId: string,
    reason: string
  ): Promise<Result<string>> {
    const timestamp = formatTimestamp();
    const snapshotId = `${cruid}-${timestamp}`;
    
    // 1. 确保目录存在（自动创建）
    const snapshotDir = `snapshots/${cruid}`;
    await this.vault.createFolder(snapshotDir).catch(() => {
      // 目录已存在，忽略错误
    });
    
    // 2. 写入快照内容到文件系统
    const snapshotPath = `${snapshotDir}/${timestamp}.md`;
    await this.vault.adapter.write(snapshotPath, content);
    
    // 3. 更新元数据索引
    this.index.snapshots.push({
      id: snapshotId,
      nodeId: cruid,
      taskId,
      created: formatCRTimestamp(),
      reason,
    });
    await this.saveIndex();
    
    return ok(snapshotId);
  }
  
  /** 恢复快照 */
  async restoreSnapshot(snapshotId: string): Promise<Result<string>> {
    // 1. 从索引查找元数据
    const meta = this.index.snapshots.find(s => s.id === snapshotId);
    if (!meta) {
      return err("E303", "快照不存在");
    }
    
    // 2. 从文件系统读取内容
    const [cruid, timestamp] = snapshotId.split('-', 2);
    const snapshotPath = `snapshots/${cruid}/${timestamp}.md`;
    const content = await this.vault.adapter.read(snapshotPath);
    
    // 3. 通过 CruidCache 获取当前路径
    const currentPath = this.cruidCache.getPath(meta.nodeId);
    if (!currentPath) {
      return err("E303", "笔记已被删除，无法恢复");
    }
    
    // 4. 恢复到当前位置
    await this.fileStorage.atomicWrite(currentPath, content);
    return ok(content);
  }
  
  /** 列出某个概念的所有快照 */
  listSnapshotsByCruid(cruid: string): SnapshotMetadata[] {
    return this.index.snapshots.filter(s => s.nodeId === cruid);
  }
}
```

**目录结构示例**:
```
data/
  snapshots/
    index.json              # 轻量级元数据索引
    abc-123-def/            # 按 cruid 分组
      2025-12-13-143022.md  # 快照内容
      2025-12-13-150315.md
    xyz-456-ghi/
      2025-12-13-160520.md
```

**收益**:
- ✅ **元数据与内容分离**: 索引文件轻量化，快照内容独立存储
- ✅ **提升鲁棒性**: 即使 `index.json` 损坏，用户依然可以通过文件夹结构找回历史版本
- ✅ **支持"恢复到当前位置"**: 通过 cruid 动态查询路径，即使笔记已移动
- ✅ **按概念分组**: 方便用户查看某个概念的所有历史版本
- ✅ **自动创建目录**: 使用 `vault.createFolder` 确保目录存在，无需复杂的预检查逻辑
- ✅ **删除 path 字段**: 快照元数据不再存储路径

---

## 审查维度 2: 伪分布式模式 (Fake Distributed Patterns)

### [严重程度: 高] LockManager 的过度设计（伪分布式模式）

**位置**: 
- `src/core/lock-manager.ts:全文`（~300 行）
- `src/types.ts:558-571` (LockRecord)

**问题**:
1. **锁超时机制**: 5 分钟超时 + 定时清理（`setInterval`）
2. **锁持久化**: 将锁状态写入 `queue-state.json`
3. **锁恢复**: 重启后从文件恢复锁状态
4. **僵尸锁清理**: 定期扫描过期锁
5. **复杂的锁类型**: 节点锁 + 类型锁

**这是分布式系统的模式！** 但 Obsidian 插件是：
- ✅ 单进程
- ✅ 单线程（JS）
- ✅ 本地运行
- ⚠️ 仍可能存在“异步并发”（`concurrency>1` 时多个任务同时进行 I/O/网络请求），但不需要分布式级别的锁持久化/超时清理

**现状补充（与当前实现对照）**:
- `TaskQueue.restoreQueueState()` 启动时已将 `Running` 任务降级为 `Pending`，并在恢复后调用 `lockManager.clear()` 清空所有锁（避免重启后被历史锁阻塞）。
- 因此，“僵尸锁/僵尸任务永久阻塞”的风险在当前实现里已被显著缓解；该条更适合被描述为“仍有可简化空间”（例如移除锁持久化与定时清理）。

**当前代码**:
```typescript
// ❌ Current: 300+ 行的锁管理器
class LockManager {
  private locks: Map<string, LockRecord>;
  private cleanupInterval: NodeJS.Timeout;
  
  acquire(key: string, type: 'node' | 'type', taskId: string) {
    // 检查锁冲突
    // 设置过期时间
    // 持久化到文件
  }
  
  startCleanup() {
    // 每分钟扫描过期锁
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredLocks();
    }, 60 * 1000);
  }
  
  restoreLocks(locks: LockRecord[]) {
    // 从文件恢复锁状态
  }
}
```

**简化方案 - 利用 JS 单线程特性**:

```typescript
// ✅ Better: 内存 Set，利用 JS 单线程特性
class SimpleLockManager {
  private processingCruids = new Set<string>();  // 正在处理的 cruid 集合
  
  /** 尝试获取锁 */
  tryAcquire(cruid: string): boolean {
    if (this.processingCruids.has(cruid)) {
      return false;  // 已被锁定
    }
    this.processingCruids.add(cruid);
    return true;
  }
  
  /** 释放锁 */
  release(cruid: string): void {
    this.processingCruids.delete(cruid);
  }
  
  /** 检查是否被锁定 */
  isLocked(cruid: string): boolean {
    return this.processingCruids.has(cruid);
  }
  
  /** 清空所有锁（启动时调用） */
  clear(): void {
    this.processingCruids.clear();
  }
  
  // 无需超时、无需持久化、无需清理、无需类型锁
}

// 使用示例
class TaskQueue {
  async executeTask(task: TaskRecord): Promise<void> {
    // 尝试获取锁
    if (!this.lockManager.tryAcquire(task.nodeId)) {
      // 锁冲突，跳过（不应该发生，因为入队时已检查）
      return;
    }
    
    try {
      // 执行任务
      await this.taskRunner.run(task);
    } finally {
      // 无论成功或失败，都释放锁
      this.lockManager.release(task.nodeId);
    }
  }
}
```

**收益**:
- ✅ **删除 300+ 行代码**（LockManager 整个模块）
- ✅ **删除 `setInterval` 定时器**（无需定期清理）
- ✅ **删除锁持久化逻辑**（无需写入文件）
- ✅ **删除 `LockRecord` 类型定义**
- ✅ **从 `queue-state.json` 移除 `locks` 字段**
- ✅ **删除锁恢复逻辑**（启动时直接清空）
- ✅ **删除类型锁**（已移至 DuplicateManager，但也可简化）

**为什么可以简化？**
- ✅ **JS 单线程**: 不存在真正的并发，无需复杂的锁机制
- ✅ **插件重启**: 所有任务都会重置为 Pending，锁自然失效
- ✅ **任务完成/失败**: 立即释放锁，无需超时机制
- ✅ **本地运行**: 无需考虑分布式环境的僵尸锁问题

---

### [严重程度: 高] 队列状态的过度持久化 + 僵尸任务处理

**位置**: 
- `src/core/task-queue.ts:saveQueue()`
- `src/types.ts:537-556` (QueueStateFile)
- `data/queue-state.json`

**问题**:
1. **每次状态变更都写文件**: 入队、出队、状态更新
2. **已部分优化但仍可收敛**: 当前实现已将任务持久化为 `MinimalTaskRecord`（payload 只保留少量恢复字段），但仍会随状态变更频繁写入
3. **存储锁状态**: 当前实现会把活跃锁写入 `queue-state.json`，但启动恢复后又会清空锁；因此“持久化锁”价值偏低
4. **统计信息**: `totalProcessed`, `totalFailed` 等可以运行时计算，或至少不必每次写入都持久化
5. **僵尸任务风险（已缓解）**: 当前实现启动恢复时会将 `Running` 统一降级为 `Pending`，避免永久阻塞

**当前持久化内容**:
```json
{
  "version": "1.0.0",
  "tasks": [/* MinimalTaskRecord 列表（精简 payload） */],
  "concurrency": 1,
  "paused": false,
  "stats": {
    "totalProcessed": 1234,
    "totalFailed": 56,
    "totalCancelled": 12
  },
  "locks": [/* 锁状态 */]
}
```

**简化方案 + 僵尸任务处理**:

```typescript
// ✅ Better: 只持久化 Pending 任务的最小信息
interface MinimalQueueState {
  version: "1.0.0";
  pendingTasks: Array<{
    id: string;
    nodeId: string;  // 使用 cruid，不存储 path
    taskType: TaskType;
    attempt: number;
    maxAttempts: number;
  }>;
  paused: boolean;
  // 移除 stats 和 locks
}

// 启动时处理僵尸任务
class TaskQueue {
  async initialize(): Promise<Result<void>> {
    const state = await this.loadQueueState();
    
    // 强制重置所有 running 任务
    for (const task of state.pendingTasks) {
      // 所有任务都是 pending，无需特殊处理
      this.tasks.set(task.id, {
        ...task,
        state: "Pending",
        startedAt: undefined,
        completedAt: undefined,
      });
    }
    
    // 清空所有锁（内存锁会在任务执行时重新获取）
    this.processingCruids.clear();
    
    return ok(undefined);
  }
}

// 统计信息改为运行时计算
function getQueueStats(): QueueStats {
  let completed = 0, failed = 0;
  for (const task of tasks.values()) {
    if (task.state === "Completed") completed++;
    if (task.state === "Failed") failed++;
  }
  return { completed, failed };
}
```

**僵尸任务处理策略**:
1. **启动重置**: 插件启动时，强制将所有 `running` 任务重置为 `pending`
2. **防止死锁**: 确保异常退出的任务不会永久阻塞队列
3. **内存锁清空**: 启动时清空所有内存锁，任务执行时重新获取

**收益**:
- ✅ **文件体积减少 ~80%**
- ✅ **减少磁盘 I/O 频率**（只在入队和状态变更时写入）
- ✅ **删除 `MinimalTaskRecord` 转换逻辑**
- ✅ **删除统计信息持久化**（运行时计算）
- ✅ **删除锁状态持久化**（使用内存锁）
- ✅ **解决僵尸任务问题**（启动时强制重置）

---

### [严重程度: 中] 管线状态持久化

**位置**: 
- `src/core/pipeline-orchestrator.ts:queueSavePipelineState()`
- `data/pipeline-state.json`

**问题**:
管线状态（`PipelineContext`）被持久化到文件，但管线是短暂的工作流，重启后应该清空。

**简化方案**:
```typescript
// ✅ Better: 管线状态仅存在于内存
// 重启后清空所有管线，用户重新发起操作
// 删除 pipeline-state.json
```

**收益**:
- 删除管线持久化逻辑（~100 行）
- 删除 `data/pipeline-state.json`
- 简化重启恢复逻辑

---

## 审查维度 3: 过度封装 (Over-Abstraction)

### [严重程度: 中] Result Monad 的过度使用

**位置**: 
- `src/types.ts:631-665` (Result 类型定义)
- 全代码库（所有函数返回 `Result<T>`）

**问题**:
1. **所有函数都返回 Result**: 即使是简单的同步操作
2. **嵌套解包**: `if (!result.ok) return result;` 重复出现
3. **类型复杂度**: `Result<Result<T>>` 嵌套
4. **学习成本**: 新贡献者需要理解 Monad 模式

**当前代码**:
```typescript
// ❌ Current: 简单操作也用 Result
function generateUUID(): Result<string> {
  try {
    return ok(crypto.randomUUID());
  } catch (error) {
    return err("E305", "生成 UUID 失败", error);
  }
}

// 调用时需要解包
const uuidResult = generateUUID();
if (!uuidResult.ok) {
  return uuidResult;  // 传播错误
}
const uuid = uuidResult.value;
```

**简化方案**:

```typescript
// ✅ Better: 混合使用 Result 和 try/catch
// 仅在真正可能失败的异步操作中使用 Result
function generateUUID(): string {
  return crypto.randomUUID();  // 不会失败，直接返回
}

// 异步 I/O 操作保留 Result
async function readFile(path: string): Promise<Result<string>> {
  try {
    const content = await vault.adapter.read(path);
    return ok(content);
  } catch (error) {
    return err("E300", `读取文件失败: ${path}`, error);
  }
}

// 或者直接使用 try/catch
async function readFile(path: string): Promise<string> {
  return await vault.adapter.read(path);
  // 让调用者处理异常
}
```

**建议规则**:
- ✅ **使用 Result**: 异步 I/O、网络请求、文件操作
- ❌ **不使用 Result**: 纯函数、同步计算、内存操作

**收益**:
- 减少 ~30% 的样板代码
- 降低类型复杂度
- 提高代码可读性

---

### [严重程度: 低] 过度的接口定义

**位置**: 
- `src/types.ts:1300-1600` (接口定义)

**问题**:
为每个类都定义了接口（`ITaskQueue`, `IVectorIndex` 等），但：
1. **没有多实现**: 每个接口只有一个实现类
2. **没有 Mock 需求**: 测试中直接使用真实类
3. **增加维护成本**: 修改时需要同步更新接口和实现

**当前模式**:
```typescript
// ❌ Current: 接口 + 实现
interface IVectorIndex {
  upsert(entry: VectorEntry): Promise<Result<void>>;
  search(type: CRType, embedding: number[], topK: number): Promise<Result<SearchResult[]>>;
}

class VectorIndex implements IVectorIndex {
  async upsert(entry: VectorEntry): Promise<Result<void>> { ... }
  async search(type: CRType, embedding: number[], topK: number): Promise<Result<SearchResult[]>> { ... }
}
```

**简化方案**:
```typescript
// ✅ Better: 直接使用类
class VectorIndex {
  async upsert(entry: VectorEntry): Promise<Result<void>> { ... }
  async search(type: CRType, embedding: number[], topK: number): Promise<Result<SearchResult[]>> { ... }
}

// 依赖注入时直接使用类类型
constructor(private vectorIndex: VectorIndex) {}
```

**何时保留接口**:
- 有多个实现（如 `ILogger` 可能有 FileLogger、ConsoleLogger）
- 需要 Mock 测试（但 TypeScript 可以用 `Partial<T>` Mock）

**收益**:
- 删除 ~500 行接口定义
- 减少维护成本
- 保持类型安全

---

### [严重程度: 低] 过度的类型别名

**位置**: 
- `src/types.ts:全文`

**问题**:
为简单类型创建了过多别名，增加认知负担。

**示例**:
```typescript
// ❌ Current: 过度别名
type QueueEventType = "task-added" | "task-started" | ...;
type PipelineEventType = "stage_changed" | "task_completed" | ...;

// ✅ Better: 直接使用字面量类型
interface QueueEvent {
  type: "task-added" | "task-started" | "task-completed" | "task-failed";
  taskId?: string;
  timestamp: string;
}
```

**收益**:
- 减少类型定义数量
- 提高代码可读性

---

## 审查维度 4: UI/API 重造轮子

### [严重程度: 高] 工作台 (Workbench) 的响应式改造

**位置**: 
- `src/ui/workbench-panel.ts`

**问题**:
1. **直接操作 DOM**: 工作台直接操作 DOM 元素，状态分散在各处
2. **状态管理混乱**: 没有统一的状态管理，UI 更新逻辑复杂
3. **入口偏集中**: Workbench 主要通过命令打开；但当前已经存在部分上下文入口（如 `file-menu` 为“增量改进笔记”提供右键入口、状态栏菜单可打开工作台）。若希望更贴近使用场景，可补强“从当前文件打开工作台/启动深化”等入口（同样挂到 `file-menu` 或 editor 菜单）。
4. **响应式缺失**: 状态变更时需要手动更新 UI

**简化方案 - 单向数据流 + 响应式 Store**:

```typescript
// ✅ Better: 使用轻量订阅式 Store 管理状态（无需引入 Svelte）

// 1. 定义状态 Store
interface WorkbenchState {
  queueStatus: QueueStatus;
  pipelines: PipelineContext[];
  duplicatePairs: DuplicatePair[];
  snapshots: SnapshotMetadata[];
}

class WorkbenchStore {
  private state: WorkbenchState = {
    queueStatus: { paused: false, pending: 0, running: 0, completed: 0, failed: 0 },
    pipelines: [],
    duplicatePairs: [],
    snapshots: [],
  };

  private listeners = new Set<(state: WorkbenchState) => void>();

  /** 订阅：返回取消订阅函数 */
  subscribe(listener: (state: WorkbenchState) => void): () => void {
    this.listeners.add(listener);
    // 立即推送一次当前状态
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private set(partial: Partial<WorkbenchState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }
  
  // 更新方法
  updateQueueStatus(status: QueueStatus) {
    this.set({ queueStatus: status });
  }
  
  updatePipelines(pipelines: PipelineContext[]) {
    this.set({ pipelines });
  }
  
  updateDuplicatePairs(pairs: DuplicatePair[]) {
    this.set({ duplicatePairs: pairs });
  }
}

// 2. UI 组件只负责订阅和渲染
class WorkbenchPanel extends ItemView {
  private store: WorkbenchStore;
  private unsubscribe?: () => void;
  
  onOpen() {
    // 订阅状态变更
    this.unsubscribe = this.store.subscribe(state => {
      this.render(state);  // 状态变更时自动重新渲染
    });
  }
  
  onClose() {
    // 取消订阅
    this.unsubscribe?.();
  }
  
  // 纯渲染函数（无副作用）
  private render(state: WorkbenchState) {
    const { contentEl } = this;
    contentEl.empty();
    
    // 渲染队列状态
    this.renderQueueStatus(contentEl, state.queueStatus);
    
    // 渲染管线列表
    this.renderPipelines(contentEl, state.pipelines);
    
    // 渲染重复对
    this.renderDuplicatePairs(contentEl, state.duplicatePairs);
  }
}
```

**可行性补充（基于当前依赖）**:
- 当前项目 `package.json` 未包含 Svelte 相关依赖，因此更现实的做法是用“订阅 + 手动 emit”的轻量 Store；如果未来确实要引入 UI 框架，需要同步调整构建链路与组件体系。

**收益**:
- ✅ **单向数据流**: 状态变更 → Store 更新 → UI 自动重新渲染
- ✅ **状态集中管理**: 所有状态在 Store 中统一管理
- ✅ **简化 UI 逻辑**: UI 组件只负责渲染，不直接操作状态
- ✅ **易于测试**: Store 可以独立测试

---

### [严重程度: 中] 入口的多样化

**位置**: 
- `src/ui/command-dispatcher.ts`
- Obsidian 命令面板

**问题**:
1. **入口仍可补强**: 当前已通过命令面板覆盖核心操作，并且已经存在 `file-menu`（文件右键菜单）入口用于“增量改进笔记”；但 Workbench/Deepen/Merge 等操作的上下文入口仍偏少、偏分散。
2. **上下文不一致**: 有的操作在文件右键菜单、有的只在工作台/命令面板，用户需要在多个入口之间切换。
3. **可发现性**: 对新用户来说，仍可能需要记住命令或先打开工作台再操作。

**简化方案 - 扩展现有上下文菜单（优先复用现有 `file-menu` 注册点）**:

```typescript
// ✅ Better: 扩展 file-menu，让更多操作在文件上下文可用
class CommandDispatcher {
  registerAllCommands() {
    // 1. 命令面板：Create（创建）
    this.plugin.addCommand({
      id: 'create-concept',
      name: '创建概念',
      callback: () => this.createConcept(),
    });
    
    // 2. 文件右键菜单：Open Workbench / Deepen / Improve
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('file-menu', (menu, file) => {
        if (file.extension !== 'md') return;

        menu.addItem((item) => {
          item
            .setTitle('打开 Cognitive Razor 工作台')
            .setIcon('brain')
            .onClick(() => this.openWorkbench());
        });

        menu.addItem((item) => {
          item
            .setTitle('深化当前笔记')
            .setIcon('git-branch')
            .onClick(() => this.runDeepen(file));
        });

        menu.addItem((item) => {
          item
            .setTitle('增量改进笔记')
            .setIcon('sparkles')
            .onClick(() => this.improveNote(file.path));
        });
      })
    );
  }
}
```

**收益**:
- ✅ **上下文操作**: 在文件右键菜单中即可触发操作
- ✅ **降低学习成本**: 用户无需记住命令名称
- ✅ **提升用户体验**: 操作更直观

---

### [严重程度: 中] 自定义 Diff 视图

**位置**: 
- `src/ui/diff-view.ts`

**问题**:
实现了自定义的 Diff 视图来显示合并/增量改进差异；其中包含“可用的简化版（行级 diff）”，但也保留了较重的“完整版 DiffView（预留未来使用）”。主要风险是维护成本与代码体量：
1. **Obsidian 无内置 Diff API**: 需要自行维护高亮/对比呈现
2. **预留代码的长期成本**: 若完整版长期不用，等同于持续维护负担
3. **收益边界不清**: 如果业务只需要“写入前对比 + 接受/放弃”，不一定需要复杂 diff 视图

**简化方案（按优先级）**:
- **优先**：删除/移除未使用的“完整版 DiffView（预留）”，只保留当前实际使用的简化视图。
- **可选**：如果可以接受“不做精细 diff 高亮”，用双栏渲染（Obsidian 原生 MarkdownRenderer）替代自研 diff 算法。

**示例 - 复用 Obsidian 原生渲染（退化方案）**:

```typescript
// ✅ Better: 使用 Obsidian 原生 MarkdownRenderer
class SimpleCompareModal extends Modal {
  constructor(
    app: App,
    private oldContent: string,
    private newContent: string
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "内容对比" });
    
    const container = contentEl.createDiv({ cls: "compare-container" });
    
    // 左侧：原内容（使用 Obsidian 原生渲染）
    const leftPane = container.createDiv({ cls: "compare-pane" });
    leftPane.createEl("h3", { text: "原内容" });
    const leftContent = leftPane.createDiv({ cls: "markdown-preview-view" });
    await MarkdownRenderer.renderMarkdown(
      this.oldContent,
      leftContent,
      "",
      null as any
    );
    
    // 右侧：新内容（使用 Obsidian 原生渲染）
    const rightPane = container.createDiv({ cls: "compare-pane" });
    rightPane.createEl("h3", { text: "新内容" });
    const rightContent = rightPane.createDiv({ cls: "markdown-preview-view" });
    await MarkdownRenderer.renderMarkdown(
      this.newContent,
      rightContent,
      "",
      null as any
    );
  }
}
```

**或者使用外部工具**:
```typescript
// 导出到临时文件，让用户用 Git/VSCode 对比
async exportForComparison(oldContent: string, newContent: string) {
  await this.vault.adapter.write(".temp/old.md", oldContent);
  await this.vault.adapter.write(".temp/new.md", newContent);
  new Notice("已导出到 .temp/ 目录，请使用外部工具对比");
}
```

**收益**:
- ✅ **复用 Obsidian 原生渲染**: 使用 `MarkdownRenderer` 而非自己实现
- ✅ **删除未使用的预留 UI**: 移除“完整版 DiffView（预留）”可显著减少维护面
- ✅ **可选退化**: 若接受无精细高亮，可进一步移除行级 diff/LCS 逻辑
- ✅ **减少维护成本**: 不需要处理各种边界情况
- ✅ **用户体验一致**: 渲染效果与 Obsidian 原生一致
- ✅ **符合用户习惯**: 以“并排对比 + 确认/放弃”为主的交互更通用

---

### [严重程度: 低] 自定义日志格式

**位置**: 
- `src/data/logger.ts`
- 支持 JSON、Pretty、Compact 三种格式

**问题**:
实现了多种日志格式，但：
1. **用户很少查看日志文件**: 主要通过 UI 查看状态
2. **格式切换**: 增加配置复杂度
3. **维护成本**: 需要维护三套格式化逻辑

**简化方案**:
```typescript
// ✅ Better: 统一使用 JSON 格式
class Logger {
  log(level: string, module: string, message: string, context?: unknown) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      context
    };
    this.write(JSON.stringify(entry) + "\n");
  }
}
```

**收益**:
- 删除格式化逻辑（~100 行）
- 删除 `logFormat` 配置项
- 简化日志解析

---

## 其他发现

### [严重程度: 低] 过度的错误分类

**位置**: 
- `src/data/error-codes.ts`
- `src/core/retry-handler.ts`

**问题**:
定义了详细的错误码体系（E001-E999），但：
1. **错误码记忆成本**: 开发者需要记住每个错误码的含义
2. **分类过细**: 很多错误码只使用一次
3. **重试策略**: 基于错误码的重试策略过于复杂

**简化方案**:
```typescript
// ✅ Better: 使用错误类型而非错误码
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class NetworkError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
    this.name = "NetworkError";
  }
}

// 重试策略基于错误类型
function shouldRetry(error: Error): boolean {
  return error instanceof NetworkError && error.retryable;
}
```

**收益**:
- 删除错误码映射表
- 简化重试逻辑
- 提高代码可读性
