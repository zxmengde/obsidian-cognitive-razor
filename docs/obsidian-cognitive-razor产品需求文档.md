# Cognitive Razor (CR) - 产品需求与架构文档 (v 1.0. Final)

**文档密级**: Core Engineering
**适用对象**: 核心开发者, 架构师
**核心理念**: 熵减 (Entropy Reduction)、逻辑闭环 (Logical Consistency)、人机共生 (Symbiosis)

---

## 1. 系统愿景 (System Vision)

**CR 是一个基于 Obsidian 的"认知编译器"。**
它不生产信息，而是将高熵的自然语言流，通过 LLM 的逻辑推演与 Embedding 的拓扑关联，编译为低熵、强类型、去重且逻辑自洽的**知识晶体**。

-   **输入**: 模糊的自然语言概念。
-   **处理**: 标准化 $\rightarrow$ 拓扑建图 $\rightarrow$ 本质解构 $\rightarrow$ 原理结晶。
-   **输出**: 符合学术命名规范、物理隔离存储的 Markdown 知识图谱。

---

## 2. 系统公理 (System Axioms)

开发过程中必须严格遵守以下不可变规则：

1.  **语义唯一性 (Semantic Uniqueness)**: 系统中任意一个“本体”只能存在一个 UID。严禁重复造轮子。
2.  **因果层级性 (Causal Hierarchy)**: 知识节点必须且只能属于 6 种类型之一，且遵循严格的生成流向：`Domain` $\rightarrow$ `Issue` $\rightarrow$ `Theory` $\rightarrow$ `Entity/Mechanism` $\rightarrow$ `Principle`。
3.  **人机共生性 (Symbiosis)**: AI 负责生成“可能性空间”和“关联推荐”，人类拥有唯一的“写入裁决权”。**严禁 AI 静默写入文件**。
4.  **命名规范性 (Canonical Naming)**: 所有文件名必须遵循 `中文术语 (English Term)` 格式，以确保学术精确性与消歧。
5.  **本地优先性 (Local First)**: 向量索引必须驻留本地内存并持久化为 JSON，严禁依赖外部重型向量数据库。

---

## 3. 系统架构 (System Architecture)

采用 **三层模型 + 预处理层** 架构。

| 层级 | 组件名 | 模型选型 | 职责描述 |
| :--- | :--- | :--- | :--- |
| **L2-Pre** | **Standardizer** | Gemini 1.5 Flash | **入口网关**。负责用户输入的标准化格式化、类型推断、别名生成。 |
| **L1** | **Index** | Gemini Embedding + Local Memory | **海马体**。负责向量计算、本地缓存管理、查重检索、隐式关联计算。 |
| **L3** | **Brain** | Gemini 1.5 Pro/Ultra | **推理引擎**。负责 Agent A/B/C/D 的深度逻辑生成与全息构建。 |
| **L2-Reflex** | **Validator** | Gemini 1.5 Flash | **前额叶**。负责 JSON 格式校验、幻觉检测、内容清洗。 |

---

## 4. 数据与存储规范 (Data & Storage)

### 4.1 目录物理隔离 (Physical Isolation)

插件将接管以下目录结构，严禁混用：

```text
Vault Root/
├── 00_Index/          # 导航页与 MOC
├── 01_Domains/        # [Agent A] 领域
├── 02_Issues/         # [Agent B] 议题
├── 03_Theories/       # [Agent C] 理论
├── 04_Entities/       # [Agent C] 实体 (复用率最高)
├── 05_Mechanisms/     # [Agent C] 机制
└── 06_Principles/     # [Agent D] 原理
```

### 4.2 文件命名规范

*   **格式**: `中文术语 (English Term).md`
*   **示例**: `纳什均衡 (Nash Equilibrium).md`, `自组织 (Self-organization).md`
*   **正则约束**: `^[\u4e00-\u9fa5]+ \([a-zA-Z0-9 -]+\)$`

### 4.3 Frontmatter (YAML) Schema

```yaml
---
uid: "uuid-v4"
type: "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism" | "Principle"
aliases: ["Nash Equilibrium", "非合作博弈均衡"]
tags: ["#Game_Theory", "#Economics"]
status: "Evergreen"
created: "ISO-8601"
updated: "ISO-8601"
---
```

---

## 5. 核心功能模块 (Functional Modules)

### 5.1 向量引擎与持久化 (Vector Engine & Persistence)

这是系统的核心性能瓶颈，需精细实现。

*   **缓存文件**: `.obsidian/plugins/cognitive-razor/vector_cache.json`
*   **数据结构**:
    ```typescript
    interface VectorCache {
      version: number;
      entries: {
        [filepath: string]: {
          mtime: number;       // 文件修改时间戳
          uid: string;
          vector: number[];    // 768维或1536维向量
          type: string;
        }
      }
    }
    ```
*   **启动逻辑 (Cold Start)**:
    1.  读取 `vector_cache.json` 到内存 Map。
    2.  遍历 Vault 中 6 大目录下的所有 `.md` 文件。
    3.  **增量检查**:
        *   若文件不在 Cache 中 $\rightarrow$ 标记为 `DIRTY`。
        *   若文件在 Cache 中但 `file.mtime > cache.mtime` $\rightarrow$ 标记为 `DIRTY`。
        *   否则 $\rightarrow$ 保持 `CLEAN`。
    4.  对 `DIRTY` 文件调用 Embedding API 重新计算，更新内存 Map。
    5.  将更新后的 Map 写入 `vector_cache.json` (Debounce 写入，防止频繁 IO)。

