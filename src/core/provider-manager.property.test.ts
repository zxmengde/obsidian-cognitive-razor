/**
 * ProviderManager 属性测试
 * 
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from 'fast-check';
import { ProviderManager, DEFAULT_ENDPOINTS } from './provider-manager';
import { ProviderConfig, ProviderType } from '../types';
import { arbProviderType } from '../test-utils';

// Mock fetch
global.fetch = jest.fn();

describe('ProviderManager 属性测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('属性 1: Provider 类型限制', () => {
    /**
     * **Feature: provider-simplification-and-ui-fixes, Property 1: Provider 类型限制**
     * **验证需求：1.1**
     * 
     * 对于任意系统初始化，可用的 Provider 类型列表必须仅包含 'openai' 和 'google'，不得包含其他类型。
     */
    it('应该只接受 openai 和 google 作为有效的 Provider 类型', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          (typeString) => {
            const manager = new ProviderManager();
            const config: any = {
              type: typeString,
              apiKey: 'test-key',
              defaultChatModel: 'test-model',
              defaultEmbedModel: 'test-embed',
              enabled: true,
            };

            // 只有 'openai' 和 'google' 应该被接受
            const validTypes = ['openai', 'google'];
            const shouldSucceed = validTypes.includes(typeString);

            if (shouldSucceed) {
              // 应该成功添加
              expect(() => {
                manager.setProvider('test-provider', config);
              }).not.toThrow();
              
              const providers = manager.getConfiguredProviders();
              expect(providers).toHaveLength(1);
              expect(providers[0].type).toBe(typeString);
            } else {
              // 应该抛出错误
              expect(() => {
                manager.setProvider('test-provider', config);
              }).toThrow('不支持的 Provider 类型');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('应该确保 ProviderType 类型只包含 openai 和 google', () => {
      fc.assert(
        fc.property(
          arbProviderType(),
          (providerType) => {
            // 验证生成的 Provider 类型只能是 openai 或 google
            expect(['openai', 'google']).toContain(providerType);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('应该确保 DEFAULT_ENDPOINTS 只包含 openai 和 google', () => {
      const keys = Object.keys(DEFAULT_ENDPOINTS);
      expect(keys).toHaveLength(2);
      expect(keys).toContain('openai');
      expect(keys).toContain('google');
      expect(keys).not.toContain('openrouter');
    });

    it('应该为所有有效的 Provider 类型提供默认端点', () => {
      fc.assert(
        fc.property(
          arbProviderType(),
          (providerType) => {
            // 每个有效的 Provider 类型都应该有默认端点
            expect(DEFAULT_ENDPOINTS[providerType]).toBeDefined();
            expect(typeof DEFAULT_ENDPOINTS[providerType]).toBe('string');
            expect(DEFAULT_ENDPOINTS[providerType].startsWith('https://')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('属性 3: 自定义端点持久化', () => {
    /**
     * **Feature: provider-simplification-and-ui-fixes, Property 3: 自定义端点持久化**
     * **验证需求：1.5**
     * 
     * 对于任意保存的 Provider 配置，如果包含自定义端点，则后续的 API 调用必须使用该自定义端点而非默认端点。
     */
    it('应该使用自定义端点进行 OpenAI API 调用', async () => {
      const customBaseUrl = 'https://custom-openai.example.com/v1';
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: 'openai',
        apiKey: 'test-key',
        baseUrl: customBaseUrl,
        defaultChatModel: 'test-model',
        defaultEmbedModel: 'test-embed',
        enabled: true,
      };

      manager.setProvider('test-provider', config);

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'test' },
            finish_reason: 'stop',
          }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await manager.chat({
        providerId: 'test-provider',
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const calledUrl = fetchCall[0] as string;
      
      // URL 应该使用自定义端点
      expect(calledUrl).toContain(customBaseUrl);
      expect(calledUrl).not.toContain(DEFAULT_ENDPOINTS.openai);
    });

    it('应该使用自定义端点进行 Google API 调用', async () => {
      const customBaseUrl = 'https://custom-google.example.com/v1';
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: 'google',
        apiKey: 'test-key',
        baseUrl: customBaseUrl,
        defaultChatModel: 'test-model',
        defaultEmbedModel: 'test-embed',
        enabled: true,
      };

      manager.setProvider('test-provider', config);

      const mockResponse = {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'test' }] },
            finishReason: 'STOP',
          }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await manager.chat({
        providerId: 'test-provider',
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const calledUrl = fetchCall[0] as string;
      
      // URL 应该使用自定义端点
      expect(calledUrl).toContain(customBaseUrl);
      expect(calledUrl).not.toContain(DEFAULT_ENDPOINTS.google);
    });

    it('应该在未提供自定义端点时使用 OpenAI 默认端点', async () => {
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: 'openai',
        apiKey: 'test-key',
        // 不提供 baseUrl
        defaultChatModel: 'test-model',
        defaultEmbedModel: 'test-embed',
        enabled: true,
      };

      manager.setProvider('test-provider', config);

      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'test' },
            finish_reason: 'stop',
          }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await manager.chat({
        providerId: 'test-provider',
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const calledUrl = fetchCall[0] as string;
      
      // URL 应该使用默认端点
      expect(calledUrl).toContain(DEFAULT_ENDPOINTS.openai);
    });

    it('应该在未提供自定义端点时使用 Google 默认端点', async () => {
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: 'google',
        apiKey: 'test-key',
        // 不提供 baseUrl
        defaultChatModel: 'test-model',
        defaultEmbedModel: 'test-embed',
        enabled: true,
      };

      manager.setProvider('test-provider', config);

      const mockResponse = {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'test' }] },
            finishReason: 'STOP',
          }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await manager.chat({
        providerId: 'test-provider',
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const calledUrl = fetchCall[0] as string;
      
      // URL 应该使用默认端点
      expect(calledUrl).toContain(DEFAULT_ENDPOINTS.google);
    });
  });
});
