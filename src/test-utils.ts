/**
 * 测试工具函数和辅助类型
 */

import * as fc from 'fast-check';
import { CRType, NoteState, TaskType, TaskState, ProviderType } from './types';

// ============================================================================
// Fast-check Arbitraries (生成器)
// ============================================================================

/**
 * 生成知识类型
 */
export const arbCRType = (): fc.Arbitrary<CRType> =>
  fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");

/**
 * 生成笔记状态
 */
export const arbNoteState = (): fc.Arbitrary<NoteState> =>
  fc.constantFrom<NoteState>("Stub", "Draft", "Evergreen");

/**
 * 生成任务类型
 */
export const arbTaskType = (): fc.Arbitrary<TaskType> =>
  fc.constantFrom<TaskType>(
    "embedding",
    "standardizeClassify",
    "enrich",
    "reason:new",
    "reason:incremental",
    "reason:merge",
    "ground"
  );

/**
 * 生成任务状态
 */
export const arbTaskState = (): fc.Arbitrary<TaskState> =>
  fc.constantFrom<TaskState>("Pending", "Running", "Completed", "Failed", "Cancelled");

/**
 * 生成 Provider 类型
 */
export const arbProviderType = (): fc.Arbitrary<ProviderType> =>
  fc.constantFrom<ProviderType>("google", "openai");

/**
 * 生成 UUID v4
 */
export const arbUUID = (): fc.Arbitrary<string> =>
  fc.tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }), // 版本位后的 3 个字符
    fc.constantFrom('8', '9', 'a', 'b'),           // 变体位（第 4 段第 1 个字符）
    fc.hexaString({ minLength: 3, maxLength: 3 }), // 变体位后的 3 个字符
    fc.hexaString({ minLength: 12, maxLength: 12 })
  ).map(([a, b, c, variant, d, e]) => `${a}-${b}-4${c}-${variant}${d}-${e}`);

/**
 * 生成 ISO 8601 时间戳
 */
export const arbISOTimestamp = (): fc.Arbitrary<string> =>
  fc.date().map(d => d.toISOString());

/**
 * 生成非空字符串
 */
export const arbNonEmptyString = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 100 });

/**
 * 生成向量嵌入 (归一化)
 */
export const arbEmbedding = (dimensions: number = 768): fc.Arbitrary<number[]> =>
  fc.array(fc.float({ min: -1, max: 1 }), { minLength: dimensions, maxLength: dimensions })
    .map(vec => {
      // 归一化向量
      const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
      return magnitude > 0 ? vec.map(val => val / magnitude) : vec;
    });

/**
 * 生成相似度分数 (0-1)
 */
export const arbSimilarity = (): fc.Arbitrary<number> =>
  fc.float({ min: 0, max: 1, noNaN: true });

/**
 * 生成置信度分数数组 (总和为 1)
 */
export const arbConfidenceScores = (): fc.Arbitrary<number[]> =>
  fc.array(fc.float({ min: 0, max: 1 }), { minLength: 5, maxLength: 5 })
    .map(scores => {
      const sum = scores.reduce((a, b) => a + b, 0);
      return sum > 0 ? scores.map(s => s / sum) : [0.2, 0.2, 0.2, 0.2, 0.2];
    });

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 检查字符串是否为有效的 UUID v4
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * 检查字符串是否为有效的 ISO 8601 时间戳
 */
export function isValidISOTimestamp(timestamp: string): boolean {
  const date = new Date(timestamp);
  return !isNaN(date.getTime()) && date.toISOString() === timestamp;
}

/**
 * 计算两个向量的余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }
  
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * 检查数组总和是否接近目标值 (考虑浮点误差)
 */
export function sumCloseTo(arr: number[], target: number, epsilon: number = 0.0001): boolean {
  const sum = arr.reduce((a, b) => a + b, 0);
  return Math.abs(sum - target) < epsilon;
}

/**
 * 生成测试用的临时文件路径
 */
export function generateTestPath(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${prefix}-${timestamp}-${random}.md`;
}

// ============================================================================
// Mock 数据生成器
// ============================================================================

/**
 * 生成测试用的 Frontmatter
 */
export function generateMockFrontmatter(overrides?: Partial<any>): any {
  return {
    uid: fc.sample(arbUUID(), 1)[0],
    type: fc.sample(arbCRType(), 1)[0],
    status: fc.sample(arbNoteState(), 1)[0],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...overrides
  };
}

/**
 * 生成测试用的任务记录
 */
export function generateMockTask(overrides?: Partial<any>): any {
  return {
    id: fc.sample(arbUUID(), 1)[0],
    nodeId: fc.sample(arbUUID(), 1)[0],
    taskType: fc.sample(arbTaskType(), 1)[0],
    state: fc.sample(arbTaskState(), 1)[0],
    attempt: 0,
    maxAttempts: 3,
    payload: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...overrides
  };
}
