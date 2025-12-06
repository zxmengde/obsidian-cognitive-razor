/**
 * URL 验证示例
 * 
 * 展示如何使用 validateUrl 函数验证自定义端点 URL
 */

import { validateUrl } from './validators';

// ============================================================================
// 示例 1: 验证 OpenAI 默认端点
// ============================================================================

const openaiUrl = 'https://api.openai.com/v1';
const openaiResult = validateUrl(openaiUrl);

if (openaiResult === null) {
  console.log('✓ OpenAI URL 有效:', openaiUrl);
} else {
  console.log('✗ OpenAI URL 无效:', openaiResult);
}

// ============================================================================
// 示例 2: 验证 Google Gemini 默认端点
// ============================================================================

const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta';
const geminiResult = validateUrl(geminiUrl);

if (geminiResult === null) {
  console.log('✓ Gemini URL 有效:', geminiUrl);
} else {
  console.log('✗ Gemini URL 无效:', geminiResult);
}

// ============================================================================
// 示例 3: 验证自定义端点（OpenRouter）
// ============================================================================

const openrouterUrl = 'https://openrouter.ai/api/v1';
const openrouterResult = validateUrl(openrouterUrl);

if (openrouterResult === null) {
  console.log('✓ OpenRouter URL 有效:', openrouterUrl);
} else {
  console.log('✗ OpenRouter URL 无效:', openrouterResult);
}

// ============================================================================
// 示例 4: 验证本地端点
// ============================================================================

const localUrl = 'http://localhost:11434';
const localResult = validateUrl(localUrl);

if (localResult === null) {
  console.log('✓ 本地 URL 有效:', localUrl);
} else {
  console.log('✗ 本地 URL 无效:', localResult);
}

// ============================================================================
// 示例 5: 处理无效 URL
// ============================================================================

const invalidUrls = [
  '',                           // 空字符串
  '   ',                        // 仅空格
  'example.com',                // 缺少协议
  'ftp://example.com',          // 错误的协议
  'https://',                   // 缺少主机名
  'https://exam ple.com',       // 包含空格
];

console.log('\n无效 URL 示例:');
invalidUrls.forEach(url => {
  const result = validateUrl(url);
  console.log(`  "${url}" -> ${result}`);
});

// ============================================================================
// 示例 6: 在 Provider 配置中使用
// ============================================================================

interface ProviderConfig {
  type: 'openai' | 'google';
  apiKey: string;
  baseUrl?: string;
  defaultChatModel: string;
  defaultEmbedModel: string;
  enabled: boolean;
}

function validateProviderConfig(config: ProviderConfig): string | null {
  // 验证 API Key
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    return 'API Key 不能为空';
  }

  // 如果提供了自定义端点，验证其格式
  if (config.baseUrl) {
    const urlError = validateUrl(config.baseUrl);
    if (urlError !== null) {
      return `自定义端点无效: ${urlError}`;
    }
  }

  // 验证模型名称
  if (!config.defaultChatModel || config.defaultChatModel.trim().length === 0) {
    return '默认聊天模型不能为空';
  }

  if (!config.defaultEmbedModel || config.defaultEmbedModel.trim().length === 0) {
    return '默认嵌入模型不能为空';
  }

  return null; // 配置有效
}

// 测试有效配置
const validConfig: ProviderConfig = {
  type: 'openai',
  apiKey: 'sk-test-key',
  baseUrl: 'https://api.openai.com/v1',
  defaultChatModel: 'gpt-4-turbo-preview',
  defaultEmbedModel: 'text-embedding-3-small',
  enabled: true,
};

const validConfigResult = validateProviderConfig(validConfig);
console.log('\n有效配置验证:', validConfigResult === null ? '✓ 通过' : `✗ ${validConfigResult}`);

// 测试无效配置（错误的 URL）
const invalidConfig: ProviderConfig = {
  type: 'openai',
  apiKey: 'sk-test-key',
  baseUrl: 'not-a-valid-url',
  defaultChatModel: 'gpt-4-turbo-preview',
  defaultEmbedModel: 'text-embedding-3-small',
  enabled: true,
};

const invalidConfigResult = validateProviderConfig(invalidConfig);
console.log('无效配置验证:', invalidConfigResult === null ? '✓ 通过' : `✗ ${invalidConfigResult}`);
