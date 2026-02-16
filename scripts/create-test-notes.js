/**
 * 创建哲学测试笔记的脚本
 * 通过 Obsidian eval 执行
 */

const notes = [
  // ===== Domain: 认识论 =====
  {
    path: "1-领域/认识论 (Epistemology).md",
    content: `---
cruid: d001-epis-0001-0001
type: Domain
name: "认识论 (Epistemology)"
definition: "研究知识的本质、来源、范围和限度的哲学分支"
status: Draft
created: 2025-01-15 10:00:00
updated: 2025-01-15 10:00:00
aliases: [Epistemology, 知识论]
tags: [哲学, 认识论, 知识]
parents: []
---

# 认识论 (Epistemology)

## 核心定义
认识论是哲学的一个主要分支，研究知识的本质、来源、范围和限度。

## 子领域
- [[理性主义 (Rationalism)]]：强调理性和先验知识
- [[经验主义 (Empiricism)]]：强调感官经验作为知识来源

## 核心议题
- [[知识的定义问题]]：什么是知识？
- [[确证问题]]：信念如何被证成？
`
  },

  // ===== Issue: 知识的定义问题 =====
  {
    path: "2-议题/知识的定义问题 (Definition of Knowledge).md",
    content: `---
cruid: i001-know-0002-0001
type: Issue
name: "知识的定义问题 (Definition of Knowledge)"
definition: "探讨知识的充分必要条件，即什么构成真正的知识"
status: Draft
created: 2025-01-15 11:00:00
updated: 2025-01-15 11:00:00
aliases: [Definition of Knowledge, 知识定义]
tags: [认识论, 知识, 定义]
parents: ["[[认识论 (Epistemology)]]"]
---

# 知识的定义问题 (Definition of Knowledge)

## 核心定义
知识的定义问题是认识论的核心议题之一，探讨什么条件下一个信念可以被称为知识。

## 经典定义
传统上，知识被定义为"被证成的真信念"(Justified True Belief, JTB)。

## 盖梯尔问题
1963年，Edmund Gettier 提出了著名的反例，表明 JTB 条件可能不充分。

## 利益相关方观点
- **基础主义者**：知识建立在不可怀疑的基础信念之上
- **融贯论者**：知识是信念系统内部一致性的产物
- **可靠主义者**：知识来自可靠的认知过程
`
  },

  // ===== Theory: 基础主义 =====
  {
    path: "3-理论/基础主义 (Foundationalism).md",
    content: `---
cruid: t001-foun-0003-0001
type: Theory
name: "基础主义 (Foundationalism)"
definition: "主张知识结构有不可怀疑的基础信念，其他信念由此推导而来"
status: Draft
created: 2025-01-15 12:00:00
updated: 2025-01-15 12:00:00
aliases: [Foundationalism, 基础论]
tags: [认识论, 基础主义, 知识结构]
parents: ["[[知识的定义问题 (Definition of Knowledge)]]"]
---

# 基础主义 (Foundationalism)

## 核心定义
基础主义认为知识的结构类似于建筑物：存在一些不需要进一步证成的基础信念，所有其他知识都建立在这些基础之上。

## 公理
### 公理 1：基础信念的自明性
- **理由**：某些信念（如感觉经验、逻辑真理）具有内在的确定性

### 公理 2：推导的有效性
- **理由**：从基础信念出发，通过有效推理可以获得派生知识

## 代表人物
- [[笛卡尔 (Descartes)]]：经典基础主义的奠基者
- [[洛克 (Locke)]]：经验基础主义的代表
`
  },

  // ===== Entity: 笛卡尔 =====
  {
    path: "4-实体/笛卡尔 (Descartes).md",
    content: `---
cruid: e001-desc-0004-0001
type: Entity
name: "笛卡尔 (Descartes)"
definition: "法国哲学家、数学家，现代哲学之父，提出'我思故我在'"
status: Draft
created: 2025-01-15 13:00:00
updated: 2025-01-15 13:00:00
aliases: [Descartes, "René Descartes", 勒内笛卡尔]
tags: [哲学家, 理性主义, 法国]
parents: ["[[基础主义 (Foundationalism)]]"]
---

# 笛卡尔 (Descartes)

## 核心定义
勒内·笛卡尔（1596-1650），法国哲学家和数学家，被誉为"现代哲学之父"。

## 属性
- **出生年份** (数值)：1596
- **逝世年份** (数值)：1650
- **国籍** (文本)：法国
- **主要领域** (文本)：哲学、数学、物理学

## 核心贡献
- 提出方法论怀疑（Methodological Doubt）
- "我思故我在"（Cogito ergo sum）
- 心物二元论（Mind-Body Dualism）
- 解析几何的创立

## 整体论
- **组成部分**：方法论怀疑、心物二元论、解析几何
- **所属系统**：理性主义哲学传统
`
  },

  // ===== Mechanism: 方法论怀疑 =====
  {
    path: "5-机制/方法论怀疑 (Methodological Doubt).md",
    content: `---
cruid: m001-meth-0005-0001
type: Mechanism
name: "方法论怀疑 (Methodological Doubt)"
definition: "通过系统性地怀疑一切可怀疑的信念来寻找不可怀疑的知识基础"
status: Draft
created: 2025-01-15 14:00:00
updated: 2025-01-15 14:00:00
aliases: [Methodological Doubt, 笛卡尔怀疑法, 系统怀疑]
tags: [认识论, 方法论, 怀疑]
parents: ["[[笛卡尔 (Descartes)]]"]
---

# 方法论怀疑 (Methodological Doubt)

## 核心定义
方法论怀疑是笛卡尔提出的哲学方法，通过系统性地怀疑一切可以被怀疑的信念，来寻找绝对确定的知识基础。

## 作用对象
- 输入：[[笛卡尔 (Descartes)]] 的全部既有信念体系
- 输出：不可怀疑的基础信念（"我思故我在"）

## 因果链
### 步骤 1：感官怀疑
- 感官有时会欺骗我们，因此感官经验不可完全信赖

### 步骤 2：梦境论证
- 我们无法确定当前是否在做梦，因此日常经验可能是虚幻的

### 步骤 3：恶魔假设
- 假设存在一个全能的恶魔在欺骗我们，一切外部知识都可能是假的

### 步骤 4：我思故我在
- 即使被欺骗，"我在思考"这一事实本身不可怀疑

## 调节因素
- **理性能力** (促进)：更强的理性分析能力使怀疑更彻底
- **先入之见** (抑制)：既有偏见阻碍彻底的怀疑
`
  },

  // ===== 第二组：用于测试合并的相似概念 =====
  // 另一个 Entity: 笛卡儿（故意用不同名称，测试重复检测）
  {
    path: "4-实体/勒内笛卡儿 (Rene Descartes).md",
    content: `---
cruid: e002-desc-0006-0001
type: Entity
name: "勒内笛卡儿 (Rene Descartes)"
definition: "17世纪法国哲学家，理性主义哲学的创始人，提出我思故我在"
status: Draft
created: 2025-01-16 09:00:00
updated: 2025-01-16 09:00:00
aliases: ["Rene Descartes", 笛卡儿]
tags: [哲学家, 理性主义, 近代哲学]
parents: ["[[基础主义 (Foundationalism)]]"]
---

# 勒内笛卡儿 (Rene Descartes)

## 核心定义
勒内·笛卡儿是17世纪法国哲学家，理性主义哲学的创始人之一。

## 属性
- **出生年份** (数值)：1596
- **逝世年份** (数值)：1650
- **国籍** (文本)：法国

## 核心贡献
- 我思故我在
- 心物二元论
`
  },

  // ===== 第三组：用于测试拓展的概念 =====
  // Issue: 确证问题
  {
    path: "2-议题/确证问题 (Justification Problem).md",
    content: `---
cruid: i002-just-0007-0001
type: Issue
name: "确证问题 (Justification Problem)"
definition: "探讨信念如何获得认识论上的证成或合理性"
status: Stub
created: 2025-01-16 10:00:00
updated: 2025-01-16 10:00:00
aliases: [Justification Problem, 证成问题]
tags: [认识论, 确证, 证成]
parents: ["[[认识论 (Epistemology)]]"]
---

# 确证问题 (Justification Problem)

## 核心定义
确证问题探讨信念如何获得认识论上的证成。一个信念仅仅为真是不够的，它还需要某种形式的证成才能成为知识。
`
  },

  // Theory: 融贯论
  {
    path: "3-理论/融贯论 (Coherentism).md",
    content: `---
cruid: t002-cohe-0008-0001
type: Theory
name: "融贯论 (Coherentism)"
definition: "主张知识的证成来自信念系统内部的一致性和相互支持"
status: Stub
created: 2025-01-16 11:00:00
updated: 2025-01-16 11:00:00
aliases: [Coherentism, 一致论]
tags: [认识论, 融贯论, 知识结构]
parents: ["[[确证问题 (Justification Problem)]]"]
---

# 融贯论 (Coherentism)

## 核心定义
融贯论认为信念的证成不依赖于基础信念，而是来自信念系统内部的一致性和相互支持关系。
`
  },
];

// 输出为 JSON 供脚本使用
console.log(JSON.stringify(notes));
