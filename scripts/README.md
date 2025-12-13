# Prompt 测试工具使用指南

## 快速开始

### 1. 安装依赖

```bash
npm install -g tsx
```

### 2. 生成 Prompt

```bash
# 生成默认场景（entity-create）
npx tsx scripts/test-prompt-builder.ts

# 生成指定场景
npx tsx scripts/test-prompt-builder.ts entity-merge

# 指定输出目录
npx tsx scripts/test-prompt-builder.ts entity-create ./my-output
```

## 可用场景

| 场景名称 | 类型 | 操作 | 说明 |
|---------|------|------|------|
| `entity-create` | Entity | create | 创建新实体（波函数） |
| `entity-merge` | Entity | merge | 合并两个实体 |
| `mechanism-incremental` | Mechanism | incremental | 增量改进机制（光电效应） |
| `domain-create` | Domain | create | 创建新领域（量子计算） |
| `issue-create` | Issue | create | 创建新议题（测量问题） |
| `theory-create` | Theory | create | 创建新理论（量子纠缠） |

## 输出文件

运行后会在 `scripts/output/` 目录生成：

1. **`{场景名}.txt`** - 完整的 Prompt 文本
2. **`{场景名}.sh`** - API 测试脚本（bash）

## API 测试

### 方法 1: 使用生成的脚本

```bash
# 1. 编辑脚本，填入 API Key
vim scripts/output/entity-create.sh

# 2. 运行测试
bash scripts/output/entity-create.sh
```

### 方法 2: 使用 curl 手动测试

```bash
# 读取 Prompt
PROMPT=$(cat scripts/output/entity-create.txt)

# 调用 OpenAI API
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "'"$PROMPT"'"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 4000
  }'
```

### 方法 3: 使用 Python

```python
import openai
import os

# 读取 Prompt
with open("scripts/output/entity-create.txt", "r", encoding="utf-8") as f:
    prompt = f.read()

# 调用 API
client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": prompt}
    ],
    temperature=0.7,
    max_tokens=4000
)

print(response.choices[0].message.content)
```

## 自定义场景

编辑 `scripts/test-prompt-builder.ts`，在 `testScenarios` 对象中添加新场景：

```typescript
const testScenarios = {
  // ... 现有场景 ...
  
  "my-custom-scenario": {
    conceptType: "Entity" as CRType,
    operation: "create" as OperationType,
    slots: {
      CTX_INPUT: "你的输入内容",
      CTX_LANGUAGE: "Chinese"
    }
  }
};
```

## 槽位说明

### Create 操作

| 槽位 | 必需 | 说明 |
|------|------|------|
| `CTX_META` | ✅ | 概念元数据（包含用户输入） |
| `CTX_LANGUAGE` | ✅ | 输出语言（Chinese/English） |

### Merge 操作

| 槽位 | 必需 | 说明 |
|------|------|------|
| `SOURCE_A_NAME` | ✅ | 源 A 的名称 |
| `CTX_SOURCE_A` | ✅ | 源 A 的完整内容 |
| `SOURCE_B_NAME` | ✅ | 源 B 的名称 |
| `CTX_SOURCE_B` | ✅ | 源 B 的完整内容 |
| `USER_INSTRUCTION` | ⚪ | 合并指令（可选） |
| `CTX_LANGUAGE` | ✅ | 输出语言 |

### Incremental 操作

| 槽位 | 必需 | 说明 |
|------|------|------|
| `CTX_CURRENT` | ✅ | 现有笔记内容 |
| `USER_INSTRUCTION` | ✅ | 改进指令 |
| `CTX_LANGUAGE` | ✅ | 输出语言 |

## 故障排查

### 错误: 文件不存在

确保在项目根目录运行脚本：

```bash
cd /path/to/obsidian-cognitive-razor
npx tsx scripts/test-prompt-builder.ts
```

### 错误: 场景不存在

查看可用场景列表：

```bash
npx tsx scripts/test-prompt-builder.ts invalid-name
```

### Prompt 中有未替换的变量

检查槽位是否完整，所有必需槽位都需要提供值。

## 高级用法

### 批量生成所有场景

```bash
for scenario in entity-create entity-merge mechanism-incremental domain-create issue-create theory-create; do
  echo "生成场景: $scenario"
  npx tsx scripts/test-prompt-builder.ts $scenario
done
```

### 比较不同操作的 Prompt

```bash
# 生成三种操作的 Prompt
npx tsx scripts/test-prompt-builder.ts entity-create
npx tsx scripts/test-prompt-builder.ts entity-merge
npx tsx scripts/test-prompt-builder.ts mechanism-incremental

# 比较文件大小
ls -lh scripts/output/*.txt
```

## 注意事项

1. **API Key 安全**: 不要将包含 API Key 的脚本提交到版本控制
2. **Token 限制**: 注意 Prompt 长度，避免超过模型的上下文限制
3. **成本控制**: 使用 `gpt-4o-mini` 进行初步测试，确认无误后再使用 `gpt-4o`
4. **输出验证**: 检查模型输出是否符合 JSON Schema 要求