### 5.2 预处理层 (L2-Pre Standardizer)

*   **触发**: 用户输入命令 `CR: Initialize Node` 并输入/选中 "博弈论"。
*   **Prompt 逻辑**:
    *   Input: "博弈论"
    *   Task: Translate to Canonical Name, Predict Type, Generate Aliases.
    *   Output: `{"name": "博弈论 (Game Theory)", "type": "Domain", "folder": "01_Domains"}`
*   **动作**:
    *   检查文件是否存在。
    *   不存在则创建，并自动填充 YAML。
    *   打开文件。

### 5.3 认知生成管线 (The Cognitive Pipeline)

#### Agent A: 领域架构师 (Mapper)
*   **输入**: Domain 笔记内容。
*   **输出**: 包含子领域列表的 JSON。
*   **后处理**: 对每个子领域名称，递归调用 **L2-Pre** 获取标准名，生成 `[[子领域 (Sub-domain)]]` 链接。

#### Agent B: 语境探针 (Probe)
*   **输入**: Issue 笔记内容。
*   **输出**: 包含相关 Theory 列表的 JSON。
*   **后处理**: 同样经过 L2-Pre 标准化链接。

#### Agent C: 理论解构者 (Deconstructor) —— *核心去重逻辑*
*   **前置动作 (RAG)**:
    1.  获取当前 Theory 的文本。
    2.  L1 检索 Top-50 相似 Entity/Mechanism。
    3.  将检索结果注入 Prompt 的 `{{vault_index}}` 变量。
*   **L3 推理**: 要求 AI 判断是 `NEW` 还是 `EXISTING`。
*   **Gatekeeper UI**:
    *   展示 AI 建议的实体列表。
    *   **冲突解决**: 若 AI 建议新建，但 L1 发现高相似度（>0.9），强制显示 "Merge Candidate" 按钮。

#### Agent D: 原理结晶者 (Synthesizer) —— *双模式*

1.  **显式合成 (Explicit)**:
    *   用户在 Graph/List 选中多个 Mechanism。
    *   右键 -> `Synthesize Principle`。
    *   L3 提取公因式，生成 Principle 笔记。

2.  **隐式推荐 (Implicit - Batch Job)**:
    *   **触发**: 每次 `vector_cache.json` 写入完成后（即一批新向量更新后）。
    *   **逻辑**:
        *   遍历新更新的 Mechanism 向量。
        *   计算其与全库其他 Domain 下 Mechanism 的余弦相似度。
        *   阈值: > 0.85。
    *   **交互**: 在 Obsidian 状态栏显示图标 `CR: 3 Insights Found`。点击打开侧边栏建议面板。

---

## 6. 开发者实施细节 (Implementation Details)

### 6.1 插件类结构

```typescript
class CognitiveRazorPlugin extends Plugin {
  promptManager: PromptManager;
  vectorManager: VectorManager;
  llmService: LLMService;

  async onload() {
    // 1. Initialize Services
    this.promptManager = new PromptManager(this);
    this.llmService = new LLMService(this.settings);
    this.vectorManager = new VectorManager(this, this.llmService);

    // 2. Load Cache & Index (Async, non-blocking)
    this.vectorManager.initializeIndex();

    // 3. Register Commands
    this.addCommand({ id: 'init-node', name: 'Initialize Node', callback: ... });
    this.addCommand({ id: 'agent-map', name: 'Agent A: Map Domain', callback: ... });
    // ... other agents
  }
}
```

### 6.2 Prompt 管理器

*   **路径**: `.obsidian/plugins/obsidian-cognitive-razor/prompts/*.md`
*   **热更新**: 每次调用 `getPrompt()` 时，检查文件 mtime 或直接读取（文件系统读取极快），确保用户修改 Prompt 后无需重启插件。

### 6.3 错误处理与回退

*   **JSON 解析失败**: L2-Reflex 自动尝试修复一次。若仍失败，输出原始文本到笔记的 `## Debug` 章节供人工查看。
*   **网络超时**: 必须实现指数退避重试 (Exponential Backoff)。

---

## 7. 用户交互流程 (UX Flow Summary)

1.  **CMD+P** -> `CR: Init` -> 输入 "熵" -> 自动跳转 `04_Entities/熵 (Entropy).md`。
2.  **CMD+P** -> `CR: Deconstruct` (Agent C)。
3.  **Loading**: 状态栏显示 "L1 Indexing... -> L3 Reasoning... -> L2 Validating..."。
4.  **Modal 弹出**:
    *   左侧: 建议新建的实体 (e.g., `微观态 (Microstate)`).
    *   右侧: 建议复用的实体 (e.g., `混乱度 (Disorder)` -> 已存在 `04_Entities/无序 (Disorder).md`).
    *   操作: 勾选确认，点击 "Write to Vault"。
5.  **后台**: 向量索引更新。
6.  **通知**: "发现新原理：热力学熵与信息熵存在同构关系，建议提取。"
