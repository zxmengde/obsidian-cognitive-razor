/**
 * 类型系统基础测试
 */

import { ok, err, Result } from './types';
import { isValidUUID, isValidISOTimestamp, sumCloseTo } from './test-utils';
import * as fc from 'fast-check';
import { arbUUID, arbISOTimestamp, arbConfidenceScores } from './test-utils';

describe('Result 类型', () => {
  test('ok() 创建成功结果', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('err() 创建失败结果', () => {
    const result = err('E001', 'Test error');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('E001');
      expect(result.error.message).toBe('Test error');
    }
  });
});

describe('UUID 验证', () => {
  test('有效的 UUID v4 格式', () => {
    const validUUIDs = [
      '550e8400-e29b-41d4-a716-446655440000',
      '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
      '123e4567-e89b-42d3-a456-426614174000'
    ];
    
    validUUIDs.forEach(uuid => {
      expect(isValidUUID(uuid)).toBe(true);
    });
  });

  test('无效的 UUID 格式', () => {
    const invalidUUIDs = [
      'not-a-uuid',
      '550e8400-e29b-31d4-a716-446655440000', // 版本号错误
      '550e8400-e29b-41d4-c716-446655440000', // 变体错误
      '550e8400e29b41d4a716446655440000',     // 缺少连字符
    ];
    
    invalidUUIDs.forEach(uuid => {
      expect(isValidUUID(uuid)).toBe(false);
    });
  });

  // **Feature: cognitive-razor, Property Test: UUID 生成器正确性**
  test('属性测试：生成的 UUID 都是有效的 v4 格式', async () => {
    await fc.assert(
      fc.asyncProperty(arbUUID(), async (uuid) => {
        expect(isValidUUID(uuid)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('ISO 时间戳验证', () => {
  test('有效的 ISO 8601 时间戳', () => {
    const validTimestamps = [
      '2024-01-01T00:00:00.000Z',
      '2024-12-31T23:59:59.999Z',
      new Date().toISOString()
    ];
    
    validTimestamps.forEach(ts => {
      expect(isValidISOTimestamp(ts)).toBe(true);
    });
  });

  test('无效的时间戳格式', () => {
    const invalidTimestamps = [
      'not-a-timestamp',
      '2024-01-01',
      '2024-01-01 00:00:00'
    ];
    
    invalidTimestamps.forEach(ts => {
      expect(isValidISOTimestamp(ts)).toBe(false);
    });
  });

  // **Feature: cognitive-razor, Property Test: 时间戳生成器正确性**
  test('属性测试：生成的时间戳都是有效的 ISO 8601 格式', async () => {
    await fc.assert(
      fc.asyncProperty(arbISOTimestamp(), async (timestamp) => {
        expect(isValidISOTimestamp(timestamp)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('置信度分数', () => {
  // **Feature: cognitive-razor, Property Test: 置信度总和恒等**
  test('属性测试：生成的置信度分数总和为 1', async () => {
    await fc.assert(
      fc.asyncProperty(arbConfidenceScores(), async (scores) => {
        expect(scores.length).toBe(5);
        expect(sumCloseTo(scores, 1.0)).toBe(true);
        scores.forEach(score => {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        });
      }),
      { numRuns: 100 }
    );
  });
});
