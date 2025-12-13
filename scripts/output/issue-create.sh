#!/bin/bash
# API 测试脚本 - issue-create
# 生成时间: 2025-12-11T16:16:38.768Z

# 读取 Prompt
PROMPT=$(cat "scripts\output\issue-create.txt")

# OpenAI API 配置
API_KEY="your-api-key-here"
API_URL="https://api.openai.com/v1/chat/completions"
MODEL="gpt-4o"

# 发送请求
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d @- <<EOF
{
  "model": "$MODEL",
  "messages": [
    {
      "role": "user",
      "content": $(echo "$PROMPT" | jq -Rs .)
    }
  ],
  "temperature": 0.7,
  "max_tokens": 4000
}
EOF
